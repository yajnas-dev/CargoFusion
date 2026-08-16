import { prisma } from "@/domain/db";
import { eventBus } from "@/events/InProcessEventBus";
import { TOPICS } from "@/events/topics";
import { AVERAGE_SPEED_METERS_PER_SECOND, LANE_SCALE_METERS } from "@/domain/constants";
import { resolveArrivedEquipmentMovements } from "@/domain/equipmentMovement";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { RouteOptimizationService } from "@/optimization/RouteOptimizationService";
import type { Equipment, EquipmentStatus, SensorEvent, YardLane } from "@/domain/types";

const MIN_CONGESTION = 1.0;
const MAX_CONGESTION = 3.0;

// Floor so even a very short hop still reads as deliberate travel, not an
// instant snap — real yard maneuvering (slowing, positioning) takes time
// beyond pure transit at cruising speed.
const MIN_TRANSIT_MS = 4000;

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
    const lane = await prisma.yardLane.update({ where: { id: laneId }, data: { blocked: true } });
    eventBus.publish(TOPICS.YARD_LANE_CHANGED, { laneId });
    return lane;
  }

  async unblockLane(laneId: string): Promise<YardLane> {
    const lane = await prisma.yardLane.update({ where: { id: laneId }, data: { blocked: false } });
    eventBus.publish(TOPICS.YARD_LANE_CHANGED, { laneId });
    return lane;
  }

  async unblockAllLanes(): Promise<number> {
    const result = await prisma.yardLane.updateMany({
      where: { blocked: true },
      data: { blocked: false },
    });
    if (result.count > 0) eventBus.publish(TOPICS.YARD_LANE_CHANGED, { laneId: null });
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
    const updated = await prisma.yardLane.update({ where: { id: lane.id }, data: { congestionWeight } });
    eventBus.publish(TOPICS.YARD_LANE_CHANGED, { laneId: lane.id });
    return updated;
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
    if (updated > 0) eventBus.publish(TOPICS.YARD_LANE_CHANGED, { laneId: null });
    return updated;
  }

  async resetCongestion(): Promise<number> {
    const result = await prisma.yardLane.updateMany({ data: { congestionWeight: MIN_CONGESTION } });
    if (result.count > 0) eventBus.publish(TOPICS.YARD_LANE_CHANGED, { laneId: null });
    return result.count;
  }

  /**
   * Starts a timed transit toward the target node instead of teleporting —
   * real-world digital-twin realism: travel time is distanceMeters /
   * AVERAGE_SPEED_METERS_PER_SECOND, the same speed RouteOptimizationService
   * quotes ETAs with. currentNodeId only updates once the transit's
   * movementArrivesAt actually passes (resolveArrivedEquipmentMovements,
   * called on every equipment read) — this call just sets it in motion.
   * Equipment already mid-transit is left alone rather than redirected
   * mid-drive; the random-equipment picker only considers idle equipment
   * in the first place, so this mainly guards the explicit-equipmentId path.
   */
  async moveEquipment(equipmentId?: string, nodeId?: string): Promise<Equipment | null> {
    await resolveArrivedEquipmentMovements();

    const equipment = equipmentId
      ? await prisma.equipment.findUnique({ where: { id: equipmentId } })
      : pickRandom(await prisma.equipment.findMany({ where: { movementArrivesAt: null } }));
    if (!equipment) return null;

    if (equipment.movementArrivesAt) {
      return equipment; // already mid-transit — let it arrive before accepting a new order
    }

    const targetNodeId = nodeId ?? (await this.randomNeighborNode(equipment.currentNodeId));
    if (targetNodeId === equipment.currentNodeId) return equipment; // isolated node — nowhere to go

    const distanceMeters = await this.distanceBetween(equipment.currentNodeId, targetNodeId);
    const durationMs = Math.max(MIN_TRANSIT_MS, (distanceMeters / AVERAGE_SPEED_METERS_PER_SECOND) * 1000);
    const now = new Date();

    const updated = await prisma.equipment.update({
      where: { id: equipment.id },
      data: {
        movementTargetNodeId: targetNodeId,
        movementStartedAt: now,
        movementArrivesAt: new Date(now.getTime() + durationMs),
      },
    });
    eventBus.publish(TOPICS.YARD_EQUIPMENT_CHANGED, { equipmentId: equipment.id });
    return updated;
  }

  /** Real path distance (not just straight-line) so a multi-hop explicit-node move gets a realistic duration too. */
  private async distanceBetween(fromNodeId: string, toNodeId: string): Promise<number> {
    const route = await new RouteOptimizationService(new MockTOSAdapter()).computeRoute(fromNodeId, toNodeId);
    return route?.distanceMeters ?? LANE_SCALE_METERS;
  }

  async setEquipmentStatus(equipmentId: string, status: EquipmentStatus): Promise<Equipment> {
    const updated = await prisma.equipment.update({ where: { id: equipmentId }, data: { status } });
    eventBus.publish(TOPICS.YARD_EQUIPMENT_CHANGED, { equipmentId });
    return updated;
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

    const event = await prisma.sensorEvent.create({
      data: {
        type: "RFID_CHECKPOINT",
        subjectId: container.id,
        nodeId: `BLOCK-${container.block}-ENTRY`,
        payloadJson: JSON.stringify({ simulated: true }),
      },
    });
    eventBus.publish(TOPICS.SENSOR_EVENT, { subjectId: container.id, type: event.type });
    return event;
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
