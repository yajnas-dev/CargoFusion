import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { detectSlaBreaches } from "@/agent-monitor/detectors/slaBreach";
import { DEFAULT_CONFIG } from "@/agent-monitor/types";

const WARNING_MS = 10 * 60_000;

describe("detectSlaBreaches", () => {
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  async function makeTask(priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT", dueBy: Date | null) {
    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "REQUESTED", priority, requestedBy: "test", dueBy },
    });
    createdTaskIds.push(task.id);
    return task;
  }

  it("flags a MEDIUM-priority task inside the warning window as HIGH severity, suggesting a reprioritize", async () => {
    const task = await makeTask("MEDIUM", new Date(Date.now() + 5 * 60_000));

    const candidates = await detectSlaBreaches({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, slaWarningThresholdMs: WARNING_MS },
    });

    const match = candidates.find((c) => c.taskId === task.id);
    expect(match).toBeDefined();
    expect(match!.severity).toBe("HIGH");
    expect(match!.suggestedActionType).toBe("REPRIORITIZE_TASK");
    expect(match!.suggestedActionPayload).toEqual({ taskId: task.id, newPriority: "URGENT" });
    expect(match!.subject.breached).toBe(false);
  });

  it("flags an already-overdue task as URGENT severity with breached=true", async () => {
    const task = await makeTask("LOW", new Date(Date.now() - 60_000));

    const candidates = await detectSlaBreaches({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, slaWarningThresholdMs: WARNING_MS },
    });

    const match = candidates.find((c) => c.taskId === task.id);
    expect(match).toBeDefined();
    expect(match!.severity).toBe("URGENT");
    expect(match!.subject.breached).toBe(true);
  });

  it("suggests ESCALATE_TO_SUPERVISOR (not reprioritize) for a task already URGENT", async () => {
    const task = await makeTask("URGENT", new Date(Date.now() + 60_000));

    const candidates = await detectSlaBreaches({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, slaWarningThresholdMs: WARNING_MS },
    });

    const match = candidates.find((c) => c.taskId === task.id);
    expect(match!.suggestedActionType).toBe("ESCALATE_TO_SUPERVISOR");
  });

  it("does not flag a task with no dueBy, or one still well outside the warning window", async () => {
    const noDeadline = await makeTask("URGENT", null);
    const farOut = await makeTask("URGENT", new Date(Date.now() + 60 * 60_000));

    const candidates = await detectSlaBreaches({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: { ...DEFAULT_CONFIG, slaWarningThresholdMs: WARNING_MS },
    });

    expect(candidates.find((c) => c.taskId === noDeadline.id)).toBeUndefined();
    expect(candidates.find((c) => c.taskId === farOut.id)).toBeUndefined();
  });
});
