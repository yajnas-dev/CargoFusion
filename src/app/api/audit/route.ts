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
 * override across the shift". `since`/`until` + `order=asc` (Phase 4: Shift
 * Timeline) narrow to a time range in chronological order for replay.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);

    const { searchParams } = req.nextUrl;
    const taskId = searchParams.get("taskId") ?? undefined;
    const actionParam = searchParams.get("action");
    const action = VALID_ACTIONS.includes(actionParam as AuditAction) ? (actionParam as AuditAction) : undefined;

    const sinceParam = searchParams.get("since");
    const untilParam = searchParams.get("until");
    const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : undefined;
    const until = untilParam && !Number.isNaN(Date.parse(untilParam)) ? new Date(untilParam) : undefined;
    const hasRange = since !== undefined || until !== undefined;

    const order = searchParams.get("order") === "asc" ? "asc" : "desc";
    const limitParam = Number(searchParams.get("limit"));
    const maxTake = hasRange ? 1000 : 200;
    const take = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, maxTake) : hasRange ? maxTake : 100;

    const events = await prisma.auditEvent.findMany({
      where: {
        ...(taskId ? { taskId } : {}),
        ...(action ? { action } : {}),
        ...(hasRange ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}),
      },
      orderBy: { createdAt: order },
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
