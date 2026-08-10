import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/domain/db";

describe("domain model / database", () => {
  afterAll(async () => {
    await prisma.container.deleteMany({ where: { id: "TEST0000001" } });
    await prisma.$disconnect();
  });

  it("round-trips a Container through the local cache", async () => {
    const created = await prisma.container.create({
      data: {
        id: "TEST0000001",
        block: "A",
        row: 1,
        bay: 2,
        tier: 3,
        weightKg: 12000,
        destination: "Rotterdam",
      },
    });
    expect(created.status).toBe("IN_YARD");
    expect(created.priority).toBe("MEDIUM");

    const found = await prisma.container.findUnique({
      where: { id: "TEST0000001" },
    });
    expect(found?.destination).toBe("Rotterdam");
  });

  it("enforces the Task -> Container foreign key", async () => {
    await expect(
      prisma.task.create({
        data: {
          containerId: "DOES-NOT-EXIST",
          requestedBy: "test-user",
        },
      }),
    ).rejects.toThrow();
  });
});
