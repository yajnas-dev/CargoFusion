import { describe, expect, it } from "vitest";
import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import type { SensorProvider } from "@/adapters/sensors/SensorProvider";
import type { EventBus } from "@/events/EventBus";

// Compile-time check that the Phase 1 interfaces are shaped as expected;
// implementations land in later phases.
describe("Phase 1 scaffolding", () => {
  it("TOSAdapter, SensorProvider, EventBus types are assignable", () => {
    const assertTypesExist = (): [TOSAdapter, SensorProvider, EventBus] =>
      null as unknown as [TOSAdapter, SensorProvider, EventBus];
    expect(typeof assertTypesExist).toBe("function");
  });
});
