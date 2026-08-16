import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { createModelOrNull, type GenerativeModelClient } from "@/agents/GeminiClient";
import { RequestInterpreter, type InterpretedRequest } from "@/agents/RequestInterpreter";
import { PlanExplainer } from "@/agents/PlanExplainer";
import { fallbackExplain, fallbackInterpret } from "@/agents/fallback";
import { SupervisorApprovalService, type SubmitRequestResult } from "@/approval/SupervisorApprovalService";
import { prisma } from "@/domain/db";

export interface RetrievalRequestResponse extends Partial<SubmitRequestResult> {
  interpreted: InterpretedRequest;
  explanation: string;
}

/**
 * The single live entry point for turning a natural-language retrieval
 * request into a persisted, explained plan: interpret -> submit to the
 * approval pipeline -> explain, with a deterministic fallback at each LLM
 * step when Gemini is unavailable or throws. Extracted from
 * POST /api/retrieval-requests (which becomes a thin session-auth
 * wrapper around this) to replace the old src/agents/RetrievalAgent.ts,
 * which duplicated this same sequence but never persisted a Task —
 * this is the one canonical path now.
 */
export class RetrievalRequestService {
  private readonly approval: SupervisorApprovalService;

  constructor(
    tos: TOSAdapter = new MockTOSAdapter(),
    private readonly model: GenerativeModelClient | null = createModelOrNull(),
  ) {
    this.approval = new SupervisorApprovalService(tos);
  }

  async submit(rawRequest: string, requestedBy: string, dueBy?: Date): Promise<RetrievalRequestResponse> {
    const interpreted = this.model
      ? await new RequestInterpreter(this.model).interpret(rawRequest).catch(() => fallbackInterpret(rawRequest))
      : fallbackInterpret(rawRequest);

    if (interpreted.isAmbiguous || !interpreted.containerQuery) {
      return {
        interpreted,
        explanation: interpreted.clarifyingQuestion ?? "Could you provide a container ID?",
      };
    }

    const result = await this.approval.submitRequest({
      containerQuery: interpreted.containerQuery,
      requestedBy,
      priority: interpreted.priority,
      requiredEquipmentType: interpreted.requiredEquipmentType,
      naturalLanguageRequest: rawRequest,
      dueBy,
    });

    const explanation = this.model
      ? await new PlanExplainer(this.model).explain(result.planResult).catch(() => fallbackExplain(result.planResult))
      : fallbackExplain(result.planResult);

    if (result.recommendation) {
      await prisma.recommendation.update({
        where: { id: result.recommendation.id },
        data: { explanation },
      });
    }

    return { interpreted, explanation, ...result };
  }
}
