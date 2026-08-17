import { EventEmitter } from "node:events";
import type { EventBus } from "@/events/EventBus";

/**
 * In-process implementation of the EventBus interface, backing both the
 * SSE route (Phase 5) and the Container Management Agent's event-driven
 * trigger (src/agent-monitor/). Multiple long-lived subscribers (each open
 * SSE connection, plus the agent) can accumulate quickly, so the default
 * Node warning threshold of 10 listeners per event is raised defensively.
 */
class InProcessEventBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  publish<T = unknown>(topic: string, payload: T): void {
    this.emitter.emit(topic, payload);
  }

  subscribe<T = unknown>(topic: string, handler: (payload: T) => void): () => void {
    this.emitter.on(topic, handler);
    return () => this.emitter.off(topic, handler);
  }
}

// Module-level singleton — same rationale as simulationEngine
// (src/simulation/SimulationEngine.ts): the Next.js dev/prod server is one
// long-lived Node process, so a subscriber registered by one request must
// still be listening for an event published by a later, unrelated request.
export const eventBus: EventBus = new InProcessEventBus();
