import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR", "OPERATOR");

    const body = await req.json().catch(() => ({}));
    const equipmentId = typeof body.equipmentId === "string" ? body.equipmentId : undefined;
    const nodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
    const equipment = await new DemoControls().moveEquipment(equipmentId, nodeId);
    if (!equipment) return NextResponse.json({ error: "No equipment available to move." }, { status: 400 });
    return NextResponse.json({ equipment });
  } catch (err) {
    return errorResponse(err);
  }
}
