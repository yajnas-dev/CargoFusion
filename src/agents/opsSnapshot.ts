import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { ACTIVE_TASK_STATUSES } from "@/domain/constants";
import type { Priority } from "@/domain/types";

export interface OpsAlertSummary {
  type: string;
  severity: Priority;
  explanation: string;
  ageMinutes: number;
}

export interface OpsSnapshot {
  activeTaskCount: number;
  pendingApprovalCount: number;
  blockedLaneCount: number;
  avgCongestionWeight: number;
  equipmentAvailable: number;
  equipmentTotal: number;
  workersAvailable: number;
  workersTotal: number;
  openIncidentCount: number;
  openAlertsBySeverity: Record<Priority, number>;
  topOpenAlerts: OpsAlertSummary[];
}

/**
 * The grounding data for the Operations Assistant (src/agents/OperationsAssistant.ts)
 * — deliberately small, same "tiny snapshot, not a full state dump"
 * principle AlertRanker's prompt already follows. Everything here is a
 * plain aggregate query; the LLM only narrates it.
 */
export async function buildOpsSnapshot(): Promise<OpsSnapshot> {
  const tos = new MockTOSAdapter();
  const [yardState, equipment, pendingApprovalCount, activeTaskCount, workers, openAlerts, topOpenAlerts, openIncidentCount] =
    await Promise.all([
      tos.getYardState(),
      tos.getEquipment(),
      prisma.task.count({ where: { status: { in: ["REQUESTED", "PLANNED"] } } }),
      prisma.task.count({ where: { status: { in: [...ACTIVE_TASK_STATUSES] } } }),
      prisma.worker.findMany({ select: { status: true } }),
      prisma.agentAlert.findMany({
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        select: { severity: true },
      }),
      prisma.agentAlert.findMany({
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        orderBy: [{ rankScore: "desc" }, { detectedAt: "desc" }],
        take: 5,
        select: { type: true, severity: true, explanation: true, detectedAt: true },
      }),
      prisma.incident.count({ where: { status: "OPEN" } }),
    ]);

  const blockedLaneCount = yardState.lanes.filter((l) => l.blocked).length;
  const avgCongestionWeight =
    yardState.lanes.length > 0
      ? yardState.lanes.reduce((sum, l) => sum + l.congestionWeight, 0) / yardState.lanes.length
      : 1;

  const openAlertsBySeverity: Record<Priority, number> = { URGENT: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const alert of openAlerts) openAlertsBySeverity[alert.severity]++;

  return {
    activeTaskCount,
    pendingApprovalCount,
    blockedLaneCount,
    avgCongestionWeight,
    equipmentAvailable: equipment.filter((e) => e.status === "AVAILABLE").length,
    equipmentTotal: equipment.length,
    workersAvailable: workers.filter((w) => w.status === "AVAILABLE").length,
    workersTotal: workers.length,
    openIncidentCount,
    openAlertsBySeverity,
    topOpenAlerts: topOpenAlerts.map((a) => ({
      type: a.type,
      severity: a.severity,
      explanation: a.explanation,
      ageMinutes: Math.floor((Date.now() - a.detectedAt.getTime()) / 60000),
    })),
  };
}
