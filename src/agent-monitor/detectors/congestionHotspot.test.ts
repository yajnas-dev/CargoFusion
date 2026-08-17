import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { detectCongestionHotspots, resetCongestionHotspotState } from "@/agent-monitor/detectors/congestionHotspot";
import { DEFAULT_CONFIG } from "@/agent-monitor/types";

const CONFIG = { ...DEFAULT_CONFIG, congestionHotspotThreshold: 2.5, congestionSustainedCycles: 3 };

describe("detectCongestionHotspots", () => {
  const mutatedLaneIds: string[] = [];

  afterEach(async () => {
    for (const id of mutatedLaneIds) {
      await prisma.yardLane.update({ where: { id }, data: { congestionWeight: 1.0 } });
    }
    mutatedLaneIds.length = 0;
    resetCongestionHotspotState();
  });

  it("does not raise until the lane has been hot for the configured number of consecutive cycles", async () => {
    const lane = await prisma.yardLane.findFirstOrThrow();
    await prisma.yardLane.update({ where: { id: lane.id }, data: { congestionWeight: 3.0 } });
    mutatedLaneIds.push(lane.id);

    const ctx = { tos: new MockTOSAdapter(), now: new Date(), config: CONFIG };

    const cycle1 = await detectCongestionHotspots(ctx);
    expect(cycle1.find((c) => c.dedupeKey === `congestion:${lane.id}`)).toBeUndefined();

    const cycle2 = await detectCongestionHotspots(ctx);
    expect(cycle2.find((c) => c.dedupeKey === `congestion:${lane.id}`)).toBeUndefined();

    const cycle3 = await detectCongestionHotspots(ctx);
    const match = cycle3.find((c) => c.dedupeKey === `congestion:${lane.id}`);
    expect(match).toBeDefined();
    expect(match!.type).toBe("CONGESTION_HOTSPOT");
    expect(match!.suggestedActionType).toBe("ESCALATE_TO_SUPERVISOR");
  });

  it("resets the streak once the lane cools below the threshold", async () => {
    const lane = await prisma.yardLane.findFirstOrThrow();
    mutatedLaneIds.push(lane.id);
    const ctx = { tos: new MockTOSAdapter(), now: new Date(), config: CONFIG };

    await prisma.yardLane.update({ where: { id: lane.id }, data: { congestionWeight: 3.0 } });
    await detectCongestionHotspots(ctx);
    await detectCongestionHotspots(ctx);

    await prisma.yardLane.update({ where: { id: lane.id }, data: { congestionWeight: 1.0 } });
    await detectCongestionHotspots(ctx); // cools off — streak resets

    await prisma.yardLane.update({ where: { id: lane.id }, data: { congestionWeight: 3.0 } });
    const afterCooldown = await detectCongestionHotspots(ctx);
    // Streak was reset, so this is only cycle 1 again, not cycle 4.
    expect(afterCooldown.find((c) => c.dedupeKey === `congestion:${lane.id}`)).toBeUndefined();
  });

  it("returns [] when no lane is over the threshold", async () => {
    const candidates = await detectCongestionHotspots({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: CONFIG,
    });
    expect(candidates).toEqual([]);
  });
});
