import { prisma } from "@/domain/db";
import { resolveArrivedEquipmentMovements } from "@/domain/equipmentMovement";
import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import type {
  Container,
  Equipment,
  YardState,
  TOSEvent,
  Recommendation,
  TosWriteBackLog,
} from "@/domain/types";

/**
 * Simulated TOS, backed by the Phase 3 seeded database. This is the only
 * module allowed to stand in for "the TOS" — everything else must go
 * through the TOSAdapter interface (report section 6.1). Not a real
 * Navis/Tideworks integration: a real adapter would replace this class
 * without callers changing.
 */
export class MockTOSAdapter implements TOSAdapter {
  async searchContainers(query: string): Promise<Container[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const exact = await prisma.container.findUnique({
      where: { id: trimmed.toUpperCase() },
    });
    if (exact) return [exact];

    // Fuzzy fallback: substring match on id, case-insensitive, capped so a
    // broad query doesn't return the whole yard.
    const candidates = await prisma.container.findMany({ take: 5000 });
    const needle = trimmed.toUpperCase();
    return candidates
      .filter((c) => c.id.includes(needle))
      .slice(0, 20);
  }

  async getContainer(id: string): Promise<Container | null> {
    return prisma.container.findUnique({ where: { id: id.toUpperCase() } });
  }

  async getEquipment(id?: string): Promise<Equipment[]> {
    await resolveArrivedEquipmentMovements();
    if (id) {
      const found = await prisma.equipment.findUnique({ where: { id } });
      return found ? [found] : [];
    }
    return prisma.equipment.findMany();
  }

  async getYardState(): Promise<YardState> {
    const [blocks, nodes, lanes] = await Promise.all([
      prisma.yardBlock.findMany(),
      prisma.yardNode.findMany(),
      prisma.yardLane.findMany(),
    ]);
    return { blocks, nodes, lanes, syncedAt: new Date().toISOString() };
  }

  /**
   * TOS gate/crane move event feed (report section 6.1's "consume event
   * streams from the TOS if available"), persisted to the SensorEvent
   * table — the same table DemoControls.triggerRfidEvent() writes to —
   * rather than an in-memory array that would be lost on every restart.
   */
  async getEvents(since?: string): Promise<TOSEvent[]> {
    const rows = await prisma.sensorEvent.findMany({
      where: since ? { occurredAt: { gte: new Date(since) } } : undefined,
      orderBy: { occurredAt: "asc" },
    });
    return rows.map((r) => ({
      type: r.type,
      subjectId: r.subjectId,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }

  async writeRecommendation(recommendation: Recommendation): Promise<void> {
    // The TOS remains authoritative for master data; ACSA only ever writes
    // recommendations back (report section 6.1), never container/equipment
    // records. Persisted to TosWriteBackLog so "what did we tell the TOS"
    // survives a restart, same rationale as the SensorEvent change above.
    await prisma.tosWriteBackLog.create({
      data: {
        recommendationId: recommendation.id,
        taskId: recommendation.taskId,
        payloadJson: JSON.stringify(recommendation),
      },
    });
  }

  /** Test/demo hook: inspect what's been "written back" to the simulated TOS. */
  async getWrittenRecommendations(): Promise<TosWriteBackLog[]> {
    return prisma.tosWriteBackLog.findMany({ orderBy: { writtenAt: "asc" } });
  }

  /** Test/demo hook: inject a synthetic TOS event (gate/crane move). */
  async emitEvent(event: TOSEvent): Promise<void> {
    await prisma.sensorEvent.create({
      data: {
        type: event.type,
        subjectId: event.subjectId,
        payloadJson: "{}",
        occurredAt: new Date(event.occurredAt),
      },
    });
  }
}
