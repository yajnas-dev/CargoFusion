import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";
import { createModelOrNull } from "@/agents/GeminiClient";
import { OperationsAssistant } from "@/agents/OperationsAssistant";
import { fallbackOpsSummary } from "@/agents/fallback";
import { buildOpsSnapshot } from "@/agents/opsSnapshot";

export async function POST(req: NextRequest) {
  try {
    await requireSessionUser(req);

    const body = await req.json().catch(() => ({}));
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) return NextResponse.json({ error: "question is required." }, { status: 400 });

    const snapshot = await buildOpsSnapshot();
    const model = createModelOrNull();

    let answer: string;
    let usedFallback: boolean;
    if (model) {
      try {
        answer = await new OperationsAssistant(model).answer(question, snapshot);
        usedFallback = false;
      } catch {
        answer = fallbackOpsSummary(snapshot);
        usedFallback = true;
      }
    } else {
      answer = fallbackOpsSummary(snapshot);
      usedFallback = true;
    }

    return NextResponse.json({ answer, usedFallback });
  } catch (err) {
    return errorResponse(err);
  }
}
