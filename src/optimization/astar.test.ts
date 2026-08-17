import { describe, expect, it } from "vitest";
import { YardGraph } from "@/optimization/YardGraph";
import { findPath } from "@/optimization/astar";
import type { YardState } from "@/domain/types";

function squareYardState(overrides: {
  blocked?: string[]; // lane ids to mark blocked
  congestion?: Record<string, number>; // lane id -> congestionWeight
} = {}): YardState {
  const nodes = [
    { id: "N1", blockId: null, x: 0, y: 0 },
    { id: "N2", blockId: null, x: 1, y: 0 },
    { id: "N3", blockId: null, x: 1, y: 1 },
    { id: "N4", blockId: null, x: 0, y: 1 },
  ];
  const laneDefs = [
    { id: "L-N1-N2", fromNodeId: "N1", toNodeId: "N2" },
    { id: "L-N2-N3", fromNodeId: "N2", toNodeId: "N3" },
    { id: "L-N3-N4", fromNodeId: "N3", toNodeId: "N4" },
    { id: "L-N4-N1", fromNodeId: "N4", toNodeId: "N1" },
  ];
  const lanes = laneDefs.map((l) => ({
    ...l,
    distanceMeters: 50,
    blocked: overrides.blocked?.includes(l.id) ?? false,
    congestionWeight: overrides.congestion?.[l.id] ?? 1,
  }));
  return { blocks: [], nodes, lanes, syncedAt: new Date().toISOString() };
}

describe("A* over the yard graph", () => {
  it("returns a trivial single-node path when origin equals destination", () => {
    const graph = new YardGraph(squareYardState());
    const result = findPath(graph, "N1", "N1");
    expect(result).toEqual({ path: ["N1"], edges: [], distanceMeters: 0 });
  });

  it("finds the direct shortest path when unobstructed", () => {
    const graph = new YardGraph(squareYardState());
    const result = findPath(graph, "N1", "N2");
    expect(result?.path).toEqual(["N1", "N2"]);
    expect(result?.distanceMeters).toBe(50);
  });

  it("reroutes around a blocked lane using the alternate path", () => {
    const graph = new YardGraph(squareYardState({ blocked: ["L-N1-N2"] }));
    const result = findPath(graph, "N1", "N2");
    expect(result?.path).toEqual(["N1", "N4", "N3", "N2"]);
    expect(result?.distanceMeters).toBe(150);
  });

  it("prefers a longer-hop-count detour when the direct lane is heavily congested", () => {
    const graph = new YardGraph(
      squareYardState({ congestion: { "L-N1-N2": 10 } }), // effective cost 500 vs detour's 150
    );
    const result = findPath(graph, "N1", "N2");
    expect(result?.path).toEqual(["N1", "N4", "N3", "N2"]);
    expect(result?.distanceMeters).toBe(150);
  });

  it("returns null when no path exists", () => {
    const graph = new YardGraph(
      squareYardState({ blocked: ["L-N1-N2", "L-N4-N1"] }), // N1 fully cut off
    );
    const result = findPath(graph, "N1", "N3");
    expect(result).toBeNull();
  });

  it("returns null for an unknown node id", () => {
    const graph = new YardGraph(squareYardState());
    expect(findPath(graph, "N1", "DOES-NOT-EXIST")).toBeNull();
  });

  it("finds the correct shortest path across a larger grid (heap-based open set at scale)", () => {
    // 6x6 grid, unit-spaced, all lanes distance 10 — regression coverage for
    // the MinHeap swap: correctness shouldn't change just because the open
    // set is now a heap with lazy-deletion instead of a linear scan.
    const size = 6;
    const nodes = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        nodes.push({ id: `G${x}-${y}`, blockId: null, x, y });
      }
    }
    const lanes = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x < size - 1) {
          lanes.push({
            id: `L-${x}-${y}-h`,
            fromNodeId: `G${x}-${y}`,
            toNodeId: `G${x + 1}-${y}`,
            distanceMeters: 10,
            blocked: false,
            congestionWeight: 1,
          });
        }
        if (y < size - 1) {
          lanes.push({
            id: `L-${x}-${y}-v`,
            fromNodeId: `G${x}-${y}`,
            toNodeId: `G${x}-${y + 1}`,
            distanceMeters: 10,
            blocked: false,
            congestionWeight: 1,
          });
        }
      }
    }
    const graph = new YardGraph({ blocks: [], nodes, lanes, syncedAt: new Date().toISOString() });

    const result = findPath(graph, "G0-0", `G${size - 1}-${size - 1}`);
    // Manhattan distance in a unit grid with unit edge cost: 2*(size-1) hops.
    expect(result?.path).toHaveLength(2 * (size - 1) + 1);
    expect(result?.distanceMeters).toBe(2 * (size - 1) * 10);
  });
});
