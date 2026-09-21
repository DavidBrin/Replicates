import { describe, expect, it } from "vitest";

import { DRAG_THRESHOLD_PX, GestureTracker, classifyKey, wheelZoomFactor } from "./input";

describe("GestureTracker", () => {
  it("classifies a press and release without movement as a tap", () => {
    const t = new GestureTracker();
    t.down(1, 100, 100);
    expect(t.move(1, 102, 101)).toEqual([]);
    expect(t.up(1, 102, 101)).toEqual([{ type: "tap", x: 102, y: 101 }]);
  });

  it("stays a tap under the 6 px threshold and becomes a pan past it", () => {
    const t = new GestureTracker();
    t.down(1, 0, 0);
    expect(t.move(1, DRAG_THRESHOLD_PX - 1, 0)).toEqual([]);
    const past = t.move(1, DRAG_THRESHOLD_PX + 4, 0);
    expect(past).toEqual([{ type: "pan", dx: DRAG_THRESHOLD_PX + 4, dy: 0 }]);
    expect(t.move(1, DRAG_THRESHOLD_PX + 7, 2)).toEqual([{ type: "pan", dx: 3, dy: 2 }]);
    // a drag never ends in a tap
    expect(t.up(1, DRAG_THRESHOLD_PX + 7, 2)).toEqual([]);
  });

  it("emits a pinch (and centre pan) for two pointers and never a tap", () => {
    const t = new GestureTracker();
    t.down(1, 100, 100);
    t.down(2, 200, 100);
    const g = t.move(2, 300, 100);
    const pinch = g.find((x) => x.type === "pinch");
    expect(pinch).toBeDefined();
    if (pinch?.type === "pinch") {
      expect(pinch.factor).toBeCloseTo(2);
      expect(pinch.cx).toBe(200);
      expect(pinch.cy).toBe(100);
    }
    const pan = g.find((x) => x.type === "pan");
    expect(pan).toEqual({ type: "pan", dx: 50, dy: 0 });
    expect(t.up(2, 300, 100)).toEqual([]);
    expect(t.up(1, 100, 100)).toEqual([]);
  });

  it("pinching inward yields a factor below one", () => {
    const t = new GestureTracker();
    t.down(1, 0, 0);
    t.down(2, 100, 0);
    const g = t.move(2, 50, 0);
    const pinch = g.find((x) => x.type === "pinch");
    expect(pinch?.type === "pinch" && pinch.factor).toBeCloseTo(0.5);
  });

  it("resets cleanly after a cancel", () => {
    const t = new GestureTracker();
    t.down(1, 0, 0);
    t.move(1, 50, 50);
    t.cancel(1);
    expect(t.activePointers).toBe(0);
    t.down(1, 10, 10);
    expect(t.up(1, 10, 10)).toEqual([{ type: "tap", x: 10, y: 10 }]);
  });
});

describe("keyboard", () => {
  it("maps the documented shortcuts", () => {
    expect(classifyKey("Escape", "Escape")).toEqual({ type: "escape" });
    expect(classifyKey("z", "KeyZ")).toEqual({ type: "undo" });
    expect(classifyKey("Enter", "Enter")).toEqual({ type: "nextDay" });
    expect(classifyKey("ArrowLeft", "ArrowLeft")?.type).toBe("pan");
    expect(classifyKey("w", "KeyW")).toEqual({ type: "pan", dx: 0, dy: 48 });
    expect(classifyKey("+", "Equal")).toEqual({ type: "zoom", factor: 1.2 });
    expect(classifyKey("-", "Minus")?.type).toBe("zoom");
    expect(classifyKey("q", "KeyQ")).toBeNull();
  });

  it("wheel up zooms in, wheel down zooms out", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});
