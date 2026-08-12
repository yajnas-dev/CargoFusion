import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { detectUrgentUnactioned } from "@/agent-monitor/detectors/urgentContainerUnactioned";
import { DEFAULT_CONFIG } from "@/agent-monitor/types";

const THRESHOLD_MS = 5 * 60_000;

async function backdateCreatedAt(taskId: string, when: Date) {
  await prisma.$executeRawUnsafe(`UPDATE "Task" SET "createdAt" = ? WHERE "id" = ?`, when.toISOString(), taskId);
}

describe("detectUrgentUnactioned", () => {
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  it("flags an old URGENT task still stuck at REQUESTED", async () => {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "REQUESTED", priority: "URGENT", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);
    await backdateCreatedAt(task.id, new Date(Date.now() - THRESHOLD_MS - 60_000));

    const candidates = await detectUrgentUnactioned({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, agingTaskThresholdMs: THRESHOLD_MS },
    });

    const match = candidates.find((c) => c.taskId === task.id);
    expect(match).toBeDefined();
    expect(match!.type).toBe("URGENT_CONTAINER_UNACTIONED");
    expect(match!.severity).toBe("URGENT");
    expect(match!.suggestedActionType).toBe("ESCALATE_TO_SUPERVISOR");
  });

  it("does not flag a recent URGENT REQUESTED task", async () => {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "REQUESTED", priority: "URGENT", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);

    const candidates = await detectUrgentUnactioned({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, agingTaskThresholdMs: THRESHOLD_MS },
    });
    expect(candidates.find((c) => c.taskId === task.id)).toBeUndefined();
  });

  it("does not flag an old MEDIUM-priority REQUESTED task", async () => {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "REQUESTED", priority: "MEDIUM", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);
    await backdateCreatedAt(task.id, new Date(Date.now() - THRESHOLD_MS - 60_000));

    const candidates = await detectUrgentUnactioned({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, agingTaskThresholdMs: THRESHOLD_MS },
    });
    expect(candidates.find((c) => c.taskId === task.id)).toBeUndefined();
  });
});
