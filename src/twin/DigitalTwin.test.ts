import { afterEach, describe, expect, it } from "vitest";
import { DigitalTwin } from "@/twin/DigitalTwin";
import { RouteOptimizationService } from "@/optimization/RouteOptimizationService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

async function eligiblePlanInputs() {
  const container = await prisma.container.findFirst({
    where: { retrievalEligible: true, status: "IN_YARD" },
  });
  const equipment = await prisma.equipment.findFirst({ where: { status: "AVAILABLE" } });
  if (!container || !equipment) throw new Error("seeded fixtures not found");

  const routes = new RouteOptimizationService(new MockTOSAdapter());
  const route = await routes.computeRoute(equipment.currentNodeId, `BLOCK-${container.block}-ENTRY`);
  if (!route) throw new Error("no route found for fixture");

  return { container, equipment, routeNodeIds: route.path };
}

describe("DigitalTwin.validatePlan", () => {
  const createdTaskIds: string[] = [];
  const mutatedContainerIds: string[] = [];
  const mutatedLaneIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
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
    for (const id of mutatedLaneIds) {
      await prisma.yardLane.update({ where: { id }, data: { blocked: false } });
    }
    mutatedLaneIds.length = 0;
  });

  it("PROCEEDs when nothing conflicts", async () => {
    const { container, equipment, routeNodeIds } = await eligiblePlanInputs();
    const twin = new DigitalTwin(new MockTOSAdapter());

    const result = await twin.validatePlan({
      containerId: container.id,
      equipmentId: equipment.id,
      routeNodeIds,
    });

    expect(result).toEqual({ valid: true, issues: [], recommendedAction: "PROCEED" });
  });

  it("ESCALATEs for an unknown container or equipment id", async () => {
    const { routeNodeIds } = await eligiblePlanInputs();
    const twin = new DigitalTwin(new MockTOSAdapter());

    const result = await twin.validatePlan({
      containerId: "DOES-NOT-EXIST",
      equipmentId: "ALSO-MISSING",
      routeNodeIds,
    });

    expect(result.valid).toBe(false);
    expect(result.recommendedAction).toBe("ESCALATE");
    expect(result.issues.map((i) => i.type).sort()).toEqual([
      "CONTAINER_NOT_FOUND",
      "EQUIPMENT_NOT_FOUND",
    ]);
  });

  it("ESCALATEs when the container is not retrieval-eligible", async () => {
    const { container, equipment, routeNodeIds } = await eligiblePlanInputs();
    await prisma.container.update({
      where: { id: container.id },
      data: { retrievalEligible: false },
    });
    mutatedContainerIds.push(container.id);

    const twin = new DigitalTwin(new MockTOSAdapter());
    const result = await twin.validatePlan({
      containerId: container.id,
      equipmentId: equipment.id,
      routeNodeIds,
    });

    expect(result.recommendedAction).toBe("ESCALATE");
    expect(result.issues.map((i) => i.type)).toContain("CONTAINER_NOT_ELIGIBLE");
  });

  it("REPLANs when the equipment is already committed to another active task", async () => {
    const { container, equipment, routeNodeIds } = await eligiblePlanInputs();
    const otherContainer = await prisma.container.findFirst({
      where: { id: { not: container.id } },
    });
    const existingTask = await prisma.task.create({
      data: {
        containerId: otherContainer!.id,
        requestedBy: "test-user",
        status: "DISPATCHED",
        assignedEquipmentId: equipment.id,
      },
    });
    createdTaskIds.push(existingTask.id);

    const twin = new DigitalTwin(new MockTOSAdapter());
    const result = await twin.validatePlan({
      containerId: container.id,
      equipmentId: equipment.id,
      routeNodeIds,
    });

    expect(result.recommendedAction).toBe("REPLAN");
    expect(result.issues.map((i) => i.type)).toContain("EQUIPMENT_DOUBLE_BOOKED");
  });

  it("excludes the plan's own task from double-booking/reservation checks", async () => {
    const { container, equipment, routeNodeIds } = await eligiblePlanInputs();
    const ownTask = await prisma.task.create({
      data: {
        containerId: container.id,
        requestedBy: "test-user",
        status: "APPROVED",
        assignedEquipmentId: equipment.id,
      },
    });
    createdTaskIds.push(ownTask.id);

    const twin = new DigitalTwin(new MockTOSAdapter());
    const result = await twin.validatePlan({
      taskId: ownTask.id,
      containerId: container.id,
      equipmentId: equipment.id,
      routeNodeIds,
    });

    expect(result.valid).toBe(true);
  });

  it("REPLANs when the route passes through a blocked lane", async () => {
    const { container, equipment, routeNodeIds } = await eligiblePlanInputs();
    expect(routeNodeIds.length).toBeGreaterThanOrEqual(2);

    const lane = await prisma.yardLane.findFirst({
      where: {
        OR: [
          { fromNodeId: routeNodeIds[0], toNodeId: routeNodeIds[1] },
          { fromNodeId: routeNodeIds[1], toNodeId: routeNodeIds[0] },
        ],
      },
    });
    expect(lane).not.toBeNull();
    await prisma.yardLane.update({ where: { id: lane!.id }, data: { blocked: true } });
    mutatedLaneIds.push(lane!.id);

    const twin = new DigitalTwin(new MockTOSAdapter());
    const result = await twin.validatePlan({
      containerId: container.id,
      equipmentId: equipment.id,
      routeNodeIds,
    });

    expect(result.recommendedAction).toBe("REPLAN");
    expect(result.issues.map((i) => i.type)).toContain("LANE_BLOCKED");
  });
});
