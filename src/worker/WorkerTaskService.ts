import { prisma } from "@/domain/db";
import { Prisma } from "@/generated/prisma/client";
import type { Task } from "@/domain/types";

/**
 * Carries an APPROVED task through dispatch and worker confirmation to
 * completion (report section 16: the Worker App shows a single active
 * task with turn-by-turn navigation and a scan-to-confirm action). Workers
 * are ACSA-local simulated data (not TOS-synced), so this talks to Prisma
 * directly rather than through TOSAdapter — same precedent as the Task
 * queries elsewhere in optimization/twin/approval.
 */
export class WorkerTaskService {
  /**
   * Finding an AVAILABLE worker and claiming them has to happen inside one
   * atomic transaction, not as a read followed by a separate write — two
   * concurrent dispatch() calls that both read the same available worker
   * before either commits would otherwise double-assign that worker to two
   * different tasks. SQLite serializes concurrent write transactions, so
   * doing the read+claim inside a single interactive transaction closes
   * that window.
   */
  async dispatch(taskId: string, actor: string): Promise<Task> {
    return prisma.$transaction(async (tx) => {
      const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      if (task.status !== "APPROVED") {
        throw new Error(`Task ${taskId} must be APPROVED to dispatch (was ${task.status}).`);
      }

      const worker = await tx.worker.findFirst({ where: { status: "AVAILABLE" } });
      if (!worker) {
        throw new Error("No available worker to dispatch this task to.");
      }

      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: { status: "DISPATCHED", assignedWorkerId: worker.id },
      });
      await tx.worker.update({ where: { id: worker.id }, data: { status: "BUSY" } });
      // Equipment must be claimed here too, symmetrically with the worker
      // above — otherwise it stays AVAILABLE for the entire time it's
      // actually out on this task (confirmRetrieval frees it back to
      // AVAILABLE, so without this it never gets marked busy in the first
      // place).
      if (task.assignedEquipmentId) {
        await tx.equipment.update({ where: { id: task.assignedEquipmentId }, data: { status: "BUSY" } });
      }
      await tx.auditEvent.create({
        data: {
          taskId,
          action: "DISPATCHED",
          actor,
          detailsJson: JSON.stringify({ workerId: worker.id }),
        },
      });

      return updatedTask;
    });
  }

  async startTask(taskId: string, workerId: string): Promise<Task> {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    this.assertAssignedWorker(task, workerId);
    if (task.status !== "DISPATCHED") {
      throw new Error(`Task ${taskId} must be DISPATCHED to start (was ${task.status}).`);
    }

    const [updatedTask] = await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } }),
      prisma.auditEvent.create({
        data: {
          taskId,
          action: "STATUS_CHANGED",
          actor: workerId,
          detailsJson: JSON.stringify({ from: "DISPATCHED", to: "IN_PROGRESS" }),
        },
      }),
    ]);

    return updatedTask;
  }

  /**
   * Worker scans/confirms the retrieval. Updates the container's status to
   * reflect the physical move — in a real deployment this would arrive
   * back via the TOS's own audit trail (report section 6.1); the mock TOS
   * *is* the local cache here, so this is that sync, not a violation of
   * "ACSA never writes container master data" (there's no separate real
   * TOS in the prototype to have written it first).
   */
  async confirmRetrieval(taskId: string, workerId: string): Promise<Task> {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    this.assertAssignedWorker(task, workerId);
    if (task.status !== "DISPATCHED" && task.status !== "IN_PROGRESS") {
      throw new Error(`Task ${taskId} must be DISPATCHED or IN_PROGRESS to confirm (was ${task.status}).`);
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.task.update({ where: { id: taskId }, data: { status: "RETRIEVED" } }),
      prisma.container.update({
        where: { id: task.containerId },
        data: { status: "RETRIEVED", retrievalEligible: false },
      }),
      prisma.worker.update({ where: { id: workerId }, data: { status: "AVAILABLE" } }),
    ];
    // Equipment was claimed for this task's duration; free it back to
    // AVAILABLE now that the retrieval is confirmed, same as the worker
    // above. A task in DISPATCHED/IN_PROGRESS always has an assigned
    // equipment (set when the plan was created), but the FK is nullable
    // in the schema, so guard rather than assume.
    if (task.assignedEquipmentId) {
      ops.push(
        prisma.equipment.update({ where: { id: task.assignedEquipmentId }, data: { status: "AVAILABLE" } }),
      );
    }
    ops.push(
      prisma.auditEvent.create({
        data: { taskId, action: "WORKER_CONFIRMED", actor: workerId, detailsJson: "{}" },
      }),
    );

    const [updatedTask] = (await prisma.$transaction(ops)) as [Task, ...unknown[]];
    return updatedTask;
  }

  async completeTask(taskId: string, actor: string): Promise<Task> {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    if (task.status !== "RETRIEVED") {
      throw new Error(`Task ${taskId} must be RETRIEVED to complete (was ${task.status}).`);
    }

    const [updatedTask] = await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: { status: "COMPLETED" } }),
      prisma.auditEvent.create({
        data: {
          taskId,
          action: "STATUS_CHANGED",
          actor,
          detailsJson: JSON.stringify({ from: "RETRIEVED", to: "COMPLETED" }),
        },
      }),
    ]);

    return updatedTask;
  }

  /** The single active task a worker's mobile view should show, if any. */
  async getActiveTaskForWorker(workerId: string): Promise<Task | null> {
    return prisma.task.findFirst({
      where: { assignedWorkerId: workerId, status: { in: ["DISPATCHED", "IN_PROGRESS"] } },
    });
  }

  private assertAssignedWorker(task: Task, workerId: string): void {
    if (task.assignedWorkerId !== workerId) {
      throw new Error(`Task ${task.id} is not assigned to worker ${workerId}.`);
    }
  }
}
