import { prisma } from "@/domain/db";
import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";

/** A PLANNED/APPROVED task that's sat without supervisor action past the configured threshold. */
export async function detectAgingTasks(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const tasks = await prisma.task.findMany({ where: { status: { in: ["PLANNED", "APPROVED"] } } });

  return tasks
    .filter((t) => ctx.now.getTime() - t.updatedAt.getTime() > ctx.config.agingTaskThresholdMs)
    .map((t) => ({
      type: "AGING_TASK" as const,
      severity: t.priority,
      taskId: t.id,
      subject: { taskId: t.id, status: t.status, statusSince: t.updatedAt.toISOString() },
      suggestedActionType: "ESCALATE_TO_SUPERVISOR" as const,
      suggestedActionPayload: { taskId: t.id },
      dedupeKey: `aging-task:${t.id}`,
    }));
}
