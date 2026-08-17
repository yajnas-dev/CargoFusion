import { prisma } from "@/domain/db";
import { EquipmentAllocationService } from "@/optimization/EquipmentAllocationService";
import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";

// Task has no persisted "required equipment type" (only used transiently
// during the original planning attempt) — matches the pipeline's own
// default (RetrievalPlanningPipeline's DEFAULT_EQUIPMENT_TYPE) for a
// re-attempt, rather than inventing a new stored field for this detector alone.
const DEFAULT_EQUIPMENT_TYPE = "YARD_TRUCK" as const;

/**
 * Tasks stuck at REQUESTED (the original plan hit NO_EQUIPMENT/NO_ROUTE/
 * NEEDS_ESCALATION, so no recommendation was ever created) where a fresh
 * allocation pass now finds a viable candidate — equipment state can
 * change after the original attempt (simulation drift, another task
 * completing, etc.).
 */
export async function detectIdleEquipmentBacklog(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const stuckTasks = await prisma.task.findMany({
    where: { status: "REQUESTED" },
    include: { container: true },
  });
  if (stuckTasks.length === 0) return [];

  const allocation = new EquipmentAllocationService(ctx.tos);
  const candidates: CandidateAlert[] = [];

  for (const task of stuckTasks) {
    const destinationNodeId = `BLOCK-${task.container.block}-ENTRY`;
    const scores = await allocation.allocate({
      destinationNodeId,
      requiredType: DEFAULT_EQUIPMENT_TYPE,
      containerWeightKg: task.container.weightKg,
      priority: task.priority,
    });
    const top = scores[0];
    if (!top) continue;

    candidates.push({
      type: "IDLE_EQUIPMENT_BACKLOG",
      severity: task.priority,
      taskId: task.id,
      subject: { taskId: task.id, equipmentId: top.equipment.id, score: top.score },
      suggestedActionType: "REASSIGN_EQUIPMENT",
      suggestedActionPayload: { taskId: task.id, equipmentId: top.equipment.id },
      dedupeKey: `idle-backlog:${task.id}`,
    });
  }
  return candidates;
}
