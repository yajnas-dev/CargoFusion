import { describe, expect, it } from "vitest";
import { fallbackExplain, fallbackInterpret } from "@/agents/fallback";
import type { RetrievalPlanResult } from "@/pipeline/RetrievalPlanningPipeline";

describe("fallbackInterpret", () => {
  it("extracts a container-id-shaped token embedded in a full sentence", () => {
    const result = fallbackInterpret("Retrieve OOLU0187810 as quickly as possible");
    expect(result.containerQuery).toBe("OOLU0187810");
    expect(result.priority).toBe("URGENT");
  });

  it("falls back to the whole trimmed string when no id-shaped token is found", () => {
    const result = fallbackInterpret("  some vague request  ");
    expect(result.containerQuery).toBe("some vague request");
    expect(result.isAmbiguous).toBe(false);
  });

  it("flags HIGH priority for softer urgency language", () => {
    expect(fallbackInterpret("Get MSKU1234567 out quickly").priority).toBe("HIGH");
  });

  it("defaults to MEDIUM priority with no urgency language", () => {
    expect(fallbackInterpret("Retrieve MSKU1234567").priority).toBe("MEDIUM");
  });

  it("flags ambiguous for an empty request", () => {
    expect(fallbackInterpret("   ").isAmbiguous).toBe(true);
  });
});

describe("fallbackExplain", () => {
  const base = { request: { containerQuery: "MSKU1234567", requestedBy: "test", priority: "MEDIUM" as const } };

  it("summarizes a NOT_FOUND result", () => {
    const result: RetrievalPlanResult = { ...base, status: "NOT_FOUND", containerMatches: [] };
    expect(fallbackExplain(result)).toContain("No container matched");
  });

  it("summarizes an AMBIGUOUS result with the candidate count", () => {
    const result: RetrievalPlanResult = {
      ...base,
      status: "AMBIGUOUS",
      containerMatches: [
        { container: { id: "MSKU1234567" } as never, confidence: 0.7, matchType: "substring" },
        { container: { id: "MSKU1234568" } as never, confidence: 0.6, matchType: "substring" },
      ],
    };
    expect(fallbackExplain(result)).toContain("2 candidates");
  });
});
