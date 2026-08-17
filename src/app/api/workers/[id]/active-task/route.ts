import { NextRequest, NextResponse } from "next/server";
import { WorkerTaskService } from "@/worker/WorkerTaskService";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { ForbiddenError } from "@/auth/errors";
import { prisma } from "@/domain/db";
import { errorResponse } from "@/app/api/errorResponse";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await requireSessionUser(req);
    if (session.role === "WORKER" && session.workerId !== id) {
      throw new ForbiddenError("A worker can only view their own active task.");
    }

    const activeTask = await new WorkerTaskService().getActiveTaskForWorker(id);
    if (!activeTask) return NextResponse.json({ task: null });

    const task = await prisma.task.findUnique({
      where: { id: activeTask.id },
      include: { container: true, assignedEquipment: true },
    });
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
