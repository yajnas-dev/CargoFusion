import { describe, expect, it } from "vitest";
import { PlanExplainer } from "@/agents/PlanExplainer";
import type { GenerativeModelClient } from "@/agents/GeminiClient";
import type { RetrievalPlanResult } from "@/pipeline/RetrievalPlanningPipeline";

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

const NOT_FOUND_RESULT: RetrievalPlanResult = {
  status: "NOT_FOUND",
  request: { containerQuery: "ZZZZ0000000", requestedBy: "test", priority: "MEDIUM" },
  containerMatches: [],
};

describe("PlanExplainer", () => {
  it("returns the model's text and includes the plan status/query in the prompt", async () => {
    const fake = new FakeModel("No container matched that query.");
    const explainer = new PlanExplainer(fake);

    const explanation = await explainer.explain(NOT_FOUND_RESULT);

    expect(explanation).toBe("No container matched that query.");
    expect(fake.lastPrompt).toContain("NOT_FOUND");
    expect(fake.lastPrompt).toContain("ZZZZ0000000");
  });

  it("includes equipment, route, and twin details in the prompt when present", async () => {
    const readyResult: RetrievalPlanResult = {
      status: "READY",
      request: { containerQuery: "MSKU1234567", requestedBy: "test", priority: "HIGH" },
      containerMatches: [],
      container: {
        id: "MSKU1234567",
        block: "A",
        row: 1,
        bay: 2,
        tier: 3,
        status: "IN_YARD",
        priority: "HIGH",
        type: "DRY",
        weightKg: 10000,
        destination: "Rotterdam",
        retrievalEligible: true,
        lastSyncedAt: new Date(),
      },
      selectedEquipment: {
        equipment: {
          id: "TRUCK-001",
          type: "YARD_TRUCK",
          status: "AVAILABLE",
          capacityKg: 20000,
          currentNodeId: "GATE",
          lastSyncedAt: new Date(),
        },
        score: 0.83,
        factors: {
          distanceMeters: 120,
          distanceScore: 0.7,
          capacityFitScore: 0.5,
          workloadScore: 1,
          activeTaskCount: 0,
          weights: { distance: 0.4, workload: 0.3, capacityFit: 0.3 },
        },
      },
      route: { path: ["GATE", "SPINE-0", "BLOCK-A-ENTRY"], edges: [], distanceMeters: 120, estimatedSeconds: 30 },
      twin: { valid: true, issues: [], recommendedAction: "PROCEED" },
    };

    const fake = new FakeModel("Recommend TRUCK-001.");
    const explainer = new PlanExplainer(fake);
    await explainer.explain(readyResult);

    expect(fake.lastPrompt).toContain("TRUCK-001");
    expect(fake.lastPrompt).toContain("PROCEED");
    expect(fake.lastPrompt).toContain("GATE -> SPINE-0 -> BLOCK-A-ENTRY");
  });
});
