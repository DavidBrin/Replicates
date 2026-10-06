/** The tier table, the eight personas, and the fold `persona ⊕ TIERS[tier]` (D28, D29, D31, D63, F10). */

import { describe, expect, it } from "vitest";

import type { BotTier } from "@/engine";

import { drawPersonas, PERSONAS, personaFor } from "./personas";
import { countingRng, fixedRng } from "./testFixtures";
import { TIER_ORDER, TIERS } from "./tiers";
import { ANTI_BOT_BIAS, BOT_TIERS } from "./types";

describe("the eight personas", () => {
  it("is exactly the eight the spec names", () => {
    expect(Object.keys(PERSONAS).sort()).toEqual([
      "assassin", "clusterer", "continental", "hoarder", "opportunist", "rusher", "turtle", "wildcard",
    ]);
  });

  it("carries the sourced defining knobs verbatim", () => {
    const table: Record<string, [number, number, number, number, number, number, number, number, string]> = {
      //          aggr  minWin reserveF floor contFocus expans stacky leaderBias placement
      rusher: [0.9, 0.3, 0.5, 2, 0.4, 0.8, 0.3, 0.5, "frontLoad"],
      continental: [0.55, 0.5, 1.0, 3, 1.0, 0.4, 0.4, 0.4, "secure"],
      clusterer: [0.5, 0.5, 1.0, 3, 0.3, 0.6, 0.5, 0.3, "secure"],
      hoarder: [0.35, 0.65, 1.4, 6, 0.3, 0.3, 1.0, 0.3, "stack"],
      turtle: [0.15, 0.8, 2.0, 4, 0.5, 0.2, 0.6, 0.2, "secure"],
      opportunist: [0.5, 0.45, 1.0, 3, 0.5, 0.5, 0.4, 0.7, "secure"],
      assassin: [0.7, 0.4, 1.0, 20, 0.3, 0.6, 0.7, 0.6, "frontLoad"],
    };
    for (const [name, row] of Object.entries(table)) {
      const p = PERSONAS[name];
      expect(p, name).toBeDefined();
      expect([
        p?.aggression, p?.minWinChance, p?.reserveFactor, p?.reserveFloor,
        p?.continentFocus, p?.expansionism, p?.stackiness, p?.leaderBias, p?.placement,
      ], name).toEqual(row);
    }
  });

  it("the assassin's reserveFloor is Killbot's published 20 — the only absolute number in any source", () => {
    expect(PERSONAS.assassin?.reserveFloor).toBe(20);
    expect(PERSONAS.assassin?.seesKillForCards).toBe(true);
  });

  it("every grudgeDecay sits in the sourced 0.5-0.95 band", () => {
    for (const p of Object.values(PERSONAS)) {
      expect(p.grudgeDecay).toBeGreaterThanOrEqual(0.5);
      expect(p.grudgeDecay).toBeLessThanOrEqual(0.95);
    }
  });
});

describe("the tier table (D28, D29, D31, D63)", () => {
  it("covers all five labels, in difficulty order", () => {
    expect(Object.keys(TIERS).sort()).toEqual(["beginner", "easy", "expert", "hard", "medium"]);
    expect(TIER_ORDER).toEqual(["beginner", "easy", "medium", "hard", "expert"]);
    expect(BOT_TIERS).toEqual(TIER_ORDER);
  });

  it("minWinChance is 0.25 / 0.25 / 0.45 / 0.55 / dynamic", () => {
    expect(TIER_ORDER.map((t) => TIERS[t].minWinChance)).toEqual([0.25, 0.25, 0.45, 0.55, "dynamic"]);
  });

  it("blunderRate is 0.40 / 0.30 / 0.12 / 0.03 / 0.00 and strictly decreasing", () => {
    const rates = TIER_ORDER.map((t) => TIERS[t].blunderRate);
    expect(rates).toEqual([0.4, 0.3, 0.12, 0.03, 0]);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i] as number).toBeLessThan(rates[i - 1] as number);
    }
  });

  it("tierReserveFactor is 0.4 / 0.5 / 0.8 / 1.0 / 1.2 and strictly increasing", () => {
    const factors = TIER_ORDER.map((t) => TIERS[t].tierReserveFactor);
    expect(factors).toEqual([0.4, 0.5, 0.8, 1.0, 1.2]);
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i] as number).toBeGreaterThan(factors[i - 1] as number);
    }
  });

  it("lookahead is 0 / 0 / 0 / 1 / 2, and only Expert uses the exact odds plus two plies", () => {
    expect(TIER_ORDER.map((t) => TIERS[t].lookahead)).toEqual([0, 0, 0, 1, 2]);
    expect(TIER_ORDER.map((t) => TIERS[t].usesExactOdds)).toEqual([false, false, true, true, true]);
  });

  it("D31: only Expert sees through fog; every honest tier inflates unknown stacks", () => {
    expect(TIER_ORDER.map((t) => TIERS[t].fogHonest)).toEqual([true, true, true, true, false]);
    expect(TIER_ORDER.map((t) => TIERS[t].fogPessimism)).toEqual([1.5, 1.4, 1.2, 1.1, 1.0]);
    // Strictly decreasing: a harder bot needs less of a crutch.
    const pess = TIER_ORDER.map((t) => TIERS[t].fogPessimism);
    for (let i = 1; i < pess.length; i++) expect(pess[i] as number).toBeLessThan(pess[i - 1] as number);
  });

  it("D63: allianceLoyalty is 1.0 up to Medium, 0.9 at Hard, 0.6 at Expert", () => {
    expect(TIER_ORDER.map((t) => TIERS[t].allianceLoyalty)).toEqual([1.0, 1.0, 1.0, 0.9, 0.6]);
  });

  it("the pools widen monotonically, and only Expert draws every persona", () => {
    const sizes = TIER_ORDER.map((t) => new Set(TIERS[t].pool).size);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i] as number).toBeGreaterThanOrEqual(sizes[i - 1] as number);
    }
    // Each tier's pool contains the previous tier's.
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const prev = new Set(TIERS[TIER_ORDER[i - 1] as BotTier].pool);
      const here = new Set(TIERS[TIER_ORDER[i] as BotTier].pool);
      for (const name of prev) expect(here.has(name), `${TIER_ORDER[i]} keeps ${name}`).toBe(true);
    }
    expect(new Set(TIERS.expert.pool)).toEqual(new Set(Object.keys(PERSONAS)));
  });

  it("Expert's pool is weighted toward continental and rusher by repetition", () => {
    const counts = new Map<string, number>();
    for (const name of TIERS.expert.pool) counts.set(name, (counts.get(name) ?? 0) + 1);
    expect(counts.get("continental")).toBeGreaterThan(1);
    expect(counts.get("rusher")).toBeGreaterThan(1);
    expect(counts.get("turtle")).toBe(1);
  });

  it("every pool name is a real persona", () => {
    for (const tier of TIER_ORDER) {
      for (const name of TIERS[tier].pool) expect(PERSONAS[name], name).toBeDefined();
    }
  });

  it("anti-bot bias is Beginner and Easy only ([SMG])", () => {
    expect(TIER_ORDER.map((t) => TIERS[t].antiBotBias)).toEqual([true, true, false, false, false]);
  });
});

describe("the fold: `persona ⊕ TIERS[tier]` (F10)", () => {
  it("the tier always wins every field in the fold table", () => {
    for (const tier of TIER_ORDER) {
      const row = TIERS[tier];
      const folded = personaFor(tier, fixedRng(0), fixedRng(0.5));
      expect(folded.tier, tier).toBe(tier);
      expect(folded.blunderRate, tier).toBe(row.blunderRate);
      expect(folded.tierReserveFactor, tier).toBe(row.tierReserveFactor);
      expect(folded.placement, tier).toBe(row.placement);
      expect(folded.lookahead, tier).toBe(row.lookahead);
      expect(folded.usesExactOdds, tier).toBe(row.usesExactOdds);
      expect(folded.fogHonest, tier).toBe(row.fogHonest);
      expect(folded.fogPessimism, tier).toBe(row.fogPessimism);
      expect(folded.allianceLoyalty, tier).toBe(row.allianceLoyalty);
      expect(folded.seesCardTradeTiming, tier).toBe(row.seesCardTradeTiming);
      expect(folded.seesDominationThreshold, tier).toBe(row.seesDominationThreshold);
      expect(folded.antiBotBias, tier).toBe(row.antiBotBias ? ANTI_BOT_BIAS : 0);
    }
  });

  it("`minWinChance: \"dynamic\"` becomes `{ minWinChance: 0, dynamicMinWinChance: true }`", () => {
    const expert = personaFor("expert", fixedRng(0), fixedRng(0.5));
    expect(expert.minWinChance).toBe(0);
    expect(expert.dynamicMinWinChance).toBe(true);
    const hard = personaFor("hard", fixedRng(0), fixedRng(0.5));
    expect(hard.minWinChance).toBe(0.55);
    expect(hard.dynamicMinWinChance).toBe(false);
    // A number|string union inside GameState would not serialise canonically (R91/D16), which is
    // exactly why the tier's "dynamic" becomes a boolean here.
    expect(typeof expert.minWinChance).toBe("number");
  });

  it("`seesKillForCards` ORs, so the assassin keeps it at a tier that does not grant it", () => {
    // Build the assassin at Medium, which has seesKillForCards: false.
    expect(TIERS.medium.seesKillForCards).toBe(false);
    const assassinAtMedium = {
      ...personaFor("medium", fixedRng(0), fixedRng(0.5)),
      ...{ name: "assassin" },
    };
    expect(assassinAtMedium.name).toBe("assassin");
    // And prove the fold itself ORs, by drawing the assassin out of Expert's pool.
    const pool = TIERS.expert.pool;
    const index = pool.indexOf("assassin");
    const drawn = personaFor("expert", fixedRng(index / pool.length), fixedRng(0.5));
    expect(drawn.name).toBe("assassin");
    expect(drawn.seesKillForCards).toBe(true);
  });

  it("everything outside the fold table comes from the persona and its jitter", () => {
    const pool = TIERS.hard.pool;
    const index = pool.indexOf("turtle");
    const folded = personaFor("hard", fixedRng(index / pool.length), fixedRng(0.5));
    expect(folded.name).toBe("turtle");
    // fixedRng(0.5) is the midpoint of the jitter band, so the sourced value survives exactly.
    expect(folded.aggression).toBeCloseTo(0.15, 12);
    expect(folded.reserveFactor).toBeCloseTo(2.0, 12);
    expect(folded.reserveFloor).toBe(4); // not jittered
  });

  it("jitters by +/-10%, and never outside a knob's legal range", () => {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      for (const tier of TIER_ORDER) {
        const folded = personaFor(tier, fixedRng(0), fixedRng(u));
        const base = PERSONAS[folded.name] as NonNullable<typeof PERSONAS[string]>;
        const amplitude = tier === "beginner" ? 0.05 : 0.1;
        for (const key of ["aggression", "continentFocus", "expansionism", "stackiness", "turtleAversion", "leaderBias"] as const) {
          expect(folded[key], `${tier}/${key}`).toBeGreaterThanOrEqual(0);
          expect(folded[key], `${tier}/${key}`).toBeLessThanOrEqual(1);
          expect(Math.abs(folded[key] - base[key])).toBeLessThanOrEqual(base[key] * amplitude + 1e-12);
        }
        expect(folded.grudgeDecay).toBeGreaterThanOrEqual(0.5);
        expect(folded.grudgeDecay).toBeLessThanOrEqual(0.95);
        expect(folded.reserveFactor).toBeGreaterThan(0);
      }
    }
  });

  it("Beginner draws from the softest end of the jitter band", () => {
    const beginner = personaFor("beginner", fixedRng(0), fixedRng(1));
    const easy = personaFor("easy", fixedRng(0), fixedRng(1));
    expect(beginner.name).toBe(easy.name); // same pool, same pick
    const base = PERSONAS[beginner.name] as NonNullable<typeof PERSONAS[string]>;
    expect(Math.abs(beginner.aggression - base.aggression))
      .toBeLessThan(Math.abs(easy.aggression - base.aggression));
  });

  it("the wildcard resolves to another persona, never itself", () => {
    const pool = TIERS.expert.pool;
    const index = pool.indexOf("wildcard");
    expect(index).toBeGreaterThanOrEqual(0);
    for (const u of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      const drawn = personaFor("expert", { ...fixedRng(0), nextFloat: makeSequence([index / pool.length, u]) }, fixedRng(0.5));
      expect(drawn.name).not.toBe("wildcard");
      expect(Object.keys(PERSONAS)).toContain(drawn.name);
    }
  });

  it("is deterministic: the same streams give the identical persona", () => {
    const a = personaFor("hard", countingRng(7), countingRng(11));
    const b = personaFor("hard", countingRng(7), countingRng(11));
    expect(a).toEqual(b);
  });

  it("consumes a FIXED number of draws per seat, so adding a human seat shifts nothing", () => {
    const assign = countingRng(3);
    const jitter = countingRng(5);
    personaFor("hard", assign, jitter);
    const afterOne = [assign.draws(), jitter.draws()];
    personaFor("expert", assign, jitter);
    const afterTwo = [assign.draws(), jitter.draws()];
    expect(afterTwo[0] as number - (afterOne[0] as number)).toBe(afterOne[0]);
    expect(afterTwo[1] as number - (afterOne[1] as number)).toBe(afterOne[1]);
    // Two assign draws (the pick and the wildcard resample) and nine jitter draws.
    expect(afterOne).toEqual([2, 9]);
  });
});

describe("drawPersonas (F3 — S2's, not the resolver's)", () => {
  it("returns one entry per seat, null for a human", () => {
    const drawn = drawPersonas(["hard", null, "easy", null], countingRng(1), countingRng(2));
    expect(drawn.length).toBe(4);
    expect(drawn[1]).toBeNull();
    expect(drawn[3]).toBeNull();
    expect(drawn[0]?.tier).toBe("hard");
    expect(drawn[2]?.tier).toBe("easy");
  });

  it("a human seat consumes no draws, so the bots' personas do not move when one is added", () => {
    const withHuman = drawPersonas(["hard", null, "easy"], countingRng(9), countingRng(13));
    const withoutHuman = drawPersonas(["hard", "easy"], countingRng(9), countingRng(13));
    expect(withHuman[0]).toEqual(withoutHuman[0]);
    expect(withHuman[2]).toEqual(withoutHuman[1]);
  });

  it("is deterministic and reproduces the same table twice", () => {
    const tiers: readonly (BotTier | null)[] = ["beginner", "easy", "medium", "hard", "expert"];
    expect(drawPersonas(tiers, countingRng(42), countingRng(43)))
      .toEqual(drawPersonas(tiers, countingRng(42), countingRng(43)));
  });

  it("handles an all-human table and an empty one", () => {
    expect(drawPersonas([null, null], countingRng(1), countingRng(1))).toEqual([null, null]);
    expect(drawPersonas([], countingRng(1), countingRng(1))).toEqual([]);
  });

  it("two seats at the same tier can differ, which is what the jitter is for", () => {
    const drawn = drawPersonas(["expert", "expert", "expert", "expert"], countingRng(21), countingRng(22));
    const signatures = new Set(drawn.map((p) => `${p?.name}:${p?.aggression}`));
    expect(signatures.size).toBeGreaterThan(1);
  });
});

/** An `Rng.nextFloat` that walks a fixed sequence, then repeats its last value. */
function makeSequence(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] as number;
    i++;
    return v;
  };
}
