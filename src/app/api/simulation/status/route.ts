import { NextResponse } from "next/server";
import { simulationEngine } from "@/simulation/SimulationEngine";

export async function GET() {
  return NextResponse.json({ running: simulationEngine.isRunning() });
}
