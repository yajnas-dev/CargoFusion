import { prisma } from "@/domain/db";

/**
 * Finalizes any equipment whose in-progress movement (started by
 * DemoControls.moveEquipment) has arrived: currentNodeId becomes the
 * movement's target, and the transit fields clear. Mimics how a real TOS's
 * cached position would update from a GPS/telemetry feed as a truck
 * physically arrives, rather than teleporting the instant a move is
 * requested.
 *
 * Called on every equipment read that cares about current position
 * (MockTOSAdapter.getEquipment, the /api/yard route) so position is
 * always up to date whenever queried — no background ticker required for
 * correctness, only for the ambient SimulationEngine's own random walk.
 */
export async function resolveArrivedEquipmentMovements(): Promise<number> {
  const arrived = await prisma.equipment.findMany({
    where: { movementArrivesAt: { lte: new Date() } },
  });
  if (arrived.length === 0) return 0;

  await prisma.$transaction(
    arrived.map((eq) =>
      prisma.equipment.update({
        where: { id: eq.id },
        data: {
          currentNodeId: eq.movementTargetNodeId!,
          movementTargetNodeId: null,
          movementStartedAt: null,
          movementArrivesAt: null,
        },
      }),
    ),
  );

  return arrived.length;
}
