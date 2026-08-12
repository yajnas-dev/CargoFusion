import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { detectBlockedLaneImpact } from "@/agent-monitor/detectors/blockedLaneImpact";
import { DEFAULT_CONFIG } from "@/agent-monitor/types";

describe("detectBlockedLaneImpact", () => {
  const mutatedLaneIds: string[] = [];
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    for (const id of mutatedLaneIds) {
      await prisma.yardLane.update({ where: { id }, data: { blocked: false } });
    }
    mutatedLaneIds.length = 0;
    if (createdTaskIds.length > 0) {
      await prisma.recommendation.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  it("raises a candidate when a blocked lane sits on an active task's recommended route", async () => {
    const lane = await prisma.yardLane.findFirstOrThrow();
    await prisma.yardLane.update({ where: { id: lane.id }, data: { blocked: true } });
    mutatedLaneIds.push(lane.id);

    const container = await prisma.container.findFirstOrThrow({
      where: { retrievalEligible: true, status: "IN_YARD" },
    });
    const task = await prisma.task.create({
      data: { containerId: container.id, status: "PLANNED", priority: "HIGH", requestedBy: "test" },
    });
    createdTaskIds.push(task.id);
    await prisma.recommendation.create({
      data: {
        taskId: task.id,
        routeJson: JSON.stringify([lane.fromNodeId, lane.toNodeId]),
        equipmentId: "TRUCK-001",
        confidence: 0.9,
        confidenceLevel: "HIGH",
        confidenceFactorsJson: "{}",
        explanation: "",
        twinValidated: true,
      },
    });

    const candidates = await detectBlockedLaneImpact({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });

    const match = candidates.find((c) => c.dedupeKey === `blocked-lane:${lane.id}`);
    expect(match).toBeDefined();
    expect(match!.taskId).toBe(task.id);
    expect(match!.type).toBe("BLOCKED_LANE_IMPACT");
    expect(match!.severity).toBe("HIGH");
    expect(match!.suggestedActionType).toBe("UNBLOCK_LANE");
    expect(match!.suggestedActionPayload).toEqual({ laneId: lane.id });
  });

  it("does not raise when the blocked lane isn't on any active task's route", async () => {
    const lane = await prisma.yardLane.findFirstOrThrow();
    await prisma.yardLane.update({ where: { id: lane.id }, data: { blocked: true } });
    mutatedLaneIds.push(lane.id);

    const candidates = await detectBlockedLaneImpact({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });
    expect(candidates.find((c) => c.dedupeKey === `blocked-lane:${lane.id}`)).toBeUndefined();
  });

  it("returns [] when no lanes are blocked", async () => {
    const candidates = await detectBlockedLaneImpact({
      tos: new MockTOSAdapter(),
      now: new Date(),
      config: DEFAULT_CONFIG,
    });
    expect(candidates).toEqual([]);
  });
});
