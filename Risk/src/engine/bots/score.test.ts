/** T8 — bot behaviour: the BSR inversion fixture, `contValue`, hostility, kill value, reserve. */

import { describe, expect, it } from "vitest";

import { SEAT_NEUTRAL, SEAT_NONE } from "@/engine";

import {
  apportion, boardShare, borderContact, bsr, bst, continentFacts, continentsHeld, expectedCardValue,
  hostility, killValue, leaderShare, myBorders, myTerritories, nbsr, normalisedStrength,
  positionValue, rankContinents, reserve, setValue, strength, turtleScore, exposureAfterCapture,
  bestSetOf, isSet, setsIn, expectedIncome, threat, augmentFor, canAttack,
} from "./score";
import { buildMap, card, classicShapedMap, makeTestView, personaAt, smallMap } from "./testFixtures";
import { DEFAULT_WEIGHTS } from "./types";

describe("T8 — Hahn's BSR inversion fixture (F58)", () => {
  /**
   * The worked example: enemy stacks of 7, 4 and 5 adjacent to a territory holding 5 gives
   * `BST = 16` and `BSR = 16/5 = 3.2`; with sibling BSRs of 4 and 1.25, `NBSR = 3.2/8.45 = 0.3787`.
   *
   * Territory 0 is mine with 5 troops and three enemy neighbours (1, 2, 3) holding 7, 4 and 5.
   * Territory 4 is mine with 2 troops against an 8-stack at 5 → BSR 4. Territory 6 is mine with
   * 4 troops against a 5-stack at 7 → BSR 1.25.
   */
  const map = buildMap({
    slug: "hahn",
    names: ["mine-a", "enemy-7", "enemy-4", "enemy-5", "mine-b", "enemy-8", "mine-c", "enemy-5b"],
    edges: [[0, 1], [0, 2], [0, 3], [4, 5], [6, 7], [0, 4], [4, 6]],
    continents: [["All", 3, [0, 1, 2, 3, 4, 5, 6, 7]]],
  });
  const view = makeTestView({
    map,
    persona: personaAt("medium"),
    board: [[0, 5], [1, 7], [1, 4], [1, 5], [0, 2], [1, 8], [0, 4], [1, 5]],
  });

  it("BST = 16", () => {
    expect(bst(view, 0)).toBe(16);
  });

  it("BSR = 3.2 — higher means MORE danger, which is the inversion trap", () => {
    expect(bsr(view, 0)).toBe(3.2);
    // The siblings that make up the published denominator.
    expect(bsr(view, 4)).toBe(4);
    expect(bsr(view, 6)).toBe(1.25);
    expect(3.2 + 4 + 1.25).toBe(8.45);
  });

  it("NBSR = 3.2 / 8.45 = 0.3787, asserted BEFORE any rounding", () => {
    const shares = nbsr(view, DEFAULT_WEIGHTS);
    expect(shares.get(0)).toBeCloseTo(3.2 / 8.45, 15);
    expect(shares.get(0)).toBeCloseTo(0.3787, 4);
    expect(shares.get(4)).toBeCloseTo(4 / 8.45, 15);
    expect(shares.get(6)).toBeCloseTo(1.25 / 8.45, 15);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 15);
  });

  it("the INTEGER split is asserted separately, by largest remainder with leftovers to the top BSR", () => {
    const shares = nbsr(view, DEFAULT_WEIGHTS);
    // 3 troops: exact shares are 1.136 / 1.420 / 0.444 -> floors 1/1/0, one leftover, and the
    // LARGEST REMAINDER is territory 6's 0.444 — not the biggest BSR's 0.136. That is the whole
    // point of largest-remainder rounding, and asserting it on the top-BSR territory instead would
    // pass a proportional-rounding bug.
    const three = apportion(view, shares, 3);
    expect(three.reduce((a, r) => a + r.count, 0)).toBe(3);
    expect(three).toEqual([
      { territory: 0, count: 1 },
      { territory: 4, count: 1 },
      { territory: 6, count: 1 },
    ]);
    // 10 troops: 3.787 / 4.734 / 1.479 -> 3/4/1, two leftovers to the biggest remainders.
    const ten = apportion(view, shares, 10);
    expect(ten.reduce((a, r) => a + r.count, 0)).toBe(10);
    expect(ten).toEqual([
      { territory: 0, count: 4 },
      { territory: 4, count: 5 },
      { territory: 6, count: 1 },
    ]);
  });

  it("`BSR >= 1` is a liability and `BSR <= 0.67` is comfortable", () => {
    expect(bsr(view, 0)).toBeGreaterThanOrEqual(1);
    const calm = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 40], [1, 7], [1, 4], [1, 5], [0, 2], [1, 8], [0, 4], [1, 5]],
    });
    expect(bsr(calm, 0)).toBeLessThanOrEqual(0.67);
  });

  it("zeroes out any BSR below `bsrFloor` before normalising, as Hahn suggested but did not test", () => {
    const quiet = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 5], [1, 7], [1, 4], [1, 5], [0, 100], [1, 8], [0, 4], [1, 5]],
    });
    // Territory 4 now has BSR 0.08, below the 0.35 floor, so it is excluded entirely.
    expect(bsr(quiet, 4)).toBeLessThan(DEFAULT_WEIGHTS.bsrFloor);
    const shares = nbsr(quiet, DEFAULT_WEIGHTS);
    expect(shares.has(4)).toBe(false);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 15);
  });

  it("apportion always distributes exactly `count`, for every count", () => {
    const shares = nbsr(view, DEFAULT_WEIGHTS);
    for (let count = 1; count <= 40; count++) {
      expect(apportion(view, shares, count).reduce((a, r) => a + r.count, 0)).toBe(count);
    }
    expect(apportion(view, shares, 0)).toEqual([]);
  });

  it("BSR is infinite on a territory holding nothing, and such a cell is never apportioned to", () => {
    const empty = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 0], [1, 7], [1, 4], [1, 5], [0, 2], [1, 8], [0, 4], [1, 5]],
    });
    expect(bsr(empty, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(nbsr(empty, DEFAULT_WEIGHTS).has(0)).toBe(false);
  });

  it("`myTerritories` and `myBorders` are ascending and exclude quiet interiors", () => {
    expect(myTerritories(view)).toEqual([0, 4, 6]);
    expect(myBorders(view)).toEqual([0, 4, 6]);
  });
});

describe("T8 — `contValue` with wHold = 2.0 on an empty Classic board", () => {
  const map = classicShapedMap();
  const view = makeTestView({
    map,
    persona: personaAt("medium"),
    board: map.territories.map(() => [SEAT_NONE, 0] as const),
    seats: 2,
  });

  it("the fixture really has Classic's sizes, bonuses and border counts", () => {
    const shape = map.continents.map((c) => [c.name, c.territories.length, c.bonus, c.border.length]);
    expect(shape).toEqual([
      ["North America", 9, 5, 3],
      ["South America", 4, 2, 2],
      ["Africa", 6, 3, 3],
      ["Europe", 7, 5, 4],
      ["Asia", 12, 7, 5],
      ["Australia", 4, 2, 1],
    ]);
  });

  it("ranks Australia and North America joint-first at 0.333", () => {
    const facts = new Map(map.continents.map((c) => [c.name, continentFacts(view, c.index)]));
    expect((facts.get("Australia") as { value: number }).value).toBeCloseTo(2 / (4 + 2), 10);
    expect((facts.get("Australia") as { value: number }).value).toBeCloseTo(0.333, 3);
    expect((facts.get("North America") as { value: number }).value).toBeCloseTo(5 / (9 + 6), 10);
    expect((facts.get("North America") as { value: number }).value).toBeCloseTo(0.333, 3);
    expect((facts.get("South America") as { value: number }).value).toBeCloseTo(2 / (4 + 4), 10);
    expect((facts.get("Africa") as { value: number }).value).toBeCloseTo(3 / (6 + 6), 10);
    expect((facts.get("Europe") as { value: number }).value).toBeCloseTo(5 / (7 + 8), 10);
    expect((facts.get("Asia") as { value: number }).value).toBeCloseTo(7 / (12 + 10), 10);
  });

  it("the top of the ranking is Australia, North America, Europe — never Europe alone", () => {
    const ranked = rankContinents(view).map((f) => map.continents[f.id]?.name);
    expect(ranked.slice(0, 3).sort()).toEqual(["Australia", "Europe", "North America"]);
    expect(ranked[ranked.length - 1]).not.toBe("Australia");
  });

  it("bonus-per-territory alone ranks Europe first, which is the bug this test exists to catch", () => {
    const perTerritory = map.continents
      .map((c) => ({ name: c.name, value: c.bonus / c.territories.length }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    expect(perTerritory[0]?.name).toBe("Europe");
    // And Australia is joint-last on that denominator.
    expect(perTerritory[perTerritory.length - 1]?.value).toBe(0.5);
  });

  it("the hold-cost term is what stops Europe and Asia looking cheap", () => {
    const europe = continentFacts(view, 3);
    expect(europe.holdCost).toBe(8);
    expect(europe.acquireCost).toBe(7);
    // Turning wHold off reverses the ranking entirely.
    const noHold = { ...DEFAULT_WEIGHTS, wHold: 0 };
    const ranked = rankContinents(view, noHold).map((f) => map.continents[f.id]?.name);
    expect(ranked[0]).toBe("Europe");
  });

  it("an occupied territory raises `acquireCost` by `1 + enemyTroops * wAcquire`", () => {
    const contested = makeTestView({
      map, persona: personaAt("medium"), seats: 2,
      board: map.territories.map((t) => (t.continent === 5 ? [1, 10] as const : [SEAT_NONE, 0] as const)),
    });
    const australia = continentFacts(contested, 5);
    expect(australia.acquireCost).toBeCloseTo(4 * (1 + 10 * DEFAULT_WEIGHTS.wAcquire), 10);
    expect(australia.value).toBeLessThan(continentFacts(view, 5).value);
  });
});

describe("continents held, and the whole-board evaluator", () => {
  const map = smallMap();

  it("holds a continent only when every territory is mine", () => {
    const all = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 3], [0, 3], [0, 3], [1, 3], [1, 3], [1, 3]],
    });
    expect(continentsHeld(all, 0)).toEqual([0]);
    expect(continentsHeld(all, 1)).toEqual([1]);
    const broken = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 3], [0, 3], [1, 3], [1, 3], [1, 3], [1, 3]],
    });
    expect(continentsHeld(broken, 0)).toEqual([]);
  });

  it("`expectedIncome` is max(3, floor(t/3)) + bonuses + expectedCardValue", () => {
    const view = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 3], [0, 3], [0, 3], [1, 3], [1, 3], [1, 3]],
    });
    // 3 territories -> max(3, 1) = 3, plus West's bonus of 2.
    expect(expectedIncome(view, 0)).toBeCloseTo(3 + 2 + expectedCardValue(view, 0), 10);
  });

  it("`positionValue` gives leader-targeting for free, with no special-case rule", () => {
    const even = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 3], [0, 3], [0, 3], [1, 3], [1, 3], [1, 3]],
    });
    expect(positionValue(even)).toBeCloseTo(-1, 10); // East's bonus is 3, West's is 2
    const ahead = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 3], [0, 3], [0, 3], [0, 3], [1, 3], [1, 3]],
    });
    expect(positionValue(ahead)).toBeGreaterThan(positionValue(even));
  });

  it("`boardShare` and `leaderShare` measure what the domination condition measures", () => {
    const view = makeTestView({
      map, persona: personaAt("medium"),
      board: [[0, 3], [0, 3], [0, 3], [0, 3], [1, 3], [1, 3]],
    });
    expect(boardShare(view, 0)).toBeCloseTo(4 / 6, 10);
    expect(leaderShare(view)).toBeCloseTo(2 / 6, 10);
  });
});

describe("opponent modelling", () => {
  const map = smallMap();
  const view = makeTestView({
    map, persona: personaAt("medium"), seats: 3,
    board: [[0, 5], [0, 1], [1, 20], [1, 2], [2, 3], [2, 3]],
    grudge: [0, 0, 12],
  });

  it("Knudsen's `H(p) = armies + 0.3*territories + continentBonuses`", () => {
    expect(strength(view, 0)).toBeCloseTo(6 + 0.6, 10);
    expect(strength(view, 1)).toBeCloseTo(22 + 0.6, 10);
    const total = strength(view, 0) + strength(view, 1) + strength(view, 2);
    expect(normalisedStrength(view, 1)).toBeCloseTo(strength(view, 1) / total, 10);
  });

  it("`turtleScore` is mean troops per border territory — don't poke a turtle", () => {
    // Seat 1 holds territory 2 (20 troops) and 3 (2), both bordering someone else.
    expect(turtleScore(view, 1)).toBeCloseTo(11, 10);
  });

  it("`borderContact` is the share of my border facing that seat", () => {
    expect(borderContact(view, 1) + borderContact(view, 2)).toBeCloseTo(1, 10);
  });

  it("hostility rises with a grudge and falls for an ally", () => {
    const base = hostility(view, 2);
    const noGrudge = makeTestView({ ...{
      map, persona: personaAt("medium"), seats: 3,
      board: [[0, 5], [0, 1], [1, 20], [1, 2], [2, 3], [2, 3]] as const,
    } });
    expect(base).toBeGreaterThan(hostility(noGrudge, 2));

    const allied = makeTestView({
      map, persona: personaAt("medium"), seats: 3, allies: [2],
      board: [[0, 5], [0, 1], [1, 20], [1, 2], [2, 3], [2, 3]],
      rules: { alliances: true },
    });
    expect(hostility(allied, 2)).toBeLessThan(hostility(noGrudge, 2));
  });

  it("the turtle term makes a well-defended seat a worse target", () => {
    const soft = makeTestView({
      map, persona: personaAt("medium"), seats: 3,
      board: [[0, 5], [0, 1], [1, 2], [1, 2], [2, 3], [2, 3]],
    });
    const hard = makeTestView({
      map, persona: personaAt("medium"), seats: 3,
      board: [[0, 5], [0, 1], [1, 40], [1, 40], [2, 3], [2, 3]],
    });
    expect(turtleScore(hard, 1)).toBeGreaterThan(turtleScore(soft, 1));
  });

  it("an eliminated seat is not an opponent and does not dilute a share", () => {
    const view2 = makeTestView({
      map, persona: personaAt("medium"), seats: 3,
      board: [[0, 5], [0, 1], [1, 20], [1, 2], [1, 3], [1, 3]],
      standing: ["active", "active", "eliminated"],
    });
    expect(normalisedStrength(view2, 2)).toBe(0);
  });
});

describe("card pricing, and `killValue`", () => {
  const map = smallMap();

  it("Fixed values are 4 / 6 / 8 and 10 for a mixed set or anything with a Wild (R22)", () => {
    expect(setValue([card("a", "infantry"), card("b", "infantry"), card("c", "infantry")], 0, "fixed")).toBe(4);
    expect(setValue([card("a", "cavalry"), card("b", "cavalry"), card("c", "cavalry")], 0, "fixed")).toBe(6);
    expect(setValue([card("a", "artillery"), card("b", "artillery"), card("c", "artillery")], 0, "fixed")).toBe(8);
    expect(setValue([card("a", "infantry"), card("b", "cavalry"), card("c", "artillery")], 0, "fixed")).toBe(10);
    expect(setValue([card("a", "wild"), card("b", "cavalry"), card("c", "cavalry")], 0, "fixed")).toBe(10);
  });

  it("the Progressive ladder is 4,6,8,10,12,15 then +5 forever (R22)", () => {
    const triple = [card("a", "infantry"), card("b", "cavalry"), card("c", "artillery")];
    const ladder = Array.from({ length: 10 }, (_, n) => setValue(triple, n, "progressive"));
    expect(ladder).toEqual([4, 6, 8, 10, 12, 15, 20, 25, 30, 35]);
  });

  it("`isSet` accepts three of a kind, one of each, and any triple with a Wild", () => {
    expect(isSet([card("a", "infantry"), card("b", "infantry"), card("c", "infantry")])).toBe(true);
    expect(isSet([card("a", "infantry"), card("b", "cavalry"), card("c", "artillery")])).toBe(true);
    expect(isSet([card("a", "wild"), card("b", "infantry"), card("c", "cavalry")])).toBe(true);
    expect(isSet([card("a", "infantry"), card("b", "infantry"), card("c", "cavalry")])).toBe(false);
    expect(isSet([card("a", "infantry")])).toBe(false);
  });

  it("`setsIn` and `bestSetOf` pick the highest-value legal set", () => {
    const hand = [
      card("a", "artillery"), card("b", "artillery"), card("c", "artillery"),
      card("d", "infantry"),
    ];
    expect(setsIn(hand)).toEqual([[0, 1, 2]]);
    expect(bestSetOf(hand, 0, "fixed")?.value).toBe(8);
    const mixed = [card("a", "infantry"), card("b", "cavalry"), card("c", "artillery"), card("d", "infantry")];
    expect(bestSetOf(mixed, 0, "fixed")?.value).toBe(10);
  });

  it("`killValue` includes the seized hand only when the persona sees it (R20)", () => {
    const board = [[0, 5], [0, 5], [1, 1], [2, 5], [2, 5], [2, 5]] as const;
    const hand = [card("a", "infantry"), card("b", "cavalry")];
    const blind = makeTestView({
      map, persona: personaAt("easy"), seats: 3, board, myCards: hand, cardCount: [2, 3, 0],
    });
    expect(blind.persona.seesKillForCards).toBe(false);
    expect(killValue(blind, 1)).toBe(1); // their one territory, and nothing else

    const seeing = makeTestView({
      map, persona: personaAt("hard"), seats: 3, board, myCards: hand, cardCount: [2, 3, 0],
    });
    expect(seeing.persona.seesKillForCards).toBe(true);
    expect(killValue(seeing, 1)).toBeGreaterThan(killValue(blind, 1));
  });

  it("`killValue` prices nothing extra when the combined hand cannot make a set", () => {
    const view = makeTestView({
      map, persona: personaAt("hard"), seats: 3,
      board: [[0, 5], [0, 5], [1, 1], [2, 5], [2, 5], [2, 5]],
      myCards: [card("a", "infantry")], cardCount: [1, 0, 0],
    });
    expect(killValue(view, 1)).toBe(1);
  });
});

describe("reserve, exposure, threat and legality", () => {
  const map = smallMap();
  const view = makeTestView({
    map, persona: personaAt("hard"),
    board: [[0, 10], [0, 2], [0, 4], [1, 9], [1, 3], [1, 3]],
  });

  it("`reserve(t) = max(reserveFloor, ceil(maxAdjacentEnemyStack * tierReserveFactor))`", () => {
    // Territory 2 borders territory 3, which holds 9. Hard's tierReserveFactor is 1.0.
    expect(view.persona.tierReserveFactor).toBe(1);
    expect(reserve(view, 2)).toBe(Math.max(view.persona.reserveFloor, 9));
  });

  it("the assassin's floor really is Killbot's published 20", () => {
    // The assassin is in Expert's pool only — Hard draws turtle / opportunist / continental /
    // hoarder / rusher — so this has to be drawn at Expert to be the real folded persona.
    const persona = personaAt("expert", {}, "assassin");
    expect(persona.name).toBe("assassin");
    expect(persona.reserveFloor).toBe(20);
    const assassin = makeTestView({
      map, persona,
      board: [[0, 10], [0, 2], [0, 4], [1, 1], [1, 3], [1, 3]],
    });
    // The biggest adjacent enemy stack is 1, so the floor is what decides — and it is 20.
    expect(reserve(assassin, 2)).toBe(20);
  });

  it("a quiet interior needs only the floor", () => {
    expect(reserve(view, 0)).toBe(view.persona.reserveFloor);
  });

  it("`exposureAfterCapture` is the enemy weight adjacent to the prize once I hold it", () => {
    // Territory 3 borders 2 (mine), 4 and 5 (enemy, 3 each).
    expect(exposureAfterCapture(view, 3)).toBe(6);
  });

  it("`threat` weights a border of a continent I hold up by half again", () => {
    const holding = makeTestView({
      map, persona: personaAt("hard"),
      board: [[0, 10], [0, 2], [0, 4], [1, 9], [1, 3], [1, 3]],
    });
    expect(continentsHeld(holding, 0)).toEqual([0]);
    expect(threat(holding, 2)).toBeCloseTo(bst(holding, 2) * 1.5, 10);
  });

  it("R29: attacks need 2+ troops, an adjacent enemy, and never target a blizzard", () => {
    expect(canAttack(view, 2, 3)).toBe(true);
    expect(canAttack(view, 1, 3)).toBe(false);   // not adjacent
    expect(canAttack(view, 2, 0)).toBe(false);   // my own
    const thin = makeTestView({
      map, persona: personaAt("hard"),
      board: [[0, 10], [0, 2], [0, 1], [1, 9], [1, 3], [1, 3]],
    });
    expect(canAttack(thin, 2, 3)).toBe(false);   // only 1 troop
  });

  it("the neutral holding is attackable, an ally is not (R7, R29, R80)", () => {
    const neutral = makeTestView({
      map, persona: personaAt("hard"), seats: 2,
      board: [[0, 10], [0, 2], [0, 4], [SEAT_NEUTRAL, 9], [1, 3], [1, 3]],
    });
    expect(canAttack(neutral, 2, 3)).toBe(true);
    const allied = makeTestView({
      map, persona: personaAt("hard"), seats: 2, allies: [1],
      board: [[0, 10], [0, 2], [0, 4], [1, 9], [1, 3], [1, 3]],
      rules: { alliances: true },
    });
    expect(canAttack(allied, 2, 3)).toBe(false);
  });

  it("R36: a capital on the target contributes +1 defender die, and nothing otherwise", () => {
    const capitals = makeTestView({
      map, persona: personaAt("hard"), seats: 2, capital: [0, 3],
      board: [[0, 10], [0, 2], [0, 4], [1, 9], [1, 3], [1, 3]],
      rules: { capitals: true },
    });
    expect(augmentFor(capitals, 3).defendDiceBonus).toBe(1);
    expect(augmentFor(capitals, 4).defendDiceBonus).toBe(0);
    expect(augmentFor(view, 3).defendDiceBonus).toBe(0); // capitals off
  });
});
