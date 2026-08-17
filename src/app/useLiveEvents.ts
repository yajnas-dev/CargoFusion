"use client";

import { useEffect, useRef, useState } from "react";
import { TOPICS, type Topic } from "@/events/topics";

type Handlers = Partial<Record<Topic, (payload: unknown) => void>>;

/**
 * Subscribes to the /api/events SSE stream for the lifetime of the
 * component. Registers a listener for every known topic (cheap — each
 * just no-ops if the caller didn't pass a handler for it) so the hook's
 * signature never has to change as new topics are added. Native
 * EventSource auto-reconnects on a dropped connection; callers combine
 * this with a longer-interval fallback poll in case the stream stays
 * silently disconnected.
 *
 * `enabled` (default true) gates whether the connection opens at all —
 * needed by callers like GlobalAlertBar that render on every page
 * (including /login, before any session cookie exists) and can't just
 * skip calling this hook, since hooks can't be conditional.
 */
export function useLiveEvents(handlers: Handlers, enabled: boolean = true): { connected: boolean } {
  const handlersRef = useRef(handlers);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events");
    const registered: Array<[string, EventListener]> = [];

    for (const topic of Object.values(TOPICS)) {
      const listener: EventListener = (event) => {
        const handler = handlersRef.current[topic as Topic];
        if (!handler) return;
        const messageEvent = event as MessageEvent<string>;
        try {
          handler(JSON.parse(messageEvent.data));
        } catch {
          handler(undefined);
        }
      };
      source.addEventListener(topic, listener);
      registered.push([topic, listener]);
    }

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    return () => {
      for (const [topic, listener] of registered) source.removeEventListener(topic, listener);
      source.close();
    };
  }, [enabled]);

  return { connected };
}
