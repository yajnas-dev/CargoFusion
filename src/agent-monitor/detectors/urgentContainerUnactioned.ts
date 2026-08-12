import { prisma } from "@/domain/db";
import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";

/**
 * URGENT-priority tasks that never progressed past REQUESTED (the
 * original plan hit NOT_FOUND/AMBIGUOUS/NO_EQUIPMENT/NO_ROUTE), sitting
 * un-actioned past the aging threshold. Container-level "URGENT container
 * never even requested" detection is out of scope: Container has no
 * "eligible-since" timestamp to measure dwell time against, and
 * lastSyncedAt isn't a reliable proxy for it.
 */
export async function detectUrgentUnactioned(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const cutoff = new Date(ctx.now.getTime() - ctx.config.agingTaskThresholdMs);
  const tasks = await prisma.task.findMany({
    where: { priority: "URGENT", status: "REQUESTED", createdAt: { lt: cutoff } },
  });

  return tasks.map((t) => ({
    type: "URGENT_CONTAINER_UNACTIONED" as const,
    severity: "URGENT" as const,
    taskId: t.id,
    subject: { taskId: t.id, createdAt: t.createdAt.toISOString() },
    suggestedActionType: "ESCALATE_TO_SUPERVISOR" as const,
    suggestedActionPayload: { taskId: t.id },
    dedupeKey: `urgent-unactioned:${t.id}`,
  }));
}
