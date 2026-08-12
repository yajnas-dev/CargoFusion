import { afterEach, describe, expect, it } from "vitest";
import { RetrievalRequestService } from "@/pipeline/RetrievalRequestService";
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

describe("RetrievalRequestService", () => {
  const createdTaskIds: string[] = [];
  const mutatedContainerIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.recommendation.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    for (const id of mutatedContainerIds) {
      await prisma.container.update({ where: { id }, data: { status: "IN_YARD", retrievalEligible: true } });
    }
    mutatedContainerIds.length = 0;
  });

  it("short-circuits to a clarifying question without touching the pipeline when ambiguous", async () => {
    const fake = new FakeModel({
      containerQuery: "",
      priority: "MEDIUM",
      requiredEquipmentType: "UNSPECIFIED",
      isAmbiguous: true,
      clarifyingQuestion: "Which container do you mean?",
    });
    const service = new RetrievalRequestService(new MockTOSAdapter(), fake);

    const response = await service.submit("do the thing", "test-operator");

    expect(response.planResult).toBeUndefined();
    expect(response.task).toBeUndefined();
    expect(response.explanation).toBe("Which container do you mean?");
    expect(fake.textCalls).toHaveLength(0); // explainer never invoked
  });

  it("runs the real pipeline, persists a Task+Recommendation, and explains the result", async () => {
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
    const service = new RetrievalRequestService(new MockTOSAdapter(), fake);

    const response = await service.submit(`Retrieve ${container!.id} urgently`, "test-operator");

    expect(response.planResult?.status).toBe("READY");
    expect(response.planResult?.container?.id).toBe(container!.id);
    expect(response.explanation).toBe("Recommend dispatching the nearest available truck.");
    expect(fake.textCalls).toHaveLength(1);
    expect(fake.textCalls[0]).toContain(container!.id);

    // This is exactly what the old RetrievalAgent never did — persist a
    // real Task/Recommendation, which is why it was superseded rather
    // than reconciled as-is.
    expect(response.task).toBeDefined();
    expect(response.task!.requestedBy).toBe("test-operator");
    expect(response.task!.status).toBe("PLANNED");
    createdTaskIds.push(response.task!.id);
    mutatedContainerIds.push(container!.id);

    const persistedTask = await prisma.task.findUniqueOrThrow({ where: { id: response.task!.id } });
    expect(persistedTask.containerId).toBe(container!.id);

    expect(response.recommendation).toBeDefined();
    const persistedRecommendation = await prisma.recommendation.findUniqueOrThrow({
      where: { id: response.recommendation!.id },
    });
    expect(persistedRecommendation.explanation).toBe("Recommend dispatching the nearest available truck.");

    const auditEvents = await prisma.auditEvent.findMany({ where: { taskId: response.task!.id } });
    expect(auditEvents.map((e) => e.action).sort()).toEqual(["RECOMMENDATION_GENERATED", "REQUEST_SUBMITTED"]);
  });

  it("falls back to deterministic interpret/explain when no model is available", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    expect(container).not.toBeNull();

    const service = new RetrievalRequestService(new MockTOSAdapter(), null);
    const response = await service.submit(`Retrieve container ${container!.id}`, "test-operator");

    expect(response.planResult?.status).toBe("READY");
    expect(response.explanation).toContain(container!.id);
    if (response.task) {
      createdTaskIds.push(response.task.id);
      mutatedContainerIds.push(container!.id);
    }
  });
});

describe.runIf(!!process.env.GEMINI_API_KEY)("RetrievalRequestService (live Gemini integration)", () => {
  const createdTaskIds: string[] = [];
  const mutatedContainerIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.recommendation.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    for (const id of mutatedContainerIds) {
      await prisma.container.update({ where: { id }, data: { status: "IN_YARD", retrievalEligible: true } });
    }
    mutatedContainerIds.length = 0;
  });

  it("interprets a natural-language request and explains a real plan end-to-end", async (ctx) => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    expect(container).not.toBeNull();

    const service = new RetrievalRequestService(new MockTOSAdapter(), new GeminiClient());
    let response;
    try {
      response = await service.submit(`Please retrieve container ${container!.id} as soon as possible.`, "test-operator");
    } catch (err) {
      // Free-tier Gemini quota is small and shared across however many
      // times this suite runs in a day — don't fail the build over
      // exhausted quota, just skip visibly.
      if (err instanceof Error && /RESOURCE_EXHAUSTED|429/.test(err.message)) {
        ctx.skip();
        return;
      }
      throw err;
    }

    expect(response.interpreted.containerQuery.toUpperCase()).toContain(container!.id);
    expect(response.planResult?.status).toBe("READY");
    expect(response.explanation.length).toBeGreaterThan(0);
    if (response.task) {
      createdTaskIds.push(response.task.id);
      mutatedContainerIds.push(container!.id);
    }
  }, 60_000); // two live Gemini calls (interpret + explain); latency observed up to ~27s standalone
});
