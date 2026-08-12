import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { detectEquipmentTaskMismatch } from "@/agent-monitor/detectors/equipmentTaskMismatch";
import { DEFAULT_CONFIG } from "@/agent-monitor/types";

describe("detectEquipmentTaskMismatch", () => {
  const mutatedEquipmentIds: string[] = [];
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    for (const id of mutatedEquipmentIds) {
      await prisma.equipment.update({ where: { id }, data: { status: "AVAILABLE" } });
    }
    mutatedEquipmentIds.length = 0;
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  it("flags equipment marked BUSY with no active task claiming it", async () => {
    const equipment = await prisma.equipment.findFirstOrThrow({ where: { status: "AVAILABLE" } });
    await prisma.equipment.update({ where: { id: equipment.id }, data: { status: "BUSY" } });
    mutatedEquipmentIds.push(equipment.id);

    const candidates = await detectEquipmentTaskMismatch({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });

    const match = candidates.find((c) => c.dedupeKey === `stuck-equipment:${equipment.id}`);
    expect(match).toBeDefined();
    expect(match!.type).toBe("EQUIPMENT_TASK_MISMATCH");
    expect(match!.suggestedActionType).toBe("FREE_STUCK_EQUIPMENT");
    expect(match!.suggestedActionPayload).toEqual({ equipmentId: equipment.id });
  });

  it("does not flag BUSY equipment that a DISPATCHED task legitimately claims", async () => {
    const equipment = await prisma.equipment.findFirstOrThrow({ where: { status: "AVAILABLE" } });
    await prisma.equipment.update({ where: { id: equipment.id }, data: { status: "BUSY" } });
    mutatedEquipmentIds.push(equipment.id);

    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: {
        containerId: container.id,
        status: "DISPATCHED",
        priority: "MEDIUM",
        requestedBy: "test",
        assignedEquipmentId: equipment.id,
      },
    });
    createdTaskIds.push(task.id);

    const candidates = await detectEquipmentTaskMismatch({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });
    expect(candidates.find((c) => c.dedupeKey === `stuck-equipment:${equipment.id}`)).toBeUndefined();
  });
});
