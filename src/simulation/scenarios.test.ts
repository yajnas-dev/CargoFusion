import { afterEach, describe, expect, it } from "vitest";
import { ScenarioRunner, SCENARIOS } from "@/simulation/scenarios";
import { prisma } from "@/domain/db";

describe("ScenarioRunner", () => {
  const restoreLaneIds: string[] = [];
  const restoreEquipmentIds: string[] = [];
  const restoreWorkerIds: string[] = [];
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    for (const id of restoreLaneIds) {
      await prisma.yardLane.update({ where: { id }, data: { blocked: false, congestionWeight: 1.0 } });
    }
    restoreLaneIds.length = 0;
    for (const id of restoreEquipmentIds) {
      await prisma.equipment.update({ where: { id }, data: { status: "AVAILABLE" } });
    }
    restoreEquipmentIds.length = 0;
    for (const id of restoreWorkerIds) {
      await prisma.worker.update({ where: { id }, data: { status: "AVAILABLE" } });
    }
    restoreWorkerIds.length = 0;
    if (createdTaskIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.recommendation.deleteMany({ where: { taskId: { in: createdTaskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  it("lists all six named scenarios with a label and description", () => {
    expect(SCENARIOS).toHaveLength(6);
    for (const s of SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.description).toBeTruthy();
    }
  });

  it("lane-blockage blocks a lane and reports it in the result", async () => {
    const before = await prisma.yardLane.findMany({ where: { blocked: true }, select: { id: true } });
    restoreLaneIds.push(...before.map((l) => l.id));

    const runner = new ScenarioRunner();
    const result = await runner.run("lane-blockage");

    expect(result.scenarioId).toBe("lane-blockage");
    expect(result.details.laneId).toBeTruthy();
    restoreLaneIds.push(result.details.laneId as string);

    const lane = await prisma.yardLane.findUniqueOrThrow({ where: { id: result.details.laneId as string } });
    expect(lane.blocked).toBe(true);
  });

  it("equipment-failure takes a piece of equipment offline", async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run("equipment-failure");

    expect(result.scenarioId).toBe("equipment-failure");
    const equipmentId = result.details.equipmentId as string | undefined;
    if (equipmentId) {
      restoreEquipmentIds.push(equipmentId);
      const equipment = await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } });
      expect(equipment.status).toBe("OFFLINE");
    }
  });

  it("worker-shortage sets up to 5 available workers to OFF_SHIFT", async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run("worker-shortage");

    const workerIds = result.details.workerIds as string[];
    restoreWorkerIds.push(...workerIds);
    expect(workerIds.length).toBeLessThanOrEqual(5);

    for (const id of workerIds) {
      const worker = await prisma.worker.findUniqueOrThrow({ where: { id } });
      expect(worker.status).toBe("OFF_SHIFT");
    }
  });

  it("multiple-urgent submits real URGENT retrieval requests for unclaimed containers", async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run("multiple-urgent");

    const taskIds = result.details.taskIds as string[];
    createdTaskIds.push(...taskIds);

    for (const id of taskIds) {
      const task = await prisma.task.findUniqueOrThrow({ where: { id } });
      expect(task.priority).toBe("URGENT");
    }
  });

  it("throws on an unknown scenario id", async () => {
    const runner = new ScenarioRunner();
    await expect(runner.run("not-a-real-scenario")).rejects.toThrow(/Unknown scenario/);
  });
});
