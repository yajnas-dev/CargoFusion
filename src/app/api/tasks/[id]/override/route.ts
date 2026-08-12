import { NextRequest, NextResponse } from "next/server";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const actor = typeof body.actor === "string" && body.actor ? body.actor : "supervisor";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const equipmentId = typeof body.equipmentId === "string" ? body.equipmentId : undefined;

  try {
    const task = await new SupervisorApprovalService(new MockTOSAdapter()).override(id, actor, reason, {
      equipmentId,
    });
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
