import { NextRequest, NextResponse } from "next/server";
import { IncidentService } from "@/incidents/IncidentService";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";
import type { IncidentStatus, IncidentType } from "@/domain/types";

const VALID_STATUSES: IncidentStatus[] = ["OPEN", "RESOLVED"];
const VALID_TYPES: IncidentType[] = ["EQUIPMENT_OFFLINE", "LANE_BLOCKED"];

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);
    const statusParam = req.nextUrl.searchParams.get("status");
    const status = VALID_STATUSES.includes(statusParam as IncidentStatus) ? (statusParam as IncidentStatus) : undefined;
    const incidents = await new IncidentService().list(status);
    return NextResponse.json({ incidents });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR", "OPERATOR");

    const body = await req.json().catch(() => ({}));
    if (!VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(", ")}.` }, { status: 400 });
    }
    if (typeof body.subjectId !== "string" || !body.subjectId) {
      return NextResponse.json({ error: "subjectId is required." }, { status: 400 });
    }

    const incident = await new IncidentService().report({
      type: body.type,
      subjectId: body.subjectId,
      actor: session.email,
      cause: typeof body.cause === "string" && body.cause ? body.cause : undefined,
    });
    return NextResponse.json({ incident });
  } catch (err) {
    return errorResponse(err);
  }
}
