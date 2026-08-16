import { NextResponse } from "next/server";
import { prisma } from "@/domain/db";
import { ACTIVE_TASK_STATUSES } from "@/domain/constants";

export async function GET() {
  const workers = await prisma.worker.findMany({
    orderBy: { id: "asc" },
    include: {
      tasks: {
        where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
        include: { container: true },
        take: 1,
      },
    },
  });
  return NextResponse.json({ workers });
}
