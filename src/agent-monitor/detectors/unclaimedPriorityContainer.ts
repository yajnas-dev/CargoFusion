import { prisma } from "@/domain/db";
import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";

// Real steady-state condition (there's almost always some backlog), so this
// detector caps its own output rather than flooding the alert feed with
// every eligible container at once — surface the most pressing few, not the
// whole yard.
const MAX_SUGGESTIONS_PER_CYCLE = 5;

/**
 * High/urgent-priority containers sitting in the yard, eligible for
 * retrieval, that nobody has ever requested — the agent proactively
 * initiating work, not just reacting to problems ("running the port").
 * Applying the suggestion calls SupervisorApprovalService.submitRequest
 * directly (src/agent-monitor/AgentAlertService.ts), the exact same
 * deterministic pipeline a human-typed request goes through — it only
 * gets the container as far as a task existing, still pending the normal
 * Approve step, never skipping supervisor sign-off.
 */
// Signature matches DetectorFn even though this detector doesn't need now/config.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function detectUnclaimedPriorityContainers(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const candidates = await prisma.container.findMany({
    where: { priority: { in: ["URGENT", "HIGH"] }, status: "IN_YARD", retrievalEligible: true },
    take: 200,
  });
  if (candidates.length === 0) return [];

  const tasked = await prisma.task.findMany({
    where: { containerId: { in: candidates.map((c) => c.id) } },
    select: { containerId: true },
  });
  const taskedIds = new Set(tasked.map((t) => t.containerId));

  return candidates
    .filter((c) => !taskedIds.has(c.id))
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "URGENT" ? -1 : 1))
    .slice(0, MAX_SUGGESTIONS_PER_CYCLE)
    .map((c) => ({
      type: "UNCLAIMED_PRIORITY_CONTAINER" as const,
      severity: c.priority,
      subject: { containerId: c.id, priority: c.priority, block: c.block },
      suggestedActionType: "INITIATE_RETRIEVAL" as const,
      suggestedActionPayload: { containerId: c.id, priority: c.priority },
      dedupeKey: `unclaimed-priority:${c.id}`,
    }));
}
