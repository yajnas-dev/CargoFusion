import { NextRequest, NextResponse } from "next/server";
import { simulationEngine } from "@/simulation/SimulationEngine";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR", "OPERATOR");
    simulationEngine.start();
    return NextResponse.json({ running: simulationEngine.isRunning() });
  } catch (err) {
    return errorResponse(err);
  }
}
