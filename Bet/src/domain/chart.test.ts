import { describe, expect, it } from "vitest";
import { buildAreaPath, buildLinePath, niceTicks, scale } from "./chart";

describe("scale", () => {
  it("linearly interpolates a value between domain and range", () => {
    expect(scale(5, 0, 10, 0, 100)).toBe(50);
    expect(scale(0, 0, 10, 0, 100)).toBe(0);
    expect(scale(10, 0, 10, 0, 100)).toBe(100);
  });

  it("returns the range midpoint (not NaN) when the domain has zero width", () => {
    expect(scale(0.5, 1, 1, 0, 10)).toBe(5);
    expect(Number.isNaN(scale(0.5, 1, 1, 0, 10))).toBe(false);
  });
});

describe("buildLinePath", () => {
  it("returns an empty string for an empty series", () => {
    expect(buildLinePath([], { width: 100, height: 50, yMin: 0, yMax: 1 })).toBe("");
  });

  it("returns a valid degenerate single-M path for a single point", () => {
    const d = buildLinePath([{ x: 0, y: 0.5 }], { width: 100, height: 50, yMin: 0, yMax: 1 });
    expect(d).toBe("M50,25");
    // A single moveto with no draw commands: valid SVG, renders nothing visible.
    expect(d.split(" ")).toHaveLength(1);
  });

  it("draws a flat line at mid-height when yMin === yMax, never NaN", () => {
    const d = buildLinePath(
      [
        { x: 0, y: 0.3 },
        { x: 10, y: 0.9 },
      ],
      { width: 100, height: 50, yMin: 0.5, yMax: 0.5, xMin: 0, xMax: 10 },
    );
    expect(d).toBe("M0,25 L100,25");
    expect(d).not.toContain("NaN");
  });

  it("sorts unsorted points and preserves duplicate x values in original order", () => {
    const d = buildLinePath(
      [
        { x: 10, y: 1 },
        { x: 0, y: 0 },
        { x: 10, y: 0.5 },
      ],
      { width: 100, height: 100, yMin: 0, yMax: 1, xMin: 0, xMax: 10 },
    );
    expect(d).toBe("M0,100 L100,0 L100,50");
  });

  it("defaults xMin/xMax to the data extent when omitted", () => {
    const d = buildLinePath(
      [
        { x: 2, y: 0 },
        { x: 4, y: 1 },
      ],
      { width: 100, height: 50, yMin: 0, yMax: 1 },
    );
    expect(d).toBe("M0,50 L100,0");
  });
});

describe("buildAreaPath", () => {
  it("returns an empty string for an empty series", () => {
    expect(buildAreaPath([], { width: 100, height: 50, yMin: 0, yMax: 1 })).toBe("");
  });

  it("closes down to the baseline and back for a basic two-point series", () => {
    const d = buildAreaPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 1 },
      ],
      { width: 100, height: 50, yMin: 0, yMax: 1, xMin: 0, xMax: 10 },
    );
    expect(d).toBe("M0,50 L100,0 L100,50 L0,50 Z");
  });

  it("produces a valid closed degenerate shape for a single point", () => {
    const d = buildAreaPath([{ x: 5, y: 0.8 }], { width: 60, height: 20, yMin: 0, yMax: 1 });
    expect(d).toBe("M30,4 L30,20 L30,20 Z");
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("niceTicks", () => {
  it("collapses to a single tick when min === max", () => {
    expect(niceTicks(5, 5, 4)).toEqual([5]);
  });

  it("returns [] for a non-positive tick count", () => {
    expect(niceTicks(0, 10, 0)).toEqual([]);
  });

  it("produces round, evenly spaced ticks spanning the domain", () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("expands past a non-round domain to nice round bounds", () => {
    expect(niceTicks(3, 27, 4)).toEqual([0, 10, 20, 30]);
  });
});
