import type { Priority } from "@/domain/types";
import type { CandidateAlert, RankedAlert } from "@/agent-monitor/types";

const SEVERITY_WEIGHT: Record<Priority, number> = { URGENT: 1, HIGH: 0.75, MEDIUM: 0.5, LOW: 0.25 };

/**
 * Deterministic stand-in for AlertRanker when Gemini is unavailable —
 * same rationale as src/agents/fallback.ts: the agent must keep producing
 * usable, explained alerts with zero LLM availability.
 */
export function fallbackRank(candidates: CandidateAlert[]): RankedAlert[] {
  return candidates.map((candidate) => ({
    candidate,
    rankScore: SEVERITY_WEIGHT[candidate.severity],
    explanation: templateFor(candidate),
  }));
}

function templateFor(candidate: CandidateAlert): string {
  switch (candidate.type) {
    case "BLOCKED_LANE_IMPACT": {
      const alt = candidate.subject.alternateRoute as { estimatedSeconds: number } | null;
      const delay = candidate.subject.delaySeconds as number | null;
      if (alt && delay !== null) {
        return `Lane ${candidate.subject.laneId} is blocked and sits on the route of an active task. An alternate route exists (~${Math.round(alt.estimatedSeconds)}s, ${delay}s slower) — unblocking would still be faster than the detour.`;
      }
      if (!alt) {
        return `Lane ${candidate.subject.laneId} is blocked and sits on the route of an active task, with no alternate route available — this task cannot proceed until it's unblocked.`;
      }
      return `Lane ${candidate.subject.laneId} is blocked and sits on the route of an active task — unblocking it would let that task proceed.`;
    }
    case "AGING_TASK":
      return `Task ${candidate.taskId} has been waiting for supervisor action since ${candidate.subject.statusSince}.`;
    case "IDLE_EQUIPMENT_BACKLOG":
      return `Task ${candidate.taskId} previously had no equipment available; equipment ${candidate.subject.equipmentId} is now free and matches.`;
    case "CONGESTION_HOTSPOT":
      return `Lane ${candidate.subject.laneId} has stayed heavily congested (${candidate.subject.congestionWeight}x) across several checks.`;
    case "EQUIPMENT_TASK_MISMATCH":
      return `Equipment ${candidate.subject.equipmentId} is marked busy but no active task currently claims it.`;
    case "URGENT_CONTAINER_UNACTIONED":
      return `Task ${candidate.taskId} is URGENT priority but has not progressed past REQUESTED.`;
    case "UNCLAIMED_PRIORITY_CONTAINER":
      return `Container ${candidate.subject.containerId} (${candidate.subject.priority} priority, block ${candidate.subject.block}) is eligible for retrieval but nobody has requested it yet.`;
    default:
      return "A yard condition needs attention.";
  }
}
