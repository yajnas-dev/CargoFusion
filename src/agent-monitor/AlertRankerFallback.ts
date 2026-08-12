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
    case "BLOCKED_LANE_IMPACT":
      return `Lane ${candidate.subject.laneId} is blocked and sits on the route of an active task — unblocking it would let that task proceed.`;
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
    default:
      return "A yard condition needs attention.";
  }
}
