import { afterEach, describe, expect, it } from "vitest";
import { CongestionTrendService } from "@/analytics/CongestionTrendService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

describe("CongestionTrendService", () => {
  // Tests here deliberately backdate some rows (e.g. "10 minutes ago") to
  // exercise the trend math, which can predate a simple `recordedAt >=
  // testStartedAt` cleanup filter — track exact lane ids touched instead.
  const touchedLaneIds: string[] = [];

  afterEach(async () => {
    if (touchedLaneIds.length > 0) {
      await prisma.congestionSnapshot.deleteMany({ where: { laneId: { in: touchedLaneIds } } });
      touchedLaneIds.length = 0;
    }
  });

  it("recordSnapshot writes one row per lane", async () => {
    const [laneCount, allLaneIds] = await Promise.all([
      prisma.yardLane.count(),
      prisma.yardLane.findMany({ select: { id: true } }),
    ]);
    touchedLaneIds.push(...allLaneIds.map((l) => l.id));
    const service = new CongestionTrendService();

    const before = await prisma.congestionSnapshot.count();
    await service.recordSnapshot(new MockTOSAdapter());
    const after = await prisma.congestionSnapshot.count();

    expect(after - before).toBe(laneCount);
  });

  it("getTrend returns no projection with fewer than 2 points, and a clamped linear extrapolation with 2+", async () => {
    const lane = await prisma.yardLane.findFirstOrThrow();
    touchedLaneIds.push(lane.id);
    const service = new CongestionTrendService();

    const empty = await service.getTrend(lane.id);
    expect(empty.projection).toBeNull();
    expect(empty.points).toEqual([]);

    const now = Date.now();
    await prisma.congestionSnapshot.createMany({
      data: [
        { laneId: lane.id, congestionWeight: 1.0, recordedAt: new Date(now - 10 * 60_000) },
        { laneId: lane.id, congestionWeight: 2.0, recordedAt: new Date(now) },
      ],
    });

    const trend = await service.getTrend(lane.id);
    expect(trend.points).toHaveLength(2);
    expect(trend.currentWeight).toBe(2.0);
    expect(trend.projection).not.toBeNull();
    // Rising 1.0 over 10 min -> +0.1/min; 15 min ahead would be 3.5, clamped to MAX_CONGESTION (3.0).
    expect(trend.projection!.projectedWeight).toBe(3.0);
    expect(trend.projection!.method).toBe("linear-extrapolation");
  });

  it("getTopTrends sorts by current congestion descending and respects the limit", async () => {
    const lanes = await prisma.yardLane.findMany({ take: 3 });
    touchedLaneIds.push(...lanes.map((l) => l.id));
    const now = Date.now();
    await prisma.congestionSnapshot.createMany({
      data: [
        { laneId: lanes[0].id, congestionWeight: 1.5, recordedAt: new Date(now - 60_000) },
        { laneId: lanes[0].id, congestionWeight: 1.5, recordedAt: new Date(now) },
        { laneId: lanes[1].id, congestionWeight: 2.5, recordedAt: new Date(now - 60_000) },
        { laneId: lanes[1].id, congestionWeight: 2.5, recordedAt: new Date(now) },
      ],
    });

    const service = new CongestionTrendService();
    const top = await service.getTopTrends(30, 1);

    expect(top).toHaveLength(1);
    expect(top[0].laneId).toBe(lanes[1].id); // higher current congestion
  });
});
