/**
 * Every event topic published on the shared EventBus. Kept as a single
 * const map (not scattered string literals) so the SSE route (Phase 5) can
 * subscribe to all of them without duplicating the list, and so a typo in
 * a topic name is a compile error rather than a silently-dead subscription.
 */
export const TOPICS = {
  TASK_CHANGED: "task.changed",
  RECOMMENDATION_CREATED: "recommendation.created",
  YARD_LANE_CHANGED: "yard.lane.changed",
  YARD_EQUIPMENT_CHANGED: "yard.equipment.changed",
  SENSOR_EVENT: "yard.sensor.event",
  AGENT_ALERT_RAISED: "agent.alert.raised",
  AGENT_ALERT_RESOLVED: "agent.alert.resolved",
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];
