/**
 * Placeholder domain types for Phase 1 interface signatures.
 * Superseded by the full domain model in Phase 2.
 */

export interface Container {
  id: string;
}

export interface Equipment {
  id: string;
}

export interface YardState {
  syncedAt: string;
}

export interface TOSEvent {
  type: string;
  occurredAt: string;
}

export interface Recommendation {
  taskId: string;
}

export interface SensorEvent {
  type: string;
  occurredAt: string;
}
