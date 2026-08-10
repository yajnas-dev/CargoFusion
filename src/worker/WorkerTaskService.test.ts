import { afterEach, describe, expect, it } from "vitest";
import { WorkerTaskService } from "@/worker/WorkerTaskService";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

async function approvedTask() {
  const container = await prisma.container.findFirst({
    where: { retrievalEligible: true, status: "IN_YARD" },
  });
  const approval = new SupervisorApprovalService(new MockTOSAdapter());
  const { task } = await approval.submitRequest({
    containerQuery: container!.id,
    requestedBy: "test-operator",
    priority: "MEDIUM",
  });
  await approval.approve(task!.id, "supervisor-1");
  return { taskId: task!.id, containerId: container!.id };
}

describe("WorkerTaskService", () => {
  const createdTaskIds: string[] = [];
  const mutatedContainerIds: string[] = [];
  const mutatedWorkerIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.recommendation.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    for (const id of mutatedContainerIds) {
      await prisma.container.update({
        where: { id },
        data: { status: "IN_YARD", retrievalEligible: true },
      });
    }
    mutatedContainerIds.length = 0;
    for (const id of mutatedWorkerIds) {
      await prisma.worker.update({ where: { id }, data: { status: "AVAILABLE" } });
    }
    mutatedWorkerIds.length = 0;
  });

  it("carries a task through the full lifecycle: dispatch -> start -> confirm -> complete", async () => {
    const { taskId, containerId } = await approvedTask();
    createdTaskIds.push(taskId);
    mutatedContainerIds.push(containerId);

    const workerService = new WorkerTaskService();

    const dispatched = await workerService.dispatch(taskId, "supervisor-1");
    expect(dispatched.status).toBe("DISPATCHED");
    expect(dispatched.assignedWorkerId).toBeTruthy();
    const workerId = dispatched.assignedWorkerId!;
    mutatedWorkerIds.push(workerId);

    const assignedWorker = await prisma.worker.findUniqueOrThrow({ where: { id: workerId } });
    expect(assignedWorker.status).toBe("BUSY");

    const activeWhileDispatched = await workerService.getActiveTaskForWorker(workerId);
    expect(activeWhileDispatched?.id).toBe(taskId);

    const started = await workerService.startTask(taskId, workerId);
    expect(started.status).toBe("IN_PROGRESS");

    const confirmed = await workerService.confirmRetrieval(taskId, workerId);
    expect(confirmed.status).toBe("RETRIEVED");

    const container = await prisma.container.findUniqueOrThrow({ where: { id: containerId } });
    expect(container.status).toBe("RETRIEVED");
    expect(container.retrievalEligible).toBe(false);

    const freedWorker = await prisma.worker.findUniqueOrThrow({ where: { id: workerId } });
    expect(freedWorker.status).toBe("AVAILABLE");

    const activeAfterConfirm = await workerService.getActiveTaskForWorker(workerId);
    expect(activeAfterConfirm).toBeNull();

    const completed = await workerService.completeTask(taskId, "supervisor-1");
    expect(completed.status).toBe("COMPLETED");

    const events = await prisma.auditEvent.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([
      "REQUEST_SUBMITTED",
      "RECOMMENDATION_GENERATED",
      "APPROVED",
      "DISPATCHED",
      "STATUS_CHANGED",
      "WORKER_CONFIRMED",
      "STATUS_CHANGED",
    ]);
  });

  it("rejects dispatching a task that isn't APPROVED", async () => {
    const container = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const approval = new SupervisorApprovalService(new MockTOSAdapter());
    const { task } = await approval.submitRequest({
      containerQuery: container!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    createdTaskIds.push(task!.id); // status PLANNED, never approved

    const workerService = new WorkerTaskService();
    await expect(workerService.dispatch(task!.id, "supervisor-1")).rejects.toThrow(/must be APPROVED/);
  });

  it("rejects a worker starting or confirming a task assigned to someone else", async () => {
    const { taskId, containerId } = await approvedTask();
    createdTaskIds.push(taskId);
    mutatedContainerIds.push(containerId);

    const workerService = new WorkerTaskService();
    const dispatched = await workerService.dispatch(taskId, "supervisor-1");
    mutatedWorkerIds.push(dispatched.assignedWorkerId!);

    await expect(workerService.startTask(taskId, "someone-else")).rejects.toThrow(/not assigned/);
    await expect(workerService.confirmRetrieval(taskId, "someone-else")).rejects.toThrow(/not assigned/);
  });
});
