import { describe, expect, it } from "vitest";
import { createRng, pick, randInt, shuffle } from "@/domain/seed/rng";

describe("seeded RNG", () => {
  it("produces identical sequences for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });

  it("pick/randInt/shuffle stay within bounds and are deterministic", () => {
    const rng1 = createRng(7);
    const items = ["a", "b", "c", "d"];
    const picked = pick(rng1, items);
    expect(items).toContain(picked);

    const rng2 = createRng(7);
    const n = randInt(rng2, 10, 20);
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(20);

    const rng3 = createRng(7);
    const rng4 = createRng(7);
    expect(shuffle(rng3, [1, 2, 3, 4, 5])).toEqual(shuffle(rng4, [1, 2, 3, 4, 5]));
  });
});
