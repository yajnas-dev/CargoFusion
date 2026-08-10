import { describe, expect, it } from "vitest";
import { RequestInterpreter } from "@/agents/RequestInterpreter";
import type { GenerativeModelClient } from "@/agents/GeminiClient";

class FakeModel implements GenerativeModelClient {
  constructor(private readonly json: unknown) {}
  lastPrompt?: string;
  async generateJSON<T>(prompt: string): Promise<T> {
    this.lastPrompt = prompt;
    return this.json as T;
  }
  async generateText(): Promise<string> {
    throw new Error("not used in this test");
  }
}

describe("RequestInterpreter", () => {
  it("maps UNSPECIFIED equipment type and empty clarifying question to undefined", async () => {
    const fake = new FakeModel({
      containerQuery: "MSKU1234567",
      priority: "URGENT",
      requiredEquipmentType: "UNSPECIFIED",
      isAmbiguous: false,
      clarifyingQuestion: "",
    });
    const interpreter = new RequestInterpreter(fake);
    const result = await interpreter.interpret("Get MSKU1234567 out as quickly as possible");

    expect(result).toEqual({
      containerQuery: "MSKU1234567",
      priority: "URGENT",
      requiredEquipmentType: undefined,
      isAmbiguous: false,
      clarifyingQuestion: undefined,
    });
    expect(fake.lastPrompt).toContain("MSKU1234567");
  });

  it("passes through an explicit equipment type and an ambiguity flag", async () => {
    const fake = new FakeModel({
      containerQuery: "",
      priority: "MEDIUM",
      requiredEquipmentType: "CRANE",
      isAmbiguous: true,
      clarifyingQuestion: "Which container would you like retrieved?",
    });
    const interpreter = new RequestInterpreter(fake);
    const result = await interpreter.interpret("Send a crane over");

    expect(result.requiredEquipmentType).toBe("CRANE");
    expect(result.isAmbiguous).toBe(true);
    expect(result.clarifyingQuestion).toBe("Which container would you like retrieved?");
  });
});
