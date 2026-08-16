import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { ForbiddenError } from "@/auth/errors";
import { prisma } from "@/domain/db";
import { errorResponse } from "@/app/api/errorResponse";

/**
 * Recent completed/retrieved tasks for a worker — the worker app previously
 * showed only the single current active task with no way to see what came
 * before it (Port Operations Roadmap Phase 3: Worker App Queue/History).
 * There's no real multi-task *queue* under the current dispatch model
 * (WorkerTaskService.dispatch claims exactly one available worker per
 * task), so history is the meaningful addition here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await requireSessionUser(req);
    if (session.role === "WORKER" && session.workerId !== id) {
      throw new ForbiddenError("A worker can only view their own task history.");
    }

    const tasks = await prisma.task.findMany({
      where: { assignedWorkerId: id, status: { in: ["RETRIEVED", "COMPLETED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: { container: true },
    });
    return NextResponse.json({ tasks });
  } catch (err) {
    return errorResponse(err);
  }
}
