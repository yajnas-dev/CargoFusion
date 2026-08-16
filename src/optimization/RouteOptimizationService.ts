import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import { YardGraph } from "@/optimization/YardGraph";
import { findPath, type RouteResult } from "@/optimization/astar";
import { AVERAGE_SPEED_METERS_PER_SECOND } from "@/domain/constants";

export interface Route extends RouteResult {
  estimatedSeconds: number;
}

/**
 * Requests a path for the assigned equipment from the A* pathfinding
 * engine, per the Route Optimization agent's spec in report section 8.1.
 * The agent layer (Phase 10) decides which origin/destination/constraints
 * to pass in; this service performs the actual computation.
 */
export class RouteOptimizationService {
  constructor(private readonly tos: TOSAdapter) {}

  async computeRoute(originNodeId: string, destinationNodeId: string): Promise<Route | null> {
    const yardState = await this.tos.getYardState();
    const graph = new YardGraph(yardState);
    const result = findPath(graph, originNodeId, destinationNodeId);
    if (!result) return null;

    return {
      ...result,
      estimatedSeconds: result.distanceMeters / AVERAGE_SPEED_METERS_PER_SECOND,
    };
  }
}
