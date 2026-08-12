import { describe, expect, it } from "vitest";
import { MinHeap } from "@/optimization/MinHeap";

describe("MinHeap", () => {
  it("pops in ascending priority order regardless of push order", () => {
    const heap = new MinHeap<number>((n) => n);
    for (const n of [5, 3, 8, 1, 9, 2, 7]) heap.push(n);

    const popped: number[] = [];
    let next = heap.pop();
    while (next !== undefined) {
      popped.push(next);
      next = heap.pop();
    }
    expect(popped).toEqual([1, 2, 3, 5, 7, 8, 9]);
  });

  it("pop() returns undefined on an empty heap", () => {
    const heap = new MinHeap<number>((n) => n);
    expect(heap.pop()).toBeUndefined();
  });

  it("size reflects the number of pushed-minus-popped items", () => {
    const heap = new MinHeap<number>((n) => n);
    expect(heap.size).toBe(0);
    heap.push(1);
    heap.push(2);
    expect(heap.size).toBe(2);
    heap.pop();
    expect(heap.size).toBe(1);
  });

  it("supports duplicate priorities and stale/superseded entries without losing items", () => {
    // Mirrors astar.ts's lazy-deletion pattern: push a second, cheaper
    // entry for the same logical id instead of updating the first one.
    interface Entry {
      id: string;
      f: number;
    }
    const heap = new MinHeap<Entry>((e) => e.f);
    heap.push({ id: "a", f: 10 });
    heap.push({ id: "a", f: 4 }); // supersedes the f:10 entry
    heap.push({ id: "b", f: 6 });

    expect(heap.pop()).toEqual({ id: "a", f: 4 });
    expect(heap.pop()).toEqual({ id: "b", f: 6 });
    expect(heap.pop()).toEqual({ id: "a", f: 10 }); // stale entry still comes out, just last
    expect(heap.pop()).toBeUndefined();
  });

  it("handles a large randomized sequence correctly", () => {
    const heap = new MinHeap<number>((n) => n);
    const values = Array.from({ length: 500 }, () => Math.floor(Math.random() * 10_000));
    for (const v of values) heap.push(v);

    const popped: number[] = [];
    let next = heap.pop();
    while (next !== undefined) {
      popped.push(next);
      next = heap.pop();
    }
    expect(popped).toEqual([...values].sort((a, b) => a - b));
  });
});
