import { NextRequest, NextResponse } from "next/server";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const actor = typeof body.actor === "string" && body.actor ? body.actor : "supervisor";
  const reason = typeof body.reason === "string" ? body.reason : "";

  try {
    const task = await new SupervisorApprovalService(new MockTOSAdapter()).reject(id, actor, reason);
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
