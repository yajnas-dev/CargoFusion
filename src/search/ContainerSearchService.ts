import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import type { Container } from "@/domain/types";
import { levenshteinDistance } from "@/search/levenshtein";

export type MatchType = "exact" | "substring" | "fuzzy";

export interface ContainerMatch {
  container: Container;
  confidence: number; // 0-1, transparent (not a validated statistical score)
  matchType: MatchType;
}

export interface SearchResult {
  query: string;
  matches: ContainerMatch[];
  source: "cache" | "tos";
}

const FUZZY_MAX_DISTANCE = 2;
const DEFAULT_LIMIT = 10;
const MIN_FUZZY_PREFIX_LENGTH = 4;

/**
 * Cache-first container lookup (report section 8.1: "Cache-first lookup
 * against the TOS-synced cache; on miss, triggers a direct TOS query and
 * disambiguates multiple matches by context"). The in-memory Map here
 * stands in for the Redis hot-path cache (report section 7.2) — it warms
 * on any TOSAdapter lookup rather than a bulk preload, since TOSAdapter
 * deliberately exposes no "list everything" query (mirrors a real TOS,
 * which wouldn't offer that either).
 *
 * All matching here is deterministic (exact / substring / Levenshtein
 * distance) — no LLM involved, per report section 8's rule that agents
 * decide *what* to look up, not *how* matching is computed.
 */
export class ContainerSearchService {
  private cache = new Map<string, Container>();

  constructor(private readonly tos: TOSAdapter) {}

  async search(query: string, limit = DEFAULT_LIMIT): Promise<SearchResult> {
    const normalized = query.trim().toUpperCase();
    if (!normalized) return { query, matches: [], source: "cache" };

    const cached = this.cache.get(normalized);
    if (cached) {
      return {
        query,
        matches: [{ container: cached, confidence: 1, matchType: "exact" }],
        source: "cache",
      };
    }

    const tosMatches = await this.tos.searchContainers(normalized);
    if (tosMatches.length > 0) {
      for (const container of tosMatches) this.cache.set(container.id, container);
      const matches = tosMatches
        .map((container): ContainerMatch =>
          container.id === normalized
            ? { container, confidence: 1, matchType: "exact" }
            : {
                container,
                confidence: this.substringConfidence(normalized, container.id),
                matchType: "substring",
              },
        )
        .sort((a, b) => b.confidence - a.confidence);
      return { query, matches: matches.slice(0, limit), source: "tos" };
    }

    const fuzzy = await this.fuzzySearch(normalized, limit);
    return { query, matches: fuzzy, source: "tos" };
  }

  /** Test/demo hook: inspect what's currently warm in the cache. */
  getCacheSize(): number {
    return this.cache.size;
  }

  private substringConfidence(query: string, id: string): number {
    const overlap = query.length / id.length;
    return Math.min(0.95, 0.6 + overlap * 0.3);
  }

  private fuzzyConfidence(query: string, distance: number): number {
    const normalized = 1 - distance / Math.max(query.length, 1);
    return Math.max(0, Math.min(0.85, normalized));
  }

  /**
   * No exact/substring hit — widen the net by querying shrinking prefixes
   * of the id (typos near the end are the common case, e.g. a mistyped
   * check digit) until the TOS returns a candidate pool, then rank by
   * edit distance from the original query.
   */
  private async fuzzySearch(normalized: string, limit: number): Promise<ContainerMatch[]> {
    let candidates: Container[] = [];
    for (
      let len = normalized.length - 1;
      len >= MIN_FUZZY_PREFIX_LENGTH && candidates.length === 0;
      len--
    ) {
      const prefix = normalized.slice(0, len);
      candidates = await this.tos.searchContainers(prefix);
    }

    const scored = candidates
      .map((container) => ({
        container,
        distance: levenshteinDistance(normalized, container.id),
      }))
      .filter((m) => m.distance <= FUZZY_MAX_DISTANCE)
      .sort((a, b) => a.distance - b.distance);

    for (const m of scored) this.cache.set(m.container.id, m.container);

    return scored.slice(0, limit).map((m) => ({
      container: m.container,
      confidence: this.fuzzyConfidence(normalized, m.distance),
      matchType: "fuzzy" as const,
    }));
  }
}
