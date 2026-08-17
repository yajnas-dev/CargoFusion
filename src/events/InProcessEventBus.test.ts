import { describe, expect, it, vi } from "vitest";
import { eventBus } from "@/events/InProcessEventBus";

describe("InProcessEventBus", () => {
  it("delivers a published payload to a subscriber on the same topic", () => {
    const handler = vi.fn();
    const unsubscribe = eventBus.subscribe("test.topic.basic", handler);

    eventBus.publish("test.topic.basic", { foo: "bar" });

    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
    unsubscribe();
  });

  it("does not deliver to subscribers on a different topic", () => {
    const handler = vi.fn();
    const unsubscribe = eventBus.subscribe("test.topic.a", handler);

    eventBus.publish("test.topic.b", { irrelevant: true });

    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("supports multiple subscribers on the same topic", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const unsub1 = eventBus.subscribe("test.topic.multi", handler1);
    const unsub2 = eventBus.subscribe("test.topic.multi", handler2);

    eventBus.publish("test.topic.multi", "payload");

    expect(handler1).toHaveBeenCalledWith("payload");
    expect(handler2).toHaveBeenCalledWith("payload");
    unsub1();
    unsub2();
  });

  it("unsubscribe stops further delivery to that handler only", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const unsub1 = eventBus.subscribe("test.topic.unsub", handler1);
    const unsub2 = eventBus.subscribe("test.topic.unsub", handler2);

    unsub1();
    eventBus.publish("test.topic.unsub", "after-unsub");

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith("after-unsub");
    unsub2();
  });
});
