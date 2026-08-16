import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { detectUnclaimedPriorityContainers } from "@/agent-monitor/detectors/unclaimedPriorityContainer";
import { DEFAULT_CONFIG } from "@/agent-monitor/types";

async function taskFreeContainer() {
  const tasked = await prisma.task.findMany({ select: { containerId: true } });
  const taskedIds = new Set(tasked.map((t) => t.containerId));
  const candidates = await prisma.container.findMany({ where: { status: "IN_YARD" }, take: 500 });
  const found = candidates.find((c) => !taskedIds.has(c.id));
  if (!found) throw new Error("No task-free IN_YARD container available for this test");
  return found;
}

describe("detectUnclaimedPriorityContainers", () => {
  const createdTaskIds: string[] = [];
  const mutatedContainerIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    for (const id of mutatedContainerIds) {
      await prisma.container.update({
        where: { id },
        data: { priority: "MEDIUM", status: "IN_YARD", retrievalEligible: true },
      });
    }
    mutatedContainerIds.length = 0;
  });

  it("suggests INITIATE_RETRIEVAL for a HIGH/URGENT container with no task at all", async () => {
    const container = await taskFreeContainer();
    mutatedContainerIds.push(container.id);
    await prisma.container.update({
      where: { id: container.id },
      data: { priority: "URGENT", retrievalEligible: true, status: "IN_YARD" },
    });

    const candidates = await detectUnclaimedPriorityContainers({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });

    const match = candidates.find((c) => c.subject.containerId === container.id);
    expect(match).toBeDefined();
    expect(match!.type).toBe("UNCLAIMED_PRIORITY_CONTAINER");
    expect(match!.severity).toBe("URGENT");
    expect(match!.suggestedActionType).toBe("INITIATE_RETRIEVAL");
    expect(match!.suggestedActionPayload).toEqual({ containerId: container.id, priority: "URGENT" });
    expect(match!.dedupeKey).toBe(`unclaimed-priority:${container.id}`);
  });

  it("does not suggest a container that already has a task, regardless of task status", async () => {
    const container = await prisma.container.findFirstOrThrow({ where: { status: "IN_YARD" } });
    mutatedContainerIds.push(container.id);
    await prisma.container.update({ where: { id: container.id }, data: { priority: "HIGH" } });

    const task = await prisma.task.create({
      data: { containerId: container.id, status: "REJECTED", priority: "HIGH", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);

    const candidates = await detectUnclaimedPriorityContainers({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });
    expect(candidates.find((c) => c.subject.containerId === container.id)).toBeUndefined();
  });

  it("does not suggest a LOW/MEDIUM priority container", async () => {
    const container = await prisma.container.findFirstOrThrow({ where: { status: "IN_YARD" } });
    mutatedContainerIds.push(container.id);
    await prisma.container.update({ where: { id: container.id }, data: { priority: "MEDIUM" } });

    const candidates = await detectUnclaimedPriorityContainers({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });
    expect(candidates.find((c) => c.subject.containerId === container.id)).toBeUndefined();
  });

  it("caps output at 5 suggestions per cycle even with a larger backlog", async () => {
    const tasked = await prisma.task.findMany({ select: { containerId: true } });
    const taskedIds = new Set(tasked.map((t) => t.containerId));
    const pool = await prisma.container.findMany({ where: { status: "IN_YARD" }, take: 500 });
    const containers = pool.filter((c) => !taskedIds.has(c.id)).slice(0, 10);
    expect(containers.length).toBeGreaterThanOrEqual(6); // need more than the cap to prove it's enforced
    for (const c of containers) {
      mutatedContainerIds.push(c.id);
      await prisma.container.update({
        where: { id: c.id },
        data: { priority: "URGENT", retrievalEligible: true, status: "IN_YARD" },
      });
    }

    const candidates = await detectUnclaimedPriorityContainers({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });
    expect(candidates.length).toBeLessThanOrEqual(5);
  });
});
