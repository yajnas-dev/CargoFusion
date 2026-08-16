/**
 * Domain types, sourced from the Prisma schema (prisma/schema.prisma) —
 * the single definition of the domain model. Re-exported here so the rest
 * of the app imports from `@/domain/types` rather than reaching into
 * `@/generated/prisma` directly.
 */
export type {
  Container,
  Equipment,
  YardBlock,
  YardNode,
  YardLane,
  Worker,
  Task,
  Recommendation,
  AuditEvent,
  SensorEvent,
  User,
  AgentAlert,
  Incident,
  CongestionSnapshot,
  TosWriteBackLog,
  ContainerStatus,
  ContainerType,
  Priority,
  EquipmentType,
  EquipmentStatus,
  WorkerStatus,
  TaskStatus,
  ConfidenceLevel,
  AuditAction,
  SensorEventType,
  UserRole,
  AgentAlertType,
  AgentAlertStatus,
  SuggestedActionType,
  IncidentType,
  IncidentStatus,
} from "@/generated/prisma/client";

import type { YardBlock, YardNode, YardLane, SensorEventType } from "@/generated/prisma/client";

/**
 * Snapshot of the yard graph as read from the TOS's yard/stowage plan
 * (report section 6.3). Not a Prisma model itself — it's a read shape
 * composed from YardBlock/YardNode/YardLane for TOSAdapter.getYardState().
 */
export interface YardState {
  blocks: YardBlock[];
  nodes: YardNode[];
  lanes: YardLane[];
  syncedAt: string;
}

/**
 * A TOS-originated event (gate move, crane move — report section 6.1).
 * Not persisted as its own table; consumed to update the local cache/twin.
 */
export interface TOSEvent {
  type: SensorEventType;
  subjectId: string;
  occurredAt: string;
}
