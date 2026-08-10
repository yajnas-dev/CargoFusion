import { afterEach, describe, expect, it } from "vitest";
import { RetrievalPlanningPipeline } from "@/pipeline/RetrievalPlanningPipeline";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

describe("RetrievalPlanningPipeline", () => {
  const createdTaskIds: string[] = [];
  const restoreEquipmentStatuses: { id: string; status: "AVAILABLE" | "BUSY" | "OFFLINE" }[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    for (const { id, status } of restoreEquipmentStatuses) {
      await prisma.equipment.update({ where: { id }, data: { status } });
    }
    restoreEquipmentStatuses.length = 0;
  });

  it("produces a READY plan for a clean exact-match retrieval request", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    expect(container).not.toBeNull();

    const pipeline = new RetrievalPlanningPipeline(new MockTOSAdapter());
    const result = await pipeline.plan({
      containerQuery: container!.id,
      requestedBy: "test-user",
      priority: "MEDIUM",
    });

    expect(result.status).toBe("READY");
    expect(result.container?.id).toBe(container!.id);
    expect(result.selectedEquipment).toBeDefined();
    expect(result.route?.path.at(-1)).toBe(`BLOCK-${container!.block}-ENTRY`);
    expect(result.twin?.recommendedAction).toBe("PROCEED");
  });

  it("returns NOT_FOUND for a query matching no container", async () => {
    const pipeline = new RetrievalPlanningPipeline(new MockTOSAdapter());
    const result = await pipeline.plan({
      containerQuery: "ZZZZ9999999",
      requestedBy: "test-user",
      priority: "MEDIUM",
    });
    expect(result.status).toBe("NOT_FOUND");
    expect(result.containerMatches).toEqual([]);
  });

  it("returns AMBIGUOUS when a partial query matches several containers with no clear winner", async () => {
    const sample = await prisma.container.findFirst();
    const partial = sample!.id.slice(0, 4); // owner-code prefix, matches many containers

    const pipeline = new RetrievalPlanningPipeline(new MockTOSAdapter());
    const result = await pipeline.plan({
      containerQuery: partial,
      requestedBy: "test-user",
      priority: "MEDIUM",
    });

    expect(result.status).toBe("AMBIGUOUS");
    expect(result.containerMatches.length).toBeGreaterThan(1);
  });

  it("returns NO_EQUIPMENT when nothing of the required type is available", async () => {
    const trucks = await prisma.equipment.findMany({ where: { type: "YARD_TRUCK" } });
    for (const t of trucks) {
      restoreEquipmentStatuses.push({ id: t.id, status: t.status as "AVAILABLE" | "BUSY" | "OFFLINE" });
      await prisma.equipment.update({ where: { id: t.id }, data: { status: "OFFLINE" } });
    }

    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const pipeline = new RetrievalPlanningPipeline(new MockTOSAdapter());
    const result = await pipeline.plan({
      containerQuery: container!.id,
      requestedBy: "test-user",
      priority: "MEDIUM",
      requiredEquipmentType: "YARD_TRUCK",
    });

    expect(result.status).toBe("NO_EQUIPMENT");
  });

  it("self-corrects past a top equipment candidate that gets double-booked before validation", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    expect(container).not.toBeNull();

    const pipeline = new RetrievalPlanningPipeline(new MockTOSAdapter());

    // Discover who the pipeline would pick, then commit that equipment to
    // an unrelated task so the second run has to fall back to the next candidate.
    const dryRun = await pipeline.plan({
      containerQuery: container!.id,
      requestedBy: "test-user",
      priority: "MEDIUM",
    });
    expect(dryRun.status).toBe("READY");
    const originalPick = dryRun.selectedEquipment!.equipment.id;

    const otherContainer = await prisma.container.findFirst({
      where: { id: { not: container!.id } },
    });
    const blockingTask = await prisma.task.create({
      data: {
        containerId: otherContainer!.id,
        requestedBy: "other-user",
        status: "DISPATCHED",
        assignedEquipmentId: originalPick,
      },
    });
    createdTaskIds.push(blockingTask.id);

    const result = await pipeline.plan({
      containerQuery: container!.id,
      requestedBy: "test-user",
      priority: "MEDIUM",
    });

    expect(result.status).toBe("READY");
    expect(result.selectedEquipment!.equipment.id).not.toBe(originalPick);
  });
});
