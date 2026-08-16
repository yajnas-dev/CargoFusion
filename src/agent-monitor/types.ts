import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import type { AgentAlertType, Priority, SuggestedActionType } from "@/domain/types";

export interface AgentMonitorConfig {
  agingTaskThresholdMs: number;
  congestionHotspotThreshold: number;
  congestionSustainedCycles: number;
  /** How far ahead of a task's dueBy the slaBreach detector starts flagging it as at-risk. */
  slaWarningThresholdMs: number;
}

export const DEFAULT_CONFIG: AgentMonitorConfig = {
  agingTaskThresholdMs: 5 * 60_000,
  congestionHotspotThreshold: 2.5,
  congestionSustainedCycles: 3,
  slaWarningThresholdMs: 10 * 60_000,
};

export interface DetectorContext {
  tos: TOSAdapter;
  now: Date;
  config: AgentMonitorConfig;
}

/**
 * A detector's raw finding, before ranking/explanation. `suggestedActionType`
 * is always one of the fixed SuggestedActionType enum members — detectors
 * never invent a free-form action, and AgentAlertService.apply() only ever
 * dispatches to the one deterministic service call each type maps to.
 */
export interface CandidateAlert {
  type: AgentAlertType;
  severity: Priority;
  taskId?: string;
  subject: Record<string, unknown>;
  suggestedActionType: SuggestedActionType;
  suggestedActionPayload: Record<string, unknown>;
  /** Stable per-condition key so re-detecting the same issue doesn't spam duplicate alerts. */
  dedupeKey: string;
}

export type DetectorFn = (ctx: DetectorContext) => Promise<CandidateAlert[]>;

export interface RankedAlert {
  candidate: CandidateAlert;
  rankScore: number;
  explanation: string;
}

/** Minimal yard context given to AlertRanker's prompt — enough to rank sensibly, not a full state dump. */
export interface YardSnapshotForPrompt {
  activeTaskCount: number;
  blockedLaneCount: number;
  avgCongestion: number;
}
