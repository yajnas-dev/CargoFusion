import { NextResponse } from "next/server";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

export async function GET() {
  const [yardState, equipment, containerCounts, activeTaskCount] = await Promise.all([
    new MockTOSAdapter().getYardState(),
    prisma.equipment.findMany(),
    prisma.container.groupBy({ by: ["block"], _count: { _all: true } }),
    prisma.task.count({ where: { status: { in: ["APPROVED", "DISPATCHED", "IN_PROGRESS"] } } }),
  ]);

  return NextResponse.json({
    blocks: yardState.blocks,
    nodes: yardState.nodes,
    lanes: yardState.lanes,
    equipment,
    containerCountsByBlock: Object.fromEntries(containerCounts.map((c) => [c.block, c._count._all])),
    activeTaskCount,
  });
}
