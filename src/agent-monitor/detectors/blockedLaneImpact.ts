import { prisma } from "@/domain/db";
import { ACTIVE_TASK_STATUSES } from "@/domain/constants";
import { findBlockedRouteSegment } from "@/twin/DigitalTwin";
import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";

/**
 * A blocked lane only matters if it's actually on an active task's route —
 * flagging every blocked lane regardless of impact would be noise. Reuses
 * DigitalTwin's own blocked-segment check so "does this route cross this
 * lane" has one implementation.
 */
export async function detectBlockedLaneImpact(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const yardState = await ctx.tos.getYardState();
  const blockedLanes = yardState.lanes.filter((l) => l.blocked);
  if (blockedLanes.length === 0) return [];

  const activeTasks = await prisma.task.findMany({
    where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
    include: { recommendations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

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

      candidates.push({
        type: "BLOCKED_LANE_IMPACT",
        severity: task.priority,
        taskId: task.id,
        subject: { laneId: lane.id, fromNodeId: lane.fromNodeId, toNodeId: lane.toNodeId, taskId: task.id },
        suggestedActionType: "UNBLOCK_LANE",
        suggestedActionPayload: { laneId: lane.id },
        dedupeKey: `blocked-lane:${lane.id}`,
      });
      break; // one impacted task is enough to flag this lane; no need to enumerate every one
    }
  }
  return candidates;
}
