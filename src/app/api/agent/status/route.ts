import { NextRequest, NextResponse } from "next/server";
import { containerManagementAgent } from "@/agent-monitor/ContainerManagementAgent";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req); // open to any authenticated role — just a status read
    return NextResponse.json({ running: containerManagementAgent.isRunning() });
  } catch (err) {
    return errorResponse(err);
  }
}
