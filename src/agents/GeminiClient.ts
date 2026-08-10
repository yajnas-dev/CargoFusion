import { GoogleGenAI, Type, type Schema } from "@google/genai";

// "gemini-2.5-flash" was retired for new API keys; "gemini-flash-latest"
// is the currently-available fast/cheap model suited to a demo's
// interpretation + explanation calls (see the "LLM provider" deviation
// noted in docs/PROTOTYPE_IMPLEMENTATION_PLAN.md Phase 10).
const MODEL_NAME = "gemini-flash-latest";

/**
 * Minimal provider-agnostic surface the agent layer depends on, so a
 * future swap (back to Claude, or another model) only touches this file's
 * implementation, not RequestInterpreter/PlanExplainer.
 */
export interface GenerativeModelClient {
  generateJSON<T>(prompt: string, schema: Schema): Promise<T>;
  generateText(prompt: string): Promise<string>;
}

export { Type }; // re-exported so callers building schemas don't need a direct @google/genai dependency

export class GeminiClient implements GenerativeModelClient {
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string = requireApiKey()) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateJSON<T>(prompt: string, schema: Schema): Promise<T> {
    const response = await this.ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema: schema },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned no text for a structured JSON request.");
    return JSON.parse(text) as T;
  }

  async generateText(prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned no text.");
    return text;
  }
}

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env (see .env.example) to use the agent layer.",
    );
  }
  return key;
}
