import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const laneId = typeof body.laneId === "string" ? body.laneId : undefined;
  const lane = await new DemoControls().spikeCongestion(laneId);
  if (!lane) return NextResponse.json({ error: "No lane available to spike." }, { status: 400 });
  return NextResponse.json({ lane });
}
