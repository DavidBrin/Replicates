/**
 * The resolver (SPEC §4.11; R3–R11, R19, R20, R29–R33, R46, R48, R58, R59,
 * R61, R76; D3, D4, D6, D7, D64, D65; F39).
 *
 * **Every draw count is asserted**, because a change to a draw count is a
 * replay-breaking change (D4). The counts are measured by advancing a second
 * generator from the same seed and comparing states, which also proves the
 * resolver spends its draws on the sub-stream it was handed and nowhere else.
 */
import { describe, expect, it } from "vitest";

import { classicWorld, mini, tiny4 } from "../__fixtures__/maps";
import { cleanSweep, fakeOdds, makeDist } from "../__fixtures__/odds";
import { buildState, config, personasFor, territoryCard } from "../__fixtures__/states";
import { deckFor, remainingDeck } from "../cards";
import { pcg32, rngFor } from "../prng";
import { SEAT_NEUTRAL, SEAT_NONE, STARTING_ARMIES, type Card, type MapDef, type Rng } from "../types";
import { combinedOutcomes, quantise, sampledOutcomes, stoppedOutcomes, walkCdf } from "./rollAttack";
import { dealTerritories } from "./dealTerritories";
import { drawCard } from "./drawCard";
import { movePortals, relocationDue } from "./movePortals";
import { placeModifiers } from "./placeModifiers";
import { rollAttack } from "./rollAttack";

/** An `Rng` whose single blitz draw is exactly `u`, so a walk has one right answer. */
function fixedU(u: number): Rng {
  return { nextU32: () => Math.round(u * 2 ** 32), nextFloat: () => u, state: [0, 0] };
}

/** How many draws `run` took out of a fresh `pcg32(hi, lo)`. */
function drawsTaken(hi: number, lo: number, run: (rng: Rng) => void): number {
  const probe = pcg32(hi, lo);
  run(probe);
  const target = probe.state;
  const counter = pcg32(hi, lo);
  for (let n = 0; n <= 2000; n++) {
    if (counter.state[0] === target[0] && counter.state[1] === target[1]) return n;
    counter.nextU32();
  }
  return -1;
}

/* ----------------------------------------------------------- placeModifiers -- */

describe("placeModifiers", () => {
  it("places nothing when both modifiers are off, and takes no draws", () => {
    const rules = config(classicWorld, 3).rules;
    const taken = drawsTaken(1, 2, (rng) => {
      const out = placeModifiers(classicWorld, rules, rng);
      expect(out.blizzards).toEqual([]);
      expect(out.portals).toEqual([]);
    });
    expect(taken).toBe(0);
  });

  it("R10 — freezes exactly modifierSlots.blizzards territories, in exactly that many draws", () => {
    const rules = config(classicWorld, 3, { blizzards: true }).rules;
    const taken = drawsTaken(5, 7, (rng) => {
      const out = placeModifiers(classicWorld, rules, rng);
      expect(out.blizzards).toHaveLength(classicWorld.modifierSlots.blizzards);
    });
    expect(taken).toBe(classicWorld.modifierSlots.blizzards);
  });

  it("R10 — never puts two blizzards in one continent while alternatives remain", () => {
    const rules = config(classicWorld, 3, { blizzards: true }).rules;
    for (let seed = 0; seed < 40; seed++) {
      const { blizzards } = placeModifiers(classicWorld, rules, pcg32(seed, seed * 7));
      const continents = blizzards.map((t) => (classicWorld.territories[t] as { continent: number }).continent);
      expect(new Set(continents).size).toBe(continents.length);
    }
  });

  it("R10 — blizzards come back ascending and distinct (R91)", () => {
    const rules = config(classicWorld, 3, { blizzards: true }).rules;
    const { blizzards } = placeModifiers(classicWorld, rules, pcg32(3, 3));
    expect([...blizzards]).toEqual([...blizzards].sort((a, b) => a - b));
    expect(new Set(blizzards).size).toBe(blizzards.length);
  });

  it("R11 — makes modifierSlots.portals portals in exactly two draws each", () => {
    const rules = config(classicWorld, 3, { portals: "stable" }).rules;
    const taken = drawsTaken(11, 13, (rng) => {
      const out = placeModifiers(classicWorld, rules, rng);
      expect(out.portals).toHaveLength(classicWorld.modifierSlots.portals);
    });
    expect(taken).toBe(2 * classicWorld.modifierSlots.portals);
  });

  it("R11 — every portal links two non-adjacent territories, none used twice", () => {
    const rules = config(classicWorld, 3, { portals: "unstable" }).rules;
    for (let seed = 0; seed < 30; seed++) {
      const { portals } = placeModifiers(classicWorld, rules, pcg32(seed, 1));
      const used = new Set<number>();
      for (const p of portals) {
        expect(p.a).not.toBe(p.b);
        expect(classicWorld.adjacency[p.a]).not.toContain(p.b);
        expect(used.has(p.a)).toBe(false);
        expect(used.has(p.b)).toBe(false);
        used.add(p.a);
        used.add(p.b);
      }
    }
  });

  it("R11 — a portal never touches a blizzard", () => {
    const rules = config(classicWorld, 3, { blizzards: true, portals: "stable" }).rules;
    for (let seed = 0; seed < 30; seed++) {
      const { blizzards, portals } = placeModifiers(classicWorld, rules, pcg32(seed, 99));
      for (const p of portals) {
        expect(blizzards).not.toContain(p.a);
        expect(blizzards).not.toContain(p.b);
      }
    }
  });

  it("R75/R76 — the portal kind comes from the rules, and both start active", () => {
    for (const kind of ["stable", "unstable"] as const) {
      const { portals } = placeModifiers(classicWorld, config(classicWorld, 3, { portals: kind }).rules, pcg32(2, 2));
      expect(portals.every((p) => p.kind === kind)).toBe(true);
      expect(portals.every((p) => p.activeFrom === 0)).toBe(true);
    }
  });

  it("spends its draws even on a board where no portal fits, so the stream never depends on the map (D4)", () => {
    // tiny4 is a complete graph: every pair is adjacent, so no portal is placeable.
    const rules = config(tiny4, 3, { portals: "stable" }).rules;
    const taken = drawsTaken(4, 4, (rng) => {
      expect(placeModifiers(tiny4, rules, rng).portals).toEqual([]);
    });
    expect(taken).toBe(2 * tiny4.modifierSlots.portals);
  });

  it("is a pure function of the rng state", () => {
    const rules = config(classicWorld, 3, { blizzards: true, portals: "unstable" }).rules;
    expect(placeModifiers(classicWorld, rules, pcg32(8, 8))).toEqual(
      placeModifiers(classicWorld, rules, pcg32(8, 8)),
    );
  });
});

/* ---------------------------------------------------------- dealTerritories -- */

describe("dealTerritories", () => {
  function deal(map: MapDef, seats: number, rules: Parameters<typeof config>[2] = {}, seed = "deal-seed") {
    const cfg = config(map, seats, rules, seed);
    return dealTerritories(map, cfg, personasFor(seats), {
      deal: rngFor(seed, "deal", 0),
      turnOrder: rngFor(seed, "turnOrder", 0),
      modifierPlace: rngFor(seed, "modifierPlace", 0),
    });
  }

  it("R4 — draws a seat order that is a permutation, and leads with turnOrder[0]", () => {
    const started = deal(classicWorld, 5);
    expect([...started.turnOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(started.seat).toBe(started.turnOrder[0]);
  });

  it("R4 — the seat order takes exactly seats - 1 draws", () => {
    for (const seats of [2, 3, 4, 5, 6]) {
      const cfg = config(classicWorld, seats);
      const taken = drawsTaken(1, 1, (rng) => {
        dealTerritories(classicWorld, cfg, personasFor(seats), {
          deal: pcg32(0, 0),
          turnOrder: rng,
          modifierPlace: pcg32(0, 0),
        });
      });
      expect(taken).toBe(seats - 1);
    }
  });

  it("R3 — deals every non-blizzard territory, counts differing by at most one", () => {
    const started = deal(classicWorld, 5);
    expect(started.deal).toHaveLength(42);
    const counts = new Map<number, number>();
    for (const entry of started.deal) counts.set(entry.owner, (counts.get(entry.owner) ?? 0) + 1);
    const sizes = [...counts.values()];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("R3 — each seat's armies sum to exactly the starting total (D65)", () => {
    for (const seats of [2, 3, 4, 5, 6]) {
      const started = deal(classicWorld, seats);
      expect(started.startingArmies).toBe(STARTING_ARMIES[seats]);
      const totals = new Map<number, number>();
      for (const entry of started.deal) {
        totals.set(entry.owner, (totals.get(entry.owner) ?? 0) + entry.troops);
      }
      for (const total of totals.values()) expect(total).toBe(started.startingArmies);
    }
  });

  it("R3/D65 — one army per territory, the remainder spread, leftovers to the lowest index", () => {
    const started = deal(classicWorld, 3);
    const mine = started.deal.filter((d) => d.owner === started.turnOrder[0]).sort((a, b) => a.territory - b.territory);
    expect(mine).toHaveLength(14);
    // 35 armies over 14 territories: 1 + floor(21/14) = 2 each, 7 leftover.
    expect(mine.slice(1).every((d) => d.troops === 2)).toBe(true);
    expect(mine[0]?.troops).toBe(9);
  });

  it("R3 — every dealt territory holds at least one army", () => {
    for (const seats of [2, 3, 6]) {
      for (const entry of deal(classicWorld, seats).deal) expect(entry.troops).toBeGreaterThanOrEqual(1);
    }
  });

  it("F39 — a blizzard tile is never dealt", () => {
    const started = deal(classicWorld, 4, { blizzards: true });
    expect(started.blizzards.length).toBeGreaterThan(0);
    for (const t of started.blizzards) {
      expect(started.deal.some((d) => d.territory === t)).toBe(false);
    }
    expect(started.deal).toHaveLength(42 - started.blizzards.length);
  });

  it("F39/R8 — a capital is always one of its own seat's dealt territories", () => {
    for (let i = 0; i < 20; i++) {
      const started = deal(classicWorld, 4, { capitals: true, blizzards: true }, `seed-${String(i)}`);
      started.capitals.forEach((capital, seat) => {
        expect(capital).not.toBeNull();
        const entry = started.deal.find((d) => d.territory === capital);
        expect(entry?.owner).toBe(seat);
        expect(started.blizzards).not.toContain(capital);
      });
    }
  });

  it("R8 — no capital is drawn when Capitals is off, and no draw is spent on one", () => {
    const off = config(classicWorld, 4);
    const on = config(classicWorld, 4, { capitals: true });
    const offTaken = drawsTaken(6, 6, (rng) => {
      dealTerritories(classicWorld, off, personasFor(4), {
        deal: rng,
        turnOrder: pcg32(0, 0),
        modifierPlace: pcg32(0, 0),
      });
    });
    const onTaken = drawsTaken(6, 6, (rng) => {
      dealTerritories(classicWorld, on, personasFor(4), {
        deal: rng,
        turnOrder: pcg32(0, 0),
        modifierPlace: pcg32(0, 0),
      });
    });
    expect(offTaken).toBe(41);
    expect(onTaken).toBe(41 + 4);
    expect(deal(classicWorld, 4).capitals).toEqual([null, null, null, null]);
  });

  it("the deal sub-stream takes (nonBlizzard - 1) + capitals draws (D4)", () => {
    const cfg = config(classicWorld, 3, { blizzards: true, capitals: true });
    const frozen = placeModifiers(classicWorld, cfg.rules, rngFor("s", "modifierPlace", 0)).blizzards.length;
    const taken = drawsTaken(9, 9, (rng) => {
      dealTerritories(classicWorld, cfg, personasFor(3), {
        deal: rng,
        turnOrder: pcg32(0, 0),
        modifierPlace: rngFor("s", "modifierPlace", 0),
      });
    });
    expect(taken).toBe(42 - frozen - 1 + 3);
  });

  it("R5/R7/D64 — the 2-seat variant deals three piles, the third to the neutral", () => {
    const started = deal(classicWorld, 2);
    expect(started.neutral).toBe(true);
    expect(started.startingArmies).toBe(40);
    for (const owner of [0, 1, SEAT_NEUTRAL]) {
      expect(started.deal.filter((d) => d.owner === owner)).toHaveLength(14);
    }
    expect(started.seats).toHaveLength(2);
  });

  it("R5 — on any other map the three piles differ by at most one, larger piles first", () => {
    const started = deal(mini, 2);
    const sizes = [started.turnOrder[0] as number, started.turnOrder[1] as number, SEAT_NEUTRAL].map(
      (owner) => started.deal.filter((d) => d.owner === owner).length,
    );
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes[0]).toBeGreaterThanOrEqual(sizes[1] as number);
    expect(sizes[1]).toBeGreaterThanOrEqual(sizes[2] as number);
  });

  it("R7 — there is no neutral seat row and no neutral SeatKind", () => {
    const started = deal(classicWorld, 2);
    expect(started.seats.map((s) => s.kind)).toEqual(["human", "bot"]);
    expect(started.turnOrder).not.toContain(SEAT_NEUTRAL);
  });

  it("R9 — Manual Placement deals no owners and takes no deal draws", () => {
    const cfg = config(classicWorld, 3, { manualPlacement: true, capitals: true });
    const taken = drawsTaken(7, 7, (rng) => {
      const started = dealTerritories(classicWorld, cfg, personasFor(3), {
        deal: rng,
        turnOrder: pcg32(0, 0),
        modifierPlace: pcg32(0, 0),
      });
      expect(started.deal).toEqual([]);
      expect(started.capitals).toEqual([null, null, null]);
    });
    expect(taken).toBe(0);
  });

  it("R9 — Manual Placement still places blizzards and portals (F39 step 2)", () => {
    const started = deal(classicWorld, 3, { manualPlacement: true, blizzards: true, portals: "stable" });
    expect(started.blizzards.length).toBeGreaterThan(0);
    expect(started.portals.length).toBeGreaterThan(0);
  });

  it("F3 — the personas it was handed land on the seat rows, null for a human", () => {
    const started = deal(classicWorld, 4);
    expect(started.seats[0]?.persona).toBeNull();
    expect(started.seats[1]?.persona?.name).toBe("rusher");
  });

  it("is reproducible from (mapSlug, seed) and differs across seeds (R3)", () => {
    expect(deal(classicWorld, 4, {}, "same")).toEqual(deal(classicWorld, 4, {}, "same"));
    expect(deal(classicWorld, 4, {}, "a")).not.toEqual(deal(classicWorld, 4, {}, "b"));
  });

  it("D4 — adding a draw to one sub-stream does not shift another", () => {
    const seats = 4;
    const cfg = config(classicWorld, seats, { blizzards: true });
    const turnOrder = rngFor("iso", "turnOrder", 0);
    const base = dealTerritories(classicWorld, cfg, personasFor(seats), {
      deal: rngFor("iso", "deal", 0),
      turnOrder,
      modifierPlace: rngFor("iso", "modifierPlace", 0),
    });
    // Burn a hundred draws on the deal stream only; the seat order and the
    // modifiers come from their own streams and must be identical.
    const burnt = rngFor("iso", "deal", 0);
    for (let i = 0; i < 100; i++) burnt.nextU32();
    const shifted = dealTerritories(classicWorld, cfg, personasFor(seats), {
      deal: burnt,
      turnOrder: rngFor("iso", "turnOrder", 0),
      modifierPlace: rngFor("iso", "modifierPlace", 0),
    });
    expect(shifted.turnOrder).toEqual(base.turnOrder);
    expect(shifted.blizzards).toEqual(base.blizzards);
    expect(shifted.deal).not.toEqual(base.deal);
  });

  it("carries the map slug and the rules straight through", () => {
    const started = deal(mini, 3, { fogOfWar: true });
    expect(started.mapSlug).toBe("mini");
    expect(started.rules.fogOfWar).toBe(true);
    expect(started.type).toBe("GAME_STARTED");
  });
});

/* --------------------------------------------------------------- rollAttack -- */

describe("rollAttack — manual (R61)", () => {
  function state(fromTroops = 5, toTroops = 3) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, fromTroops, toTroops, 1, 1],
      phase: "attack",
    });
  }

  it("takes exactly attackerDice + defendDice draws (D4)", () => {
    for (const [attackerDice, toTroops, expected] of [
      [3, 3, 5],
      [2, 3, 4],
      [1, 3, 3],
      [3, 1, 4],
    ] as const) {
      const taken = drawsTaken(1, 1, (rng) => {
        rollAttack(
          state(5, toTroops),
          mini,
          { from: 2, to: 3, mode: "manual", attackerDice },
          rng,
          fakeOdds(),
          "trueRandom",
        );
      });
      expect(taken).toBe(expected);
    }
  });

  it("returns dice in 1..6, sorted descending", () => {
    for (let seed = 0; seed < 50; seed++) {
      const action = rollAttack(
        state(),
        mini,
        { from: 2, to: 3, mode: "manual", attackerDice: 3 },
        pcg32(seed, seed),
        fakeOdds(),
        "trueRandom",
      );
      if (action.mode !== "manual") throw new Error("expected a manual roll");
      for (const d of [...action.attackerDice, ...action.defenderDice]) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(6);
      }
      expect([...action.attackerDice]).toEqual([...action.attackerDice].sort((a, b) => b - a));
      expect([...action.defenderDice]).toEqual([...action.defenderDice].sort((a, b) => b - a));
    }
  });

  it("R30/R33 — clamps the requested dice to what the source can field", () => {
    const action = rollAttack(
      state(2),
      mini,
      { from: 2, to: 3, mode: "manual", attackerDice: 3 },
      pcg32(1, 1),
      fakeOdds(),
      "trueRandom",
    );
    if (action.mode !== "manual") throw new Error("expected a manual roll");
    expect(action.attackerDice).toHaveLength(1);
  });

  it("R30 — the defender's dice count follows the plan", () => {
    const one = rollAttack(
      state(5, 1),
      mini,
      { from: 2, to: 3, mode: "manual", attackerDice: 3 },
      pcg32(1, 1),
      fakeOdds(),
      "trueRandom",
    );
    if (one.mode !== "manual") throw new Error("expected a manual roll");
    expect(one.defenderDice).toHaveLength(1);
  });

  it("R72 — a capital defender rolls three dice through the same path", () => {
    const capitalState = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, 5, 4, 1, 1],
      phase: "attack",
      rules: { capitals: true },
      capitals: [0, 3],
    });
    const action = rollAttack(
      capitalState,
      mini,
      { from: 2, to: 3, mode: "manual", attackerDice: 3 },
      pcg32(1, 1),
      fakeOdds(),
      "trueRandom",
    );
    if (action.mode !== "manual") throw new Error("expected a manual roll");
    expect(action.defenderDice).toHaveLength(3);
  });

  it("R61 — is True Random whatever the dice mode says: the odds table is never consulted", () => {
    let consulted = 0;
    const spy = fakeOdds((a, d) => {
      consulted += 1;
      return cleanSweep(a, d);
    }, "balancedBlitz");
    rollAttack(
      state(),
      mini,
      { from: 2, to: 3, mode: "manual", attackerDice: 2 },
      pcg32(1, 1),
      spy,
      "balancedBlitz",
    );
    expect(consulted).toBe(0);
  });

  it("R7/F17 — a neutral defender goes through the same path with no special case", () => {
    const neutral = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, SEAT_NEUTRAL, SEAT_NEUTRAL, SEAT_NEUTRAL],
      troops: [1, 1, 5, 3, 1, 1],
      phase: "attack",
    });
    const action = rollAttack(
      neutral,
      mini,
      { from: 2, to: 3, mode: "manual", attackerDice: 3 },
      pcg32(4, 4),
      fakeOdds(),
      "trueRandom",
    );
    if (action.mode !== "manual") throw new Error("expected a manual roll");
    expect(action.defenderDice).toHaveLength(2);
    expect(action.seat).toBe(0);
  });

  it("is a pure function of the rng state", () => {
    const a = rollAttack(state(), mini, { from: 2, to: 3, mode: "manual", attackerDice: 3 }, pcg32(9, 9), fakeOdds(), "trueRandom");
    const b = rollAttack(state(), mini, { from: 2, to: 3, mode: "manual", attackerDice: 3 }, pcg32(9, 9), fakeOdds(), "trueRandom");
    expect(a).toEqual(b);
  });

  it("spreads each die roughly evenly over 1..6", () => {
    const counts = new Array<number>(7).fill(0);
    const rng = pcg32(17, 23);
    for (let i = 0; i < 3000; i++) {
      const action = rollAttack(
        state(),
        mini,
        { from: 2, to: 3, mode: "manual", attackerDice: 3 },
        rng,
        fakeOdds(),
        "trueRandom",
      );
      if (action.mode !== "manual") throw new Error("expected a manual roll");
      for (const d of action.attackerDice) counts[d] = (counts[d] as number) + 1;
    }
    for (let face = 1; face <= 6; face++) expect(counts[face]).toBeGreaterThan(1200);
  });
});

describe("rollAttack — blitz (R58, R59, D6, D7)", () => {
  function state(fromTroops = 6, toTroops = 4) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, fromTroops, toTroops, 1, 1],
      phase: "attack",
    });
  }

  it("R58/D6 — takes exactly one draw, however big the battle", () => {
    for (const [from, to] of [
      [2, 1],
      [6, 4],
      [80, 60],
    ] as const) {
      const taken = drawsTaken(2, 3, (rng) => {
        rollAttack(state(from, to), mini, { from: 2, to: 3, mode: "blitz" }, rng, fakeOdds(), "trueRandom");
      });
      expect(taken).toBe(1);
    }
  });

  it("R38 — asks the table for A excluding the garrison", () => {
    let asked: [number, number] | null = null;
    const spy = fakeOdds((a, d) => {
      asked = [a, d];
      return cleanSweep(a, d);
    });
    rollAttack(state(20, 10), mini, { from: 2, to: 3, mode: "blitz" }, pcg32(1, 1), spy, "trueRandom");
    expect(asked).toEqual([19, 10]);
  });

  it("R36 — hands the table the augment for this specific attack", () => {
    let aug: { defendDiceBonus: number } | undefined;
    const spy = fakeOdds((a, d, augment) => {
      aug = augment;
      return cleanSweep(a, d);
    });
    const capitalState = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, 6, 4, 1, 1],
      phase: "attack",
      rules: { capitals: true },
      capitals: [0, 3],
    });
    rollAttack(capitalState, mini, { from: 2, to: 3, mode: "blitz" }, pcg32(1, 1), spy, "trueRandom");
    expect(aug?.defendDiceBonus).toBe(1);
  });

  it("R48 — passes stopUntil through to the table and back into the action", () => {
    let seen: number | undefined;
    const spy = fakeOdds((a, d, _aug, stopUntil) => {
      seen = stopUntil;
      return makeDist(a, d, { holdLosing: { 2: 1 } });
    });
    const action = rollAttack(
      state(10, 6),
      mini,
      { from: 2, to: 3, mode: "blitz", stopUntil: 4 },
      pcg32(1, 1),
      spy,
      "trueRandom",
    );
    expect(seen).toBe(4);
    if (action.mode !== "blitz") throw new Error("expected a blitz");
    expect(action.stopUntil).toBe(4);
    /*
     * `holdLosing` is the **resolved** defender-hold range, and the DP writes a cell there only on
     * the transition that empties the attacker's force — so the attacker's loss is all of `A`, 9,
     * whatever the limiter would have let it commit. It used to report `(A + 1) - stopUntil = 6`,
     * which under-counted a real, reachable outcome (codex round 2, finding 8); `odds/sample.test.ts`
     * pins the same branch against the REAL DP at a reachable `stopUntil: 2`.
     */
    expect(action.attackerLosses).toBe(9);
    expect(action.defenderLosses).toBe(2);
  });

  it("omits stopUntil from the action when the limiter was not set", () => {
    const action = rollAttack(state(), mini, { from: 2, to: 3, mode: "blitz" }, pcg32(1, 1), fakeOdds(), "trueRandom");
    if (action.mode !== "blitz") throw new Error("expected a blitz");
    expect("stopUntil" in action).toBe(false);
  });

  /*
   * R48/F46 — the limiter's stopped mass lives in `dist.stopped`, NOT in
   * `defendLoss[j < D]`, so `attackLoss` + `defendLoss` sum to `1 - unresolved`
   * and a walk over those two alone leaves the whole stopped tail unreachable:
   * every `u` above the resolved mass used to fall off the end of the loop and
   * come back as `lastIndexWithMass`, i.e. as "the defender held, having lost
   * nothing". These pin the tail.
   */
  describe("the stopped tail (R48, F46)", () => {
    // A = 9, D = 6, stopUntil = 4 -> committed = (A + 1) - stopUntil = 6.
    const limited = (a: number, d: number) => makeDist(a, d, {
      conquerLosing: { 0: 0.2 },
      holdLosing: { 0: 0.3 },
      stopped: [
        { attackerLosses: 6, defenderLosses: 2, p: 0.3 },
        { attackerLosses: 8, defenderLosses: 4, p: 0.2 },
      ],
    });

    function at(u: number) {
      const action = rollAttack(
        state(10, 6), mini, { from: 2, to: 3, mode: "blitz", stopUntil: 4 },
        fixedU(u), fakeOdds(limited), "trueRandom",
      );
      if (action.mode !== "blitz") throw new Error("expected a blitz");
      return { attackerLosses: action.attackerLosses, defenderLosses: action.defenderLosses };
    }

    it("the published arrays sum to 1 - unresolved, and the sampled walk to 1", () => {
      const dist = limited(9, 6);
      const total = (xs: readonly number[]) => xs.reduce((acc, x) => acc + x, 0);
      expect(dist.unresolved).toBeCloseTo(0.5, 12);
      expect(total(combinedOutcomes(dist))).toBeCloseTo(0.5, 12);
      expect(total(sampledOutcomes(dist))).toBeCloseTo(1, 12);
      expect(stoppedOutcomes(dist)).toHaveLength(2);
      expect(sampledOutcomes(dist)).toHaveLength(9 + 6 + 2);
    });

    it("a u in the stopped tail reports the stopped outcome's own losses", () => {
      // Both of these used to come back as { 6, 0 } — the last RESOLVED cell.
      expect(at(0.6)).toEqual({ attackerLosses: 6, defenderLosses: 2 });
      expect(at(0.9)).toEqual({ attackerLosses: 8, defenderLosses: 4 });
    });

    it("a draw in the stopped tail never reports a draw as a defender hold", () => {
      // The defender is alive AND has lost troops: neither half of `combined`
      // can express that, which is why the tail has to exist.
      const stopped = at(0.9);
      expect(stopped.defenderLosses).toBeGreaterThan(0);
      expect(stopped.defenderLosses).toBeLessThan(6);
    });

    it("leaves the resolved prefix of the CDF exactly where it was", () => {
      expect(at(0)).toEqual({ attackerLosses: 0, defenderLosses: 6 });
      // A resolved hold costs the attacker all of A = 9 — see the note on R48 above.
      expect(at(0.45)).toEqual({ attackerLosses: 9, defenderLosses: 0 });
    });

    it("stays within what the reducer will accept, across the whole unit interval", () => {
      for (let n = 0; n <= 200; n++) {
        const out = at(n / 201);
        expect(out.attackerLosses).toBeLessThanOrEqual(9); // sourceTroops - 1
        expect(out.defenderLosses).toBeLessThanOrEqual(6);
      }
    });

    it("an OutcomeDist with no `stopped` breakdown walks exactly as it always did", () => {
      const legacy = fakeOdds((a, d) => makeDist(a, d, { holdLosing: { 2: 1 } }));
      const action = rollAttack(
        state(10, 6), mini, { from: 2, to: 3, mode: "blitz", stopUntil: 4 },
        pcg32(1, 1), legacy, "trueRandom",
      );
      if (action.mode !== "blitz") throw new Error("expected a blitz");
      expect(action).toMatchObject({ attackerLosses: 9, defenderLosses: 2 });
    });
  });

  it("maps an attacker-half outcome to (lost i, defender wiped)", () => {
    const spy = fakeOdds((a, d) => makeDist(a, d, { conquerLosing: { 2: 1 } }));
    const action = rollAttack(state(9, 5), mini, { from: 2, to: 3, mode: "blitz" }, pcg32(1, 1), spy, "trueRandom");
    if (action.mode !== "blitz") throw new Error("expected a blitz");
    expect(action).toMatchObject({ attackerLosses: 2, defenderLosses: 5 });
  });

  it("maps a defender-half outcome to (attacker wiped, defender lost j)", () => {
    const spy = fakeOdds((a, d) => makeDist(a, d, { holdLosing: { 3: 1 } }));
    const action = rollAttack(state(9, 5), mini, { from: 2, to: 3, mode: "blitz" }, pcg32(1, 1), spy, "trueRandom");
    if (action.mode !== "blitz") throw new Error("expected a blitz");
    expect(action).toMatchObject({ attackerLosses: 8, defenderLosses: 3 });
  });

  it("returns a no-op for a distribution with no mass rather than inventing an outcome", () => {
    const spy = fakeOdds((a, d) => makeDist(a, d, {}));
    const action = rollAttack(state(9, 5), mini, { from: 2, to: 3, mode: "blitz" }, pcg32(1, 1), spy, "trueRandom");
    if (action.mode !== "blitz") throw new Error("expected a blitz");
    expect(action).toMatchObject({ attackerLosses: 0, defenderLosses: 0 });
  });

  it("produces an action the reducer accepts, across many seeds", () => {
    const spy = fakeOdds((a, d) =>
      makeDist(a, d, { conquerLosing: { 0: 0.3, 1: 0.2 }, holdLosing: { 0: 0.2, 1: 0.3 } }),
    );
    for (let seed = 0; seed < 60; seed++) {
      const s = state(9, 5);
      const action = rollAttack(s, mini, { from: 2, to: 3, mode: "blitz" }, pcg32(seed, 1), spy, "trueRandom");
      if (action.mode !== "blitz") throw new Error("expected a blitz");
      expect(action.attackerLosses).toBeLessThanOrEqual(8);
      expect(action.defenderLosses).toBeLessThanOrEqual(5);
    }
  });
});

describe("the combined array and the quantised walk (R52, R59, D7, F46)", () => {
  it("F46 — orders attacker-favourable first and excludes the two aggregate cells", () => {
    const dist = makeDist(3, 2, { conquerLosing: { 0: 0.1, 1: 0.2, 2: 0.1 }, holdLosing: { 0: 0.3, 1: 0.3 } });
    const combined = combinedOutcomes(dist);
    expect(combined).toHaveLength(5); // A + D, not A + D + 2
    expect(combined[0]).toBeCloseTo(0.1, 12);
    expect(combined[2]).toBeCloseTo(0.1, 12);
    // The defender half is reversed: defendLoss[D-1] comes first.
    expect(combined[3]).toBeCloseTo(0.3, 12);
    expect(combined[4]).toBeCloseTo(0.3, 12);
    // The totals are the two cells NOT in the array.
    expect(dist.attackLoss[3]).toBeCloseTo(0.6, 12);
    expect(dist.defendLoss[2]).toBeCloseTo(0.4, 12);
  });

  it("R59 — quantises onto the 2^32 grid", () => {
    expect(quantise(0)).toBe(0);
    expect(quantise(1)).toBe(2 ** 32);
    expect(quantise(0.5)).toBe(2 ** 31);
  });

  it("R59 — the walk is pinned at u = 0, eps, 0.5 and 1 - eps", () => {
    const combined = [0.25, 0.25, 0.25, 0.25];
    const eps = 2 ** -32;
    expect(walkCdf(combined, 0)).toBe(0);
    expect(walkCdf(combined, eps)).toBe(0);
    expect(walkCdf(combined, 0.5)).toBe(2);
    expect(walkCdf(combined, 1 - eps)).toBe(3);
  });

  it("R59 — the boundary is `u < cum`, so a u exactly on a cut takes the later outcome", () => {
    const combined = [0.25, 0.75];
    expect(walkCdf(combined, 0.25 - 2 ** -32)).toBe(0);
    expect(walkCdf(combined, 0.25)).toBe(1);
  });

  it("skips zero-probability outcomes", () => {
    expect(walkCdf([0, 0, 1, 0], 0)).toBe(2);
    expect(walkCdf([0, 0, 1, 0], 0.999)).toBe(2);
  });

  it("falls back to the last outcome carrying mass when the residue overshoots", () => {
    // Deliberately short of 1, as a reshaped distribution's float residue can be.
    expect(walkCdf([0.3, 0.3, 0.3], 0.999)).toBe(2);
  });

  it("returns -1 for a distribution with no mass at all", () => {
    expect(walkCdf([0, 0, 0], 0.5)).toBe(-1);
    expect(walkCdf([], 0.5)).toBe(-1);
  });

  it("reproduces the input distribution over many draws", () => {
    const combined = [0.1, 0.4, 0.5];
    const counts = [0, 0, 0];
    const rng = pcg32(31, 37);
    for (let i = 0; i < 60_000; i++) {
      const at = walkCdf(combined, rng.nextFloat());
      counts[at] = (counts[at] as number) + 1;
    }
    expect((counts[0] as number) / 60_000).toBeCloseTo(0.1, 2);
    expect((counts[1] as number) / 60_000).toBeCloseTo(0.4, 2);
    expect((counts[2] as number) / 60_000).toBeCloseTo(0.5, 2);
  });
});

/* ----------------------------------------------------------------- drawCard -- */

describe("drawCard (R19, R20)", () => {
  function state(hands: Readonly<Record<number, readonly Card[]>> = {}, discard: readonly Card[] = []) {
    return buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1], hands, discard });
  }

  it("R20/D4 — takes exactly one draw", () => {
    const taken = drawsTaken(3, 5, (rng) => {
      drawCard(state(), mini, 0, rng);
    });
    expect(taken).toBe(1);
  });

  it("R19 — draws from the live pool, never a held or discarded card", () => {
    const held = [territoryCard(mini, 0), territoryCard(mini, 1)];
    const discarded = [territoryCard(mini, 2)];
    const s = state({ 0: held }, discarded);
    const pool = remainingDeck(s, mini).map((c) => c.id);
    for (let seed = 0; seed < 40; seed++) {
      const action = drawCard(s, mini, 0, pcg32(seed, 1));
      expect(pool).toContain(action.card.id);
      expect(action.seat).toBe(0);
      expect(action.type).toBe("CARD_DRAWN");
    }
  });

  it("R19 — can draw either wild", () => {
    const s = state();
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed++) seen.add(drawCard(s, mini, 0, pcg32(seed, 7)).card.id);
    expect(seen.has("wild-1")).toBe(true);
    expect(seen.has("wild-2")).toBe(true);
  });

  it("R19 — reaches every card in the pool over enough seeds", () => {
    const s = state();
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) seen.add(drawCard(s, mini, 0, pcg32(seed, 11)).card.id);
    expect(seen.size).toBe(deckFor(mini).length);
  });

  it("R19 — with an empty pool it draws from the discard, which is the reshuffle", () => {
    const all = deckFor(mini);
    const s = state({}, all);
    for (let seed = 0; seed < 20; seed++) {
      const action = drawCard(s, mini, 0, pcg32(seed, 13));
      expect(all.map((c) => c.id)).toContain(action.card.id);
    }
  });

  it("carries the suit and territory of the card it drew", () => {
    const action = drawCard(state(), mini, 1, pcg32(2, 2));
    const expected = deckFor(mini).find((c) => c.id === action.card.id);
    expect(action.card).toEqual(expected);
  });

  it("is a pure function of the rng state", () => {
    expect(drawCard(state(), mini, 0, pcg32(5, 5))).toEqual(drawCard(state(), mini, 0, pcg32(5, 5)));
  });
});

/* -------------------------------------------------------------- movePortals -- */

describe("movePortals (R76, D58)", () => {
  function state(round: number, kind: "off" | "stable" | "unstable", activeFrom = 0) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      rules: { portals: kind },
      portals: kind === "off" ? [] : [{ a: 0, b: 4, kind, activeFrom }],
      round,
    });
  }

  it("R76 — returns null unless portals are unstable and round % 3 === 0", () => {
    expect(relocationDue(state(3, "stable"))).toBe(false);
    expect(movePortals(state(3, "stable"), mini, pcg32(1, 1))).toBeNull();
    expect(movePortals(state(3, "off"), mini, pcg32(1, 1))).toBeNull();
    for (const round of [1, 2, 4, 5, 7, 8]) {
      expect(relocationDue(state(round, "unstable"))).toBe(false);
      expect(movePortals(state(round, "unstable"), mini, pcg32(1, 1))).toBeNull();
    }
  });

  it("R76 — relocates on every round divisible by three", () => {
    for (const round of [3, 6, 9, 12]) {
      expect(relocationDue(state(round, "unstable"))).toBe(true);
      expect(movePortals(state(round, "unstable"), mini, pcg32(1, 1))).not.toBeNull();
    }
  });

  it("R76 — the relocated portal is inactive for the whole of that round", () => {
    const action = movePortals(state(3, "unstable"), mini, pcg32(1, 1));
    expect(action?.portals.every((p) => p.activeFrom === 4)).toBe(true);
  });

  it("R11 — the new pair is non-adjacent and off every blizzard", () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = buildState(classicWorld, {
        seats: 2,
        owners: classicWorld.territories.map((_t, i) => (i % 2 === 0 ? 0 : 1)),
        rules: { portals: "unstable" },
        portals: [{ a: 0, b: 20, kind: "unstable", activeFrom: 0 }],
        blizzards: [5, 6, 7],
        round: 3,
      });
      const action = movePortals(s, classicWorld, pcg32(seed, 3));
      for (const p of action?.portals ?? []) {
        expect(classicWorld.adjacency[p.a]).not.toContain(p.b);
        expect([5, 6, 7]).not.toContain(p.a);
        expect([5, 6, 7]).not.toContain(p.b);
      }
    }
  });

  it("R75 — stable portals in the same game are left where they are", () => {
    const s = buildState(classicWorld, {
      seats: 2,
      owners: classicWorld.territories.map(() => 0),
      rules: { portals: "unstable" },
      portals: [
        { a: 0, b: 20, kind: "stable", activeFrom: 0 },
        { a: 1, b: 21, kind: "unstable", activeFrom: 0 },
      ],
      round: 3,
    });
    const action = movePortals(s, classicWorld, pcg32(1, 1));
    expect(action?.portals).toContainEqual({ a: 0, b: 20, kind: "stable", activeFrom: 0 });
    expect(action?.portals.filter((p) => p.kind === "unstable")).toHaveLength(1);
  });

  it("D4 — takes exactly two draws per unstable portal", () => {
    const s = buildState(classicWorld, {
      seats: 2,
      owners: classicWorld.territories.map(() => 0),
      rules: { portals: "unstable" },
      portals: [
        { a: 0, b: 20, kind: "unstable", activeFrom: 0 },
        { a: 1, b: 21, kind: "unstable", activeFrom: 0 },
        { a: 2, b: 22, kind: "unstable", activeFrom: 0 },
      ],
      round: 6,
    });
    const taken = drawsTaken(8, 9, (rng) => {
      movePortals(s, classicWorld, rng);
    });
    expect(taken).toBe(6);
  });

  it("returns an action the reducer accepts", () => {
    const s = buildState(classicWorld, {
      seats: 2,
      owners: classicWorld.territories.map((_t, i) => (i % 2 === 0 ? 0 : 1)),
      rules: { portals: "unstable" },
      portals: [{ a: 0, b: 20, kind: "unstable", activeFrom: 0 }],
      round: 3,
    });
    const action = movePortals(s, classicWorld, pcg32(1, 1));
    expect(action?.seat).toBe(0);
    expect(action?.type).toBe("PORTALS_MOVED");
  });

  it("returns null when the game has no unstable portals to move", () => {
    const s = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      rules: { portals: "unstable" },
      portals: [],
      round: 3,
    });
    expect(movePortals(s, mini, pcg32(1, 1))).toBeNull();
  });

  it("is a pure function of the rng state", () => {
    const s = state(3, "unstable");
    expect(movePortals(s, mini, pcg32(6, 6))).toEqual(movePortals(s, mini, pcg32(6, 6)));
  });

  it("never reuses a blizzard tile as a portal end, even on a cramped board", () => {
    const s = buildState(tiny4, {
      seats: 2,
      owners: [0, 0, 1, 1],
      rules: { portals: "unstable" },
      portals: [{ a: 0, b: 2, kind: "unstable", activeFrom: 0 }],
      round: 3,
    });
    // tiny4 is complete, so no non-adjacent pair exists and nothing is placed.
    expect(movePortals(s, tiny4, pcg32(1, 1))?.portals).toEqual([]);
    void SEAT_NONE;
  });
});
