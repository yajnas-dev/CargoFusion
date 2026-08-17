import { NextRequest, NextResponse } from "next/server";
import { AgentAlertService } from "@/agent-monitor/AgentAlertService";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR");
    const alert = await new AgentAlertService().dismiss(id, session.email, reason);
    return NextResponse.json({ alert });
  } catch (err) {
    return errorResponse(err);
  }
}
