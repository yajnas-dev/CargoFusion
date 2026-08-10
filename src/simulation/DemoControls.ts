import { prisma } from "@/domain/db";
import type { Equipment, EquipmentStatus, SensorEvent, YardLane } from "@/domain/types";

const MIN_CONGESTION = 1.0;
const MAX_CONGESTION = 3.0;

/**
 * Explicit, operator-triggered demo actions (report section 13: "simulate
 * congestion, block lane, move equipment, create RFID event, change
 * container position, make equipment unavailable"). Each call is a single
 * deliberate mutation, distinct from SimulationEngine's continuous
 * background drift. Uses plain Math.random() for "pick something" calls —
 * unlike the Phase 3 dataset generator, live demo interactions don't need
 * to be reproducible across runs.
 */
export class DemoControls {
  async blockLane(laneId: string): Promise<YardLane> {
    return prisma.yardLane.update({ where: { id: laneId }, data: { blocked: true } });
  }

  async unblockLane(laneId: string): Promise<YardLane> {
    return prisma.yardLane.update({ where: { id: laneId }, data: { blocked: false } });
  }

  async unblockAllLanes(): Promise<number> {
    const result = await prisma.yardLane.updateMany({
      where: { blocked: true },
      data: { blocked: false },
    });
    return result.count;
  }

  async blockRandomLane(): Promise<YardLane | null> {
    const lanes = await prisma.yardLane.findMany({ where: { blocked: false } });
    const lane = pickRandom(lanes);
    if (!lane) return null;
    return this.blockLane(lane.id);
  }

  async spikeCongestion(laneId?: string, multiplier = 2): Promise<YardLane | null> {
    const lane = laneId
      ? await prisma.yardLane.findUnique({ where: { id: laneId } })
      : pickRandom(await prisma.yardLane.findMany());
    if (!lane) return null;
    const congestionWeight = clamp(lane.congestionWeight * multiplier, MIN_CONGESTION, MAX_CONGESTION);
    return prisma.yardLane.update({ where: { id: lane.id }, data: { congestionWeight } });
  }

  /** Small random walk applied to every lane's congestion — the "ambient traffic" effect. */
  async driftCongestion(maxDelta = 0.15): Promise<number> {
    const lanes = await prisma.yardLane.findMany();
    let updated = 0;
    for (const lane of lanes) {
      const delta = (Math.random() * 2 - 1) * maxDelta;
      const congestionWeight = clamp(lane.congestionWeight + delta, MIN_CONGESTION, MAX_CONGESTION);
      if (congestionWeight !== lane.congestionWeight) {
        await prisma.yardLane.update({ where: { id: lane.id }, data: { congestionWeight } });
        updated++;
      }
    }
    return updated;
  }

  async resetCongestion(): Promise<number> {
    const result = await prisma.yardLane.updateMany({ data: { congestionWeight: MIN_CONGESTION } });
    return result.count;
  }

  async moveEquipment(equipmentId?: string, nodeId?: string): Promise<Equipment | null> {
    const equipment = equipmentId
      ? await prisma.equipment.findUnique({ where: { id: equipmentId } })
      : pickRandom(await prisma.equipment.findMany());
    if (!equipment) return null;

    const targetNodeId = nodeId ?? (await this.randomNeighborNode(equipment.currentNodeId));
    return prisma.equipment.update({ where: { id: equipment.id }, data: { currentNodeId: targetNodeId } });
  }

  async setEquipmentStatus(equipmentId: string, status: EquipmentStatus): Promise<Equipment> {
    return prisma.equipment.update({ where: { id: equipmentId }, data: { status } });
  }

  /** Toggles a random non-BUSY equipment between AVAILABLE and OFFLINE. */
  async flapRandomEquipmentAvailability(): Promise<Equipment | null> {
    const candidates = await prisma.equipment.findMany({
      where: { status: { in: ["AVAILABLE", "OFFLINE"] } },
    });
    const equipment = pickRandom(candidates);
    if (!equipment) return null;
    const nextStatus: EquipmentStatus = equipment.status === "AVAILABLE" ? "OFFLINE" : "AVAILABLE";
    return this.setEquipmentStatus(equipment.id, nextStatus);
  }

  async triggerRfidEvent(containerId?: string): Promise<SensorEvent | null> {
    const container = containerId
      ? await prisma.container.findUnique({ where: { id: containerId } })
      : pickRandom(await prisma.container.findMany({ take: 200 }));
    if (!container) return null;

    return prisma.sensorEvent.create({
      data: {
        type: "RFID_CHECKPOINT",
        subjectId: container.id,
        nodeId: `BLOCK-${container.block}-ENTRY`,
        payloadJson: JSON.stringify({ simulated: true }),
      },
    });
  }

  private async randomNeighborNode(currentNodeId: string): Promise<string> {
    const lanes = await prisma.yardLane.findMany({
      where: { OR: [{ fromNodeId: currentNodeId }, { toNodeId: currentNodeId }] },
    });
    const lane = pickRandom(lanes);
    if (!lane) return currentNodeId;
    return lane.fromNodeId === currentNodeId ? lane.toNodeId : lane.fromNodeId;
  }
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
