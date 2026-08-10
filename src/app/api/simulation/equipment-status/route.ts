import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const equipmentId = typeof body.equipmentId === "string" ? body.equipmentId : undefined;
  const controls = new DemoControls();

  try {
    if (equipmentId) {
      const status = body.status === "AVAILABLE" || body.status === "OFFLINE" ? body.status : "OFFLINE";
      const equipment = await controls.setEquipmentStatus(equipmentId, status);
      return NextResponse.json({ equipment });
    }
    const equipment = await controls.flapRandomEquipmentAvailability();
    if (!equipment) return NextResponse.json({ error: "No equipment available to flap." }, { status: 400 });
    return NextResponse.json({ equipment });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
