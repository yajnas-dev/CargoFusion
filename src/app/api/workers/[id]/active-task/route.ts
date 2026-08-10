import { NextResponse } from "next/server";
import { WorkerTaskService } from "@/worker/WorkerTaskService";
import { prisma } from "@/domain/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activeTask = await new WorkerTaskService().getActiveTaskForWorker(id);
  if (!activeTask) return NextResponse.json({ task: null });

  const task = await prisma.task.findUnique({
    where: { id: activeTask.id },
    include: { container: true, assignedEquipment: true },
  });
  return NextResponse.json({ task });
}
