import { describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";

/**
 * Validates the shape of data produced by `npm run db:seed`, not a mock.
 * Run `npm run db:seed` before `npm run test` if this fails on a fresh clone.
 */
describe("synthetic data generator output", () => {
  it("seeds 1000+ containers", async () => {
    const count = await prisma.container.count();
    expect(count).toBeGreaterThanOrEqual(1000);
  });

  it("seeds 100+ equipment across both types", async () => {
    const total = await prisma.equipment.count();
    expect(total).toBeGreaterThanOrEqual(100);

    const cranes = await prisma.equipment.count({ where: { type: "CRANE" } });
    const trucks = await prisma.equipment.count({ where: { type: "YARD_TRUCK" } });
    expect(cranes).toBeGreaterThan(0);
    expect(trucks).toBeGreaterThan(0);
  });

  it("builds a connected yard graph with a gate node", async () => {
    const gate = await prisma.yardNode.findUnique({ where: { id: "GATE" } });
    expect(gate).not.toBeNull();

    const lanes = await prisma.yardLane.count();
    expect(lanes).toBeGreaterThan(0);
  });

  it("seeds workers", async () => {
    const workers = await prisma.worker.count();
    expect(workers).toBeGreaterThan(0);
  });

  it("every equipment references a valid yard node (FK integrity)", async () => {
    const equipment = await prisma.equipment.findMany({
      include: { currentNode: true },
    });
    expect(equipment.every((e) => e.currentNode !== null)).toBe(true);
  });

  it("seeds one demo user per role, with WORKER accounts linked to real Worker rows", async () => {
    const users = await prisma.user.findMany({ include: { worker: true } });
    expect(users.length).toBeGreaterThanOrEqual(5);

    const byRole = (role: string) => users.filter((u) => u.role === role);
    expect(byRole("OPERATOR").length).toBeGreaterThanOrEqual(1);
    expect(byRole("SUPERVISOR").length).toBeGreaterThanOrEqual(1);

    const workers = byRole("WORKER");
    expect(workers.length).toBeGreaterThanOrEqual(1);
    expect(workers.every((u) => u.workerId !== null && u.worker !== null)).toBe(true);
  });
});
