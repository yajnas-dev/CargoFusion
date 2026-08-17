import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import type { Equipment, EquipmentType, Priority } from "@/domain/types";
import { RouteOptimizationService } from "@/optimization/RouteOptimizationService";
import { prisma } from "@/domain/db";
import { ACTIVE_TASK_STATUSES } from "@/domain/constants";

// Distances beyond this are treated as "far" for scoring purposes (a whole
// yard traversal); not a hard cutoff, just normalizes the distance score.
const MAX_EXPECTED_DISTANCE_METERS = 400;

interface PriorityWeights {
  distance: number;
  workload: number;
  capacityFit: number;
}

// Urgent/high-priority requests weight proximity more heavily — get the
// nearest capable equipment moving, even at the cost of a slightly worse
// capacity match or a busier resource.
const WEIGHTS_BY_URGENCY: Record<"urgent" | "normal", PriorityWeights> = {
  urgent: { distance: 0.6, workload: 0.2, capacityFit: 0.2 },
  normal: { distance: 0.4, workload: 0.3, capacityFit: 0.3 },
};

export interface AllocationContext {
  destinationNodeId: string;
  requiredType: EquipmentType;
  containerWeightKg: number;
  priority: Priority;
}

export interface EquipmentScoreFactors {
  distanceMeters: number;
  distanceScore: number;
  capacityFitScore: number;
  workloadScore: number;
  activeTaskCount: number;
  weights: PriorityWeights;
}

export interface EquipmentScore {
  equipment: Equipment;
  score: number; // 0-1, transparent composite
  factors: EquipmentScoreFactors;
}

/**
 * Deterministic weighted-scoring equipment allocator (report section
 * 8.1/13: distance, availability, equipment type, current workload, task
 * priority — no LLM involvement, no OR-Tools dependency for prototype
 * scale). Returns every scored candidate so the caller/UI can show why an
 * equipment was picked over the alternatives, per the report's emphasis on
 * explainable recommendations.
 */
export class EquipmentAllocationService {
  private readonly routes: RouteOptimizationService;

  constructor(private readonly tos: TOSAdapter) {
    this.routes = new RouteOptimizationService(tos);
  }

  async allocate(context: AllocationContext): Promise<EquipmentScore[]> {
    const allOfType = await this.tos.getEquipment();
    const eligible = allOfType.filter(
      (e) =>
        e.type === context.requiredType &&
        e.status === "AVAILABLE" &&
        e.capacityKg >= context.containerWeightKg,
    );

    const isUrgent = context.priority === "HIGH" || context.priority === "URGENT";
    const weights = isUrgent ? WEIGHTS_BY_URGENCY.urgent : WEIGHTS_BY_URGENCY.normal;

    const scored: EquipmentScore[] = [];
    for (const equipment of eligible) {
      const route = await this.routes.computeRoute(
        equipment.currentNodeId,
        context.destinationNodeId,
      );
      if (!route) continue; // unreachable equipment can't be a candidate

      const activeTaskCount = await prisma.task.count({
        where: {
          assignedEquipmentId: equipment.id,
          status: { in: [...ACTIVE_TASK_STATUSES] },
        },
      });

      const distanceScore =
        1 - Math.min(route.distanceMeters / MAX_EXPECTED_DISTANCE_METERS, 1);
      const capacityFitScore =
        1 - Math.abs(equipment.capacityKg - context.containerWeightKg) / equipment.capacityKg;
      const workloadScore = 1 / (1 + activeTaskCount);

      const score =
        weights.distance * distanceScore +
        weights.capacityFit * capacityFitScore +
        weights.workload * workloadScore;

      scored.push({
        equipment,
        score,
        factors: {
          distanceMeters: route.distanceMeters,
          distanceScore,
          capacityFitScore,
          workloadScore,
          activeTaskCount,
          weights,
        },
      });
    }

    return scored.sort((a, b) => b.score - a.score);
  }
}
