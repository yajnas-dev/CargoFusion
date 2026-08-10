import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import type { GenerativeModelClient } from "@/agents/GeminiClient";
import { GeminiClient } from "@/agents/GeminiClient";
import { RequestInterpreter, type InterpretedRequest } from "@/agents/RequestInterpreter";
import { PlanExplainer } from "@/agents/PlanExplainer";
import { RetrievalPlanningPipeline, type RetrievalPlanResult } from "@/pipeline/RetrievalPlanningPipeline";

export interface AgentResponse {
  interpreted: InterpretedRequest;
  planResult?: RetrievalPlanResult;
  explanation: string;
}

/**
 * Top-level orchestrator matching report section 8's Orchestrator +
 * Decision agent responsibilities at prototype scope: interpret the
 * request, delegate to the deterministic pipeline (Phase 9) for the
 * actual computation, and explain the result. Escalates to a clarifying
 * question instead of guessing when the request doesn't resolve to a
 * container query.
 */
export class RetrievalAgent {
  private readonly pipeline: RetrievalPlanningPipeline;
  private readonly interpreter: RequestInterpreter;
  private readonly explainer: PlanExplainer;

  constructor(tos: TOSAdapter, model: GenerativeModelClient = new GeminiClient()) {
    this.pipeline = new RetrievalPlanningPipeline(tos);
    this.interpreter = new RequestInterpreter(model);
    this.explainer = new PlanExplainer(model);
  }

  async handleRequest(naturalLanguageRequest: string): Promise<AgentResponse> {
    const interpreted = await this.interpreter.interpret(naturalLanguageRequest);

    if (interpreted.isAmbiguous || !interpreted.containerQuery) {
      return {
        interpreted,
        explanation:
          interpreted.clarifyingQuestion ??
          "I couldn't identify which container you mean — could you provide a container ID?",
      };
    }

    const planResult = await this.pipeline.plan({
      containerQuery: interpreted.containerQuery,
      requestedBy: "operator", // caller identity is layered on in Phase 12 (supervisor approval)
      priority: interpreted.priority,
      requiredEquipmentType: interpreted.requiredEquipmentType,
    });

    const explanation = await this.explainer.explain(planResult);

    return { interpreted, planResult, explanation };
  }
}
