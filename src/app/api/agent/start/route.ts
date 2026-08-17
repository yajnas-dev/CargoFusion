import { NextRequest, NextResponse } from "next/server";
import { containerManagementAgent } from "@/agent-monitor/ContainerManagementAgent";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR");
    containerManagementAgent.start();
    return NextResponse.json({ running: containerManagementAgent.isRunning() });
  } catch (err) {
    return errorResponse(err);
  }
}
