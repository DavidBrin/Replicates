import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ONE, fx, toFloat } from "./fixed";
import {
  BALLOON_ANGLE_MAX,
  BALLOON_ANGLE_MIN,
  DI_MAX_DEVIATION,
  SAKURAI_AIRBORNE,
  SAKURAI_ANGLE,
  SAKURAI_GROUNDED,
} from "./constants";
import {
  applyDI,
  applyLSI,
  computeHitlag,
  computeHitstun,
  computeKnockback,
  computeRage,
  computeShieldstun,
  computeStaleness,
  knockbackToVelocity,
  normalizeAngle,
  resolveAngle,
  toWorldAngle,
} from "./knockback";
import type { MoveSlot } from "./types";

/**
 * Mario's up smash, as the research records it: 19.6%, base knockback 32,
 * knockback growth 94. Every worked example below is this move, because it is
 * the one the research computed by hand against three different victims.
 */
const MARIO_USMASH = {
  damage: fx(19.6),
  baseKnockback: fx(32),
  knockbackGrowth: fx(94),
};

/** Knockback against a victim at `percentBefore`, in real units. */
function kbAgainst(weight: number, percentBefore: number): number {
  return toFloat(
    computeKnockback({
      // The formula's `p` is the percent *after* the hit, so the damage lands first.
      percent: fx(percentBefore) + MARIO_USMASH.damage,
      damage: MARIO_USMASH.damage,
      weight,
      baseKnockback: MARIO_USMASH.baseKnockback,
      knockbackGrowth: MARIO_USMASH.knockbackGrowth,
    }),
  );
}

describe("computeKnockback", () => {
  it("matches the worked example against Bowser at 0%", () => {
    expect(kbAgainst(135, 0)).toBeCloseTo(72.6, 0);
    expect(Math.abs(kbAgainst(135, 0) - 72.63)).toBeLessThan(0.5);
  });

  it("matches the worked example against Jigglypuff at 0%", () => {
    expect(Math.abs(kbAgainst(68, 0) - 82.08)).toBeLessThan(0.5);
  });

  it("matches the worked example against Bowser at 60%", () => {
    expect(Math.abs(kbAgainst(135, 60) - 145.2)).toBeLessThan(0.5);
  });

  it("treats weight 100 as the weight-independent case", () => {
    // 200/(100+100) is exactly 1, so the weight term drops out of the formula.
    const p = fx(19.6);
    const kb = computeKnockback({
      percent: p,
      damage: fx(19.6),
      weight: 100,
      baseKnockback: 0,
      knockbackGrowth: fx(100),
    });
    // (19.6/10 + 19.6*19.6/20) * 1 * 1.4 + 18 = 47.63
    expect(toFloat(kb)).toBeCloseTo(47.64, 1);
  });

  it("ignores percent, weight and rage for a set-knockback hitbox", () => {
    const base = { damage: fx(12), baseKnockback: fx(60), knockbackGrowth: fx(100), setKnockback: true };
    const low = computeKnockback({ ...base, percent: 0, weight: 68 });
    const high = computeKnockback({ ...base, percent: fx(200), weight: 135, rage: fx(1.1) });
    expect(low).toBe(fx(60));
    expect(high).toBe(fx(60));
  });

  it("applies the crouch-cancel and grounded-meteor multipliers", () => {
    const args = {
      percent: fx(50),
      damage: fx(12),
      weight: 98,
      baseKnockback: fx(30),
      knockbackGrowth: fx(100),
    };
    const plain = computeKnockback(args);
    expect(toFloat(computeKnockback({ ...args, crouchCancel: true }))).toBeCloseTo(
      toFloat(plain) * 0.85,
      1,
    );
    expect(toFloat(computeKnockback({ ...args, groundedMeteor: true }))).toBeCloseTo(
      toFloat(plain) * 0.8,
      1,
    );
  });

  it("rises monotonically with the victim's percent", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }), (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return kbAgainst(98, lo) <= kbAgainst(98, hi);
      }),
    );
  });

  it("sends a heavier victim less far from an identical hit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 140 }),
        fc.integer({ min: 60, max: 140 }),
        fc.integer({ min: 0, max: 300 }),
        (a, b, percent) => {
          const light = Math.min(a, b);
          const heavy = Math.max(a, b);
          return kbAgainst(light, percent) >= kbAgainst(heavy, percent);
        },
      ),
    );
  });
});

describe("computeHitstun", () => {
  it("is floor(kb * 0.4) - 1", () => {
    expect(computeHitstun(fx(100))).toBe(39);
    expect(computeHitstun(fx(50))).toBe(19);
  });

  it("grows at 0.25 per unit past 200 knockback", () => {
    // 200*0.4 = 80, then (300-200)*0.25 = 25, minus Ultimate's extra frame.
    expect(computeHitstun(fx(300))).toBe(104);
  });

  it("never goes negative", () => {
    expect(computeHitstun(0)).toBe(0);
    expect(computeHitstun(fx(1))).toBe(0);
  });

  it("crosses into tumble at 32 frames, which is just past 82 knockback", () => {
    // 82.5 * 0.4 - 1 is exactly 32, so anything above it tumbles.
    expect(computeHitstun(fx(85))).toBeGreaterThanOrEqual(32);
    expect(computeHitstun(fx(82))).toBeLessThan(32);
  });

  it("applies 0.4 exactly, not the Q12 approximation of it", () => {
    // fx(0.4) is 0.39990, which would floor 100 knockback to 38 frames.
    expect(computeHitstun(fx(100))).toBe(39);
    expect(computeHitstun(fx(200))).toBe(79);
  });
});

describe("computeRage", () => {
  it("does nothing below 35%", () => {
    expect(computeRage(0)).toBe(ONE);
    expect(computeRage(fx(34))).toBe(ONE);
    expect(computeRage(fx(35))).toBe(ONE);
  });

  it("reaches 1.1x at 150% and stops there", () => {
    expect(toFloat(computeRage(fx(150)))).toBeCloseTo(1.1, 3);
    expect(computeRage(fx(300))).toBe(computeRage(fx(150)));
  });

  it("is halfway at 92.5%", () => {
    expect(toFloat(computeRage(fx(92.5)))).toBeCloseTo(1.05, 3);
  });
});

describe("computeHitlag", () => {
  it("is floor(damage * 0.65 + 6)", () => {
    expect(computeHitlag(fx(10))).toBe(12);
    expect(computeHitlag(0)).toBe(6);
  });

  it("stretches electric hits by 1.5 and shrinks shielded ones by 0.67", () => {
    expect(computeHitlag(fx(10), { electric: true })).toBe(18);
    expect(computeHitlag(fx(10), { shielding: true })).toBe(8);
  });

  it("caps at 30 frames", () => {
    expect(computeHitlag(fx(100))).toBe(30);
    expect(computeHitlag(fx(40), { electric: true })).toBe(30);
  });
});

describe("computeShieldstun", () => {
  it("is floor(0.8 * damage + 2) for a plain hit", () => {
    expect(computeShieldstun(fx(10))).toBe(10);
  });

  it("cuts smashes to 0.725 and aerials to 0.33", () => {
    expect(computeShieldstun(fx(10), { smash: true })).toBe(7);
    expect(computeShieldstun(fx(10), { aerial: true })).toBe(4);
  });

  it("takes a further 0.29 off a projectile", () => {
    expect(computeShieldstun(fx(10), { projectile: true })).toBe(4);
  });

  it("caps at 60 frames", () => {
    expect(computeShieldstun(fx(500))).toBe(60);
  });
});

describe("computeStaleness", () => {
  const slot: MoveSlot = "fair";

  it("gives a move absent from the queue the 1.05x freshness bonus", () => {
    const s = computeStaleness([], slot);
    expect(toFloat(s.damage)).toBeCloseTo(1.05, 3);
  });

  it("takes 9% off for the most recent slot and 1% for the oldest", () => {
    const recent = computeStaleness([slot], slot);
    expect(toFloat(recent.damage)).toBeCloseTo(0.96, 3);

    const oldest: MoveSlot[] = ["jab1", "jab1", "jab1", "jab1", "jab1", "jab1", "jab1", "jab1", slot];
    expect(toFloat(computeStaleness(oldest, slot).damage)).toBeCloseTo(1.04, 3);
  });

  it("bottoms out at 0.6x with the whole queue full of one move", () => {
    const queue = new Array<MoveSlot>(9).fill(slot);
    expect(toFloat(computeStaleness(queue, slot).damage)).toBeCloseTo(0.6, 3);
  });

  it("damps the knockback effect to 0.3 of the damage effect", () => {
    const queue = new Array<MoveSlot>(9).fill(slot);
    const s = computeStaleness(queue, slot);
    // Damage falls 40%; knockback should fall only 12%.
    expect(toFloat(s.damage)).toBeCloseTo(0.6, 3);
    expect(toFloat(s.knockback)).toBeCloseTo(0.88, 2);
  });

  it("ignores anything past the ninth slot", () => {
    const queue: MoveSlot[] = [
      "jab1", "jab1", "jab1", "jab1", "jab1", "jab1", "jab1", "jab1", "jab1", slot,
    ];
    expect(computeStaleness(queue, slot).damage).toBe(computeStaleness([], slot).damage);
  });
});

describe("applyDI", () => {
  it("does nothing with the stick at neutral", () => {
    expect(applyDI(fx(45), 0, 0)).toBe(fx(45));
  });

  it("does nothing when the stick points along the launch", () => {
    // Straight up the launch direction has no perpendicular component at all.
    expect(applyDI(fx(90), 0, 1)).toBe(fx(90));
  });

  it("bends the angle by the full 9.74 degrees at perpendicular", () => {
    const bent = applyDI(fx(0), 0, 1);
    expect(toFloat(bent - fx(0))).toBeCloseTo(toFloat(DI_MAX_DEVIATION), 2);
  });

  it("bends the other way for the opposite perpendicular", () => {
    expect(applyDI(fx(0), 0, -1)).toBeLessThan(fx(0));
  });

  it("never deviates more than 9.74 degrees", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -720, max: 720 }),
        fc.integer({ min: -1, max: 1 }),
        fc.integer({ min: -1, max: 1 }),
        (deg, sx, sy) => {
          const angle = fx(deg);
          const bent = applyDI(angle, sx, sy);
          return Math.abs(bent - angle) <= DI_MAX_DEVIATION;
        },
      ),
    );
  });
});

describe("applyLSI", () => {
  it("scales a horizontal launch up by 1.095 and down by 0.92", () => {
    expect(toFloat(applyLSI(fx(10), 1, fx(0)))).toBeCloseTo(10.95, 1);
    expect(toFloat(applyLSI(fx(10), -1, fx(0)))).toBeCloseTo(9.2, 1);
  });

  it("does nothing inside the 65-115 degree dead zone", () => {
    expect(applyLSI(fx(10), 1, fx(90))).toBe(fx(10));
    expect(applyLSI(fx(10), -1, fx(70))).toBe(fx(10));
    expect(applyLSI(fx(10), 1, fx(114))).toBe(fx(10));
  });

  it("mirrors the dead zone for a straight-down launch", () => {
    expect(applyLSI(fx(10), 1, fx(270))).toBe(fx(10));
  });

  it("does nothing with the stick at neutral", () => {
    expect(applyLSI(fx(10), 0, fx(0))).toBe(fx(10));
  });
});

describe("resolveAngle", () => {
  it("sends a grounded victim flat and an airborne one at 44 degrees", () => {
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, true)).toBe(SAKURAI_GROUNDED);
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, false)).toBe(SAKURAI_AIRBORNE);
  });

  it("leaves an ordinary angle alone", () => {
    expect(resolveAngle({ angle: fx(45) }, true)).toBe(fx(45));
  });
});

describe("knockbackToVelocity", () => {
  it("converts knockback to speed at 0.03 per unit", () => {
    const v = knockbackToVelocity(fx(100), fx(0), 1);
    expect(toFloat(v.speed)).toBeCloseTo(3, 2);
    expect(toFloat(v.vx)).toBeCloseTo(3, 1);
    expect(toFloat(v.vy)).toBeCloseTo(0, 1);
  });

  it("mirrors the horizontal component by the attacker's facing", () => {
    const right = knockbackToVelocity(fx(100), fx(45), 1);
    const left = knockbackToVelocity(fx(100), fx(45), -1);
    expect(left.vx).toBe(-right.vx);
    expect(left.vy).toBe(right.vy);
  });

  it("flags balloon knockback between 70 and 110 degrees", () => {
    expect(knockbackToVelocity(fx(100), BALLOON_ANGLE_MIN, 1).balloon).toBe(true);
    expect(knockbackToVelocity(fx(100), fx(90), 1).balloon).toBe(true);
    expect(knockbackToVelocity(fx(100), BALLOON_ANGLE_MAX, 1).balloon).toBe(true);
    expect(knockbackToVelocity(fx(100), fx(45), 1).balloon).toBe(false);
  });

  it("decides balloon from the angle it is given, once", () => {
    // The classification is a property of the *launch*, not of the velocity it
    // produces — the velocity changes every frame afterwards. `physics.test.ts`
    // covers what that buys; this is the source of truth it is read from.
    expect(knockbackToVelocity(fx(120), fx(69.9), 1).balloon).toBe(false);
    expect(knockbackToVelocity(fx(120), fx(110.1), 1).balloon).toBe(false);
  });
});

describe("angle helpers", () => {
  it("normalises into [0, 360)", () => {
    expect(normalizeAngle(fx(-90))).toBe(fx(270));
    expect(normalizeAngle(fx(450))).toBe(fx(90));
  });

  it("mirrors an attacker-relative angle into world space", () => {
    expect(toWorldAngle(fx(45), 1)).toBe(fx(45));
    expect(toWorldAngle(fx(45), -1)).toBe(fx(135));
  });
});

/*
 * Regression tests for the second review round.
 *
 * Both of these are boundary cases: the arithmetic was "nearly" right, and
 * nearly right at a `floor` is a whole frame wrong.
 */
describe("truncating between multipliers crosses frame boundaries", () => {
  it("combines shieldstun's multipliers before its single floor", () => {
    // Reachable in play: Marth's down smash body hit (8%), charged 22 frames,
    // sitting in the stale queue at two reductions. Applying 0.8 and then 0.725
    // with a truncation between them lands on 6; the formula has exactly one
    // floor and gives 7. One frame decides whether the move is punishable.
    const damage = 35311; // 8.6208... in Q12
    expect(computeShieldstun(damage, { smash: true })).toBe(7);
  });

  it("does not let the 0.8 and 0.725 constants drift on their own", () => {
    // The same call with the ratios applied one at a time, spelled out, so this
    // test fails if anyone reintroduces the chain.
    const damage = 35311;
    const chained = Math.trunc((Math.trunc((damage * 4) / 5) * 29) / 40);
    const combined = Math.trunc((damage * 4 * 29) / (5 * 40));
    expect(combined).toBeGreaterThan(chained);
    expect(Math.floor((combined + ONE * 2) / ONE)).toBe(7);
    expect(Math.floor((chained + ONE * 2) / ONE)).toBe(6);
  });

  it("keeps hitlag's +6 out of a truncated product", () => {
    // floor(20 x 0.65 + 6) is 19. Applying fx(0.65) — which is 0.64990 — and
    // truncating first gives 18.
    expect(computeHitlag(fx(20))).toBe(19);
  });
});
