import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ONE, fx, toFloat } from "./fixed";
import {
  attackerShieldPushback,
  mashFrames,
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
