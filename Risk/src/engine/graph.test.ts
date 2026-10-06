/**
 * The board graph (R11, R29, R66, R68, R69, R74–R76, R90, R91).
 */
import { describe, expect, it } from "vitest";

import { buildState, splitOwners } from "./__fixtures__/states";
import { classicWorld, mini, tiny4 } from "./__fixtures__/maps";
import {
  activePortals,
  areAdjacent,
  isBlizzard,
  knownTerritory,
  neighbours,
  ownedBy,
  playableTerritories,
  portalActive,
  reachableOwn,
  unclaimed,
} from "./graph";
import type { PortalState } from "./types";

const stable = (a: number, b: number): PortalState => ({ a, b, kind: "stable", activeFrom: 0 });

describe("the fixture graphs", () => {
  it("tiny4 is 4 territories, 1 continent, 6 undirected edges", () => {
    expect(tiny4.territories).toHaveLength(4);
    expect(tiny4.continents).toHaveLength(1);
    const edges = new Set<string>();
    for (const t of tiny4.territories) for (const n of t.adjacent) edges.add([t.index, n].sort((a, b) => a - b).join("-"));
    expect(edges.size).toBe(6);
  });

  it("mini is 6 territories, 2 continents, 7 undirected edges", () => {
    expect(mini.territories).toHaveLength(6);
    expect(mini.continents).toHaveLength(2);
    const edges = new Set<string>();
    for (const t of mini.territories) for (const n of t.adjacent) edges.add([t.index, n].sort((a, b) => a - b).join("-"));
    expect(edges.size).toBe(7);
  });

  it("classic-world is 42 / 6 / 83, with the 9 sea links already unioned in (F45)", () => {
    expect(classicWorld.territories).toHaveLength(42);
    expect(classicWorld.continents).toHaveLength(6);
    const edges = new Set<string>();
    let seaLinkEnds = 0;
    for (const t of classicWorld.territories) {
      for (const n of t.adjacent) edges.add([t.index, n].sort((a, b) => a - b).join("-"));
      seaLinkEnds += t.seaLinked.length;
      for (const n of t.seaLinked) expect(t.adjacent).toContain(n);
    }
    expect(edges.size).toBe(83);
    expect(seaLinkEnds / 2).toBe(9);
  });

  it("R90 — every fixture's adjacency is symmetric", () => {
    for (const map of [tiny4, mini, classicWorld]) {
      for (const t of map.territories) {
        for (const n of t.adjacent) {
          expect((map.territories[n] as { adjacent: readonly number[] }).adjacent).toContain(t.index);
        }
      }
    }
  });

  it("R91 — every adjacency row is sorted ascending", () => {
    for (const map of [tiny4, mini, classicWorld]) {
      for (const row of map.adjacency) {
        expect([...row]).toEqual([...row].sort((a, b) => a - b));
      }
    }
  });

  it("MapDef.adjacency mirrors Territory.adjacent exactly (F45)", () => {
    for (const map of [tiny4, mini, classicWorld]) {
      map.territories.forEach((t, i) => expect(map.adjacency[i]).toEqual(t.adjacent));
    }
  });

  it("classic's suit counts differ by at most one (F7)", () => {
    const counts = { infantry: 0, cavalry: 0, artillery: 0 };
    for (const t of classicWorld.territories) counts[t.suit] += 1;
    const values = Object.values(counts);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });
});

describe("knownTerritory", () => {
  it("accepts an index on the map and rejects everything else", () => {
    expect(knownTerritory(tiny4, 0)).toBe(true);
    expect(knownTerritory(tiny4, 3)).toBe(true);
    expect(knownTerritory(tiny4, 4)).toBe(false);
    expect(knownTerritory(tiny4, -1)).toBe(false);
    expect(knownTerritory(tiny4, 1.5)).toBe(false);
    expect(knownTerritory(tiny4, Number.NaN)).toBe(false);
  });
});

describe("portals as edges", () => {
  it("R75 — a stable portal is active from the first round", () => {
    expect(portalActive(stable(0, 1), 1)).toBe(true);
    expect(portalActive(stable(0, 1), 9)).toBe(true);
  });

  it("R76 — a relocated unstable portal is inactive for the round it moved in", () => {
    const moved: PortalState = { a: 0, b: 3, kind: "unstable", activeFrom: 4 };
    expect(portalActive(moved, 3)).toBe(false);
    expect(portalActive(moved, 4)).toBe(true);
  });

  it("R68 — an active portal adds an edge for both attack and fortify", () => {
    const state = buildState(mini, { owners: [0, 0, 0, 0, 1, 1], portals: [stable(0, 4)] });
    expect(areAdjacent(state, mini, 0, 4)).toBe(true);
    expect(areAdjacent(state, mini, 4, 0)).toBe(true);
    expect(neighbours(state, mini, 0)).toEqual([1, 2, 4]);
  });

  it("an inactive portal adds no edge", () => {
    const state = buildState(mini, {
      owners: [0, 0, 0, 0, 1, 1],
      portals: [{ a: 0, b: 4, kind: "unstable", activeFrom: 5 }],
      round: 3,
    });
    expect(areAdjacent(state, mini, 0, 4)).toBe(false);
    expect(activePortals(state)).toEqual([]);
  });

  it("activePortals lists only this round's conductors", () => {
    const state = buildState(mini, {
      portals: [stable(0, 4), { a: 1, b: 5, kind: "unstable", activeFrom: 7 }],
      round: 3,
    });
    expect(activePortals(state)).toHaveLength(1);
    expect(activePortals(state)[0]?.a).toBe(0);
  });

  it("never reports a territory as its own neighbour", () => {
    const state = buildState(mini, { portals: [{ a: 2, b: 2, kind: "stable", activeFrom: 0 }] });
    expect(neighbours(state, mini, 2)).not.toContain(2);
  });

  it("R90 — adjacency stays symmetric under every portal configuration", () => {
    const configs: PortalState[][] = [[], [stable(0, 4)], [stable(0, 4), stable(1, 5)], [stable(2, 5)]];
    for (const portals of configs) {
      const state = buildState(mini, { portals });
      for (let a = 0; a < mini.territories.length; a++) {
        for (const b of neighbours(state, mini, a)) {
          expect(neighbours(state, mini, b)).toContain(a);
        }
      }
    }
  });
});

describe("reachableOwn", () => {
  it("R66 — multi-hop through the mover's own territories is reachable", () => {
    const state = buildState(mini, { owners: [0, 0, 0, 1, 1, 1] });
    expect(reachableOwn(state, mini, 0, 0)).toEqual([1, 2]);
  });

  it("R69 — a path blocked by an enemy is not reachable, though attack adjacency is unaffected", () => {
    const state = buildState(mini, { owners: [0, 1, 0, 0, 0, 0] });
    // 0 -> 2 directly; 1 is the enemy and is never a path node.
    expect(reachableOwn(state, mini, 0, 0)).toEqual([2, 3, 4, 5]);
    expect(reachableOwn(state, mini, 0, 0)).not.toContain(1);
  });

  it("R74 — a blizzard is never a path node", () => {
    const state = buildState(mini, { owners: [0, 0, 0, 0, 0, 0], blizzards: [2] });
    // mini: l3 (index 2) is the only bridge to the right half.
    expect(reachableOwn(state, mini, 0, 0)).toEqual([1]);
  });

  it("R68 — an active portal is a fortify edge too", () => {
    const state = buildState(mini, { owners: [0, 0, 0, 0, 0, 0], blizzards: [2], portals: [stable(0, 4)] });
    expect(reachableOwn(state, mini, 0, 0)).toEqual([1, 3, 4, 5]);
  });

  it("excludes the source itself and returns ascending ids (R91)", () => {
    const state = buildState(classicWorld, { owners: splitOwners(classicWorld, 1) });
    const out = reachableOwn(state, classicWorld, 5, 0);
    expect(out).not.toContain(5);
    expect([...out]).toEqual([...out].sort((a, b) => a - b));
    expect(out).toHaveLength(41);
  });

  it("returns nothing for an off-map source", () => {
    const state = buildState(mini, { owners: [0, 0, 0, 0, 0, 0] });
    expect(reachableOwn(state, mini, 99, 0)).toEqual([]);
  });
});

describe("board queries", () => {
  it("isBlizzard reads the territory flag", () => {
    const state = buildState(tiny4, { blizzards: [1] });
    expect(isBlizzard(state, 1)).toBe(true);
    expect(isBlizzard(state, 0)).toBe(false);
    expect(isBlizzard(state, 99)).toBe(false);
  });

  it("ownedBy lists a seat's territories ascending", () => {
    const state = buildState(mini, { owners: [1, 0, 1, 0, 1, 0] });
    expect(ownedBy(state, 1)).toEqual([0, 2, 4]);
    expect(ownedBy(state, 0)).toEqual([1, 3, 5]);
  });

  it("unclaimed lists unowned non-blizzard territories (R9)", () => {
    const state = buildState(tiny4, { owners: [0], blizzards: [1] });
    expect(unclaimed(state)).toEqual([2, 3]);
  });

  it("R74 — playableTerritories excludes every blizzard", () => {
    const state = buildState(tiny4, { blizzards: [0, 2] });
    expect(playableTerritories(state)).toEqual([1, 3]);
  });
});
