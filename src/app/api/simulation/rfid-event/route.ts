import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR", "OPERATOR");

    const body = await req.json().catch(() => ({}));
    const containerId = typeof body.containerId === "string" ? body.containerId : undefined;
    const event = await new DemoControls().triggerRfidEvent(containerId);
    if (!event) return NextResponse.json({ error: "No container available for an RFID event." }, { status: 400 });
    return NextResponse.json({ event });
  } catch (err) {
    return errorResponse(err);
  }
}
