/**
 * Kirby's Inhale, the pure parts (Plan 5, Task 9): the Copy Ability's merged
 * definition, the spit star's damage table, the hold and flight lengths, and
 * the chance of losing a copy to a hit.
 *
 * Sources:
 * - SmashWiki "Kirby (SSBU)/Neutral special"
 *   (https://www.ssbwiki.com/Kirby_(SSBU)/Neutral_special): the hold, "180 +
 *   1.1t - k"; the star's damage by weight (the table, 62 - 68: 10% … 135: 21%);
 *   the star's duration, "25 + 0.5t, with a maximum of 60"; "Copy Ability damage
 *   multiplier 1.2"; "Period before Copy Ability can be lost by damage taken
 *   1200 frames (6.0.0 onward)"; "Chance to lose Copy Ability by damage taken
 *   (this * damage / 0.7) 0.7 (6.0.0 onward)".
 * - SmashWiki "Kirby (SSBU)" (https://www.ssbwiki.com/Kirby_(SSBU)): "the chance
 *   for Kirby to lose his Copy Ability by getting hit is equal to the damage %
 *   taken"; 6.0.0, "Chance to lose: Damage Received/70 * 100% → Damage
 *   Received/70 * 70%".
 * - SmashWiki "Inhale (Kirby)" (https://www.ssbwiki.com/Inhale_(Kirby)): "If a
 *   Kirby swallows a Kirby with a Copy Ability, he will steal it away from them";
 *   "If a Kirby attempts to copy another Kirby that has no Copy Ability, the
 *   swallowed Kirby will pop out normally".
 */

import { describe, expect, it } from "vitest";

import { gameScriptFor } from "./acmd/legacy";
import { ONE, fx, randomInt } from "./fixed";
import { emptyCombat } from "./combat";
import { COPY_DAMAGE, COPY_GRACE_FRAMES, abilityFromSwallow, maybeLoseCopy, starDamage, swallowVictim, withCopyAbility } from "./inhale";
import "./status";
import { STAR_MAX_FRAMES, inhaleHoldFrames, starFrames } from "./status/inhale";
import type { FighterDef, FighterState, GameState, MoveDef } from "./types";

function def(id: string, damage: number, inhale = false): FighterDef {
  const neutralB = {
    slot: "neutralB",
    name: `${id} B`,
    totalFrames: 30,
    hitboxes: [{ id: 0, startFrame: 5, endFrame: 6, x: 0, y: 0, radius: 1, damage, angle: 0, baseKnockback: 0, knockbackGrowth: 0 }],
    ...(inhale ? { inhale: { swallow: "inhaleSwallow", spit: "inhaleSpit" } } : {}),
  } as MoveDef;
  return { id, moves: { neutralB } } as unknown as FighterDef;
}

describe("withCopyAbility (Plan 5)", () => {
  it("gives Kirby the copied neutral special at ×1.2", () => {
    const kirby = def("kirby", 1);
    const mario = def("mario", 5);
    const out = withCopyAbility(kirby, mario);
    expect(out.moves.neutralB?.name).toBe("mario B");
    expect(out.moves.neutralB?.copyDamage).toBe(COPY_DAMAGE);
    expect(withCopyAbility(kirby, mario)).toBe(out);
    expect(withCopyAbility(kirby, null)).toBe(kirby);
  });

  it("never hands one context's merged definition to another holding different definitions under the same ids", () => {
    const a = withCopyAbility(def("kirby", 1), def("mario", 5));
    const b = withCopyAbility(def("kirby", 1), def("mario", 9));
    expect(a).not.toBe(b);
    expect(a.moves.neutralB?.hitboxes[0].damage).toBe(5);
    expect(b.moves.neutralB?.hitboxes[0].damage).toBe(9);
  });

  it("runs the copied fighter's own script for it, the one made ready at load, not a second compile", () => {
    const mario = def("mario", 5);
    const out = withCopyAbility(def("kirby", 1), mario);
    expect(gameScriptFor(out, "neutralB")).toBe(gameScriptFor(mario, "neutralB"));
  });

  it("is 1.2 exactly, in Q12", () => {
    expect(COPY_DAMAGE).toBe(fx(1.2));
    expect(COPY_GRACE_FRAMES).toBe(1200);
  });
});

describe("the catch", () => {
  it("makes the fighter caught intangible from its own frame, holds it for 180 + 1.1t − k, and puts both in their statuses", () => {
    const kirby = { action: "special", actionFrame: 9, move: "neutralB", damage: fx(30), combat: emptyCombat() } as unknown as FighterState;
    const victim = { action: "stand", actionFrame: 4, move: null, damage: fx(20), intangible: 0, grabTimer: 0, combat: emptyCombat() } as unknown as FighterState;
    swallowVictim(kirby, victim);
    expect(victim.intangible).toBeGreaterThan(0);
    expect(victim.grabTimer).toBe(inhaleHoldFrames(fx(20), fx(30)));
    expect(victim.combat.grabLength).toBe(victim.grabTimer);
    expect(victim).toMatchObject({ action: "swallowed", actionFrame: 0 });
    expect(kirby).toMatchObject({ action: "inhaleHold", actionFrame: 0, move: null });
  });
});

describe("what a swallow copies (SmashWiki \"Inhale (Kirby)\")", () => {
  const kirby = def("kirby", 1, true);
  const victim = (defId: string, copy: string) => ({ defId, combat: { copy } }) as unknown as FighterState;

  it("copies any other fighter's own neutral special", () => {
    expect(abilityFromSwallow(def("mario", 5), victim("mario", ""))).toBe("mario");
  });

  it("steals a swallowed Kirby's Copy Ability, and copies nothing from one without", () => {
    expect(abilityFromSwallow(kirby, victim("kirby", "fox"))).toBe("fox");
    expect(abilityFromSwallow(kirby, victim("kirby", ""))).toBe("");
  });
});

describe("the spit star's damage, by the spat fighter's weight (SmashWiki's table)", () => {
  // Each published row: its weight range and damage.
  const ROWS: readonly [lo: number, hi: number, damage: number][] = [
    [62, 68, 10],
    [75, 81, 12],
    [82, 87, 13],
    [88, 94, 14],
    [95, 100, 15],
    [101, 107, 16],
    [108, 113, 17],
    [116, 118, 18],
    [127, 133, 20],
    [135, 135, 21],
  ];

  it.each(ROWS)("weights %i to %i take %i%%", (lo, hi, damage) => {
    for (let w = lo; w <= hi; w++) expect(starDamage(w), `weight ${w}`).toBe(damage);
  });

  it("gives the roster's weights their rows (Mario 98: 15%, Donkey Kong 127: 20%, Fox 77: 12%)", () => {
    expect(starDamage(98)).toBe(15);
    expect(starDamage(127)).toBe(20);
    expect(starDamage(77)).toBe(12);
    expect(starDamage(108)).toBe(17);
  });

  // UNVERIFIED: the table skips 69-74, 114-115 and 119-126; a weight in a gap
  // takes the row below it.
  it("gives a weight between published rows the row below it (UNVERIFIED)", () => {
    expect(starDamage(70)).toBe(10);
    expect(starDamage(114)).toBe(17);
    expect(starDamage(120)).toBe(18);
    expect(starDamage(134)).toBe(20);
    expect(starDamage(50)).toBe(10);
  });
});

describe("the hold and the flight", () => {
  it("holds 180 + 1.1t − k frames, t the held fighter's percent and k Kirby's", () => {
    expect(inhaleHoldFrames(0, 0)).toBe(180);
    expect(inhaleHoldFrames(fx(50), fx(20))).toBe(215);
    // UNVERIFIED: rounded down, as the grab's 90 + 1.7p is.
    expect(inhaleHoldFrames(fx(15), 0)).toBe(196);
  });

  it("flies a spat fighter 25 + 0.5t frames, 60 at most", () => {
    expect(starFrames(0)).toBe(25);
    expect(starFrames(fx(40))).toBe(45);
    expect(starFrames(fx(70))).toBe(STAR_MAX_FRAMES);
    expect(starFrames(fx(150))).toBe(60);
  });
});

describe("losing a Copy Ability to a hit", () => {
  function kirbyState(copy: string, copyFrames: number, seed: number): { s: GameState; f: FighterState } {
    const f = { combat: { copy, copyFrames } } as unknown as FighterState;
    return { s: { rngSeed: seed, fighters: [f] } as unknown as GameState, f };
  }

  it("never draws, or loses it, inside the 1200-frame grace", () => {
    const { s, f } = kirbyState("mario", COPY_GRACE_FRAMES - 1, 77);
    maybeLoseCopy(s, f, fx(100));
    expect(f.combat.copy).toBe("mario");
    expect(s.rngSeed).toBe(77);
  });

  it("draws nothing without a copy, or for a hit that deals nothing", () => {
    const none = kirbyState("", 5000, 77);
    maybeLoseCopy(none.s, none.f, fx(30));
    expect(none.s.rngSeed).toBe(77);
    const zero = kirbyState("mario", 5000, 77);
    maybeLoseCopy(zero.s, zero.f, 0);
    expect(zero.s.rngSeed).toBe(77);
    expect(zero.f.combat.copy).toBe("mario");
  });

  it("after the grace, loses it with chance damage / 100, drawn once from the match's seeded RNG", () => {
    // The draw, done by hand: an integer in [0, 100%) against the damage, Q12.
    let lost = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const { s, f } = kirbyState("mario", COPY_GRACE_FRAMES, seed);
      maybeLoseCopy(s, f, fx(25));
      const r = randomInt(seed, 100 * ONE);
      expect(s.rngSeed, `seed ${seed}`).toBe(r.seed);
      expect(f.combat.copy === "", `seed ${seed}`).toBe(r.value < fx(25));
      if (f.combat.copy === "") lost += 1;
    }
    // About a quarter of 400.
    expect(lost).toBeGreaterThan(70);
    expect(lost).toBeLessThan(130);
  });

  it("always loses it to a hit of 100% or more", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { s, f } = kirbyState("mario", COPY_GRACE_FRAMES, seed);
      maybeLoseCopy(s, f, fx(100));
      expect(f.combat.copy).toBe("");
    }
  });
});
