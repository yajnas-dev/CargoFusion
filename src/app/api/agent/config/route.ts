import { NextRequest, NextResponse } from "next/server";
import { containerManagementAgent } from "@/agent-monitor/ContainerManagementAgent";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);
    return NextResponse.json({ config: containerManagementAgent.getConfig() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR");

    const body = await req.json().catch(() => ({}));
    const partial: Record<string, number> = {};
    for (const key of ["agingTaskThresholdMs", "congestionHotspotThreshold", "congestionSustainedCycles"] as const) {
      if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] > 0) {
        partial[key] = body[key];
      }
    }

    const config = containerManagementAgent.setConfig(partial);
    return NextResponse.json({ config });
  } catch (err) {
    return errorResponse(err);
  }
}
