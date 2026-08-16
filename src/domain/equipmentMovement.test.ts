import { afterEach, describe, expect, it } from "vitest";
import { resolveArrivedEquipmentMovements } from "@/domain/equipmentMovement";
import { prisma } from "@/domain/db";

describe("resolveArrivedEquipmentMovements", () => {
  const mutatedEquipmentIds: string[] = [];

  afterEach(async () => {
    for (const id of mutatedEquipmentIds) {
      await prisma.equipment.update({
        where: { id },
        data: { movementTargetNodeId: null, movementStartedAt: null, movementArrivesAt: null },
      });
    }
    mutatedEquipmentIds.length = 0;
  });

  it("finalizes an equipment whose movementArrivesAt is in the past", async () => {
    const equipment = await prisma.equipment.findFirstOrThrow();
    mutatedEquipmentIds.push(equipment.id);
    const targetNode = await prisma.yardNode.findFirstOrThrow({ where: { id: { not: equipment.currentNodeId } } });

    await prisma.equipment.update({
      where: { id: equipment.id },
      data: {
        movementTargetNodeId: targetNode.id,
        movementStartedAt: new Date(Date.now() - 10_000),
        movementArrivesAt: new Date(Date.now() - 1000),
      },
    });

    const count = await resolveArrivedEquipmentMovements();
    expect(count).toBeGreaterThanOrEqual(1);

    const resolved = await prisma.equipment.findUniqueOrThrow({ where: { id: equipment.id } });
    expect(resolved.currentNodeId).toBe(targetNode.id);
    expect(resolved.movementTargetNodeId).toBeNull();
    expect(resolved.movementStartedAt).toBeNull();
    expect(resolved.movementArrivesAt).toBeNull();
  });

  it("leaves an equipment whose movementArrivesAt is still in the future untouched", async () => {
    const equipment = await prisma.equipment.findFirstOrThrow();
    mutatedEquipmentIds.push(equipment.id);
    const targetNode = await prisma.yardNode.findFirstOrThrow({ where: { id: { not: equipment.currentNodeId } } });
    const futureArrival = new Date(Date.now() + 60_000);

    await prisma.equipment.update({
      where: { id: equipment.id },
      data: {
        movementTargetNodeId: targetNode.id,
        movementStartedAt: new Date(),
        movementArrivesAt: futureArrival,
      },
    });

    await resolveArrivedEquipmentMovements();

    const stillMoving = await prisma.equipment.findUniqueOrThrow({ where: { id: equipment.id } });
    expect(stillMoving.currentNodeId).toBe(equipment.currentNodeId); // unchanged
    expect(stillMoving.movementArrivesAt?.getTime()).toBe(futureArrival.getTime());
  });

  it("returns 0 and is a no-op when nothing is in transit", async () => {
    const count = await resolveArrivedEquipmentMovements();
    expect(count).toBe(0);
  });
});
