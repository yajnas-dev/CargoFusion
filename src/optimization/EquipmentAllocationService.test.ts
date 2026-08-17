import { afterEach, describe, expect, it } from "vitest";
import { EquipmentAllocationService } from "@/optimization/EquipmentAllocationService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

describe("EquipmentAllocationService (against the real seeded data)", () => {
  const createdTaskIds: string[] = [];

  afterEach(async () => {
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
  });

  it("returns only AVAILABLE, type-matching, capacity-sufficient equipment, ranked by score", async () => {
    const service = new EquipmentAllocationService(new MockTOSAdapter());
    const results = await service.allocate({
      destinationNodeId: "BLOCK-A-ENTRY",
      requiredType: "YARD_TRUCK",
      containerWeightKg: 5000,
      priority: "MEDIUM",
    });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.equipment.type).toBe("YARD_TRUCK");
      expect(r.equipment.status).toBe("AVAILABLE");
      expect(r.equipment.capacityKg).toBeGreaterThanOrEqual(5000);
    }
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("excludes equipment whose capacity is below the container weight", async () => {
    const service = new EquipmentAllocationService(new MockTOSAdapter());
    const results = await service.allocate({
      destinationNodeId: "BLOCK-A-ENTRY",
      requiredType: "YARD_TRUCK",
      containerWeightKg: 999_999,
      priority: "MEDIUM",
    });
    expect(results).toEqual([]);
  });

  it("weights distance more heavily for URGENT than for LOW priority", async () => {
    const service = new EquipmentAllocationService(new MockTOSAdapter());
    const [urgent] = await service.allocate({
      destinationNodeId: "BLOCK-A-ENTRY",
      requiredType: "YARD_TRUCK",
      containerWeightKg: 5000,
      priority: "URGENT",
    });
    const [low] = await service.allocate({
      destinationNodeId: "BLOCK-A-ENTRY",
      requiredType: "YARD_TRUCK",
      containerWeightKg: 5000,
      priority: "LOW",
    });
    expect(urgent.factors.weights.distance).toBeGreaterThan(low.factors.weights.distance);
  });

  it("factors in current workload from active tasks assigned to the equipment", async () => {
    const truck = await prisma.equipment.findFirst({
      where: { type: "YARD_TRUCK", status: "AVAILABLE" },
    });
    const container = await prisma.container.findFirst();
    expect(truck).not.toBeNull();
    expect(container).not.toBeNull();

    const task = await prisma.task.create({
      data: {
        containerId: container!.id,
        requestedBy: "test-user",
        status: "DISPATCHED",
        assignedEquipmentId: truck!.id,
      },
    });
    createdTaskIds.push(task.id);

    const service = new EquipmentAllocationService(new MockTOSAdapter());
    const results = await service.allocate({
      destinationNodeId: "BLOCK-A-ENTRY",
      requiredType: "YARD_TRUCK",
      containerWeightKg: 5000,
      priority: "MEDIUM",
    });

    const scored = results.find((r) => r.equipment.id === truck!.id);
    expect(scored).toBeDefined();
    expect(scored!.factors.activeTaskCount).toBeGreaterThanOrEqual(1);
    expect(scored!.factors.workloadScore).toBeLessThan(1);
  });

  it("counts a PLANNED (not-yet-approved) task as workload too", async () => {
    // A PLANNED task already names this equipment in its own recommendation
    // even though a supervisor hasn't approved it yet — it should still
    // suppress this equipment from being handed out to a second concurrent
    // request as if it were fully free.
    const truck = await prisma.equipment.findFirst({
      where: { type: "YARD_TRUCK", status: "AVAILABLE" },
    });
    const container = await prisma.container.findFirst();
    expect(truck).not.toBeNull();
    expect(container).not.toBeNull();

    const task = await prisma.task.create({
      data: {
        containerId: container!.id,
        requestedBy: "test-user",
        status: "PLANNED",
        assignedEquipmentId: truck!.id,
      },
    });
    createdTaskIds.push(task.id);

    const service = new EquipmentAllocationService(new MockTOSAdapter());
    const results = await service.allocate({
      destinationNodeId: "BLOCK-A-ENTRY",
      requiredType: "YARD_TRUCK",
      containerWeightKg: 5000,
      priority: "MEDIUM",
    });

    const scored = results.find((r) => r.equipment.id === truck!.id);
    expect(scored).toBeDefined();
    expect(scored!.factors.activeTaskCount).toBeGreaterThanOrEqual(1);
  });
});
