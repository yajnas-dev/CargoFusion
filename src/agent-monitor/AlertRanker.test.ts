import { describe, expect, it } from "vitest";
import { AlertRanker } from "@/agent-monitor/AlertRanker";
import type { GenerativeModelClient } from "@/agents/GeminiClient";
import type { CandidateAlert } from "@/agent-monitor/types";

class FakeModel implements GenerativeModelClient {
  jsonCalls: string[] = [];
  constructor(private readonly json: unknown) {}
  async generateJSON<T>(prompt: string): Promise<T> {
    this.jsonCalls.push(prompt);
    return this.json as T;
  }
  async generateText(): Promise<string> {
    throw new Error("not used by AlertRanker");
  }
}

function candidate(overrides: Partial<CandidateAlert>): CandidateAlert {
  return {
    type: "AGING_TASK",
    severity: "MEDIUM",
    subject: { taskId: "task-1" },
    suggestedActionType: "ESCALATE_TO_SUPERVISOR",
    suggestedActionPayload: {},
    dedupeKey: "task-1",
    ...overrides,
  };
}

const SNAPSHOT = { activeTaskCount: 3, blockedLaneCount: 1, avgCongestion: 1.4 };

describe("AlertRanker", () => {
  it("returns [] without calling the model when there are no candidates", async () => {
    const fake = new FakeModel([]);
    const ranked = await new AlertRanker(fake).rank([], SNAPSHOT);
    expect(ranked).toEqual([]);
    expect(fake.jsonCalls).toHaveLength(0);
  });

  it("maps the model's response back to the right candidates by index", async () => {
    const candidates = [
      candidate({ dedupeKey: "a", type: "BLOCKED_LANE_IMPACT" }),
      candidate({ dedupeKey: "b", type: "AGING_TASK" }),
    ];
    const fake = new FakeModel([
      { index: 1, rankScore: 0.4, explanation: "Task b is aging." },
      { index: 0, rankScore: 0.9, explanation: "Lane a is blocking task a." },
    ]);

    const ranked = await new AlertRanker(fake).rank(candidates, SNAPSHOT);

    expect(ranked).toHaveLength(2);
    const forA = ranked.find((r) => r.candidate.dedupeKey === "a");
    const forB = ranked.find((r) => r.candidate.dedupeKey === "b");
    expect(forA?.rankScore).toBe(0.9);
    expect(forA?.explanation).toBe("Lane a is blocking task a.");
    expect(forB?.rankScore).toBe(0.4);
  });

  it("drops entries with an out-of-range index instead of throwing", async () => {
    const candidates = [candidate({ dedupeKey: "only-one" })];
    const fake = new FakeModel([
      { index: 0, rankScore: 0.5, explanation: "valid" },
      { index: 5, rankScore: 0.5, explanation: "out of range, should be dropped" },
    ]);

    const ranked = await new AlertRanker(fake).rank(candidates, SNAPSHOT);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.dedupeKey).toBe("only-one");
  });

  it("clamps an out-of-bounds rankScore into [0,1]", async () => {
    const candidates = [candidate({ dedupeKey: "clamp-test" })];
    const fake = new FakeModel([{ index: 0, rankScore: 5, explanation: "too high" }]);

    const ranked = await new AlertRanker(fake).rank(candidates, SNAPSHOT);
    expect(ranked[0].rankScore).toBe(1);
  });

  it("includes each candidate's type/severity and the yard snapshot in the prompt, plus a do-not-invent instruction", async () => {
    const candidates = [candidate({ type: "CONGESTION_HOTSPOT", severity: "HIGH", dedupeKey: "c" })];
    const fake = new FakeModel([{ index: 0, rankScore: 0.5, explanation: "x" }]);

    await new AlertRanker(fake).rank(candidates, SNAPSHOT);

    expect(fake.jsonCalls).toHaveLength(1);
    const prompt = fake.jsonCalls[0];
    expect(prompt).toContain("CONGESTION_HOTSPOT");
    expect(prompt).toContain("HIGH");
    expect(prompt).toContain("do not invent");
    expect(prompt).toContain(String(SNAPSHOT.activeTaskCount));
  });
});
