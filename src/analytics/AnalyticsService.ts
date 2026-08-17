import { prisma } from "@/domain/db";
import type { TaskStatus } from "@/domain/types";

export interface ThroughputSummary {
  completedInWindow: number;
  windowHours: number;
  perHour: number;
}

export interface DurationSummary {
  sampleSize: number;
  avgSeconds: number | null;
}

export interface UtilizationSummary {
  available: number;
  busy: number;
  offlineOrOffShift: number;
  total: number;
  avgActiveTaskCount: number | null;
}

export interface IncidentDurationSummary {
  type: string;
  resolvedCount: number;
  avgResolutionSeconds: number | null;
}

export interface AnalyticsSummary {
  windowHours: number;
  throughput: ThroughputSummary;
  avgRetrievalTime: DurationSummary; // REQUESTED (Task.createdAt) -> COMPLETED (Task.updatedAt)
  avgQueueTime: DurationSummary; // REQUEST_SUBMITTED -> APPROVED, all priorities
  avgUrgentQueueTime: DurationSummary; // same, URGENT priority only
  taskStatusCounts: Record<TaskStatus, number>;
  requestOutcomeCounts: Record<string, number>; // from REQUEST_SUBMITTED audit events' recorded plan status
  equipmentUtilization: UtilizationSummary;
  workerUtilization: UtilizationSummary;
  congestion: { avgCongestionWeight: number; blockedLaneCount: number; totalLaneCount: number };
  alertVolumeByType: Record<string, number>;
  incidents: { open: number; resolvedByType: IncidentDurationSummary[] };
}

const ALL_TASK_STATUSES: TaskStatus[] = [
  "REQUESTED",
  "PLANNED",
  "APPROVED",
  "REJECTED",
  "DISPATCHED",
  "IN_PROGRESS",
  "RETRIEVED",
  "COMPLETED",
];

function avgSecondsBetween(pairs: { start: Date; end: Date }[]): DurationSummary {
  if (pairs.length === 0) return { sampleSize: 0, avgSeconds: null };
  const totalSeconds = pairs.reduce((sum, p) => sum + (p.end.getTime() - p.start.getTime()) / 1000, 0);
  return { sampleSize: pairs.length, avgSeconds: totalSeconds / pairs.length };
}

/**
 * Read-only aggregation over data every other service already writes —
 * Port Operations Roadmap Phase 2: Analytics/KPI Dashboard. Every number
 * here traces to a real column (Task/AuditEvent/AgentAlert/Incident); no
 * metric is fabricated or estimated from something the schema doesn't
 * actually track (e.g. no "replanning frequency" here — the pipeline's
 * internal retry attempts aren't persisted anywhere, so that metric can't
 * honestly be reported yet).
 */
export class AnalyticsService {
  async summarize(windowHours = 24): Promise<AnalyticsSummary> {
    const windowStart = new Date(Date.now() - windowHours * 3_600_000);

    const [
      completedInWindow,
      completedTasksAllTime,
      statusCounts,
      requestSubmissions,
      queueTimingEvents,
      equipmentRows,
      equipmentWorkload,
      workerRows,
      laneStats,
      blockedLaneCount,
      alertTypeCounts,
      openIncidentCount,
      resolvedIncidents,
    ] = await Promise.all([
      prisma.task.count({ where: { status: "COMPLETED", updatedAt: { gte: windowStart } } }),
      prisma.task.findMany({ where: { status: "COMPLETED" }, select: { createdAt: true, updatedAt: true } }),
      prisma.task.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.auditEvent.findMany({ where: { action: "REQUEST_SUBMITTED" }, select: { detailsJson: true } }),
      prisma.auditEvent.findMany({
        where: { action: { in: ["REQUEST_SUBMITTED", "APPROVED"] }, taskId: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { taskId: true, action: true, createdAt: true },
      }),
      prisma.equipment.findMany({ select: { status: true } }),
      prisma.task.groupBy({
        by: ["assignedEquipmentId"],
        where: { assignedEquipmentId: { not: null }, status: { in: ["PLANNED", "APPROVED", "DISPATCHED", "IN_PROGRESS"] } },
        _count: { _all: true },
      }),
      prisma.worker.findMany({ select: { status: true } }),
      prisma.yardLane.aggregate({ _avg: { congestionWeight: true }, _count: { _all: true } }),
      prisma.yardLane.count({ where: { blocked: true } }),
      prisma.agentAlert.groupBy({ by: ["type"], _count: { _all: true } }),
      prisma.incident.count({ where: { status: "OPEN" } }),
      prisma.incident.findMany({
        where: { status: "RESOLVED" },
        select: { type: true, startedAt: true, resolvedAt: true },
      }),
    ]);

    const taskStatusCounts = Object.fromEntries(ALL_TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const row of statusCounts) taskStatusCounts[row.status] = row._count._all;

    const requestOutcomeCounts: Record<string, number> = {};
    for (const submission of requestSubmissions) {
      try {
        const status = (JSON.parse(submission.detailsJson).status as string | undefined) ?? "UNKNOWN";
        requestOutcomeCounts[status] = (requestOutcomeCounts[status] ?? 0) + 1;
      } catch {
        requestOutcomeCounts.UNKNOWN = (requestOutcomeCounts.UNKNOWN ?? 0) + 1;
      }
    }

    const submittedAt = new Map<string, Date>();
    const approvedAt = new Map<string, Date>();
    for (const ev of queueTimingEvents) {
      if (!ev.taskId) continue;
      if (ev.action === "REQUEST_SUBMITTED" && !submittedAt.has(ev.taskId)) submittedAt.set(ev.taskId, ev.createdAt);
      if (ev.action === "APPROVED" && !approvedAt.has(ev.taskId)) approvedAt.set(ev.taskId, ev.createdAt);
    }
    const queuedTaskIds = [...submittedAt.keys()].filter((id) => approvedAt.has(id));
    const queuedTasks = queuedTaskIds.length
      ? await prisma.task.findMany({ where: { id: { in: queuedTaskIds } }, select: { id: true, priority: true } })
      : [];
    const priorityById = new Map(queuedTasks.map((t) => [t.id, t.priority]));
    const allQueuePairs = queuedTaskIds.map((id) => ({ start: submittedAt.get(id)!, end: approvedAt.get(id)! }));
    const urgentQueuePairs = queuedTaskIds
      .filter((id) => priorityById.get(id) === "URGENT")
      .map((id) => ({ start: submittedAt.get(id)!, end: approvedAt.get(id)! }));

    const equipmentAvailable = equipmentRows.filter((e) => e.status === "AVAILABLE").length;
    const equipmentBusy = equipmentRows.filter((e) => e.status === "BUSY").length;
    const equipmentOffline = equipmentRows.filter((e) => e.status === "OFFLINE").length;
    const avgEquipmentWorkload = equipmentWorkload.length
      ? equipmentWorkload.reduce((sum, w) => sum + w._count._all, 0) / equipmentRows.length
      : equipmentRows.length > 0
        ? 0
        : null;

    const workerAvailable = workerRows.filter((w) => w.status === "AVAILABLE").length;
    const workerBusy = workerRows.filter((w) => w.status === "BUSY").length;
    const workerOffShift = workerRows.filter((w) => w.status === "OFF_SHIFT").length;

    const alertVolumeByType: Record<string, number> = {};
    for (const row of alertTypeCounts) alertVolumeByType[row.type] = row._count._all;

    const resolvedByTypeMap = new Map<string, { start: Date; end: Date }[]>();
    for (const incident of resolvedIncidents) {
      if (!incident.resolvedAt) continue;
      const list = resolvedByTypeMap.get(incident.type) ?? [];
      list.push({ start: incident.startedAt, end: incident.resolvedAt });
      resolvedByTypeMap.set(incident.type, list);
    }
    const resolvedByType: IncidentDurationSummary[] = [...resolvedByTypeMap.entries()].map(([type, pairs]) => ({
      type,
      resolvedCount: pairs.length,
      avgResolutionSeconds: avgSecondsBetween(pairs).avgSeconds,
    }));

    return {
      windowHours,
      throughput: {
        completedInWindow,
        windowHours,
        perHour: completedInWindow / windowHours,
      },
      avgRetrievalTime: avgSecondsBetween(
        completedTasksAllTime.map((t) => ({ start: t.createdAt, end: t.updatedAt })),
      ),
      avgQueueTime: avgSecondsBetween(allQueuePairs),
      avgUrgentQueueTime: avgSecondsBetween(urgentQueuePairs),
      taskStatusCounts,
      requestOutcomeCounts,
      equipmentUtilization: {
        available: equipmentAvailable,
        busy: equipmentBusy,
        offlineOrOffShift: equipmentOffline,
        total: equipmentRows.length,
        avgActiveTaskCount: avgEquipmentWorkload,
      },
      workerUtilization: {
        available: workerAvailable,
        busy: workerBusy,
        offlineOrOffShift: workerOffShift,
        total: workerRows.length,
        avgActiveTaskCount: null,
      },
      congestion: {
        avgCongestionWeight: laneStats._avg.congestionWeight ?? 1,
        blockedLaneCount,
        totalLaneCount: laneStats._count._all,
      },
      alertVolumeByType,
      incidents: { open: openIncidentCount, resolvedByType },
    };
  }
}
