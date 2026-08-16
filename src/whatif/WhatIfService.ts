import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import { prisma } from "@/domain/db";
import { ACTIVE_TASK_STATUSES, AVERAGE_SPEED_METERS_PER_SECOND } from "@/domain/constants";
import { findBlockedRouteSegment } from "@/twin/DigitalTwin";
import { YardGraph } from "@/optimization/YardGraph";
import { findPath } from "@/optimization/astar";
import type { Priority } from "@/domain/types";

export interface LaneBlockImpact {
  taskId: string;
  containerId: string;
  priority: Priority;
  hasAlternateRoute: boolean;
  alternateEstimatedSeconds: number | null;
}

export interface LaneBlockPreview {
  laneId: string;
  affectedTaskCount: number;
  affected: LaneBlockImpact[];
}

export interface EquipmentOfflinePreview {
  equipmentId: string;
  wouldImpactActiveTask: boolean;
  currentlyClaimedByTask: { taskId: string; containerId: string; priority: Priority } | null;
}

/**
 * Read-only "what would happen if" checks (Port Operations Roadmap Phase
 * 2), sharing exactly the same deterministic logic the real detectors and
 * services use — nothing here is a separate simulation. Never mutates:
 * lane blocking is evaluated by building a YardGraph from a locally
 * patched copy of the lane list (never written to the database), and
 * equipment impact is a plain query against the current active-task claim.
 */
export class WhatIfService {
  constructor(private readonly tos: TOSAdapter) {}

  async previewLaneBlock(laneId: string): Promise<LaneBlockPreview> {
    const yardState = await this.tos.getYardState();
    const lane = yardState.lanes.find((l) => l.id === laneId);
    if (!lane) throw new Error(`Lane ${laneId} not found.`);
    if (lane.blocked) throw new Error(`Lane ${laneId} is already blocked.`);

    const hypotheticalLane = { ...lane, blocked: true };
    const hypotheticalGraph = new YardGraph({
      ...yardState,
      lanes: yardState.lanes.map((l) => (l.id === laneId ? hypotheticalLane : l)),
    });

    const activeTasks = await prisma.task.findMany({
      where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
      include: { recommendations: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    const affected: LaneBlockImpact[] = [];
    for (const task of activeTasks) {
      const recommendation = task.recommendations[0];
      if (!recommendation) continue;

      let routeNodeIds: string[];
      try {
        routeNodeIds = JSON.parse(recommendation.routeJson);
      } catch {
        continue;
      }

      const segment = findBlockedRouteSegment(routeNodeIds, [hypotheticalLane]);
      if (!segment) continue;

      const origin = routeNodeIds[0];
      const destination = routeNodeIds[routeNodeIds.length - 1];
      const alternate = origin && destination ? findPath(hypotheticalGraph, origin, destination) : null;

      affected.push({
        taskId: task.id,
        containerId: task.containerId,
        priority: task.priority,
        hasAlternateRoute: alternate !== null,
        alternateEstimatedSeconds: alternate ? alternate.distanceMeters / AVERAGE_SPEED_METERS_PER_SECOND : null,
      });
    }

    return { laneId, affectedTaskCount: affected.length, affected };
  }

  async previewEquipmentOffline(equipmentId: string): Promise<EquipmentOfflinePreview> {
    const [equipment] = await this.tos.getEquipment(equipmentId);
    if (!equipment) throw new Error(`Equipment ${equipmentId} not found.`);

    const claimingTask = await prisma.task.findFirst({
      where: { assignedEquipmentId: equipmentId, status: { in: [...ACTIVE_TASK_STATUSES] } },
    });

    return {
      equipmentId,
      wouldImpactActiveTask: claimingTask !== null,
      currentlyClaimedByTask: claimingTask
        ? { taskId: claimingTask.id, containerId: claimingTask.containerId, priority: claimingTask.priority }
        : null,
    };
  }
}
