import { NextResponse } from "next/server";
import { simulationEngine } from "@/simulation/SimulationEngine";

export async function POST() {
  simulationEngine.start();
  return NextResponse.json({ running: simulationEngine.isRunning() });
}
