import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/domain/db";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";
import type { AuditAction } from "@/domain/types";

const VALID_ACTIONS: AuditAction[] = [
  "REQUEST_SUBMITTED",
  "RECOMMENDATION_GENERATED",
  "APPROVED",
  "REJECTED",
  "OVERRIDDEN",
  "DISPATCHED",
  "WORKER_CONFIRMED",
  "STATUS_CHANGED",
  "AGENT_ALERT_RAISED",
  "AGENT_ALERT_APPLIED",
  "AGENT_ALERT_DISMISSED",
  "INCIDENT_REPORTED",
  "INCIDENT_RESOLVED",
];

/**
 * Read-only surface over AuditEvent — every mutating service already writes
 * one, but nothing exposed them until now (Port Operations Roadmap Phase 1:
 * Audit Trail Viewer). Filterable by taskId and/or action so a supervisor
 * can pull either "everything that happened to this task" or "every
 * override across the shift".
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);

    const { searchParams } = req.nextUrl;
    const taskId = searchParams.get("taskId") ?? undefined;
    const actionParam = searchParams.get("action");
    const action = VALID_ACTIONS.includes(actionParam as AuditAction) ? (actionParam as AuditAction) : undefined;
    const limitParam = Number(searchParams.get("limit"));
    const take = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100;

    const events = await prisma.auditEvent.findMany({
      where: {
        ...(taskId ? { taskId } : {}),
        ...(action ? { action } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        task: { include: { container: true } },
        agentAlert: { select: { type: true } },
      },
    });

    return NextResponse.json({ events });
  } catch (err) {
    return errorResponse(err);
  }
}
