import { eventBus } from "@/events/InProcessEventBus";
import { TOPICS } from "@/events/topics";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import { createModelOrNull, type GenerativeModelClient } from "@/agents/GeminiClient";
import { DETECTORS } from "@/agent-monitor/detectors";
import { AlertRanker } from "@/agent-monitor/AlertRanker";
import { fallbackRank } from "@/agent-monitor/AlertRankerFallback";
import { AgentAlertService } from "@/agent-monitor/AgentAlertService";
import { DEFAULT_CONFIG, type AgentMonitorConfig, type CandidateAlert, type YardSnapshotForPrompt } from "@/agent-monitor/types";
import { prisma } from "@/domain/db";
import { ACTIVE_TASK_STATUSES } from "@/domain/constants";
import type { AgentAlert } from "@/domain/types";

const DEFAULT_TICK_INTERVAL_MS = 15000;
const DEBOUNCE_MS = 2000;
const TRIGGER_TOPICS = [TOPICS.YARD_LANE_CHANGED, TOPICS.YARD_EQUIPMENT_CHANGED, TOPICS.TASK_CHANGED, TOPICS.SENSOR_EVENT];

/**
 * Autonomous monitor + advisor for yard/task state (src/agent-monitor/).
 * Runs deterministic detectors (src/agent-monitor/detectors/) each cycle,
 * ranks/explains the results with AlertRanker (Gemini) or fallbackRank
 * when no model is available, and persists them as AgentAlerts via
 * AgentAlertService — it never mutates yard/task state itself. Mirrors
 * SimulationEngine's singleton start/stop/isRunning shape and its
 * deliberate opt-in principle: never auto-starts.
 */
export class ContainerManagementAgent {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private eventUnsubs: Array<() => void> = [];
  private config: AgentMonitorConfig = { ...DEFAULT_CONFIG };

  constructor(
    private readonly tos: TOSAdapter = new MockTOSAdapter(),
    private readonly alerts: AgentAlertService = new AgentAlertService(),
    private readonly model: GenerativeModelClient | null = createModelOrNull(),
  ) {}

  start(intervalMs: number = DEFAULT_TICK_INTERVAL_MS): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.runCycle().catch((err) => console.error("Container Management Agent cycle failed:", err));
    }, intervalMs);
    this.eventUnsubs = TRIGGER_TOPICS.map((topic) => eventBus.subscribe(topic, () => this.scheduleDebouncedCycle()));
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const unsubscribe of this.eventUnsubs) unsubscribe();
    this.eventUnsubs = [];
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  getConfig(): AgentMonitorConfig {
    return { ...this.config };
  }

  setConfig(partial: Partial<AgentMonitorConfig>): AgentMonitorConfig {
    this.config = { ...this.config, ...partial };
    return this.getConfig();
  }

  private scheduleDebouncedCycle(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.runCycle().catch((err) => console.error("Container Management Agent cycle failed:", err));
    }, DEBOUNCE_MS);
  }

  /** Runs every detector, ranks/explains the findings, and persists+publishes new alerts. */
  async runCycle(): Promise<AgentAlert[]> {
    const ctx = { tos: this.tos, now: new Date(), config: this.config };
    const results = await Promise.all(DETECTORS.map((detector) => detector(ctx)));
    const candidates: CandidateAlert[] = results.flat();
    if (candidates.length === 0) return [];

    const snapshot = await this.buildYardSnapshot();
    const ranked = this.model
      ? await new AlertRanker(this.model).rank(candidates, snapshot).catch(() => fallbackRank(candidates))
      : fallbackRank(candidates);

    return this.alerts.raiseBatch(ranked);
  }

  private async buildYardSnapshot(): Promise<YardSnapshotForPrompt> {
    const [yardState, activeTaskCount] = await Promise.all([
      this.tos.getYardState(),
      prisma.task.count({ where: { status: { in: [...ACTIVE_TASK_STATUSES] } } }),
    ]);
    const blockedLaneCount = yardState.lanes.filter((l) => l.blocked).length;
    const avgCongestion =
      yardState.lanes.length > 0
        ? yardState.lanes.reduce((sum, l) => sum + l.congestionWeight, 0) / yardState.lanes.length
        : 1;

    return { activeTaskCount, blockedLaneCount, avgCongestion };
  }
}

// Module-level singleton — same rationale as simulationEngine
// (src/simulation/SimulationEngine.ts): the Next.js dev/prod server is one
// long-lived Node process, so start/stop state needs to survive across
// API route invocations.
export const containerManagementAgent = new ContainerManagementAgent();
