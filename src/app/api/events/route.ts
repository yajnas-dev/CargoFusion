import type { NextRequest } from "next/server";
import { eventBus } from "@/events/InProcessEventBus";
import { TOPICS } from "@/events/topics";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

const HEARTBEAT_MS = 15_000;

// Accesses request cookies (via requireSessionUser) so this is dynamic by
// nature, but declared explicitly since a long-lived streaming response
// must never be cached/reused across requests.
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events fan-out for every EventBus topic (src/events/topics.ts).
 * SSE over a raw WebSocket server: no custom server exists today, and a
 * streaming Route Handler works within the same single-process assumption
 * SimulationEngine already relies on — see docs/PROTOTYPE_IMPLEMENTATION_PLAN.md
 * and the rework plan for the fuller rationale.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req); // EventSource sends cookies automatically on same-origin requests

    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval>;
    let unsubscribers: Array<() => void> = [];

    const stream = new ReadableStream({
      start(controller) {
        const send = (topic: string, payload: unknown) => {
          const frame = `event: ${topic}\ndata: ${JSON.stringify(payload)}\n\n`;
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            // Controller already closed (client disconnected mid-publish) — nothing to do.
          }
        };

        unsubscribers = Object.values(TOPICS).map((topic) =>
          eventBus.subscribe(topic, (payload) => send(topic, payload)),
        );

        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            // Already closed.
          }
        }, HEARTBEAT_MS);
      },
      cancel() {
        clearInterval(heartbeat);
        for (const unsubscribe of unsubscribers) unsubscribe();
      },
    });

    req.signal.addEventListener("abort", () => {
      clearInterval(heartbeat);
      for (const unsubscribe of unsubscribers) unsubscribe();
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
