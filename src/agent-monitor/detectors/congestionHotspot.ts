import type { CandidateAlert, DetectorContext } from "@/agent-monitor/types";

// Module-level (not per-agent-instance) so it persists across ContainerManagementAgent
// singleton cycles the same way the singleton itself does — see resetCongestionHotspotState().
const consecutiveHotCycles = new Map<string, number>();

/**
 * A lane sustained at/above the congestion threshold for several
 * consecutive cycles — "sustained," not "momentarily hot," to avoid
 * flagging normal DemoControls.driftCongestion() noise every cycle.
 */
export async function detectCongestionHotspots(ctx: DetectorContext): Promise<CandidateAlert[]> {
  const yardState = await ctx.tos.getYardState();
  const candidates: CandidateAlert[] = [];
  const stillHot = new Set<string>();

  for (const lane of yardState.lanes) {
    if (lane.congestionWeight < ctx.config.congestionHotspotThreshold) continue;

    stillHot.add(lane.id);
    const cycles = (consecutiveHotCycles.get(lane.id) ?? 0) + 1;
    consecutiveHotCycles.set(lane.id, cycles);

    if (cycles >= ctx.config.congestionSustainedCycles) {
      candidates.push({
        type: "CONGESTION_HOTSPOT",
        severity: "MEDIUM",
        subject: { laneId: lane.id, congestionWeight: lane.congestionWeight, consecutiveCycles: cycles },
        suggestedActionType: "ESCALATE_TO_SUPERVISOR",
        suggestedActionPayload: { laneId: lane.id, congestionWeight: lane.congestionWeight },
        dedupeKey: `congestion:${lane.id}`,
      });
    }
  }

  // A lane that's cooled off resets its streak instead of staying primed
  // to re-trigger the moment it next ticks over the threshold.
  for (const laneId of [...consecutiveHotCycles.keys()]) {
    if (!stillHot.has(laneId)) consecutiveHotCycles.delete(laneId);
  }

  return candidates;
}

/** Test/lifecycle hook: clears the sustained-cycle counters. */
export function resetCongestionHotspotState(): void {
  consecutiveHotCycles.clear();
}
