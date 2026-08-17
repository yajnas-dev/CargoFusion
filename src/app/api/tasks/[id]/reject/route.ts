import { NextRequest, NextResponse } from "next/server";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason : "";

  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR");
    const task = await new SupervisorApprovalService(new MockTOSAdapter()).reject(id, session.email, reason);
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
