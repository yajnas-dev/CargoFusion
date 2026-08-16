import { describe, expect, it } from "vitest";
import { fallbackRank } from "@/agent-monitor/AlertRankerFallback";
import type { CandidateAlert } from "@/agent-monitor/types";

function candidate(overrides: Partial<CandidateAlert>): CandidateAlert {
  return {
    type: "AGING_TASK",
    severity: "MEDIUM",
    subject: {},
    suggestedActionType: "ESCALATE_TO_SUPERVISOR",
    suggestedActionPayload: {},
    dedupeKey: "test-key",
    ...overrides,
  };
}

describe("fallbackRank", () => {
  it("produces a non-empty explanation and a rankScore in [0,1] for every AgentAlertType", () => {
    const types: CandidateAlert["type"][] = [
      "BLOCKED_LANE_IMPACT",
      "AGING_TASK",
      "IDLE_EQUIPMENT_BACKLOG",
      "CONGESTION_HOTSPOT",
      "EQUIPMENT_TASK_MISMATCH",
      "URGENT_CONTAINER_UNACTIONED",
      "UNCLAIMED_PRIORITY_CONTAINER",
    ];
    const candidates = types.map((type) =>
      candidate({
        type,
        subject: {
          laneId: "L1",
          taskId: "T1",
          equipmentId: "E1",
          statusSince: "now",
          congestionWeight: 3,
          containerId: "C1",
          priority: "HIGH",
          block: "A1",
        },
      }),
    );

    const ranked = fallbackRank(candidates);

    expect(ranked).toHaveLength(types.length);
    for (const r of ranked) {
      expect(r.explanation.length).toBeGreaterThan(0);
      expect(r.rankScore).toBeGreaterThan(0);
      expect(r.rankScore).toBeLessThanOrEqual(1);
    }
  });

  it("orders severity-weighted scores URGENT > HIGH > MEDIUM > LOW", () => {
    const ranked = fallbackRank([
      candidate({ severity: "LOW", dedupeKey: "low" }),
      candidate({ severity: "URGENT", dedupeKey: "urgent" }),
      candidate({ severity: "MEDIUM", dedupeKey: "medium" }),
      candidate({ severity: "HIGH", dedupeKey: "high" }),
    ]);

    const byKey = Object.fromEntries(ranked.map((r) => [r.candidate.dedupeKey, r.rankScore]));
    expect(byKey.urgent).toBeGreaterThan(byKey.high);
    expect(byKey.high).toBeGreaterThan(byKey.medium);
    expect(byKey.medium).toBeGreaterThan(byKey.low);
  });

  it("preserves the candidate reference on each ranked entry", () => {
    const c = candidate({ dedupeKey: "preserve-me" });
    const [ranked] = fallbackRank([c]);
    expect(ranked.candidate).toBe(c);
  });
});
