import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { AgentAlertService } from "@/agent-monitor/AgentAlertService";
import type { RankedAlert, CandidateAlert } from "@/agent-monitor/types";

function candidate(overrides: Partial<CandidateAlert>): CandidateAlert {
  return {
    type: "AGING_TASK",
    severity: "MEDIUM",
    subject: {},
    suggestedActionType: "ESCALATE_TO_SUPERVISOR",
    suggestedActionPayload: {},
    dedupeKey: `test-${Math.random()}`,
    ...overrides,
  };
}

function ranked(overrides: Partial<CandidateAlert> = {}): RankedAlert {
  return { candidate: candidate(overrides), rankScore: 0.5, explanation: "test explanation" };
}

describe("AgentAlertService", () => {
  const createdAlertIds: string[] = [];
  const mutatedLaneIds: string[] = [];
  const mutatedEquipmentIds: string[] = [];
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    if (createdAlertIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { agentAlertId: { in: createdAlertIds } } });
      await prisma.agentAlert.deleteMany({ where: { id: { in: createdAlertIds } } });
      createdAlertIds.length = 0;
    }
    for (const id of mutatedLaneIds) {
      await prisma.yardLane.update({ where: { id }, data: { blocked: false } });
    }
    mutatedLaneIds.length = 0;
    for (const id of mutatedEquipmentIds) {
      await prisma.equipment.update({ where: { id }, data: { status: "AVAILABLE" } });
    }
    mutatedEquipmentIds.length = 0;
    if (createdTaskIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  describe("raiseBatch", () => {
    it("persists new alerts and writes an AGENT_ALERT_RAISED audit event for each", async () => {
      const service = new AgentAlertService();
      const [alert] = await service.raiseBatch([ranked({ dedupeKey: "raise-test-1" })]);
      createdAlertIds.push(alert.id);

      expect(alert.status).toBe("OPEN");
      expect(alert.explanation).toBe("test explanation");

      const audit = await prisma.auditEvent.findFirst({
        where: { agentAlertId: alert.id, action: "AGENT_ALERT_RAISED" },
      });
      expect(audit).not.toBeNull();
      expect(audit!.actor).toBe("agent:container-management-agent");
    });

    it("skips a candidate whose dedupeKey already has an OPEN alert", async () => {
      const service = new AgentAlertService();
      const [first] = await service.raiseBatch([ranked({ dedupeKey: "dedupe-test" })]);
      createdAlertIds.push(first.id);

      const second = await service.raiseBatch([ranked({ dedupeKey: "dedupe-test" })]);
      expect(second).toHaveLength(0);

      const all = await prisma.agentAlert.findMany({ where: { dedupeKey: "dedupe-test" } });
      expect(all).toHaveLength(1);
    });

    it("does not skip a candidate whose prior alert with the same dedupeKey was already resolved", async () => {
      const service = new AgentAlertService();
      const [first] = await service.raiseBatch([ranked({ dedupeKey: "dedupe-resolved-test" })]);
      createdAlertIds.push(first.id);
      await service.dismiss(first.id, "test-supervisor");

      const second = await service.raiseBatch([ranked({ dedupeKey: "dedupe-resolved-test" })]);
      expect(second).toHaveLength(1);
      createdAlertIds.push(second[0].id);
    });
  });

  describe("apply", () => {
    it("UNBLOCK_LANE unblocks the lane and marks the alert APPLIED", async () => {
      const lane = await prisma.yardLane.findFirstOrThrow();
      await prisma.yardLane.update({ where: { id: lane.id }, data: { blocked: true } });
      mutatedLaneIds.push(lane.id);

      const service = new AgentAlertService();
      const [alert] = await service.raiseBatch([
        ranked({
          type: "BLOCKED_LANE_IMPACT",
          suggestedActionType: "UNBLOCK_LANE",
          suggestedActionPayload: { laneId: lane.id },
          dedupeKey: `apply-unblock-${lane.id}`,
        }),
      ]);
      createdAlertIds.push(alert.id);

      const { alert: applied } = await service.apply(alert.id, "test-supervisor");
      expect(applied.status).toBe("APPLIED");
      expect(applied.resolvedBy).toBe("test-supervisor");

      const updatedLane = await prisma.yardLane.findUniqueOrThrow({ where: { id: lane.id } });
      expect(updatedLane.blocked).toBe(false);

      const audit = await prisma.auditEvent.findFirst({
        where: { agentAlertId: alert.id, action: "AGENT_ALERT_APPLIED" },
      });
      expect(audit?.actor).toBe("test-supervisor");
    });

    it("FREE_STUCK_EQUIPMENT frees the equipment and marks the alert APPLIED", async () => {
      const equipment = await prisma.equipment.findFirstOrThrow({ where: { status: "AVAILABLE" } });
      await prisma.equipment.update({ where: { id: equipment.id }, data: { status: "BUSY" } });
      mutatedEquipmentIds.push(equipment.id);

      const service = new AgentAlertService();
      const [alert] = await service.raiseBatch([
        ranked({
          type: "EQUIPMENT_TASK_MISMATCH",
          suggestedActionType: "FREE_STUCK_EQUIPMENT",
          suggestedActionPayload: { equipmentId: equipment.id },
          dedupeKey: `apply-free-${equipment.id}`,
        }),
      ]);
      createdAlertIds.push(alert.id);

      await service.apply(alert.id, "test-supervisor");

      const freed = await prisma.equipment.findUniqueOrThrow({ where: { id: equipment.id } });
      expect(freed.status).toBe("AVAILABLE");
    });

    it("REPRIORITIZE_TASK updates the task's priority", async () => {
      const container = await prisma.container.findFirstOrThrow({
        where: { retrievalEligible: true, status: "IN_YARD" },
      });
      const task = await prisma.task.create({
        data: { containerId: container.id, status: "PLANNED", priority: "LOW", requestedBy: "test" },
      });
      createdTaskIds.push(task.id);

      const service = new AgentAlertService();
      const [alert] = await service.raiseBatch([
        ranked({
          type: "AGING_TASK",
          taskId: task.id,
          suggestedActionType: "REPRIORITIZE_TASK",
          suggestedActionPayload: { taskId: task.id, newPriority: "URGENT" },
          dedupeKey: `apply-reprioritize-${task.id}`,
        }),
      ]);
      createdAlertIds.push(alert.id);

      await service.apply(alert.id, "test-supervisor");

      const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(updated.priority).toBe("URGENT");
    });

    it("ESCALATE_TO_SUPERVISOR has no automated action and leaves the alert OPEN", async () => {
      const service = new AgentAlertService();
      const [alert] = await service.raiseBatch([
        ranked({ suggestedActionType: "ESCALATE_TO_SUPERVISOR", dedupeKey: "apply-escalate" }),
      ]);
      createdAlertIds.push(alert.id);

      await expect(service.apply(alert.id, "test-supervisor")).rejects.toThrow(/no automated action/);

      const unchanged = await prisma.agentAlert.findUniqueOrThrow({ where: { id: alert.id } });
      expect(unchanged.status).toBe("OPEN");
    });

    it("fails closed: a rejected underlying action leaves the alert unresolved", async () => {
      const service = new AgentAlertService();
      const [alert] = await service.raiseBatch([
        ranked({
          type: "IDLE_EQUIPMENT_BACKLOG",
          suggestedActionType: "REASSIGN_EQUIPMENT",
          suggestedActionPayload: { taskId: "does-not-exist", equipmentId: "ALSO-DOES-NOT-EXIST" },
          dedupeKey: "apply-fails-closed",
        }),
      ]);
      createdAlertIds.push(alert.id);

      await expect(service.apply(alert.id, "test-supervisor")).rejects.toThrow();

      const unchanged = await prisma.agentAlert.findUniqueOrThrow({ where: { id: alert.id } });
      expect(unchanged.status).toBe("OPEN");
    });
  });

  describe("dismiss", () => {
    it("marks the alert DISMISSED with a resolution note and audits it", async () => {
      const service = new AgentAlertService();
      const [alert] = await service.raiseBatch([ranked({ dedupeKey: "dismiss-test" })]);
      createdAlertIds.push(alert.id);

      const dismissed = await service.dismiss(alert.id, "test-supervisor", "handled manually");
      expect(dismissed.status).toBe("DISMISSED");
      expect(dismissed.resolvedBy).toBe("test-supervisor");
      expect(JSON.parse(dismissed.resolutionNoteJson!)).toEqual({ reason: "handled manually" });

      const audit = await prisma.auditEvent.findFirst({
        where: { agentAlertId: alert.id, action: "AGENT_ALERT_DISMISSED" },
      });
      expect(audit).not.toBeNull();
    });
  });
});
