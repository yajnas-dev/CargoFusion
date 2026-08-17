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
    const controls = new DemoControls();

    if (equipmentId) {
      const status = body.status === "AVAILABLE" || body.status === "OFFLINE" ? body.status : "OFFLINE";
      const equipment = await controls.setEquipmentStatus(equipmentId, status);
      return NextResponse.json({ equipment });
    }
    const equipment = await controls.flapRandomEquipmentAvailability();
    if (!equipment) return NextResponse.json({ error: "No equipment available to flap." }, { status: 400 });
    return NextResponse.json({ equipment });
  } catch (err) {
    return errorResponse(err);
  }
}
