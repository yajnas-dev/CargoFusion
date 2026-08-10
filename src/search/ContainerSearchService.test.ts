import { describe, expect, it } from "vitest";
import { ContainerSearchService } from "@/search/ContainerSearchService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { prisma } from "@/domain/db";

describe("ContainerSearchService", () => {
  it("returns [] for an empty query without touching the TOS", async () => {
    const service = new ContainerSearchService(new MockTOSAdapter());
    const result = await service.search("   ");
    expect(result).toEqual({ query: "   ", matches: [], source: "cache" });
  });

  it("finds an exact match via the TOS, then serves it from cache on repeat", async () => {
    const sample = await prisma.container.findFirst();
    expect(sample).not.toBeNull();

    const service = new ContainerSearchService(new MockTOSAdapter());

    const first = await service.search(sample!.id);
    expect(first.source).toBe("tos");
    expect(first.matches[0]).toMatchObject({ matchType: "exact", confidence: 1 });
    expect(first.matches[0].container.id).toBe(sample!.id);

    const second = await service.search(sample!.id);
    expect(second.source).toBe("cache");
    expect(second.matches[0].container.id).toBe(sample!.id);
  });

  it("finds substring matches with confidence < 1", async () => {
    const sample = await prisma.container.findFirst();
    expect(sample).not.toBeNull();

    const service = new ContainerSearchService(new MockTOSAdapter());
    const partial = sample!.id.slice(0, 6);
    const result = await service.search(partial);

    expect(result.source).toBe("tos");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.every((m) => m.matchType !== "exact")).toBe(true);
    expect(result.matches.every((m) => m.confidence < 1)).toBe(true);
    expect(result.matches.some((m) => m.container.id === sample!.id)).toBe(true);
  });

  it("recovers a near-miss id via fuzzy matching", async () => {
    const sample = await prisma.container.findFirst();
    expect(sample).not.toBeNull();

    // Flip the last digit to simulate a typo that breaks the exact/substring path.
    const lastChar = sample!.id.at(-1)!;
    const swappedChar = lastChar === "0" ? "1" : "0";
    const typo = sample!.id.slice(0, -1) + swappedChar;

    const service = new ContainerSearchService(new MockTOSAdapter());
    const result = await service.search(typo);

    expect(result.matches.some((m) => m.container.id === sample!.id)).toBe(true);
    const match = result.matches.find((m) => m.container.id === sample!.id)!;
    expect(match.matchType).toBe("fuzzy");
    expect(match.confidence).toBeLessThan(1);
    expect(match.confidence).toBeGreaterThan(0);
  });

  it("returns no matches for a query with no plausible candidates", async () => {
    const service = new ContainerSearchService(new MockTOSAdapter());
    const result = await service.search("ZZZZ9999999");
    expect(result.matches).toEqual([]);
  });

  it("warms the cache as searches happen", async () => {
    const sample = await prisma.container.findFirst();
    const service = new ContainerSearchService(new MockTOSAdapter());
    expect(service.getCacheSize()).toBe(0);
    await service.search(sample!.id);
    expect(service.getCacheSize()).toBeGreaterThan(0);
  });
});
