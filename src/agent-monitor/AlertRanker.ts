import { Type, type GenerativeModelClient } from "@/agents/GeminiClient";
import { fallbackRank } from "@/agent-monitor/AlertRankerFallback";
import type { CandidateAlert, RankedAlert, YardSnapshotForPrompt } from "@/agent-monitor/types";

const SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      index: {
        type: Type.NUMBER,
        description: "The 0-based index of the candidate in the list below that this entry ranks/explains.",
      },
      rankScore: {
        type: Type.NUMBER,
        description: "0-1 urgency/importance score for this candidate relative to the others in the list.",
      },
      explanation: {
        type: Type.STRING,
        description: "1-2 plain-language sentences a supervisor would read to decide whether to act on this.",
      },
    },
    required: ["index", "rankScore", "explanation"],
  },
};

/**
 * The Container Management Agent's one LLM call site, parallel to
 * PlanExplainer: ranks and explains an already-detected, fixed list of
 * candidate alerts. Never sees raw yard state, never proposes a new
 * issue or action — only the CandidateAlerts the deterministic detectors
 * already produced. AlertRankerFallback provides the same shape with
 * zero LLM availability, wired the same way retrieval-requests/route.ts
 * falls back on Gemini failure.
 */
export class AlertRanker {
  constructor(private readonly model: GenerativeModelClient) {}

  async rank(candidates: CandidateAlert[], yardSnapshot: YardSnapshotForPrompt): Promise<RankedAlert[]> {
    if (candidates.length === 0) return [];

    const prompt = buildPrompt(candidates, yardSnapshot);
    const raw = await this.model.generateJSON<{ index: number; rankScore: number; explanation: string }[]>(
      prompt,
      SCHEMA,
    );

    const ranked: RankedAlert[] = [];
    const coveredCandidates = new Set<CandidateAlert>();
    for (const entry of raw) {
      const candidate = candidates[entry.index];
      if (!candidate) continue; // defensive: an out-of-range index from a malformed response is dropped, not thrown
      ranked.push({ candidate, rankScore: clamp01(entry.rankScore), explanation: entry.explanation });
      coveredCandidates.add(candidate);
    }

    // The model's response can omit candidates outright — a large list, a
    // token limit, or just an incomplete enumeration — and that must never
    // mean a real detected issue silently never becomes an alert. Whatever
    // it left out is still raised, deterministically ranked/explained
    // instead of lost.
    const uncovered = candidates.filter((c) => !coveredCandidates.has(c));
    if (uncovered.length > 0) {
      ranked.push(...fallbackRank(uncovered));
    }

    return ranked;
  }
}

function buildPrompt(candidates: CandidateAlert[], yard: YardSnapshotForPrompt): string {
  const lines: string[] = [
    "You are the ranking step of a container terminal's autonomous yard-monitoring agent.",
    "Below is a fixed list of already-detected issues, each with an index. Rank and explain only these — do not invent new issues, do not suggest actions beyond what's already listed, do not invent numbers not given below.",
    "For each, return its index, a 0-1 rankScore reflecting how urgently a supervisor should look at it relative to the others, and a 1-2 sentence plain-language explanation.",
    "",
    `Yard context: ${yard.activeTaskCount} active tasks, ${yard.blockedLaneCount} blocked lanes, average congestion ${yard.avgCongestion.toFixed(2)}x.`,
    "",
    "Issues:",
  ];

  candidates.forEach((candidate, index) => {
    lines.push(
      `${index}. type=${candidate.type}, severity=${candidate.severity}, suggestedAction=${candidate.suggestedActionType}, details=${JSON.stringify(candidate.subject)}`,
    );
  });

  return lines.join("\n");
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
