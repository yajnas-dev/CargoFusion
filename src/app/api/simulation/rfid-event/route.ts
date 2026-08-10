import { NextRequest, NextResponse } from "next/server";
import { DemoControls } from "@/simulation/DemoControls";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const containerId = typeof body.containerId === "string" ? body.containerId : undefined;
  const event = await new DemoControls().triggerRfidEvent(containerId);
  if (!event) return NextResponse.json({ error: "No container available for an RFID event." }, { status: 400 });
  return NextResponse.json({ event });
}
