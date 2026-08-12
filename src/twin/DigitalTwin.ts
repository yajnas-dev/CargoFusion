import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import { prisma } from "@/domain/db";
import { ACTIVE_TASK_STATUSES } from "@/domain/constants";
import type { YardLane } from "@/domain/types";

export type TwinIssueType =
  | "CONTAINER_NOT_FOUND"
  | "CONTAINER_NOT_ELIGIBLE"
  | "CONTAINER_RESERVED"
  | "EQUIPMENT_NOT_FOUND"
  | "EQUIPMENT_UNAVAILABLE"
  | "EQUIPMENT_DOUBLE_BOOKED"
  | "LANE_BLOCKED";

export interface TwinIssue {
  type: TwinIssueType;
  message: string;
}

export type RecommendedAction = "PROCEED" | "REPLAN" | "ESCALATE";

// Conflicts a fresh allocation/route pass could plausibly resolve on retry.
const REPLANNABLE_ISSUES: ReadonlySet<TwinIssueType> = new Set([
  "EQUIPMENT_UNAVAILABLE",
  "EQUIPMENT_DOUBLE_BOOKED",
  "LANE_BLOCKED",
]);

/**
 * The first adjacent pair in routeNodeIds that crosses a blocked lane, or
 * null if none does. Shared between DigitalTwin.validatePlan's
 * LANE_BLOCKED check and the Container Management Agent's
 * blockedLaneImpact detector (src/agent-monitor/detectors/blockedLaneImpact.ts),
 * so "does this route cross this blocked lane" has exactly one
 * implementation. Returns the segment (not just a boolean) so callers can
 * build a specific message.
 */
export function findBlockedRouteSegment(
  routeNodeIds: string[],
  lanes: Pick<YardLane, "fromNodeId" | "toNodeId" | "blocked">[],
): { fromNodeId: string; toNodeId: string } | null {
  const blockedPairs = new Set<string>();
  for (const lane of lanes) {
    if (lane.blocked) {
      blockedPairs.add(`${lane.fromNodeId}|${lane.toNodeId}`);
      blockedPairs.add(`${lane.toNodeId}|${lane.fromNodeId}`);
    }
  }
  for (let i = 0; i < routeNodeIds.length - 1; i++) {
    if (blockedPairs.has(`${routeNodeIds[i]}|${routeNodeIds[i + 1]}`)) {
      return { fromNodeId: routeNodeIds[i], toNodeId: routeNodeIds[i + 1] };
    }
  }
  return null;
}

export interface PlanToValidate {
  /** Excludes this task's own reservation from double-booking checks (re-validating an existing task). */
  taskId?: string;
  containerId: string;
  equipmentId: string;
  /** Yard node ids, origin -> destination, as returned by RouteOptimizationService. */
  routeNodeIds: string[];
}

export interface ValidationResult {
  valid: boolean;
  issues: TwinIssue[];
  recommendedAction: RecommendedAction;
}

/**
 * Reconciled view of yard/container/equipment state used to validate a
 * proposed plan before it's ever shown to a supervisor for approval
 * (report section 12). Not a physics simulation — fidelity is only as
 * good as the last TOS sync / checkpoint event, same as the real design.
 */
export class DigitalTwin {
  constructor(private readonly tos: TOSAdapter) {}

  async validatePlan(plan: PlanToValidate): Promise<ValidationResult> {
    const issues: TwinIssue[] = [];

    const container = await this.tos.getContainer(plan.containerId);
    if (!container) {
      issues.push({
        type: "CONTAINER_NOT_FOUND",
        message: `Container ${plan.containerId} is not in the synced cache.`,
      });
    } else {
      if (!container.retrievalEligible) {
        issues.push({
          type: "CONTAINER_NOT_ELIGIBLE",
          message: `Container ${container.id} is not eligible for retrieval (status: ${container.status}).`,
        });
      }
      const conflictingContainerTask = await prisma.task.findFirst({
        where: {
          containerId: container.id,
          status: { in: [...ACTIVE_TASK_STATUSES] },
          ...(plan.taskId ? { id: { not: plan.taskId } } : {}),
        },
      });
      if (conflictingContainerTask) {
        issues.push({
          type: "CONTAINER_RESERVED",
          message: `Container ${container.id} already has an active task (${conflictingContainerTask.id}).`,
        });
      }
    }

    const equipmentMatches = await this.tos.getEquipment(plan.equipmentId);
    const equipment = equipmentMatches[0];
    if (!equipment) {
      issues.push({
        type: "EQUIPMENT_NOT_FOUND",
        message: `Equipment ${plan.equipmentId} is not in the synced cache.`,
      });
    } else {
      if (equipment.status !== "AVAILABLE") {
        issues.push({
          type: "EQUIPMENT_UNAVAILABLE",
          message: `Equipment ${equipment.id} is not available (status: ${equipment.status}).`,
        });
      }
      const conflictingEquipmentTask = await prisma.task.findFirst({
        where: {
          assignedEquipmentId: equipment.id,
          status: { in: [...ACTIVE_TASK_STATUSES] },
          ...(plan.taskId ? { id: { not: plan.taskId } } : {}),
        },
      });
      if (conflictingEquipmentTask) {
        issues.push({
          type: "EQUIPMENT_DOUBLE_BOOKED",
          message: `Equipment ${equipment.id} is already committed to task ${conflictingEquipmentTask.id}.`,
        });
      }
    }

    const yardState = await this.tos.getYardState();
    const blockedSegment = findBlockedRouteSegment(plan.routeNodeIds, yardState.lanes);
    if (blockedSegment) {
      issues.push({
        type: "LANE_BLOCKED",
        message: `Route passes through a blocked lane between ${blockedSegment.fromNodeId} and ${blockedSegment.toNodeId}.`,
      });
    }

    const recommendedAction: RecommendedAction =
      issues.length === 0
        ? "PROCEED"
        : issues.every((issue) => REPLANNABLE_ISSUES.has(issue.type))
          ? "REPLAN"
          : "ESCALATE";

    return { valid: issues.length === 0, issues, recommendedAction };
  }
}
