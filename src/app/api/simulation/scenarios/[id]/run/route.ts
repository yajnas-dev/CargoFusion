import { NextRequest, NextResponse } from "next/server";
import { ScenarioRunner } from "@/simulation/scenarios";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR", "OPERATOR");

    const result = await new ScenarioRunner().run(id);
    return NextResponse.json({ result });
  } catch (err) {
    return errorResponse(err);
  }
}
