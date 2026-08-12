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
  const mutatedEquipmentIds: string[] = [];

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
    for (const id of mutatedEquipmentIds) {
      await prisma.equipment.update({ where: { id }, data: { status: "AVAILABLE" } });
    }
    mutatedEquipmentIds.length = 0;
  });

  it("carries a task through the full lifecycle: dispatch -> start -> confirm -> complete", async () => {
    const { taskId, containerId } = await approvedTask();
    createdTaskIds.push(taskId);
    mutatedContainerIds.push(containerId);

    const workerService = new WorkerTaskService();

    const dispatched = await workerService.dispatch(taskId, "supervisor-1");
    expect(dispatched.status).toBe("DISPATCHED");
    expect(dispatched.assignedWorkerId).toBeTruthy();
    expect(dispatched.assignedEquipmentId).toBeTruthy();
    const workerId = dispatched.assignedWorkerId!;
    const equipmentId = dispatched.assignedEquipmentId!;
    mutatedWorkerIds.push(workerId);
    mutatedEquipmentIds.push(equipmentId);

    const assignedWorker = await prisma.worker.findUniqueOrThrow({ where: { id: workerId } });
    expect(assignedWorker.status).toBe("BUSY");

    const claimedEquipment = await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } });
    expect(claimedEquipment.status).toBe("BUSY");

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

    // Regression: confirmRetrieval used to free the worker but never the
    // equipment, leaving it permanently claimed after the task completed.
    const freedEquipment = await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } });
    expect(freedEquipment.status).toBe("AVAILABLE");

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

  it("doesn't double-assign the same worker to two tasks dispatched concurrently", async () => {
    // Regression test for a TOCTOU race: dispatch() used to read the first
    // AVAILABLE worker, then write inside a separate transaction, so two
    // concurrent dispatch() calls could both read the same worker before
    // either write committed. Firing two dispatches together (against two
    // different approved tasks) reproduces that interleaving deterministically,
    // since without the fix both reads happen before either write and (with
    // no orderBy) resolve to the same "first available" row.
    const approval = new SupervisorApprovalService(new MockTOSAdapter());

    const container1 = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const { task: task1 } = await approval.submitRequest({
      containerQuery: container1!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    await approval.approve(task1!.id, "supervisor-1");
    createdTaskIds.push(task1!.id);
    mutatedContainerIds.push(container1!.id);

    const container2 = await prisma.container.findFirst({
      where: { retrievalEligible: true, status: "IN_YARD", id: { not: container1!.id } },
    });
    const { task: task2 } = await approval.submitRequest({
      containerQuery: container2!.id,
      requestedBy: "test-operator",
      priority: "MEDIUM",
    });
    await approval.approve(task2!.id, "supervisor-1");
    createdTaskIds.push(task2!.id);
    mutatedContainerIds.push(container2!.id);

    const workerService = new WorkerTaskService();
    const [dispatched1, dispatched2] = await Promise.all([
      workerService.dispatch(task1!.id, "supervisor-1"),
      workerService.dispatch(task2!.id, "supervisor-1"),
    ]);

    expect(dispatched1.assignedWorkerId).toBeTruthy();
    expect(dispatched2.assignedWorkerId).toBeTruthy();
    expect(dispatched1.assignedWorkerId).not.toBe(dispatched2.assignedWorkerId);
    mutatedWorkerIds.push(dispatched1.assignedWorkerId!, dispatched2.assignedWorkerId!);

    const worker1 = await prisma.worker.findUniqueOrThrow({ where: { id: dispatched1.assignedWorkerId! } });
    const worker2 = await prisma.worker.findUniqueOrThrow({ where: { id: dispatched2.assignedWorkerId! } });
    expect(worker1.status).toBe("BUSY");
    expect(worker2.status).toBe("BUSY");
  });
});
