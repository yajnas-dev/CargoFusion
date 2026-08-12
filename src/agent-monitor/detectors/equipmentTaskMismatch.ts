import { prisma } from "@/domain/db";
import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";

/**
 * Equipment marked BUSY with no active task actually claiming it — a
 * safety net for the equipment-lifecycle bug fixed directly in
 * WorkerTaskService (dispatch/confirmRetrieval now claim/free equipment
 * symmetrically with the worker), catching any equipment that still ends
 * up stuck via some other path (a crashed request mid-transaction, a
 * manual DB edit, etc.).
 */
// Signature matches DetectorFn even though this detector doesn't need now/config.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function detectEquipmentTaskMismatch(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const busyEquipment = await prisma.equipment.findMany({ where: { status: "BUSY" } });
  if (busyEquipment.length === 0) return [];

  const claimingTasks = await prisma.task.findMany({
    where: { status: { in: ["DISPATCHED", "IN_PROGRESS", "RETRIEVED"] }, assignedEquipmentId: { not: null } },
    select: { assignedEquipmentId: true },
  });
  const claimedIds = new Set(claimingTasks.map((t) => t.assignedEquipmentId));

  return busyEquipment
    .filter((eq) => !claimedIds.has(eq.id))
    .map((eq) => ({
      type: "EQUIPMENT_TASK_MISMATCH" as const,
      severity: "LOW" as const,
      subject: { equipmentId: eq.id },
      suggestedActionType: "FREE_STUCK_EQUIPMENT" as const,
      suggestedActionPayload: { equipmentId: eq.id },
      dedupeKey: `stuck-equipment:${eq.id}`,
    }));
}
