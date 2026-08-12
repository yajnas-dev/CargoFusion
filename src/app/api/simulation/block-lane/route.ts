import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR", "OPERATOR");

    const body = await req.json().catch(() => ({}));
    const laneId = typeof body.laneId === "string" ? body.laneId : undefined;
    const controls = new DemoControls();
    const lane = laneId ? await controls.blockLane(laneId) : await controls.blockRandomLane();
    if (!lane) return NextResponse.json({ error: "No lane available to block." }, { status: 400 });
    return NextResponse.json({ lane });
  } catch (err) {
    return errorResponse(err);
  }
}
