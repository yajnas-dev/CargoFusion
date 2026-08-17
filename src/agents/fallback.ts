import type { InterpretedRequest } from "@/agents/RequestInterpreter";
import type { RetrievalPlanResult } from "@/pipeline/RetrievalPlanningPipeline";
import type { OpsSnapshot } from "@/agents/opsSnapshot";
import { formatDuration } from "@/domain/format";

/**
 * Deterministic stand-ins used when Gemini is unavailable (no API key,
 * network error, or rate limit — all observed during this project's real
 * usage) so the API layer degrades gracefully instead of failing the
 * request outright. Not a substitute for the LLM's disambiguation
 * quality — just enough to keep the demo/pipeline usable.
 */
// ISO 6346-shaped container id (4 letters + 6-7 digits), e.g. MSKU1234567.
const CONTAINER_ID_PATTERN = /[A-Za-z]{4}\d{6,7}/;
const URGENT_KEYWORDS = /\b(urgent|asap|as soon as possible|as quickly as possible|immediately|right away)\b/i;
const HIGH_KEYWORDS = /\b(priority|soon|quickly|fast)\b/i;

export function fallbackInterpret(rawRequest: string): InterpretedRequest {
  const idMatch = rawRequest.match(CONTAINER_ID_PATTERN);
  const containerQuery = idMatch ? idMatch[0] : rawRequest.trim();

  const priority = URGENT_KEYWORDS.test(rawRequest)
    ? "URGENT"
    : HIGH_KEYWORDS.test(rawRequest)
      ? "HIGH"
      : "MEDIUM";

  return { containerQuery, priority, isAmbiguous: !containerQuery };
}

export function fallbackExplain(result: RetrievalPlanResult): string {
  switch (result.status) {
    case "READY": {
      const crane = result.craneCandidates?.[0];
      const craneNote = crane ? ` Crane ${crane.equipment.id} will service the block.` : "";
      return `Recommended: dispatch ${result.selectedEquipment!.equipment.id} to retrieve ${result.container!.id} from block ${result.container!.block}. Route distance ${result.route!.distanceMeters.toFixed(0)}m, ETA ${formatDuration(result.route!.estimatedSeconds)}.${craneNote}`;
    }
    case "AMBIGUOUS":
      return `Multiple containers matched "${result.request.containerQuery}" (${result.containerMatches.length} candidates) — please provide a more specific container ID.`;
    case "NOT_FOUND":
      return `No container matched "${result.request.containerQuery}".`;
    case "NO_EQUIPMENT":
      return `No eligible equipment is currently available for container ${result.container?.id ?? result.request.containerQuery}.`;
    case "NO_ROUTE":
      return `No route could be found to container ${result.container?.id ?? result.request.containerQuery}.`;
    case "NEEDS_ESCALATION":
      return `Plan for ${result.container?.id ?? result.request.containerQuery} needs supervisor attention: ${result.twin?.issues.map((i) => i.message).join("; ") ?? "unresolved conflict"}.`;
    default:
      return "Unable to generate a recommendation.";
  }
}

/**
 * Deterministic stand-in for OperationsAssistant.answer() — can't parse an
 * arbitrary question without an LLM, so this ignores the question and
 * reports the same snapshot data as a plain summary instead of pretending
 * to answer it. Still grounded in real numbers, just not tailored to what
 * was actually asked.
 */
export function fallbackOpsSummary(snapshot: OpsSnapshot): string {
  const top = snapshot.topOpenAlerts
    .slice(0, 3)
    .map((a) => `${a.type.replace(/_/g, " ").toLowerCase()} (${a.severity})`)
    .join(", ");
  return (
    `AI assistant is unavailable right now, so here's the current state instead: ` +
    `${snapshot.activeTaskCount} active task(s), ${snapshot.pendingApprovalCount} pending approval, ` +
    `${snapshot.blockedLaneCount} blocked lane(s), ${snapshot.openIncidentCount} open incident(s), ` +
    `${snapshot.equipmentAvailable}/${snapshot.equipmentTotal} equipment available, ` +
    `${snapshot.workersAvailable}/${snapshot.workersTotal} workers available.` +
    (top ? ` Top open alerts: ${top}.` : " No open alerts.")
  );
}
