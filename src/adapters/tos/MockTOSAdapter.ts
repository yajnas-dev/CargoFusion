import { prisma } from "@/domain/db";
import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import type {
  Container,
  Equipment,
  YardState,
  TOSEvent,
  Recommendation,
} from "@/domain/types";

/**
 * Simulated TOS, backed by the Phase 3 seeded database. This is the only
 * module allowed to stand in for "the TOS" — everything else must go
 * through the TOSAdapter interface (report section 6.1). Not a real
 * Navis/Tideworks integration: a real adapter would replace this class
 * without callers changing.
 */
export class MockTOSAdapter implements TOSAdapter {
  // In-memory stand-in for a TOS gate/crane move event feed (report
  // section 6.1's "consume event streams from the TOS if available").
  // No persistence layer for this yet — Phase 15's simulation engine will
  // push into a real event source later.
  private events: TOSEvent[] = [];
  private writtenRecommendations: Recommendation[] = [];

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

  async getEvents(since?: string): Promise<TOSEvent[]> {
    if (!since) return [...this.events];
    const cutoff = new Date(since).getTime();
    return this.events.filter((e) => new Date(e.occurredAt).getTime() >= cutoff);
  }

  async writeRecommendation(recommendation: Recommendation): Promise<void> {
    // The TOS remains authoritative for master data; ACSA only ever writes
    // recommendations back (report section 6.1), never container/equipment
    // records. Simulated here as an in-memory acknowledgment.
    this.writtenRecommendations.push(recommendation);
  }

  /** Test/demo hook: inspect what's been "written back" to the simulated TOS. */
  getWrittenRecommendations(): readonly Recommendation[] {
    return this.writtenRecommendations;
  }

  /** Test/demo hook: inject a synthetic TOS event (gate/crane move). */
  emitEvent(event: TOSEvent): void {
    this.events.push(event);
  }
}
