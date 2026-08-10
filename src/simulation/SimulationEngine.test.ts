import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationEngine } from "@/simulation/SimulationEngine";
import { prisma } from "@/domain/db";

describe("SimulationEngine", () => {
  it("start()/stop() toggle isRunning and start() is idempotent", () => {
    vi.useFakeTimers();
    const engine = new SimulationEngine();
    expect(engine.isRunning()).toBe(false);

    engine.start(1000);
    expect(engine.isRunning()).toBe(true);

    const tickSpy = vi.spyOn(engine, "tick").mockResolvedValue();
    engine.start(1000); // second call must not schedule a duplicate interval
    vi.advanceTimersByTime(3000);
    expect(tickSpy).toHaveBeenCalledTimes(3); // not 6, if a duplicate interval had been created

    engine.stop();
    expect(engine.isRunning()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(tickSpy).toHaveBeenCalledTimes(3); // no further ticks after stop

    vi.useRealTimers();
  });

  describe("tick() maintains data invariants across repeated runs", () => {
    let laneSnapshot: { id: string; blocked: boolean; congestionWeight: number }[];
    let equipmentSnapshot: { id: string; status: "AVAILABLE" | "BUSY" | "OFFLINE"; currentNodeId: string }[];
    let testStart: Date;

    beforeEach(async () => {
      laneSnapshot = await prisma.yardLane.findMany({
        select: { id: true, blocked: true, congestionWeight: true },
      });
      equipmentSnapshot = await prisma.equipment.findMany({
        select: { id: true, status: true, currentNodeId: true },
      });
      testStart = new Date();
    });

    afterEach(async () => {
      for (const lane of laneSnapshot) {
        await prisma.yardLane.update({
          where: { id: lane.id },
          data: { blocked: lane.blocked, congestionWeight: lane.congestionWeight },
        });
      }
      for (const eq of equipmentSnapshot) {
        await prisma.equipment.update({
          where: { id: eq.id },
          data: { status: eq.status, currentNodeId: eq.currentNodeId },
        });
      }
      // Only remove SensorEvent rows created by this test's ticks, not other tests'.
      await prisma.sensorEvent.deleteMany({ where: { occurredAt: { gte: testStart } } });
    });

    it("keeps congestion in bounds and every equipment's node valid after many ticks", async () => {
      const engine = new SimulationEngine();
      for (let i = 0; i < 25; i++) {
        await engine.tick();
      }

      const lanes = await prisma.yardLane.findMany();
      for (const lane of lanes) {
        expect(lane.congestionWeight).toBeGreaterThanOrEqual(1.0);
        expect(lane.congestionWeight).toBeLessThanOrEqual(3.0);
      }

      const equipment = await prisma.equipment.findMany();
      const nodeIds = new Set((await prisma.yardNode.findMany({ select: { id: true } })).map((n) => n.id));
      for (const eq of equipment) {
        expect(nodeIds.has(eq.currentNodeId)).toBe(true);
      }
    });
  });
});
