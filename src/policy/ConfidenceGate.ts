import type { RetrievalPlanResult } from "@/pipeline/RetrievalPlanningPipeline";
import type { ConfidenceLevel } from "@/domain/types";

const WEIGHTS = { search: 0.35, equipment: 0.35, congestion: 0.3 } as const;
const HIGH_THRESHOLD = 0.8;
const MEDIUM_THRESHOLD = 0.5;
// A route whose average congestionWeight reaches this multiplier is
// treated as maximally uncertain; an illustrative reference point, not a
// calibrated operational figure.
const MAX_CONGESTION_WEIGHT = 3;

export interface ConfidenceFactor {
  name: string;
  value: number; // 0-1
  weight: number;
  contribution: number; // value * weight
  description: string;
}

export interface ConfidenceAssessment {
  score: number; // 0-1 composite
  level: ConfidenceLevel;
  factors: ConfidenceFactor[];
}

export type ReadyPlanResult = RetrievalPlanResult &
  Required<Pick<RetrievalPlanResult, "container" | "selectedEquipment" | "route" | "twin">>;

export function isReadyPlan(result: RetrievalPlanResult): result is ReadyPlanResult {
  return (
    result.status === "READY" &&
    !!result.container &&
    !!result.selectedEquipment &&
    !!result.route &&
    !!result.twin
  );
}

/**
 * Confidence/policy gate (report section 11): every recommendation passes
 * through a transparent composite score before being shown to a
 * supervisor. This is a prototype decision-support heuristic, not a
 * statistically validated model (report section 11's explicit caveat) —
 * the factor breakdown is exposed rather than hidden behind one opaque
 * number, so a supervisor can see *why* something scored the way it did.
 */
export class ConfidenceGate {
  assess(plan: ReadyPlanResult): ConfidenceAssessment {
    const searchMatch = plan.containerMatches.find((m) => m.container.id === plan.container.id);
    const searchConfidence = searchMatch?.confidence ?? 1;

    const equipmentScore = plan.selectedEquipment.score;

    const avgCongestion =
      plan.route.edges.length > 0
        ? plan.route.edges.reduce((sum, e) => sum + e.congestionWeight, 0) / plan.route.edges.length
        : 1;
    const congestionCertainty =
      1 - clamp((avgCongestion - 1) / (MAX_CONGESTION_WEIGHT - 1), 0, 1);

    const factors: ConfidenceFactor[] = [
      {
        name: "searchConfidence",
        value: searchConfidence,
        weight: WEIGHTS.search,
        contribution: searchConfidence * WEIGHTS.search,
        description: "How confident the container search was in matching the request to this container.",
      },
      {
        name: "equipmentScore",
        value: equipmentScore,
        weight: WEIGHTS.equipment,
        contribution: equipmentScore * WEIGHTS.equipment,
        description: "How well-suited the selected equipment is (distance, capacity fit, workload).",
      },
      {
        name: "routeCongestionCertainty",
        value: congestionCertainty,
        weight: WEIGHTS.congestion,
        contribution: congestionCertainty * WEIGHTS.congestion,
        description: "How uncongested the route is; heavier congestion makes the ETA estimate less certain.",
      },
    ];

    const score = factors.reduce((sum, f) => sum + f.contribution, 0);
    const level: ConfidenceLevel =
      score >= HIGH_THRESHOLD ? "HIGH" : score >= MEDIUM_THRESHOLD ? "MEDIUM" : "LOW";

    return { score, level, factors };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
