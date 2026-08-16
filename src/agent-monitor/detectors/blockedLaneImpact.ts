import { prisma } from "@/domain/db";
import { ACTIVE_TASK_STATUSES, AVERAGE_SPEED_METERS_PER_SECOND } from "@/domain/constants";
import { findBlockedRouteSegment } from "@/twin/DigitalTwin";
import { RouteOptimizationService } from "@/optimization/RouteOptimizationService";
import type { YardLane } from "@/domain/types";
import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";

/**
 * Physical distance of a recorded path, even though the current lane list
 * may now mark part of it blocked — a blocked lane keeps its
 * distanceMeters, only routing excludes it. This is "how long the original
 * plan assumed," the baseline the alternate route's delay is measured
 * against (Port Operations Roadmap Phase 2: Incident Impact & Reroute
 * Assist).
 */
function originalRouteDistanceMeters(routeNodeIds: string[], lanes: YardLane[]): number | null {
  const byPair = new Map<string, number>();
  for (const lane of lanes) {
    byPair.set(`${lane.fromNodeId}|${lane.toNodeId}`, lane.distanceMeters);
    byPair.set(`${lane.toNodeId}|${lane.fromNodeId}`, lane.distanceMeters);
  }
  let total = 0;
  for (let i = 0; i < routeNodeIds.length - 1; i++) {
    const distance = byPair.get(`${routeNodeIds[i]}|${routeNodeIds[i + 1]}`);
    if (distance === undefined) return null; // recorded path doesn't match the current graph — can't baseline it
    total += distance;
  }
  return total;
}

/**
 * A blocked lane only matters if it's actually on an active task's route —
 * flagging every blocked lane regardless of impact would be noise. Reuses
 * DigitalTwin's own blocked-segment check so "does this route cross this
 * lane" has one implementation. Also computes a real alternate route (A*
 * already excludes blocked lanes outright, so recomputing the same
 * origin/destination naturally routes around the blockage) and the delay
 * that detour costs, so the alert carries an actual reroute recommendation
 * rather than just "this is blocked" — still pure deterministic TypeScript,
 * no LLM involved in the numbers.
 */
export async function detectBlockedLaneImpact(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const yardState = await ctx.tos.getYardState();
  const blockedLanes = yardState.lanes.filter((l) => l.blocked);
  if (blockedLanes.length === 0) return [];

  const activeTasks = await prisma.task.findMany({
    where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
    include: { recommendations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const routes = new RouteOptimizationService(ctx.tos);

  const candidates: CandidateAlert[] = [];
  for (const lane of blockedLanes) {
    for (const task of activeTasks) {
      const recommendation = task.recommendations[0];
      if (!recommendation) continue;

      let routeNodeIds: string[];
      try {
        routeNodeIds = JSON.parse(recommendation.routeJson);
      } catch {
        continue;
      }

      const segment = findBlockedRouteSegment(routeNodeIds, [lane]);
      if (!segment) continue;

      const origin = routeNodeIds[0];
      const destination = routeNodeIds[routeNodeIds.length - 1];
      const originalDistanceMeters = originalRouteDistanceMeters(routeNodeIds, yardState.lanes);
      const originalEstimatedSeconds =
        originalDistanceMeters !== null ? originalDistanceMeters / AVERAGE_SPEED_METERS_PER_SECOND : null;
      const alternate = origin && destination ? await routes.computeRoute(origin, destination) : null;

      candidates.push({
        type: "BLOCKED_LANE_IMPACT",
        severity: task.priority,
        taskId: task.id,
        subject: {
          laneId: lane.id,
          fromNodeId: lane.fromNodeId,
          toNodeId: lane.toNodeId,
          taskId: task.id,
          containerId: task.containerId,
          alternateRoute: alternate
            ? { path: alternate.path, distanceMeters: alternate.distanceMeters, estimatedSeconds: alternate.estimatedSeconds }
            : null,
          delaySeconds:
            alternate && originalEstimatedSeconds !== null
              ? Math.max(0, Math.round(alternate.estimatedSeconds - originalEstimatedSeconds))
              : null,
        },
        suggestedActionType: "UNBLOCK_LANE",
        suggestedActionPayload: { laneId: lane.id },
        dedupeKey: `blocked-lane:${lane.id}`,
      });
      break; // one impacted task is enough to flag this lane; no need to enumerate every one
    }
  }
  return candidates;
}
