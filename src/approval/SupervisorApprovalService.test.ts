import { afterEach, describe, expect, it } from "vitest";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

describe("SupervisorApprovalService", () => {
  const createdTaskIds: string[] = [];
  const looseAuditActors: string[] = []; // for audit events created without a Task (NOT_FOUND path)

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.recommendation.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    if (looseAuditActors.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { actor: { in: looseAuditActors } } });
      looseAuditActors.length = 0;
    }
  });

  it("logs a REQUEST_SUBMITTED audit event without creating a Task when no container resolves", async () => {
    const actor = "test-actor-notfound";
    looseAuditActors.push(actor);

    const service = new SupervisorApprovalService(new MockTOSAdapter());
    const result = await service.submitRequest({
      containerQuery: "ZZZZ9999999",
      requestedBy: actor,
      priority: "MEDIUM",
    });

    expect(result.planResult.status).toBe("NOT_FOUND");
    expect(result.task).toBeUndefined();

    const audit = await prisma.auditEvent.findFirst({ where: { actor, action: "REQUEST_SUBMITTED" } });
    expect(audit).not.toBeNull();
    expect(audit!.taskId).toBeNull();
  });

  it("persists a Task + Recommendation and logs both audit events for a READY plan", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    expect(container).not.toBeNull();

    const service = new SupervisorApprovalService(new MockTOSAdapter());
    const result = await service.submitRequest({
      containerQuery: container!.id,
      requestedBy: "test-operator",
      priority: "HIGH",
    });
    expect(result.task).toBeDefined();
    createdTaskIds.push(result.task!.id);

    expect(result.planResult.status).toBe("READY");
    expect(result.task!.status).toBe("PLANNED");
    expect(result.recommendation).toBeDefined();
    expect(result.recommendation!.taskId).toBe(result.task!.id);
    expect(result.confidence).toBeDefined();
    expect(result.recommendation!.confidenceLevel).toBe(result.confidence!.level);

    const events = await prisma.auditEvent.findMany({ where: { taskId: result.task!.id } });
    expect(events.map((e) => e.action).sort()).toEqual(["RECOMMENDATION_GENERATED", "REQUEST_SUBMITTED"]);
  });

  it("approve() sets the task to APPROVED and logs an APPROVED audit event", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const service = new SupervisorApprovalService(new MockTOSAdapter());
    const { task } = await service.submitRequest({
      containerQuery: container!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    createdTaskIds.push(task!.id);

    const approved = await service.approve(task!.id, "supervisor-1");
    expect(approved.status).toBe("APPROVED");

    const audit = await prisma.auditEvent.findFirst({
      where: { taskId: task!.id, action: "APPROVED" },
    });
    expect(audit?.actor).toBe("supervisor-1");
  });

  it("reject() sets the task to REJECTED and records the reason", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const service = new SupervisorApprovalService(new MockTOSAdapter());
    const { task } = await service.submitRequest({
      containerQuery: container!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    createdTaskIds.push(task!.id);

    const rejected = await service.reject(task!.id, "supervisor-1", "Container needed elsewhere first.");
    expect(rejected.status).toBe("REJECTED");

    const audit = await prisma.auditEvent.findFirst({
      where: { taskId: task!.id, action: "REJECTED" },
    });
    expect(JSON.parse(audit!.detailsJson)).toEqual({ reason: "Container needed elsewhere first." });
  });

  it("override() captures who/why/original-vs-new and applies the new equipment decision", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const service = new SupervisorApprovalService(new MockTOSAdapter());
    const { task, recommendation } = await service.submitRequest({
      containerQuery: container!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    createdTaskIds.push(task!.id);

    const alternateEquipment = await prisma.equipment.findFirst({
      where: { type: "YARD_TRUCK", status: "AVAILABLE", id: { not: recommendation!.equipmentId } },
    });
    expect(alternateEquipment).not.toBeNull();

    const overridden = await service.override(task!.id, "supervisor-2", "Prefer a closer truck.", {
      equipmentId: alternateEquipment!.id,
    });

    expect(overridden.status).toBe("APPROVED");
    expect(overridden.assignedEquipmentId).toBe(alternateEquipment!.id);

    const audit = await prisma.auditEvent.findFirst({
      where: { taskId: task!.id, action: "OVERRIDDEN" },
    });
    const details = JSON.parse(audit!.detailsJson);
    expect(details.reason).toBe("Prefer a closer truck.");
    expect(details.originalRecommendation.equipmentId).toBe(recommendation!.equipmentId);
    expect(details.newDecision.equipmentId).toBe(alternateEquipment!.id);
    expect(details.timestamp).toBeTruthy();
  });

  it("override() rejects a nonexistent equipment id and leaves the task unchanged", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const service = new SupervisorApprovalService(new MockTOSAdapter());
    const { task } = await service.submitRequest({
      containerQuery: container!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    createdTaskIds.push(task!.id);

    await expect(
      service.override(task!.id, "supervisor-2", "typo'd equipment id", { equipmentId: "DOES-NOT-EXIST" }),
    ).rejects.toThrow(/not in the synced cache/);

    const unchanged = await prisma.task.findUniqueOrThrow({ where: { id: task!.id } });
    expect(unchanged.status).toBe("PLANNED");
    expect(unchanged.assignedEquipmentId).toBe(task!.assignedEquipmentId);
  });

  it("override() rejects equipment that's already double-booked to another active task", async () => {
    const container1 = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const service = new SupervisorApprovalService(new MockTOSAdapter());
    const { task: task1, recommendation: recommendation1 } = await service.submitRequest({
      containerQuery: container1!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    createdTaskIds.push(task1!.id);

    const container2 = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD", id: { not: container1!.id } },
    });
    const { task: task2 } = await service.submitRequest({
      containerQuery: container2!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    createdTaskIds.push(task2!.id);

    // task2 tries to override onto the equipment task1's recommendation
    // already committed to (task1 is still PLANNED, an ACTIVE_TASK_STATUS).
    await expect(
      service.override(task2!.id, "supervisor-2", "steal task1's equipment", {
        equipmentId: recommendation1!.equipmentId,
      }),
    ).rejects.toThrow(/already committed to task/);

    const unchanged = await prisma.task.findUniqueOrThrow({ where: { id: task2!.id } });
    expect(unchanged.status).toBe("PLANNED");
  });

  it("rejects approve()/reject()/override() on a task outside their valid status", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const service = new SupervisorApprovalService(new MockTOSAdapter());
    const { task } = await service.submitRequest({
      containerQuery: container!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    createdTaskIds.push(task!.id);

    // PLANNED -> APPROVED -> REJECTED is not a legal path, but drive the
    // task there anyway to get it out of PLANNED for this test.
    await service.approve(task!.id, "supervisor-1");

    // Now APPROVED: re-approving (already past PLANNED) must be rejected.
    await expect(service.approve(task!.id, "supervisor-1")).rejects.toThrow(/must be PLANNED/);

    // APPROVED is still a legal override target (equipment can be swapped before dispatch).
    const alternateEquipment = await prisma.equipment.findFirst({
      where: { type: "YARD_TRUCK", status: "AVAILABLE" },
    });
    await service.override(task!.id, "supervisor-2", "swap before dispatch", {
      equipmentId: alternateEquipment!.id,
    });

    // Force the task to a terminal state, then confirm every guarded action rejects it.
    await prisma.task.update({ where: { id: task!.id }, data: { status: "COMPLETED" } });

    await expect(service.approve(task!.id, "supervisor-1")).rejects.toThrow(/must be PLANNED/);
    await expect(service.reject(task!.id, "supervisor-1", "too late")).rejects.toThrow(
      /must be PLANNED or REQUESTED/,
    );
    await expect(
      service.override(task!.id, "supervisor-1", "too late", { equipmentId: alternateEquipment!.id }),
    ).rejects.toThrow(/must be PLANNED or APPROVED/);
  });
});
