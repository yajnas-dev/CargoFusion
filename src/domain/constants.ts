/**
 * Meters per unit of YardNode x/y coordinate. Shared between the seed
 * generator (which computes lane distances) and A* (whose heuristic must
 * use the same scale to stay admissible).
 */
export const LANE_SCALE_METERS = 50;

/**
 * Task statuses that represent a live claim on their assigned equipment or
 * container. Includes PLANNED (a resolved-but-not-yet-approved
 * recommendation already names an equipment/container pair) alongside the
 * post-approval states, so a second concurrent request can't be scored,
 * twin-validated, and persisted against the same equipment/container while
 * an earlier request is still awaiting supervisor approval. Shared between
 * DigitalTwin (double-booking/reservation checks) and
 * EquipmentAllocationService (workload scoring) so the two can't drift out
 * of sync with each other.
 */
export const ACTIVE_TASK_STATUSES = ["PLANNED", "APPROVED", "DISPATCHED", "IN_PROGRESS"] as const;
