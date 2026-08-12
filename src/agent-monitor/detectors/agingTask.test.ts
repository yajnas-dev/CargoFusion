import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { detectAgingTasks } from "@/agent-monitor/detectors/agingTask";
import { DEFAULT_CONFIG } from "@/agent-monitor/types";

const THRESHOLD_MS = 5 * 60_000;

async function backdateUpdatedAt(taskId: string, when: Date) {
  await prisma.$executeRawUnsafe(`UPDATE "Task" SET "updatedAt" = ? WHERE "id" = ?`, when.toISOString(), taskId);
}

describe("detectAgingTasks", () => {
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  it("flags a PLANNED task whose updatedAt is older than the threshold", async () => {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "PLANNED", priority: "MEDIUM", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);
    await backdateUpdatedAt(task.id, new Date(Date.now() - THRESHOLD_MS - 60_000));

    const candidates = await detectAgingTasks({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, agingTaskThresholdMs: THRESHOLD_MS },
    });

    const match = candidates.find((c) => c.taskId === task.id);
    expect(match).toBeDefined();
    expect(match!.type).toBe("AGING_TASK");
    expect(match!.suggestedActionType).toBe("ESCALATE_TO_SUPERVISOR");
    expect(match!.dedupeKey).toBe(`aging-task:${task.id}`);
  });

  it("flags an APPROVED task the same way", async () => {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "APPROVED", priority: "LOW", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);
    await backdateUpdatedAt(task.id, new Date(Date.now() - THRESHOLD_MS - 60_000));

    const candidates = await detectAgingTasks({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, agingTaskThresholdMs: THRESHOLD_MS },
    });
    expect(candidates.find((c) => c.taskId === task.id)).toBeDefined();
  });

  it("does not flag a recently-updated task, or one outside PLANNED/APPROVED", async () => {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const fresh = await prisma.task.create({
      data: { containerId: container.id, status: "PLANNED", priority: "MEDIUM", requestedBy: "test" },
    });
    createdTaskIds.push(fresh.id);

    const candidates = await detectAgingTasks({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, agingTaskThresholdMs: THRESHOLD_MS },
    });
    expect(candidates.find((c) => c.taskId === fresh.id)).toBeUndefined();
  });
});
