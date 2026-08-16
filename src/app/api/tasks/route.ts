import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/domain/db";
import type { TaskStatus } from "@/domain/types";

const VALID_STATUSES: TaskStatus[] = [
  "REQUESTED",
  "PLANNED",
  "APPROVED",
  "REJECTED",
  "DISPATCHED",
  "IN_PROGRESS",
  "RETRIEVED",
  "COMPLETED",
];

/**
 * `?status=PLANNED,REQUESTED` narrows the list to exactly what the
 * Supervisor Approval Queue (`/tasks`) needs — everything else keeps the
 * previous unfiltered "latest tasks" behavior the dashboard's Task Tracking
 * table relies on.
 */
export async function GET(req?: NextRequest) {
  const statusParam = req?.nextUrl.searchParams.get("status");
  const statuses = statusParam
    ? statusParam
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is TaskStatus => VALID_STATUSES.includes(s as TaskStatus))
    : undefined;

  const tasks = await prisma.task.findMany({
    where: statuses && statuses.length > 0 ? { status: { in: statuses } } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      container: true,
      assignedEquipment: true,
      assignedWorker: true,
      recommendations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return NextResponse.json({ tasks });
}
