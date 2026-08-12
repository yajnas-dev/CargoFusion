import type { YardGraph } from "@/optimization/YardGraph";
import { MinHeap } from "@/optimization/MinHeap";

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

  // Binary heap keyed by f-score. A plain heap has no O(log n) decrease-key,
  // so a shorter path to a node already in the open set pushes a *new*
  // entry rather than updating the old one; bestOpenF tracks each node's
  // current-best f so a popped entry that's since been superseded (stale)
  // is detected and skipped instead of reprocessed.
  interface OpenEntry {
    id: string;
    f: number;
  }
  const open = new MinHeap<OpenEntry>((entry) => entry.f);
  const bestOpenF = new Map<string, number>();

  const originF = graph.straightLineDistance(originId, destinationId);
  open.push({ id: originId, f: originF });
  bestOpenF.set(originId, originF);

  let current = open.pop();
  while (current !== undefined) {
    const currentId = current.id;
    // Stale entry: a better path to this node was found after this one was pushed.
    if (current.f > bestOpenF.get(currentId)!) {
      current = open.pop();
      continue;
    }

    if (currentId === destinationId) {
      return reconstructPath(graph, cameFrom, currentId, gScore.get(currentId)!);
    }

    closed.add(currentId);

    for (const edge of graph.neighbors(currentId)) {
      if (edge.blocked || closed.has(edge.toNodeId)) continue;

      const tentativeG = gScore.get(currentId)! + edge.distanceMeters * edge.congestionWeight;
      const knownG = gScore.get(edge.toNodeId);
      if (knownG === undefined || tentativeG < knownG) {
        cameFrom.set(edge.toNodeId, currentId);
        gScore.set(edge.toNodeId, tentativeG);
        const f = tentativeG + graph.straightLineDistance(edge.toNodeId, destinationId);
        bestOpenF.set(edge.toNodeId, f);
        open.push({ id: edge.toNodeId, f });
      }
    }

    current = open.pop();
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
