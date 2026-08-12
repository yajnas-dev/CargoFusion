import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { detectIdleEquipmentBacklog } from "@/agent-monitor/detectors/idleEquipmentBacklog";
import { DEFAULT_CONFIG } from "@/agent-monitor/types";

describe("detectIdleEquipmentBacklog", () => {
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  it("suggests reassigning equipment to a REQUESTED task once a viable candidate exists", async () => {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "REQUESTED", priority: "MEDIUM", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);

    const candidates = await detectIdleEquipmentBacklog({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });

    const match = candidates.find((c) => c.taskId === task.id);
    expect(match).toBeDefined();
    expect(match!.type).toBe("IDLE_EQUIPMENT_BACKLOG");
    expect(match!.suggestedActionType).toBe("REASSIGN_EQUIPMENT");
    expect(match!.suggestedActionPayload.taskId).toBe(task.id);
    expect(typeof match!.suggestedActionPayload.equipmentId).toBe("string");
    expect(match!.dedupeKey).toBe(`idle-backlog:${task.id}`);
  });

  it("does not suggest anything for a task that isn't REQUESTED", async () => {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "PLANNED", priority: "MEDIUM", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);

    const candidates = await detectIdleEquipmentBacklog({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });
    expect(candidates.find((c) => c.taskId === task.id)).toBeUndefined();
  });
});
