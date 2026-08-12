import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/domain/db";

import { POST as submitRetrievalRequest } from "@/app/api/retrieval-requests/route";
import { GET as getTasks } from "@/app/api/tasks/route";
import { GET as getTaskDetail } from "@/app/api/tasks/[id]/route";
import { POST as approveTask } from "@/app/api/tasks/[id]/approve/route";
import { POST as dispatchTask } from "@/app/api/tasks/[id]/dispatch/route";
import { POST as startTask } from "@/app/api/tasks/[id]/start/route";
import { POST as confirmTask } from "@/app/api/tasks/[id]/confirm/route";
import { POST as completeTask } from "@/app/api/tasks/[id]/complete/route";
import { GET as getYard } from "@/app/api/yard/route";

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/**
 * Drives the exact end-to-end scenario from the prototype brief (section
 * 2, "PROTOTYPE OBJECTIVE"): a natural-language retrieval request through
 * to a completed retrieval with a full audit trail, dashboard-visible
 * state changes throughout. Calls the real Next.js route handlers
 * directly (not the underlying services) — this is the closest a Vitest
 * test can get to "a browser hit these endpoints," without needing an
 * actual running HTTP server. No mocks anywhere in this chain; the only
 * thing that may vary run-to-run is whether Gemini or its deterministic
 * fallback interpreted/explained the request (both are exercised
 * elsewhere; this test doesn't care which one ran, only that the plan it
 * produced was actionable).
 */
describe("Full demo scenario: NL request -> completed retrieval -> audit trail", () => {
  it("completes the entire report-section-2 scenario with a consistent audit trail", async (ctx) => {
    // 1-3: authenticate (out of scope for the prototype's approval model —
    // requestedBy stands in for an authenticated operator identity) and
    // 4-9: find the container, inspect yard/equipment state, generate
    // candidates, compute route + equipment, check the digital twin.
    // All of this happens inside the single POST below.
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    expect(container).not.toBeNull();

    // Same as RetrievalAgent's live-Gemini test: when GEMINI_API_KEY is
    // configured, this route makes real interpret+explain calls, which can
    // legitimately take well past Vitest's 5s default (observed up to
    // ~27s standalone) or hit the small free-tier daily quota. This test
    // otherwise doesn't care which path (Gemini or its deterministic
    // fallback) produced the plan, so skip visibly on quota exhaustion
    // rather than failing the build over it.
    let submitResponse;
    try {
      submitResponse = await submitRetrievalRequest(
        jsonRequest("http://localhost/api/retrieval-requests", {
          request: `Retrieve container ${container!.id}`,
          requestedBy: "operator-e2e",
        }),
      );
    } catch (err) {
      if (err instanceof Error && /RESOURCE_EXHAUSTED|429/.test(err.message)) {
        ctx.skip();
        return;
      }
      throw err;
    }
    expect(submitResponse.status).toBe(200);
    const submitData = await submitResponse.json();

    // 10-11: recommendation generated, explanation produced.
    expect(submitData.planResult.status).toBe("READY");
    expect(submitData.explanation).toBeTruthy();
    expect(submitData.confidence.level).toMatch(/^(HIGH|MEDIUM|LOW)$/);
    expect(submitData.task.status).toBe("PLANNED");
    const taskId: string = submitData.task.id;

    // 12: supervisor approves.
    const approveResponse = await approveTask(
      jsonRequest(`http://localhost/api/tasks/${taskId}/approve`, { actor: "supervisor-e2e" }),
      idParams(taskId),
    );
    expect(approveResponse.status).toBe(200);
    expect((await approveResponse.json()).task.status).toBe("APPROVED");

    // 13: dispatched to a simulated worker.
    const dispatchResponse = await dispatchTask(
      jsonRequest(`http://localhost/api/tasks/${taskId}/dispatch`, { actor: "supervisor-e2e" }),
      idParams(taskId),
    );
    expect(dispatchResponse.status).toBe(200);
    const dispatchData = await dispatchResponse.json();
    expect(dispatchData.task.status).toBe("DISPATCHED");
    const workerId: string = dispatchData.task.assignedWorkerId;
    expect(workerId).toBeTruthy();

    // 14: worker sees the task (mobile/worker interface -> GET .../active-task,
    // already covered by WorkerTaskService tests; here we confirm it via
    // the task detail the dashboard would show).
    const midDetailResponse = await getTaskDetail(new Request(`http://localhost/api/tasks/${taskId}`), idParams(taskId));
    const midDetail = await midDetailResponse.json();
    expect(midDetail.task.assignedWorker.id).toBe(workerId);

    // 15: worker confirms retrieval (start, then confirm).
    const startResponse = await startTask(
      jsonRequest(`http://localhost/api/tasks/${taskId}/start`, { workerId }),
      idParams(taskId),
    );
    expect((await startResponse.json()).task.status).toBe("IN_PROGRESS");

    const confirmResponse = await confirmTask(
      jsonRequest(`http://localhost/api/tasks/${taskId}/confirm`, { workerId }),
      idParams(taskId),
    );
    expect((await confirmResponse.json()).task.status).toBe("RETRIEVED");

    // 16: system updates task status to COMPLETED.
    const completeResponse = await completeTask(
      jsonRequest(`http://localhost/api/tasks/${taskId}/complete`, { actor: "supervisor-e2e" }),
      idParams(taskId),
    );
    expect((await completeResponse.json()).task.status).toBe("COMPLETED");

    // 17: dashboard reflects the completed retrieval — the task list and
    // yard summary the dashboard actually fetches.
    const tasksResponse = await getTasks();
    const tasksData = await tasksResponse.json();
    const listedTask = tasksData.tasks.find((t: { id: string }) => t.id === taskId);
    expect(listedTask.status).toBe("COMPLETED");
    expect(listedTask.container.id).toBe(container!.id);

    const yardResponse = await getYard();
    const yardData = await yardResponse.json();
    expect(yardData.activeTaskCount).toBe(0); // COMPLETED isn't counted as active

    const retrievedContainer = await prisma.container.findUniqueOrThrow({ where: { id: container!.id } });
    expect(retrievedContainer.status).toBe("RETRIEVED");
    expect(retrievedContainer.retrievalEligible).toBe(false);

    // 18: audit trail records the entire process, in order, with no gaps.
    const finalDetailResponse = await getTaskDetail(new Request(`http://localhost/api/tasks/${taskId}`), idParams(taskId));
    const finalDetail = await finalDetailResponse.json();
    expect(finalDetail.task.auditEvents.map((e: { action: string }) => e.action)).toEqual([
      "REQUEST_SUBMITTED",
      "RECOMMENDATION_GENERATED",
      "APPROVED",
      "DISPATCHED",
      "STATUS_CHANGED", // start
      "WORKER_CONFIRMED",
      "STATUS_CHANGED", // complete
    ]);
    expect(finalDetail.task.recommendations).toHaveLength(1);
    expect(finalDetail.task.recommendations[0].explanation).toBe(submitData.explanation);

    // Cleanup: this test creates real Task/Recommendation/AuditEvent rows
    // and moves the container to RETRIEVED — restore seeded state so
    // other test files' assumptions about this container hold.
    await prisma.auditEvent.deleteMany({ where: { taskId } });
    await prisma.recommendation.deleteMany({ where: { taskId } });
    await prisma.task.deleteMany({ where: { id: taskId } });
    await prisma.container.update({
      where: { id: container!.id },
      data: { status: "IN_YARD", retrievalEligible: true },
    });
    await prisma.worker.update({ where: { id: workerId }, data: { status: "AVAILABLE" } });
  }, 60_000); // two live Gemini calls (interpret + explain) on the request-submission step
});
