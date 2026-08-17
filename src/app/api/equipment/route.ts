import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/domain/db";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";
import { ACTIVE_TASK_STATUSES } from "@/domain/constants";

/**
 * Fleet visibility (Port Operations Roadmap Phase 1: Equipment & Worker List
 * Pages — the "Equipment"/"Trucks" nav items were disabled stubs on the
 * dashboard). Surfaces the same per-equipment active-task workload that
 * EquipmentAllocationService already computes internally for ranking, so a
 * supervisor can see at a glance which cranes/trucks are overloaded without
 * that number being locked inside the allocation scorer.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);

    const [equipment, workload] = await Promise.all([
      prisma.equipment.findMany({
        orderBy: [{ type: "asc" }, { id: "asc" }],
        include: { currentNode: { include: { block: true } } },
      }),
      prisma.task.groupBy({
        by: ["assignedEquipmentId"],
        where: { assignedEquipmentId: { not: null }, status: { in: [...ACTIVE_TASK_STATUSES] } },
        _count: { _all: true },
      }),
    ]);

    const workloadById = new Map(workload.map((w) => [w.assignedEquipmentId as string, w._count._all]));

    return NextResponse.json({
      equipment: equipment.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        capacityKg: e.capacityKg,
        currentNodeId: e.currentNodeId,
        blockId: e.currentNode.blockId,
        blockName: e.currentNode.block?.name ?? null,
        inTransit: e.movementTargetNodeId !== null,
        activeTaskCount: workloadById.get(e.id) ?? 0,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
