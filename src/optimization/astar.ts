import type { YardGraph } from "@/optimization/YardGraph";

export interface RouteEdge {
  fromNodeId: string;
  toNodeId: string;
  distanceMeters: number;
  congestionWeight: number;
}

export interface RouteResult {
  path: string[]; // node ids, origin -> destination
  edges: RouteEdge[];
  /** Congestion-weighted travel cost in meters (sum of distanceMeters * congestionWeight per edge). */
  distanceMeters: number;
}

/**
 * A* search over the yard graph with a congestion-weighted edge cost
 * (distance * congestionWeight) and blocked lanes excluded entirely, per
 * report section 13's route-optimization spec. Deterministic; no LLM
 * involvement — the agent layer (Phase 10) only decides which
 * origin/destination/constraints to pass in.
 */
export function findPath(
  graph: YardGraph,
  originId: string,
  destinationId: string,
): RouteResult | null {
  if (!graph.hasNode(originId) || !graph.hasNode(destinationId)) return null;
  if (originId === destinationId) {
    return { path: [originId], edges: [], distanceMeters: 0 };
  }

  const gScore = new Map<string, number>([[originId, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();

  // Small graph (dozens of nodes) — a linear scan for the lowest-fScore
  // open node is simpler than a binary heap and plenty fast at this scale.
  const open = new Map<string, number>([
    [originId, graph.straightLineDistance(originId, destinationId)],
  ]);

  while (open.size > 0) {
    let currentId: string | null = null;
    let currentF = Infinity;
    for (const [id, f] of open) {
      if (f < currentF) {
        currentF = f;
        currentId = id;
      }
    }
    if (currentId === null) break;

    if (currentId === destinationId) {
      return reconstructPath(graph, cameFrom, currentId, gScore.get(currentId)!);
    }

    open.delete(currentId);
    closed.add(currentId);

    for (const edge of graph.neighbors(currentId)) {
      if (edge.blocked || closed.has(edge.toNodeId)) continue;

      const tentativeG =
        gScore.get(currentId)! + edge.distanceMeters * edge.congestionWeight;
      const knownG = gScore.get(edge.toNodeId);
      if (knownG === undefined || tentativeG < knownG) {
        cameFrom.set(edge.toNodeId, currentId);
        gScore.set(edge.toNodeId, tentativeG);
        open.set(
          edge.toNodeId,
          tentativeG + graph.straightLineDistance(edge.toNodeId, destinationId),
        );
      }
    }
  }

  return null; // no path (fully blocked / disconnected)
}

function reconstructPath(
  graph: YardGraph,
  cameFrom: Map<string, string>,
  destinationId: string,
  totalDistance: number,
): RouteResult {
  const path: string[] = [destinationId];
  let cursor = destinationId;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor)!;
    path.unshift(cursor);
  }

  const edges: RouteEdge[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const fromNodeId = path[i];
    const toNodeId = path[i + 1];
    const edge = graph.neighbors(fromNodeId).find((e) => e.toNodeId === toNodeId)!;
    edges.push({
      fromNodeId,
      toNodeId,
      distanceMeters: edge.distanceMeters,
      congestionWeight: edge.congestionWeight,
    });
  }

  return { path, edges, distanceMeters: totalDistance };
}
