import { NextRequest, NextResponse } from "next/server";
import { AgentAlertService } from "@/agent-monitor/AgentAlertService";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR");
    const { alert, result } = await new AgentAlertService().apply(id, session.email);
    return NextResponse.json({ alert, result });
  } catch (err) {
    return errorResponse(err);
  }
}
