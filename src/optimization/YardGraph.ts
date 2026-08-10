import type { YardState, YardLane, YardNode } from "@/domain/types";
import { LANE_SCALE_METERS } from "@/domain/constants";

export interface GraphEdge {
  toNodeId: string;
  distanceMeters: number;
  congestionWeight: number;
  blocked: boolean;
}

/**
 * In-memory representation of the yard graph for pathfinding. Lanes are
 * treated as undirected — a yard truck/crane can traverse either
 * direction of a lane between two intersections.
 */
export class YardGraph {
  readonly nodes: Map<string, YardNode>;
  private readonly adjacency: Map<string, GraphEdge[]>;

  constructor(yardState: YardState) {
    this.nodes = new Map(yardState.nodes.map((n) => [n.id, n]));
    this.adjacency = new Map();
    for (const node of yardState.nodes) this.adjacency.set(node.id, []);
    for (const lane of yardState.lanes) this.addLaneBothDirections(lane);
  }

  private addLaneBothDirections(lane: YardLane): void {
    const forward: GraphEdge = {
      toNodeId: lane.toNodeId,
      distanceMeters: lane.distanceMeters,
      congestionWeight: lane.congestionWeight,
      blocked: lane.blocked,
    };
    const backward: GraphEdge = {
      toNodeId: lane.fromNodeId,
      distanceMeters: lane.distanceMeters,
      congestionWeight: lane.congestionWeight,
      blocked: lane.blocked,
    };
    this.adjacency.get(lane.fromNodeId)?.push(forward);
    this.adjacency.get(lane.toNodeId)?.push(backward);
  }

  neighbors(nodeId: string): GraphEdge[] {
    return this.adjacency.get(nodeId) ?? [];
  }

  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /**
   * Straight-line distance in meters, using the same scale as seeded lane
   * distances so it stays an admissible A* heuristic (never overestimates
   * the true remaining cost, since congestionWeight only ever inflates
   * edge cost above the physical distance).
   */
  straightLineDistance(aId: string, bId: string): number {
    const a = this.nodes.get(aId);
    const b = this.nodes.get(bId);
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y) * LANE_SCALE_METERS;
  }
}
