import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const laneId = typeof body.laneId === "string" ? body.laneId : undefined;
  if (!laneId) return NextResponse.json({ error: "laneId is required." }, { status: 400 });

  try {
    const lane = await new DemoControls().unblockLane(laneId);
    return NextResponse.json({ lane });
  } catch (err) {
    return errorResponse(err);
  }
}
