import { describe, expect, it } from "vitest";

import { ONE, fx, toFloat } from "./fixed";
import { chargedHitbox } from "./specialCharge";
import type { Hitbox } from "./types";

const BASE: Hitbox = {
  id: 0,
  startFrame: 1,
  endFrame: 60,
  x: 0,
  y: 0,
  radius: fx(1.9),
  damage: fx(5),
  angle: fx(361),
  baseKnockback: fx(14),
  knockbackGrowth: fx(42),
};
// Samus's Charge Shot, SmashWiki "Samus (SSBU)/Neutral special"
// (https://www.ssbwiki.com/Samus_(SSBU)/Neutral_special): 5 + 23·c/112,
// BK 14 + 32·c/112, KS 42 + 8·c/112, radius 1.9 + 6.1·c/112; 28% at angle 40 full.
const FULL = { damage: fx(28), angle: fx(40), baseKnockback: fx(46), knockbackGrowth: fx(50), radius: fx(8) };

describe("chargedHitbox", () => {
  it("is the authored hitbox uncharged", () => {
    expect(chargedHitbox(BASE, FULL, 0)).toEqual(BASE);
  });

  it("is the full-charge hitbox at a full charge, angle included", () => {
    const h = chargedHitbox(BASE, FULL, ONE);
    expect(h.damage).toBe(fx(28));
    expect(h.angle).toBe(fx(40));
    expect(h.baseKnockback).toBe(fx(46));
    expect(h.knockbackGrowth).toBe(fx(50));
    expect(h.radius).toBe(fx(8));
  });

  it("interpolates the numbers linearly, but keeps the uncharged angle until full", () => {
    const h = chargedHitbox(BASE, FULL, ONE / 2);
    expect(h.damage).toBe(fx(5) + Math.trunc((fx(28) - fx(5)) / 2));
    expect(h.baseKnockback).toBe(fx(14) + Math.trunc((fx(46) - fx(14)) / 2));
    expect(h.angle).toBe(fx(361));
  });

  it("leaves a hitbox with no full-charge entry alone", () => {
    expect(chargedHitbox(BASE, undefined, ONE)).toBe(BASE);
  });
});

describe("partly charged, per SmashWiki's formula for the move", () => {
  const SWORD: Hitbox = { ...BASE, damage: fx(9), angle: fx(361), baseKnockback: fx(60), knockbackGrowth: fx(100) };
  const t = (c: number, frames: number) => Math.trunc((c * ONE) / frames);

  it("multiplies the damage alone (Shield Breaker: 1 + 1.2·c/60, 19.62% a frame before full)", () => {
    const h = chargedHitbox(SWORD, { damage: fx(24) }, t(59, 60), { kind: "multiply", by: fx(1.2) });
    expect(toFloat(h.damage)).toBeCloseTo(19.62, 2);
    expect(h.baseKnockback).toBe(fx(60));
    expect(chargedHitbox(SWORD, { damage: fx(24) }, ONE, { kind: "multiply", by: fx(1.2) }).damage).toBe(fx(24));
  });

  it("adds to the damage alone (Hammer Flip: 0.085% a frame, 29.115% a frame before full, then 35%)", () => {
    const hammer: Hitbox = { ...BASE, damage: fx(19), angle: fx(48) };
    const near = chargedHitbox(hammer, { damage: fx(35), angle: fx(361) }, t(119, 120), { kind: "add", total: fx(10.2) });
    expect(toFloat(near.damage)).toBeCloseTo(29.115, 2);
    expect(near.angle).toBe(fx(48));
    const full = chargedHitbox(hammer, { damage: fx(35), angle: fx(361) }, ONE, { kind: "add", total: fx(10.2) });
    expect(full.damage).toBe(fx(35));
    expect(full.angle).toBe(fx(361));
  });

  it("rounds down to a whole percent where the formula does (Giant Punch: 10 + 18·c/110)", () => {
    const punch: Hitbox = { ...BASE, damage: fx(10) };
    const rule = { kind: "add", total: fx(18), floor: true } as const;
    expect(chargedHitbox(punch, { damage: fx(28) }, t(109, 110), rule).damage).toBe(fx(27));
    expect(chargedHitbox(punch, { damage: fx(28) }, t(30, 110), rule).damage).toBe(fx(14));
    expect(chargedHitbox(punch, { damage: fx(28) }, ONE, rule).damage).toBe(fx(28));
  });
});
