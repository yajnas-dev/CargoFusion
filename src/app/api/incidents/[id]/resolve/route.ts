import { NextRequest, NextResponse } from "next/server";
import { IncidentService } from "@/incidents/IncidentService";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR", "OPERATOR");

    const body = await req.json().catch(() => ({}));
    const note = typeof body.note === "string" && body.note ? body.note : undefined;

    const incident = await new IncidentService().resolve(id, session.email, note);
    return NextResponse.json({ incident });
  } catch (err) {
    return errorResponse(err);
  }
}
