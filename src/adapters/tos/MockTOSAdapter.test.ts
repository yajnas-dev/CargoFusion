import { describe, expect, it } from "vitest";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";
import type { Recommendation } from "@/domain/types";

describe("MockTOSAdapter", () => {
  it("finds a container by exact id and returns null for unknown ids", async () => {
    const adapter = new MockTOSAdapter();
    const sample = await prisma.container.findFirst();
    expect(sample).not.toBeNull();

    const found = await adapter.getContainer(sample!.id);
    expect(found?.id).toBe(sample!.id);

    const missing = await adapter.getContainer("ZZZZ0000000");
    expect(missing).toBeNull();
  });

  it("searchContainers matches exact id and falls back to substring", async () => {
    const adapter = new MockTOSAdapter();
    const sample = await prisma.container.findFirst();
    expect(sample).not.toBeNull();

    const exactResults = await adapter.searchContainers(sample!.id);
    expect(exactResults.map((c) => c.id)).toContain(sample!.id);

    const partial = sample!.id.slice(0, 6);
    const fuzzyResults = await adapter.searchContainers(partial);
    expect(fuzzyResults.length).toBeGreaterThan(0);
    expect(fuzzyResults.every((c) => c.id.includes(partial.toUpperCase()))).toBe(true);
  });

  it("searchContainers returns [] for an empty query", async () => {
    const adapter = new MockTOSAdapter();
    expect(await adapter.searchContainers("   ")).toEqual([]);
  });

  it("getEquipment returns a single match by id or all equipment without one", async () => {
    const adapter = new MockTOSAdapter();
    const sample = await prisma.equipment.findFirst();
    expect(sample).not.toBeNull();

    const single = await adapter.getEquipment(sample!.id);
    expect(single).toHaveLength(1);
    expect(single[0].id).toBe(sample!.id);

    const all = await adapter.getEquipment();
    const totalInDb = await prisma.equipment.count();
    expect(all).toHaveLength(totalInDb);
  });

  it("getYardState reflects the seeded yard graph", async () => {
    const adapter = new MockTOSAdapter();
    const state = await adapter.getYardState();
    expect(state.blocks.length).toBeGreaterThan(0);
    expect(state.nodes.length).toBeGreaterThan(0);
    expect(state.lanes.length).toBeGreaterThan(0);
    expect(state.syncedAt).toBeTruthy();
  });

  it("emitEvent/getEvents round-trips and filters by `since`", async () => {
    const adapter = new MockTOSAdapter();
    adapter.emitEvent({
      type: "GATE_MOVE",
      subjectId: "TEST-CONTAINER",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    adapter.emitEvent({
      type: "CRANE_MOVE",
      subjectId: "TEST-EQUIPMENT",
      occurredAt: "2026-06-01T00:00:00.000Z",
    });

    const all = await adapter.getEvents();
    expect(all).toHaveLength(2);

    const recentOnly = await adapter.getEvents("2026-03-01T00:00:00.000Z");
    expect(recentOnly).toHaveLength(1);
    expect(recentOnly[0].type).toBe("CRANE_MOVE");
  });

  it("writeRecommendation records what was sent to the simulated TOS", async () => {
    const adapter = new MockTOSAdapter();
    const recommendation = {
      id: "rec-test-1",
      taskId: "task-test-1",
      routeJson: "[]",
      equipmentId: "TRUCK-001",
      confidence: 0.9,
      confidenceLevel: "HIGH",
      confidenceFactorsJson: "{}",
      explanation: "test explanation",
      twinValidated: true,
      twinIssuesJson: null,
      createdAt: new Date(),
    } satisfies Recommendation;

    await adapter.writeRecommendation(recommendation);
    expect(adapter.getWrittenRecommendations()).toEqual([recommendation]);
  });
});
