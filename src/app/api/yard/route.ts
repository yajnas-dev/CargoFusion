import { NextResponse } from "next/server";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

export async function GET() {
  const tos = new MockTOSAdapter();
  const [
    yardState,
    equipment,
    containerCounts,
    activeTaskCount,
    totalContainers,
    containersInYard,
    craneTotal,
    craneBusy,
  ] = await Promise.all([
    tos.getYardState(),
    tos.getEquipment(), // resolves any arrived transits (src/domain/equipmentMovement.ts) before reading position
    prisma.container.groupBy({ by: ["block"], _count: { _all: true } }),
    prisma.task.count({ where: { status: { in: ["APPROVED", "DISPATCHED", "IN_PROGRESS"] } } }),
    prisma.container.count(),
    prisma.container.count({ where: { status: "IN_YARD" } }),
    prisma.equipment.count({ where: { type: "CRANE" } }),
    prisma.equipment.count({ where: { type: "CRANE", status: "BUSY" } }),
  ]);

  return NextResponse.json({
    blocks: yardState.blocks,
    nodes: yardState.nodes,
    lanes: yardState.lanes,
    equipment,
    containerCountsByBlock: Object.fromEntries(containerCounts.map((c) => [c.block, c._count._all])),
    activeTaskCount,
    totalContainers,
    containersInYard,
    craneUtilization: craneTotal > 0 ? craneBusy / craneTotal : 0,
  });
}
