/**
 * Array-backed binary min-heap, keyed by a priority function. Used by
 * astar.ts's open-set instead of the previous linear scan for the lowest
 * f-score node — fine at the seeded yard's scale (dozens of nodes), but a
 * real scaling risk for a larger graph.
 *
 * No decrease-key: a plain binary heap can't update an existing entry's
 * priority in O(log n). Callers push a new entry whenever a shorter path
 * to a node is found rather than mutating the old one; pop() callers must
 * discard any popped entry that's gone stale (see astar.ts).
 */
export class MinHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly priority: (item: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priority(this.items[i]) >= this.priority(this.items[parent])) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private bubbleDown(index: number): void {
    let i = index;
    const n = this.items.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      let smallest = i;
      if (left < n && this.priority(this.items[left]) < this.priority(this.items[smallest])) smallest = left;
      if (right < n && this.priority(this.items[right]) < this.priority(this.items[smallest])) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = tmp;
  }
}
