import { describe, expect, it } from "vitest";

import { LEVEL_IDS } from "./levels";
import {
  OVERWORLD_BRIDGES,
  OVERWORLD_ISLANDS,
  OVERWORLD_NODES,
  OVERWORLD_PATH,
  OVERWORLD_PROPS,
  nodeFor,
} from "./overworld";

function inUnit(p: { x: number; y: number }) {
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x).toBeLessThanOrEqual(1);
  expect(p.y).toBeGreaterThanOrEqual(0);
  expect(p.y).toBeLessThanOrEqual(1);
}

/** Ray-casting point-in-polygon. */
function inside(p: { x: number; y: number }, poly: readonly { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

describe("overworld", () => {
  it("has one node per level, in level order, all inside the unit square", () => {
    expect(OVERWORLD_NODES.map((n) => n.levelId)).toEqual([...LEVEL_IDS]);
    for (const n of OVERWORLD_NODES) inUnit(n);
    for (const p of OVERWORLD_PATH) inUnit(p);
    for (const p of OVERWORLD_PROPS) inUnit(p);
    for (const island of OVERWORLD_ISLANDS) for (const p of island) inUnit(p);
  });

  it("nodes sit on the path and progress along it", () => {
    let last = -1;
    for (const n of OVERWORLD_NODES) {
      expect(n.pathIndex).toBeGreaterThan(last);
      last = n.pathIndex;
      expect(OVERWORLD_PATH[n.pathIndex]).toEqual({ x: n.x, y: n.y });
    }
    expect(OVERWORLD_NODES[0]!.pathIndex).toBe(0);
    expect(OVERWORLD_NODES[11]!.pathIndex).toBe(OVERWORLD_PATH.length - 1);
  });

  it("levels climb the island from south to north over three sections and two bridges", () => {
    expect(OVERWORLD_ISLANDS).toHaveLength(3);
    expect(OVERWORLD_BRIDGES).toHaveLength(2);
    for (const n of OVERWORLD_NODES) {
      expect(inside(n, OVERWORLD_ISLANDS[n.section]!)).toBe(true);
    }
    expect(OVERWORLD_NODES.filter((n) => n.section === 0)).toHaveLength(4);
    expect(OVERWORLD_NODES.filter((n) => n.section === 1)).toHaveLength(4);
    expect(OVERWORLD_NODES.filter((n) => n.section === 2)).toHaveLength(4);
    expect(OVERWORLD_NODES[0]!.y).toBeGreaterThan(OVERWORLD_NODES[11]!.y);
  });

  it("nodes are spread out (no two closer than 0.05)", () => {
    for (let i = 0; i < OVERWORLD_NODES.length; i++) {
      for (let j = i + 1; j < OVERWORLD_NODES.length; j++) {
        const a = OVERWORLD_NODES[i]!;
        const b = OVERWORLD_NODES[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.05);
      }
    }
  });

  it("nodeFor", () => {
    expect(nodeFor("07")?.levelId).toBe("07");
    expect(nodeFor("nope")).toBeUndefined();
  });
});
