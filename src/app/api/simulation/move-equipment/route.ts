import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const equipmentId = typeof body.equipmentId === "string" ? body.equipmentId : undefined;
  const nodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
  const equipment = await new DemoControls().moveEquipment(equipmentId, nodeId);
  if (!equipment) return NextResponse.json({ error: "No equipment available to move." }, { status: 400 });
  return NextResponse.json({ equipment });
}
