/**
 * §8's two path languages: one curved attack arrow with a solid head, and the
 * deliberately different fortify chevrons marching source → destination.
 */
import { describe, expect, it } from "vitest";

import {
  arrowHeadPath,
  attackArrowPath,
  BOW,
  CHEVRON_PITCH,
  createArrowLayer,
  fortifyChevrons,
  HEAD_SIZE,
} from "./arrows";

type Pt = readonly [number, number];

function numbers(d: string): number[] {
  return (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
}

describe("attackArrowPath", () => {
  it("is a single quadratic from `from` to `to`", () => {
    expect(attackArrowPath([10, 20], [110, 20])).toBe("M 10 20 Q 60 42 110 20");
  });

  it("offsets the control point 22% of the chord, perpendicular to it", () => {
    const cases: readonly (readonly [Pt, Pt])[] = [
      [[0, 0], [100, 0]],
      [[0, 0], [0, 240]],
      [[400, 120], [130, 460]],
      [[-80, 300], [260, -40]],
    ];
    for (const [from, to] of cases) {
      const [, , cx, cy] = numbers(attackArrowPath(from, to)) as [number, number, number, number];
      const chord: Pt = [to[0] - from[0], to[1] - from[1]];
      const length = Math.hypot(chord[0], chord[1]);
      const mid: Pt = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const offset: Pt = [cx - mid[0], cy - mid[1]];
      // 22% of the chord long …
      expect(Math.hypot(offset[0], offset[1])).toBeCloseTo(BOW * length, 6);
      // … and square to it.
      expect(offset[0] * chord[0] + offset[1] * chord[1]).toBeCloseTo(0, 6);
    }
  });

  it("degenerates to a point rather than dividing by zero", () => {
    expect(attackArrowPath([50, 50], [50, 50])).toBe("M 50 50 Q 50 50 50 50");
  });
});

describe("arrowHeadPath", () => {
  it("puts the tip on `to` and closes a 22 px triangle", () => {
    const d = arrowHeadPath([0, 0], [200, 0]);
    const [tipX, tipY, ...rest] = numbers(d) as [number, number, ...number[]];
    expect([tipX, tipY]).toEqual([200, 0]);
    expect(d.endsWith("Z")).toBe(true);
    const [b1x, b1y, b2x, b2y] = rest as [number, number, number, number];
    // The base is HEAD_SIZE behind the tip and HEAD_SIZE wide across.
    const baseMid: Pt = [(b1x + b2x) / 2, (b1y + b2y) / 2];
    // Paths are emitted rounded to 3 decimals, so 2 is the honest precision.
    expect(Math.hypot(tipX - baseMid[0], tipY - baseMid[1])).toBeCloseTo(HEAD_SIZE, 2);
    expect(Math.hypot(b1x - b2x, b1y - b2y)).toBeCloseTo(HEAD_SIZE, 2);
  });

  it("orients along the curve's end tangent, not the chord", () => {
    const from: Pt = [0, 0];
    const to: Pt = [300, 0];
    const [, , cx, cy] = numbers(attackArrowPath(from, to)) as [number, number, number, number];
    const [tipX, tipY, b1x, b1y, b2x, b2y] = numbers(arrowHeadPath(from, to)) as [
      number, number, number, number, number, number,
    ];
    const axis: Pt = [tipX - (b1x + b2x) / 2, tipY - (b1y + b2y) / 2];
    const tangent: Pt = [to[0] - cx, to[1] - cy];
    const cross =
      (axis[0] * tangent[1] - axis[1] * tangent[0]) /
      (Math.hypot(axis[0], axis[1]) * Math.hypot(tangent[0], tangent[1]));
    expect(cross).toBeCloseTo(0, 4);
    expect(axis[0] * tangent[0] + axis[1] * tangent[1]).toBeGreaterThan(0);
    // The bow is real: the tangent is not the chord.
    expect(Math.abs(axis[1])).toBeGreaterThan(1);
  });

  it("takes a custom head size", () => {
    const [tipX, , b1x, b1y, b2x, b2y] = numbers(arrowHeadPath([0, 0], [100, 0], 40)) as [
      number, number, number, number, number, number,
    ];
    expect(Math.hypot(b1x - b2x, b1y - b2y)).toBeCloseTo(40, 2);
    expect(tipX).toBe(100);
  });
});

describe("fortifyChevrons", () => {
  it("marches at 34 px pitch along a straight leg", () => {
    const chevrons = fortifyChevrons([[0, 0], [100, 0]]);
    expect(chevrons).toHaveLength(3);
    expect(chevrons.map((c) => c.at[0])).toEqual([0, 34, 68]);
    expect(chevrons.every((c) => Math.abs(c.at[1]) < 1e-9)).toBe(true);
    expect(chevrons.every((c) => c.angle === 0)).toBe(true);
  });

  it("honours a custom pitch, and starts at the source", () => {
    const chevrons = fortifyChevrons([[20, 5], [20, 105]], 25);
    expect(chevrons.map((c) => c.at[1])).toEqual([5, 30, 55, 80, 105]);
    expect(chevrons[0]?.at).toEqual([20, 5]);
    expect(chevrons[0]?.angle).toBeCloseTo(90, 6);
  });

  it("keeps the pitch around the corner of an L-shaped chain", () => {
    const chevrons = fortifyChevrons([[0, 0], [100, 0], [100, 100]]);
    expect(chevrons.length).toBeGreaterThanOrEqual(5);
    expect(chevrons[0]?.at[0]).toBeCloseTo(0, 6);
    // The spline already leans toward the corner as it leaves the source, so
    // the first chevron is a couple of degrees off the leg, not exactly on it.
    expect(Math.abs(chevrons[0]?.angle ?? 99)).toBeLessThan(5);
    for (let i = 1; i < chevrons.length; i += 1) {
      const a = chevrons[i - 1]?.at as Pt;
      const b = chevrons[i]?.at as Pt;
      // Chord, not arc: a chevron that rounds the corner sits slightly closer.
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeGreaterThan(CHEVRON_PITCH - 3);
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(CHEVRON_PITCH + 1e-6);
    }
    // It really does turn the corner: the last chevron points down the second leg.
    expect(chevrons[chevrons.length - 1]?.angle).toBeGreaterThan(60);
  });

  it("returns nothing for a degenerate chain", () => {
    expect(fortifyChevrons([[0, 0]])).toEqual([]);
    expect(fortifyChevrons([])).toEqual([]);
    expect(fortifyChevrons([[0, 0], [10, 0]], 0)).toEqual([]);
  });
});

describe("arrow layer", () => {
  it("shows an attack as outline + body + head, all on the same curve", () => {
    const layer = createArrowLayer();
    layer.showAttack([0, 0], [120, 60]);
    const d = attackArrowPath([0, 0], [120, 60]);
    expect(layer.element.querySelector(".attack-outline")?.getAttribute("d")).toBe(d);
    expect(layer.element.querySelector(".attack-body")?.getAttribute("d")).toBe(d);
    expect(layer.element.querySelector(".attack-head")?.getAttribute("d")).toBe(
      arrowHeadPath([0, 0], [120, 60]),
    );
    expect(layer.element.querySelector('.attack-body[data-hidden="1"]')).toBeNull();
  });

  it("lays out one transformed chevron per step", () => {
    const layer = createArrowLayer();
    layer.showFortify([[0, 0], [100, 0]]);
    const chevrons = layer.element.querySelectorAll(".chevron");
    expect(chevrons).toHaveLength(3);
    expect(chevrons[1]?.getAttribute("transform")).toBe("translate(34 0) rotate(0)");
    expect(chevrons[1]?.getAttribute("d")).toBe("M -8 -13 L 8 0 L -8 13");
    // Re-showing replaces rather than accumulates.
    layer.showFortify([[0, 0], [40, 0]]);
    expect(layer.element.querySelectorAll(".chevron")).toHaveLength(2);
  });

  it("clear() empties the group and parks the arrow", () => {
    const layer = createArrowLayer();
    layer.showAttack([0, 0], [100, 0]);
    layer.showFortify([[0, 0], [100, 0]]);
    layer.clear();
    expect(layer.element.querySelectorAll(".chevron")).toHaveLength(0);
    expect(layer.element.querySelector("g.chevrons")?.children).toHaveLength(0);
    for (const selector of [".attack-outline", ".attack-body", ".attack-head"]) {
      const node = layer.element.querySelector(selector);
      expect(node?.hasAttribute("d")).toBe(false);
      expect(node?.getAttribute("data-hidden")).toBe("1");
    }
  });

  it("destroy detaches the layer", () => {
    const layer = createArrowLayer();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    svg.appendChild(layer.element);
    expect(svg.querySelector("g.risk-arrows")).toBe(layer.element);
    layer.destroy();
    expect(svg.querySelector("g.risk-arrows")).toBeNull();
  });
});
