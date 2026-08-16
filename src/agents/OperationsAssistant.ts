import type { GenerativeModelClient } from "@/agents/GeminiClient";
import type { OpsSnapshot } from "@/agents/opsSnapshot";

/**
 * "What's happening in the yard right now?" / "why are retrievals slowing
 * down?" / "what should we prioritize?" — a read-only narrator over data
 * that otherwise requires manually cross-referencing the dashboard, /agent,
 * and the yard map (Port Operations Roadmap Phase 2). Same trust boundary
 * as PlanExplainer/AlertRanker: this only narrates a snapshot the
 * deterministic layer already computed, never a calculation of its own,
 * and has no mutation capability at all — it's a query, not an action.
 */
export class OperationsAssistant {
  constructor(private readonly model: GenerativeModelClient) {}

  async answer(question: string, snapshot: OpsSnapshot): Promise<string> {
    return this.model.generateText(buildPrompt(question, snapshot));
  }
}

function buildPrompt(question: string, snapshot: OpsSnapshot): string {
  return [
    "You are the Operations Assistant for a container terminal control room, answering a supervisor's question during a live shift.",
    "Answer using ONLY the data given below — do not invent numbers, alerts, tasks, or equipment not listed here.",
    "If the data below doesn't contain what's needed to answer, say so plainly rather than guessing.",
    "Keep the answer to 2-5 sentences, plain language, no markdown headers.",
    "",
    `Supervisor's question: "${question}"`,
    "",
    "Current operations snapshot (JSON):",
    JSON.stringify(snapshot, null, 2),
  ].join("\n");
}
