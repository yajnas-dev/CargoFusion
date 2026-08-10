import type { GenerativeModelClient } from "@/agents/GeminiClient";
import { Type } from "@/agents/GeminiClient";
import type { EquipmentType, Priority } from "@/domain/types";

export interface InterpretedRequest {
  containerQuery: string;
  priority: Priority;
  requiredEquipmentType?: EquipmentType;
  isAmbiguous: boolean;
  clarifyingQuestion?: string;
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    containerQuery: {
      type: Type.STRING,
      description:
        "The container identifier or search text extracted from the request (e.g. 'MSKU1234567'). Empty string if none can be identified.",
    },
    priority: {
      type: Type.STRING,
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      description:
        "Inferred urgency. Phrases like 'as soon as possible'/'urgent'/'now' map to URGENT or HIGH. Default MEDIUM if unstated.",
    },
    requiredEquipmentType: {
      type: Type.STRING,
      enum: ["YARD_TRUCK", "CRANE", "UNSPECIFIED"],
      description: "Only set to YARD_TRUCK or CRANE if the request explicitly asks for one; otherwise UNSPECIFIED.",
    },
    isAmbiguous: {
      type: Type.BOOLEAN,
      description: "True if no container identifier or usable search text could be extracted from the request.",
    },
    clarifyingQuestion: {
      type: Type.STRING,
      description: "If isAmbiguous is true, a short question to ask the operator to clarify. Empty string otherwise.",
    },
  },
  required: ["containerQuery", "priority", "requiredEquipmentType", "isAmbiguous", "clarifyingQuestion"],
};

/**
 * Interprets a natural-language retrieval request into a structured goal
 * (report section 8: "Claude can interpret: container = ..., objective =
 * ..., priority = ..."). Only decides *what* to look up — never computes
 * routes, scores, or coordinates itself.
 */
export class RequestInterpreter {
  constructor(private readonly model: GenerativeModelClient) {}

  async interpret(naturalLanguageRequest: string): Promise<InterpretedRequest> {
    const prompt = `You are the request-interpretation step of a container terminal retrieval assistant. Extract structured fields from the operator's request below. Do not invent a container id if none is present or implied — set isAmbiguous instead.

Operator request: "${naturalLanguageRequest}"`;

    const raw = await this.model.generateJSON<{
      containerQuery: string;
      priority: Priority;
      requiredEquipmentType: EquipmentType | "UNSPECIFIED";
      isAmbiguous: boolean;
      clarifyingQuestion: string;
    }>(prompt, SCHEMA);

    return {
      containerQuery: raw.containerQuery,
      priority: raw.priority,
      requiredEquipmentType:
        raw.requiredEquipmentType === "UNSPECIFIED" ? undefined : raw.requiredEquipmentType,
      isAmbiguous: raw.isAmbiguous,
      clarifyingQuestion: raw.clarifyingQuestion || undefined,
    };
  }
}
