/**
 * Meters per unit of YardNode x/y coordinate. Shared between the seed
 * generator (which computes lane distances) and A* (whose heuristic must
 * use the same scale to stay admissible).
 */
export const LANE_SCALE_METERS = 50;
