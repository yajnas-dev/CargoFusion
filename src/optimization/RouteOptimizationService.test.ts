import { afterEach, describe, expect, it } from "vitest";
import { RouteOptimizationService } from "@/optimization/RouteOptimizationService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

describe("RouteOptimizationService (against the real seeded yard graph)", () => {
  afterEach(async () => {
    // Undo any blocked-lane mutations so other test files see the seeded state.
    await prisma.yardLane.updateMany({ data: { blocked: false } });
  });

  it("computes a route from the gate to a block entry", async () => {
    const service = new RouteOptimizationService(new MockTOSAdapter());
    const route = await service.computeRoute("GATE", "BLOCK-A-ENTRY");

    expect(route).not.toBeNull();
    expect(route!.path[0]).toBe("GATE");
    expect(route!.path.at(-1)).toBe("BLOCK-A-ENTRY");
    expect(route!.distanceMeters).toBeGreaterThan(0);
    expect(route!.estimatedSeconds).toBeGreaterThan(0);
  });

  it("returns null for an unreachable/unknown destination", async () => {
    const service = new RouteOptimizationService(new MockTOSAdapter());
    expect(await service.computeRoute("GATE", "NOT-A-NODE")).toBeNull();
  });

  it("reroutes via the lateral aisle when the direct spine lane to a block is blocked", async () => {
    const spineLane = await prisma.yardLane.findFirst({
      where: { fromNodeId: "SPINE-0", toNodeId: "BLOCK-A-ENTRY" },
    });
    expect(spineLane).not.toBeNull();

    const service = new RouteOptimizationService(new MockTOSAdapter());
    const before = await service.computeRoute("GATE", "BLOCK-A-ENTRY");
    expect(before?.path).not.toContain("BLOCK-B-ENTRY");

    await prisma.yardLane.update({
      where: { id: spineLane!.id },
      data: { blocked: true },
    });

    const after = await service.computeRoute("GATE", "BLOCK-A-ENTRY");
    expect(after).not.toBeNull();
    expect(after!.path).toContain("BLOCK-B-ENTRY"); // detours via the aisle lane
    expect(after!.distanceMeters).toBeGreaterThan(before!.distanceMeters);
  });
});
