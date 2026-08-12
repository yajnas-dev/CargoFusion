import { NextRequest, NextResponse } from "next/server";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { GeminiClient } from "@/agents/GeminiClient";
import { RequestInterpreter } from "@/agents/RequestInterpreter";
import { PlanExplainer } from "@/agents/PlanExplainer";
import { fallbackExplain, fallbackInterpret } from "@/agents/fallback";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { prisma } from "@/domain/db";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);

    const body = await req.json().catch(() => null);
    const rawRequest = typeof body?.request === "string" ? body.request.trim() : "";
    const requestedBy = session.email;

    if (!rawRequest) {
      return NextResponse.json({ error: "'request' is required." }, { status: 400 });
    }

    let model: GeminiClient | null;
    try {
      model = new GeminiClient();
    } catch {
      model = null; // no GEMINI_API_KEY configured
    }

    const interpreted = model
      ? await new RequestInterpreter(model).interpret(rawRequest).catch(() => fallbackInterpret(rawRequest))
      : fallbackInterpret(rawRequest);

    if (interpreted.isAmbiguous || !interpreted.containerQuery) {
      return NextResponse.json({
        interpreted,
        explanation: interpreted.clarifyingQuestion ?? "Could you provide a container ID?",
      });
    }

    const approval = new SupervisorApprovalService(new MockTOSAdapter());
    const result = await approval.submitRequest({
      containerQuery: interpreted.containerQuery,
      requestedBy,
      priority: interpreted.priority,
      requiredEquipmentType: interpreted.requiredEquipmentType,
      naturalLanguageRequest: rawRequest,
    });

    const explanation = model
      ? await new PlanExplainer(model).explain(result.planResult).catch(() => fallbackExplain(result.planResult))
      : fallbackExplain(result.planResult);

    if (result.recommendation) {
      await prisma.recommendation.update({
        where: { id: result.recommendation.id },
        data: { explanation },
      });
    }

    return NextResponse.json({ interpreted, explanation, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
