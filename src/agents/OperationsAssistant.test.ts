import { describe, expect, it } from "vitest";
import { OperationsAssistant } from "@/agents/OperationsAssistant";
import type { GenerativeModelClient } from "@/agents/GeminiClient";
import type { OpsSnapshot } from "@/agents/opsSnapshot";

class FakeModel implements GenerativeModelClient {
  lastPrompt?: string;
  constructor(private readonly text: string) {}
  async generateJSON<T>(): Promise<T> {
    throw new Error("not used in this test");
  }
  async generateText(prompt: string): Promise<string> {
    this.lastPrompt = prompt;
    return this.text;
  }
}

const SNAPSHOT: OpsSnapshot = {
  activeTaskCount: 4,
  pendingApprovalCount: 2,
  blockedLaneCount: 1,
  avgCongestionWeight: 1.8,
  equipmentAvailable: 40,
  equipmentTotal: 110,
  workersAvailable: 10,
  workersTotal: 40,
  openIncidentCount: 1,
  openAlertsBySeverity: { URGENT: 1, HIGH: 2, MEDIUM: 0, LOW: 0 },
  topOpenAlerts: [
    { type: "BLOCKED_LANE_IMPACT", severity: "URGENT", explanation: "Lane X is blocked on an active route.", ageMinutes: 5 },
  ],
};

describe("OperationsAssistant", () => {
  it("returns the model's text and grounds the prompt in the question and snapshot data, not invented facts", async () => {
    const fake = new FakeModel("One lane is blocked and affecting an urgent task — unblocking it should be the priority.");
    const assistant = new OperationsAssistant(fake);

    const answer = await assistant.answer("What should we prioritize right now?", SNAPSHOT);

    expect(answer).toBe("One lane is blocked and affecting an urgent task — unblocking it should be the priority.");
    expect(fake.lastPrompt).toContain("What should we prioritize right now?");
    expect(fake.lastPrompt).toContain("\"blockedLaneCount\": 1");
    expect(fake.lastPrompt).toContain("BLOCKED_LANE_IMPACT");
    expect(fake.lastPrompt).toContain("do not invent numbers, alerts, tasks, or equipment not listed here");
  });
});
