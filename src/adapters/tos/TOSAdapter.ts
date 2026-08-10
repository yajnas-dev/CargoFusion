import type {
  Container,
  Equipment,
  YardState,
  TOSEvent,
  Recommendation,
} from "@/domain/types";

/**
 * The only interface allowed to represent access to the Terminal Operating
 * System (real or simulated). Per the ACSA report (section 6), the TOS
 * remains the source of truth; this adapter is read-mostly, with writes
 * limited to recommendations. No other module should model TOS access
 * directly — implementations are swappable (MockTOSAdapter now, a real
 * Navis/Tideworks adapter later) without touching callers.
 */
export interface TOSAdapter {
  searchContainers(query: string): Promise<Container[]>;
  getContainer(id: string): Promise<Container | null>;
  getEquipment(id?: string): Promise<Equipment[]>;
  getYardState(): Promise<YardState>;
  getEvents(since?: string): Promise<TOSEvent[]>;
  writeRecommendation(recommendation: Recommendation): Promise<void>;
}
