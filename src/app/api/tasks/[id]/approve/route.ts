import { NextRequest, NextResponse } from "next/server";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await requireSessionUser(req);
    requireRole(session, "SUPERVISOR");
    const task = await new SupervisorApprovalService(new MockTOSAdapter()).approve(id, session.email);
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
