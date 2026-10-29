import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ONE, byRatio, fx, toFloat } from "./fixed";
import { PERFECT_SHIELD_PUSHBACK_RATIO } from "./constants";
import {
  attackerShieldPushback,
  mashFrames,
  perfectShieldHitlag,
  shieldBreakStun,
  shieldDamage,
  shieldPushback,
  shieldScale,
} from "./shield";
import { emptyCombat } from "./combat";
import { shieldstunExact } from "./knockback";
import * as ref from "../../research/rebuild-2026-10/tools/ssbu_ref.mjs";

describe("shield arithmetic (Plan 3, Task 9)", () => {
  // SmashWiki "Shield" (https://www.ssbwiki.com/Shield), Ultimate: damage ×1.19.
  it("takes 1.19x the hit's damage off the shield", () => {
    expect(toFloat(shieldDamage(fx(10)))).toBeCloseTo(11.9, 3);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 40, noNaN: true }), (d) => {
        expect(Math.abs(toFloat(shieldDamage(fx(d))) - ref.shieldDamage(toFloat(fx(d))))).toBeLessThan(2 / ONE);
      }),
    );
  });

  // SmashWiki "Shield": size = (HP / 50) × 0.85 + 0.15.
  it.each([
    [50, 1],
    [25, 0.575],
    [0, 0.15],
  ])("scales a shield with %f HP to %f of its radius", (hp, scale) => {
    expect(toFloat(shieldScale(fx(hp)))).toBeCloseTo(scale, 3);
  });

  // SmashWiki "Shield": defender pushback (shieldstun + 1) × 0.09, at most 1.3;
  // rubendal `AttackerShieldPushback`: 0.04 × damage + 0.025, none for a projectile.
  // "Shieldstun is not rounded down" (SmashWiki "Shield", pushback table), as in
  // rubendal `ShieldPushback`: ((damage × 0.8 × mults) + 3) × 0.09.
  it("pushes the defender back (shieldstun + 1) x 0.09 on the unrounded shieldstun, capped at 1.3", () => {
    for (let ss = 0; ss <= 30; ss++) {
      expect(toFloat(shieldPushback(ss * ONE))).toBeCloseTo(ref.shieldPushback(ss), 3);
    }
    for (const d of [3, 7.5, 11.2]) {
      expect(toFloat(shieldPushback(shieldstunExact(fx(d))))).toBeCloseTo((d * 0.8 + 3) * 0.09, 3);
    }
    expect(shieldPushback(60 * ONE)).toBe(fx(1.3));
    // A hard smash overflows the cap on the plain path: (40 × 0.8 × 0.725 + 3) × 0.09 = 2.358.
    expect(shieldPushback(shieldstunExact(fx(40), { smash: true }))).toBe(fx(1.3));
  });

  it("pushes a melee attacker back 0.04 x damage + 0.025", () => {
    expect(toFloat(attackerShieldPushback(fx(10)))).toBeCloseTo(0.425, 3);
  });

  // SmashWiki "Stun" (https://www.ssbwiki.com/Stun): from Brawl on, shield-break
  // stun is 400 − p frames; at 400% or more it ends at once.
  it("stuns a broken shield's owner for 400 - percent frames", () => {
    expect(shieldBreakStun(0)).toBe(400);
    expect(shieldBreakStun(fx(99.5))).toBe(300);
    expect(shieldBreakStun(fx(400))).toBe(0);
    expect(shieldBreakStun(fx(999))).toBe(0);
  });

  // SmashWiki "Stun": mashing takes 5.4 frames a button and 3 a stick input in Ultimate.
  it("turns mash presses into whole frames, carrying the fraction", () => {
    const c = emptyCombat();
    // Tenths of a frame: 5.4 a button, 3 a stick input.
    expect(mashFrames(c, 1, 0, 54, 30)).toBe(5);
    expect(mashFrames(c, 1, 0, 54, 30)).toBe(5);
    expect(mashFrames(c, 1, 0, 54, 30)).toBe(6);
    expect(mashFrames(c, 0, 1, 54, 30)).toBe(3);
    expect(mashFrames(c, 0, 0, 54, 30)).toBe(0);
  });
});

describe("perfect shield hitlag (Plan 3, Task 10)", () => {
  // SmashWiki "Perfect shield" (https://www.ssbwiki.com/Perfect_shield), Ultimate,
  // extra hitlag attacker/defender: direct non-projectile +14/+11, indirect
  // non-projectile +14/+2, direct projectile 0/+8, indirect projectile 0/−1.
  it.each([
    [false, true, 24, 21],
    [false, false, 24, 12],
    [true, true, 0, 18],
    [true, false, 0, 9],
  ])("projectile %s, direct %s: attacker %i, defender %i on a 10-frame hit", (projectile, direct, attacker, defender) => {
    expect(perfectShieldHitlag(10, projectile, direct)).toEqual({ attacker, defender });
  });

  it("never freezes anyone for a negative time", () => {
    expect(perfectShieldHitlag(0, true, false)).toEqual({ attacker: 0, defender: 0 });
  });

  // A melee hit with no hitlag of its own (a 0× multiplier) freezes nobody, so
  // the table's +14/+11 and +14/+2 have nothing to be added to. UNVERIFIED: no
  // source rules on it.
  it.each([true, false])("freezes nobody for a melee hit with no hitlag (direct %s)", (direct) => {
    expect(perfectShieldHitlag(0, false, direct)).toEqual({ attacker: 0, defender: 0 });
  });
});

describe("perfect shield pushback (Plan 3, Task 10 fix round 1)", () => {
  // The 0.15 sits inside the formula and the 1.3 cap comes last — SmashWiki
  // "Shield" (https://www.ssbwiki.com/Shield), pushback table;
  // rubendal SSBU-Calculator `ShieldPushback`
  // (https://github.com/rubendal/SSBU-Calculator/blob/master/js/formulas.js):
  // `((… + 3) × 0.09 × perfectshieldMult2)`, then `if (pushback > 1.3)`; and
  // `research/rebuild-2026-10/tools/ssbu_ref.mjs`.
  it("takes 0.15 of (shieldstun + 1) x 0.09 and caps afterwards", () => {
    for (let ss = 0; ss <= 30; ss++) {
      expect(toFloat(shieldPushback(ss * ONE, true))).toBeCloseTo(ref.shieldPushback(ss, true), 3);
    }
    // Far past the cap: (120 + 1) × 0.09 × 0.15 = 1.6335 is still capped at 1.3.
    expect(shieldPushback(120 * ONE, true)).toBe(fx(1.3));
  });

  // Where the order matters: a 40% smash is (40 × 0.8 × 0.725 + 3) × 0.09 = 2.358
  // before the cap. Capping first (1.3) and then taking 0.15 gave 0.195 (798 in
  // Q12); the published order gives 2.358 × 0.15 = 0.3537, which is 1448 in Q12
  // (26.2 × 4096 × 0.09 × 0.15 = 1448.75, truncated once).
  it("applies the factor before the cap: a 40% smash slides 0.354, not 0.195", () => {
    const stun = shieldstunExact(fx(40), { smash: true });
    expect(shieldPushback(stun, true)).toBe(1448);
    expect(toFloat(shieldPushback(stun, true))).toBeCloseTo(ref.shieldPushback(40 * 0.8 * 0.725 + 2, true), 3);
    // The old order, for the record: cap first, then the factor.
    expect(byRatio(shieldPushback(stun), PERFECT_SHIELD_PUSHBACK_RATIO)).toBe(798);
  });
});
