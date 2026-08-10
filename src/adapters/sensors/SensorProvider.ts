import type { SensorEvent } from "@/domain/types";

/**
 * Interface for IoT/edge sensor access (RFID checkpoints, GPS, crane and
 * truck telemetry — see report section 10). Implementations are swappable:
 * SimulatedSensorProvider for the prototype, a RealSensorProvider later.
 * No module outside adapters/sensors should generate sensor data directly.
 */
export interface SensorProvider {
  subscribe(onEvent: (event: SensorEvent) => void): () => void;
  getLatestEvents(since?: string): Promise<SensorEvent[]>;
}
