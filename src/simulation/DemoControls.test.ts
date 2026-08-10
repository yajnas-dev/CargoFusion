import { afterEach, describe, expect, it } from "vitest";
import { DemoControls } from "@/simulation/DemoControls";
import { prisma } from "@/domain/db";

describe("DemoControls", () => {
  const restoreLaneIds: string[] = [];
  const restoreEquipmentIds: string[] = [];
  const createdSensorEventIds: string[] = [];

  afterEach(async () => {
    for (const id of restoreLaneIds) {
      await prisma.yardLane.update({ where: { id }, data: { blocked: false, congestionWeight: 1.0 } });
    }
    restoreLaneIds.length = 0;
    for (const id of restoreEquipmentIds) {
      const original = equipmentSnapshots.get(id);
      if (original) await prisma.equipment.update({ where: { id }, data: original });
    }
    restoreEquipmentIds.length = 0;
    equipmentSnapshots.clear();
    if (createdSensorEventIds.length > 0) {
      await prisma.sensorEvent.deleteMany({ where: { id: { in: createdSensorEventIds } } });
      createdSensorEventIds.length = 0;
    }
  });

  const equipmentSnapshots = new Map<string, { status: "AVAILABLE" | "BUSY" | "OFFLINE"; currentNodeId: string }>();
  async function snapshotEquipment(id: string) {
    const eq = await prisma.equipment.findUniqueOrThrow({ where: { id } });
    equipmentSnapshots.set(id, { status: eq.status, currentNodeId: eq.currentNodeId });
    restoreEquipmentIds.push(id);
    return eq;
  }

  it("blockLane/unblockLane toggle a specific lane", async () => {
    const lane = await prisma.yardLane.findFirstOrThrow();
    restoreLaneIds.push(lane.id);

    const controls = new DemoControls();
    const blocked = await controls.blockLane(lane.id);
    expect(blocked.blocked).toBe(true);

    const unblocked = await controls.unblockLane(lane.id);
    expect(unblocked.blocked).toBe(false);
  });

  it("blockRandomLane blocks an unblocked lane and returns null once none remain", async () => {
    const allLanes = await prisma.yardLane.findMany();
    restoreLaneIds.push(...allLanes.map((l) => l.id));

    const controls = new DemoControls();
    const blocked = await controls.blockRandomLane();
    expect(blocked).not.toBeNull();
    expect(blocked!.blocked).toBe(true);

    // Block every remaining lane, then confirm there's nothing left to pick.
    await prisma.yardLane.updateMany({ data: { blocked: true } });
    const noneLeft = await controls.blockRandomLane();
    expect(noneLeft).toBeNull();
  });

  it("spikeCongestion multiplies and clamps to the max", async () => {
    const lane = await prisma.yardLane.findFirstOrThrow();
    restoreLaneIds.push(lane.id);
    await prisma.yardLane.update({ where: { id: lane.id }, data: { congestionWeight: 1.0 } });

    const controls = new DemoControls();
    const once = await controls.spikeCongestion(lane.id, 2);
    expect(once!.congestionWeight).toBe(2.0);

    const twice = await controls.spikeCongestion(lane.id, 5);
    expect(twice!.congestionWeight).toBe(3.0); // clamped to MAX_CONGESTION
  });

  it("driftCongestion keeps every lane within [1, 3]", async () => {
    const allLanes = await prisma.yardLane.findMany();
    restoreLaneIds.push(...allLanes.map((l) => l.id));

    const controls = new DemoControls();
    await controls.driftCongestion();

    const after = await prisma.yardLane.findMany();
    for (const lane of after) {
      expect(lane.congestionWeight).toBeGreaterThanOrEqual(1.0);
      expect(lane.congestionWeight).toBeLessThanOrEqual(3.0);
    }
  });

  it("resetCongestion sets every lane back to 1.0", async () => {
    const allLanes = await prisma.yardLane.findMany();
    restoreLaneIds.push(...allLanes.map((l) => l.id));
    await prisma.yardLane.updateMany({ data: { congestionWeight: 2.5 } });

    const controls = new DemoControls();
    await controls.resetCongestion();

    const after = await prisma.yardLane.findMany();
    expect(after.every((l) => l.congestionWeight === 1.0)).toBe(true);
  });

  it("moveEquipment to an explicit node updates currentNodeId", async () => {
    const equipment = await prisma.equipment.findFirstOrThrow();
    await snapshotEquipment(equipment.id);

    const controls = new DemoControls();
    const moved = await controls.moveEquipment(equipment.id, "GATE");
    expect(moved!.currentNodeId).toBe("GATE");
  });

  it("moveEquipment with no target moves to an actual neighboring node", async () => {
    const equipment = await prisma.equipment.findFirstOrThrow();
    await snapshotEquipment(equipment.id);

    const neighborLanes = await prisma.yardLane.findMany({
      where: { OR: [{ fromNodeId: equipment.currentNodeId }, { toNodeId: equipment.currentNodeId }] },
    });
    const validNeighbors = new Set(
      neighborLanes.flatMap((l) => [l.fromNodeId, l.toNodeId]).filter((n) => n !== equipment.currentNodeId),
    );

    const controls = new DemoControls();
    const moved = await controls.moveEquipment(equipment.id);
    expect(validNeighbors.has(moved!.currentNodeId)).toBe(true);
  });

  it("flapRandomEquipmentAvailability toggles a non-BUSY equipment between AVAILABLE and OFFLINE", async () => {
    const controls = new DemoControls();
    const flapped = await controls.flapRandomEquipmentAvailability();
    expect(flapped).not.toBeNull();
    expect(["AVAILABLE", "OFFLINE"]).toContain(flapped!.status);

    const inDb = await prisma.equipment.findUniqueOrThrow({ where: { id: flapped!.id } });
    expect(inDb.status).toBe(flapped!.status);

    // It's a binary toggle, so the pre-flap status was the other value — restore it directly.
    const originalStatus = flapped!.status === "AVAILABLE" ? "OFFLINE" : "AVAILABLE";
    await prisma.equipment.update({ where: { id: flapped!.id }, data: { status: originalStatus } });
  });

  it("triggerRfidEvent with an explicit container creates a matching SensorEvent", async () => {
    const container = await prisma.container.findFirstOrThrow();
    const controls = new DemoControls();
    const event = await controls.triggerRfidEvent(container.id);
    createdSensorEventIds.push(event!.id);

    expect(event!.type).toBe("RFID_CHECKPOINT");
    expect(event!.subjectId).toBe(container.id);
    expect(event!.nodeId).toBe(`BLOCK-${container.block}-ENTRY`);
  });
});
