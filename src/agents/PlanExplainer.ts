import type { GenerativeModelClient } from "@/agents/GeminiClient";
import type { RetrievalPlanResult } from "@/pipeline/RetrievalPlanningPipeline";
import { formatDuration } from "@/domain/format";

/**
 * Turns a deterministic pipeline result into a human-readable explanation
 * for the supervisor (report section 8: the agent "synthesizes" the plan
 * for humans/workers based on computations it didn't perform itself). All
 * numbers here (distance, ETA, scores) are already computed by
 * search/optimization/twin — this only narrates them.
 */
export class PlanExplainer {
  constructor(private readonly model: GenerativeModelClient) {}

  async explain(result: RetrievalPlanResult): Promise<string> {
    const prompt = buildPrompt(result);
    return this.model.generateText(prompt);
  }
}

function buildPrompt(result: RetrievalPlanResult): string {
  const lines: string[] = [
    "You are the explanation step of a container terminal retrieval assistant.",
    "Write a concise explanation (2-4 sentences, plain language, no markdown headers) for a human supervisor reviewing this system-generated plan.",
    "Do not invent numbers not given below; only narrate what's provided.",
    "",
    `Plan status: ${result.status}`,
    `Requested container query: "${result.request.containerQuery}"`,
    `Priority: ${result.request.priority}`,
  ];

  if (result.container) {
    lines.push(
      `Container: ${result.container.id} (block ${result.container.block}, row ${result.container.row}, bay ${result.container.bay}, tier ${result.container.tier}), destination ${result.container.destination}, weight ${result.container.weightKg}kg.`,
    );
  }

  if (result.containerMatches.length > 1) {
    lines.push(
      `Candidate containers: ${result.containerMatches
        .map((m) => `${m.container.id} (${m.matchType}, confidence ${m.confidence.toFixed(2)})`)
        .join(", ")}.`,
    );
  }

  if (result.selectedEquipment) {
    const { equipment, score, factors } = result.selectedEquipment;
    lines.push(
      `Selected equipment: ${equipment.id} (${equipment.type}), score ${score.toFixed(2)} — distance ${factors.distanceMeters.toFixed(0)}m, capacity fit ${factors.capacityFitScore.toFixed(2)}, workload score ${factors.workloadScore.toFixed(2)} (${factors.activeTaskCount} active tasks).`,
    );
  }

  if (result.route) {
    lines.push(
      `Route: ${result.route.path.join(" -> ")}, ${result.route.distanceMeters.toFixed(0)}m, ETA ${formatDuration(result.route.estimatedSeconds)}.`,
    );
  }

  if (result.craneCandidates && result.craneCandidates.length > 0) {
    const crane = result.craneCandidates[0];
    lines.push(
      `Crane servicing the block: ${crane.equipment.id}, ${crane.factors.distanceMeters.toFixed(0)}m from the block entry.`,
    );
  } else if (result.craneCandidates) {
    lines.push("No crane is currently available to service this block.");
  }

  if (result.twin) {
    lines.push(
      `Digital twin validation: ${result.twin.recommendedAction}${
        result.twin.issues.length > 0
          ? " — issues: " + result.twin.issues.map((i) => i.message).join("; ")
          : " — no conflicts found"
      }.`,
    );
  }

  return lines.join("\n");
}
