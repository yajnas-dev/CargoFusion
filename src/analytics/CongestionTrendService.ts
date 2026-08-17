import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import { prisma } from "@/domain/db";

const MIN_CONGESTION = 1.0;
const MAX_CONGESTION = 3.0;
const PROJECTION_MINUTES_AHEAD = 15;

export interface CongestionPoint {
  recordedAt: string;
  congestionWeight: number;
}

export interface CongestionProjection {
  inMinutes: number;
  projectedWeight: number;
  method: "linear-extrapolation";
}

export interface CongestionTrend {
  laneId: string;
  points: CongestionPoint[];
  currentWeight: number;
  projection: CongestionProjection | null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Periodic congestion snapshots + a short-horizon linear extrapolation
 * (Port Operations Roadmap Phase 3) — deliberately not a forecast model.
 * "If the straight-line trend between the oldest and newest reading in the
 * window continues, here's roughly where it'd be in 15 minutes" — nothing
 * more sophisticated is claimed, since there's no real trend data (or
 * validated model) to support more than that yet.
 */
export class CongestionTrendService {
  async recordSnapshot(tos: TOSAdapter): Promise<void> {
    const yardState = await tos.getYardState();
    if (yardState.lanes.length === 0) return;
    await prisma.congestionSnapshot.createMany({
      data: yardState.lanes.map((l) => ({ laneId: l.id, congestionWeight: l.congestionWeight })),
    });
  }

  async getTrend(laneId: string, lookbackMinutes = 30): Promise<CongestionTrend> {
    const since = new Date(Date.now() - lookbackMinutes * 60_000);
    const rows = await prisma.congestionSnapshot.findMany({
      where: { laneId, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
    });

    const points: CongestionPoint[] = rows.map((r) => ({
      recordedAt: r.recordedAt.toISOString(),
      congestionWeight: r.congestionWeight,
    }));
    const currentWeight = rows.length > 0 ? rows[rows.length - 1].congestionWeight : MIN_CONGESTION;

    if (rows.length < 2) {
      return { laneId, points, currentWeight, projection: null };
    }

    const first = rows[0];
    const last = rows[rows.length - 1];
    const elapsedMs = last.recordedAt.getTime() - first.recordedAt.getTime();
    if (elapsedMs <= 0) {
      return { laneId, points, currentWeight, projection: null };
    }

    const slopePerMs = (last.congestionWeight - first.congestionWeight) / elapsedMs;
    const projectedWeight = clamp(
      last.congestionWeight + slopePerMs * PROJECTION_MINUTES_AHEAD * 60_000,
      MIN_CONGESTION,
      MAX_CONGESTION,
    );

    return {
      laneId,
      points,
      currentWeight,
      projection: { inMinutes: PROJECTION_MINUTES_AHEAD, projectedWeight, method: "linear-extrapolation" },
    };
  }

  /** Trends for every lane with at least one recent snapshot, sorted by current congestion descending. */
  async getTopTrends(lookbackMinutes = 30, limit = 10): Promise<CongestionTrend[]> {
    const since = new Date(Date.now() - lookbackMinutes * 60_000);
    const laneIds = await prisma.congestionSnapshot.findMany({
      where: { recordedAt: { gte: since } },
      distinct: ["laneId"],
      select: { laneId: true },
    });

    const trends = await Promise.all(laneIds.map((l) => this.getTrend(l.laneId, lookbackMinutes)));
    return trends.sort((a, b) => b.currentWeight - a.currentWeight).slice(0, limit);
  }
}
