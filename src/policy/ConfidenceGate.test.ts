import { describe, expect, it } from "vitest";
import { ConfidenceGate, isReadyPlan, type ReadyPlanResult } from "@/policy/ConfidenceGate";
import { RetrievalPlanningPipeline } from "@/pipeline/RetrievalPlanningPipeline";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";
import type { RetrievalPlanResult } from "@/pipeline/RetrievalPlanningPipeline";

function fixture(overrides: {
  searchConfidence?: number;
  equipmentScore?: number;
  edgeCongestionWeights?: number[];
}): ReadyPlanResult {
  const container = {
    id: "MSKU1234567",
    block: "A",
    row: 1,
    bay: 2,
    tier: 3,
    status: "IN_YARD" as const,
    priority: "MEDIUM" as const,
    type: "DRY" as const,
    weightKg: 10000,
    destination: "Rotterdam",
    retrievalEligible: true,
    lastSyncedAt: new Date(),
  };
  const searchConfidence = overrides.searchConfidence ?? 1;
  const edgeWeights = overrides.edgeCongestionWeights ?? [1];

  return {
    status: "READY",
    request: { containerQuery: container.id, requestedBy: "test", priority: "MEDIUM" },
    containerMatches: [{ container, confidence: searchConfidence, matchType: "exact" }],
    container,
    equipmentCandidates: [],
    selectedEquipment: {
      equipment: {
        id: "TRUCK-001",
        type: "YARD_TRUCK",
        status: "AVAILABLE",
        capacityKg: 20000,
        currentNodeId: "GATE",
        lastSyncedAt: new Date(),
      },
      score: overrides.equipmentScore ?? 1,
      factors: {
        distanceMeters: 100,
        distanceScore: 1,
        capacityFitScore: 1,
        workloadScore: 1,
        activeTaskCount: 0,
        weights: { distance: 0.4, workload: 0.3, capacityFit: 0.3 },
      },
    },
    route: {
      path: ["GATE", "SPINE-0", "BLOCK-A-ENTRY"],
      edges: edgeWeights.map((congestionWeight, i) => ({
        fromNodeId: `N${i}`,
        toNodeId: `N${i + 1}`,
        distanceMeters: 50,
        congestionWeight,
      })),
      distanceMeters: 100,
      estimatedSeconds: 25,
    },
    twin: { valid: true, issues: [], recommendedAction: "PROCEED" },
  };
}

describe("isReadyPlan", () => {
  it("accepts a fully-populated READY result and rejects others", () => {
    expect(isReadyPlan(fixture({}))).toBe(true);
    const notFound: RetrievalPlanResult = {
      status: "NOT_FOUND",
      request: { containerQuery: "x", requestedBy: "test", priority: "MEDIUM" },
      containerMatches: [],
    };
    expect(isReadyPlan(notFound)).toBe(false);
  });
});

describe("ConfidenceGate.assess", () => {
  it("scores a clean, uncongested, well-fit plan as HIGH", () => {
    const gate = new ConfidenceGate();
    const result = gate.assess(fixture({ searchConfidence: 1, equipmentScore: 1, edgeCongestionWeights: [1] }));
    expect(result.level).toBe("HIGH");
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.factors.reduce((sum, f) => sum + f.contribution, 0)).toBeCloseTo(result.score, 10);
  });

  it("scores a moderately-fit, moderately-congested plan as MEDIUM", () => {
    const gate = new ConfidenceGate();
    const result = gate.assess(
      fixture({ searchConfidence: 0.7, equipmentScore: 0.6, edgeCongestionWeights: [2] }),
    );
    expect(result.level).toBe("MEDIUM");
  });

  it("scores a poorly-fit, heavily-congested fuzzy match as LOW", () => {
    const gate = new ConfidenceGate();
    const result = gate.assess(
      fixture({ searchConfidence: 0.3, equipmentScore: 0.3, edgeCongestionWeights: [3, 3] }),
    );
    expect(result.level).toBe("LOW");
    const congestionFactor = result.factors.find((f) => f.name === "routeCongestionCertainty")!;
    expect(congestionFactor.value).toBeCloseTo(0, 5);
  });

  it("treats a trivial (no-edge) route as maximally certain", () => {
    const gate = new ConfidenceGate();
    const result = gate.assess(fixture({ edgeCongestionWeights: [] }));
    const congestionFactor = result.factors.find((f) => f.name === "routeCongestionCertainty")!;
    expect(congestionFactor.value).toBe(1);
  });

  it("assesses a real pipeline READY plan against the seeded data with valid, self-consistent output", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const pipeline = new RetrievalPlanningPipeline(new MockTOSAdapter());
    const planResult = await pipeline.plan({
      containerQuery: container!.id,
      requestedBy: "test-user",
      priority: "MEDIUM",
    });
    expect(isReadyPlan(planResult)).toBe(true);

    const gate = new ConfidenceGate();
    const assessment = gate.assess(planResult as ReadyPlanResult);

    expect(["HIGH", "MEDIUM", "LOW"]).toContain(assessment.level);
    expect(assessment.score).toBeGreaterThanOrEqual(0);
    expect(assessment.score).toBeLessThanOrEqual(1);
    expect(assessment.factors).toHaveLength(3);
  });
});
