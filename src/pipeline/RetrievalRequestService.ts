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

export interface BatchRetrievalRequestItem {
  rawRequest: string;
  response?: RetrievalRequestResponse;
  error?: string;
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

  /**
   * Batch submission (Port Operations Roadmap Phase 3) — one request per
   * line, each going through the exact same interpret -> submit -> explain
   * path as a single request, not a separate bulk pipeline. A real shift
   * gets bursts of requests (a manifest pasted in, several containers
   * needed for one outbound truck), not one-at-a-time typing — this is
   * about handling that volume, not about parsing "and" inside one
   * sentence. Each line is isolated: one failing doesn't stop the rest.
   */
  async submitBatch(rawRequests: string[], requestedBy: string): Promise<BatchRetrievalRequestItem[]> {
    const items: BatchRetrievalRequestItem[] = [];
    for (const rawRequest of rawRequests) {
      try {
        const response = await this.submit(rawRequest, requestedBy);
        items.push({ rawRequest, response });
      } catch (err) {
        items.push({ rawRequest, error: err instanceof Error ? err.message : "Unexpected error." });
      }
    }
    return items;
  }
}
