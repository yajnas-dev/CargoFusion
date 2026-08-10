import { NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";

export async function POST() {
  const count = await new DemoControls().unblockAllLanes();
  return NextResponse.json({ unblocked: count });
}
