/**
 * In-process publish/subscribe event bus standing in for Kafka (report
 * section 11). Topic-based shape is kept deliberately Kafka-like so a real
 * broker could later replace this implementation without changing callers.
 */
export interface EventBus {
  publish<T = unknown>(topic: string, payload: T): void;
  subscribe<T = unknown>(
    topic: string,
    handler: (payload: T) => void,
  ): () => void;
}
