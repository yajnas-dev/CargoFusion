import { NextResponse } from "next/server";
import { prisma } from "@/domain/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      container: true,
      assignedEquipment: true,
      assignedWorker: true,
      recommendations: { orderBy: { createdAt: "desc" } },
      auditEvents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ task });
}
