import { NextRequest, NextResponse } from "next/server";
import { WorkerTaskService } from "@/worker/WorkerTaskService";
import { requireSessionUser, requireRole } from "@/auth/requireSessionUser";
import { ForbiddenError } from "@/auth/errors";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await requireSessionUser(req);
    requireRole(session, "WORKER");
    if (!session.workerId) throw new ForbiddenError("This account is not linked to a worker profile.");

    const task = await new WorkerTaskService().startTask(id, session.workerId);
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
