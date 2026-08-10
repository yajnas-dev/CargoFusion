import { describe, expect, it } from "vitest";
import { RetrievalAgent } from "@/agents/RetrievalAgent";
import { GeminiClient } from "@/agents/GeminiClient";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";
import type { GenerativeModelClient } from "@/agents/GeminiClient";

class FakeModel implements GenerativeModelClient {
  jsonCalls: string[] = [];
  textCalls: string[] = [];
  constructor(
    private readonly json: unknown,
    private readonly text = "explanation",
  ) {}
  async generateJSON<T>(prompt: string): Promise<T> {
    this.jsonCalls.push(prompt);
    return this.json as T;
  }
  async generateText(prompt: string): Promise<string> {
    this.textCalls.push(prompt);
    return this.text;
  }
}

describe("RetrievalAgent (fake model, deterministic orchestration)", () => {
  it("short-circuits to a clarifying question without calling the pipeline when ambiguous", async () => {
    const fake = new FakeModel({
      containerQuery: "",
      priority: "MEDIUM",
      requiredEquipmentType: "UNSPECIFIED",
      isAmbiguous: true,
      clarifyingQuestion: "Which container do you mean?",
    });
    const agent = new RetrievalAgent(new MockTOSAdapter(), fake);

    const response = await agent.handleRequest("do the thing");

    expect(response.planResult).toBeUndefined();
    expect(response.explanation).toBe("Which container do you mean?");
    expect(fake.textCalls).toHaveLength(0); // explainer never invoked
  });

  it("runs the real pipeline against a resolved container and explains the result", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    expect(container).not.toBeNull();

    const fake = new FakeModel(
      {
        containerQuery: container!.id,
        priority: "HIGH",
        requiredEquipmentType: "UNSPECIFIED",
        isAmbiguous: false,
        clarifyingQuestion: "",
      },
      "Recommend dispatching the nearest available truck.",
    );
    const agent = new RetrievalAgent(new MockTOSAdapter(), fake);

    const response = await agent.handleRequest(`Retrieve ${container!.id} urgently`);

    expect(response.planResult?.status).toBe("READY");
    expect(response.planResult?.container?.id).toBe(container!.id);
    expect(response.explanation).toBe("Recommend dispatching the nearest available truck.");
    expect(fake.textCalls).toHaveLength(1);
    expect(fake.textCalls[0]).toContain(container!.id);
  });
});

describe.runIf(!!process.env.GEMINI_API_KEY)(
  "RetrievalAgent (live Gemini integration)",
  () => {
    it("interprets a natural-language request and explains a real plan end-to-end", async () => {
      const container = await prisma.container.findFirst({
        where: { retrievalEligible: true, status: "IN_YARD" },
      });
      expect(container).not.toBeNull();

      const agent = new RetrievalAgent(new MockTOSAdapter(), new GeminiClient());
      const response = await agent.handleRequest(
        `Please retrieve container ${container!.id} as soon as possible.`,
      );

      expect(response.interpreted.containerQuery.toUpperCase()).toContain(container!.id);
      expect(response.planResult?.status).toBe("READY");
      expect(response.explanation.length).toBeGreaterThan(0);
    }, 60_000); // two live Gemini calls (interpret + explain); latency observed up to ~27s standalone
  },
);
