import { NextRequest, NextResponse } from "next/server";
import { AgentAlertService } from "@/agent-monitor/AgentAlertService";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { prisma } from "@/domain/db";
import { errorResponse } from "@/app/api/errorResponse";
import type { AgentAlertStatus } from "@/domain/types";

const VALID_STATUSES: AgentAlertStatus[] = ["OPEN", "ACKNOWLEDGED", "APPLIED", "DISMISSED"];

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);

    const statusParam = req.nextUrl.searchParams.get("status");
    const status = VALID_STATUSES.includes(statusParam as AgentAlertStatus)
      ? (statusParam as AgentAlertStatus)
      : undefined;

    const alerts = await new AgentAlertService().list(status);
    const taskIds = alerts.map((a) => a.taskId).filter((id): id is string => id !== null);
    const tasks = taskIds.length
      ? await prisma.task.findMany({ where: { id: { in: taskIds } }, include: { container: true } })
      : [];
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    return NextResponse.json({
      alerts: alerts.map((alert) => ({ ...alert, task: alert.taskId ? (taskById.get(alert.taskId) ?? null) : null })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
