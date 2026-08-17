import { prisma } from "@/domain/db";
import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";
import type { Priority } from "@/domain/types";

const PRE_DISPATCH_STATUSES = ["REQUESTED", "PLANNED", "APPROVED"] as const;

/**
 * A task with a deadline (Task.dueBy, set at request time — Port
 * Operations Roadmap Phase 3: SLA/Deadline Awareness) that's within the
 * warning window of breaching it, or already has, while still short of
 * DISPATCHED. Same shape as agingTask, but keyed to an explicit deadline
 * rather than a fixed idle-time threshold. Suggests bumping priority to
 * URGENT when it isn't already — a real actionable fix, not just a flag —
 * and falls back to ESCALATE_TO_SUPERVISOR once there's nothing left to
 * automate.
 */
export async function detectSlaBreaches(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const tasks = await prisma.task.findMany({
    where: { status: { in: [...PRE_DISPATCH_STATUSES] }, dueBy: { not: null } },
  });

  const candidates: CandidateAlert[] = [];
  for (const task of tasks) {
    const msUntilDue = task.dueBy!.getTime() - ctx.now.getTime();
    if (msUntilDue > ctx.config.slaWarningThresholdMs) continue;

    const breached = msUntilDue <= 0;
    const severity: Priority = breached ? "URGENT" : task.priority === "URGENT" || task.priority === "HIGH" ? task.priority : "HIGH";

    candidates.push({
      type: "SLA_AT_RISK",
      severity,
      taskId: task.id,
      subject: {
        taskId: task.id,
        dueBy: task.dueBy!.toISOString(),
        breached,
        minutesRemaining: Math.round(msUntilDue / 60000),
      },
      suggestedActionType: task.priority === "URGENT" ? "ESCALATE_TO_SUPERVISOR" : "REPRIORITIZE_TASK",
      suggestedActionPayload: task.priority === "URGENT" ? { taskId: task.id } : { taskId: task.id, newPriority: "URGENT" },
      dedupeKey: `sla-risk:${task.id}`,
    });
  }
  return candidates;
}
