import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const laneId = typeof body.laneId === "string" ? body.laneId : undefined;
  const controls = new DemoControls();
  const lane = laneId ? await controls.blockLane(laneId) : await controls.blockRandomLane();
  if (!lane) return NextResponse.json({ error: "No lane available to block." }, { status: 400 });
  return NextResponse.json({ lane });
}
