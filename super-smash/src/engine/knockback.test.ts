import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ONE, cosDeg, fx, sinDeg, toFloat } from "./fixed";
import {
  BALLOON_ANGLE_MAX,
  BALLOON_ANGLE_MIN,
  DI_MAX_DEVIATION,
  SAKURAI_AIRBORNE,
  SAKURAI_ANGLE,
  SAKURAI_GROUNDED,
  SOFT_DI_SHIFT,
  TUMBLE_HITSTUN,
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
  damageSpeedUpMag,
  damageSpeedUpMaxMag,
  effectiveHitstun,
  knockbackToVelocity,
  normalizeAngle,
  resolveAngle,
  stickSensibility,
  toWorldAngle,
} from "./knockback";
import type { MoveSlot } from "./types";
import * as ref from "../../research/rebuild-2026-10/tools/ssbu_ref.mjs";

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

  // rubendal SSBU-Calculator `Hitstun`: the base is floor(kb × 0.4) − 1 at any
  // knockback. The shallower slope past 200 is what the balloon speed-up does to
  // it (`effectiveHitstun`), not part of the base.
  it("keeps the 0.4 slope past 200 knockback", () => {
    expect(computeHitstun(fx(300))).toBe(119);
  });

  // SmashWiki "Hitstun" (https://www.ssbwiki.com/Hitstun): flinching attacks
  // "always inflict a minimum of 4 frames of hitstun"; rubendal: `if (hitstun < 5) hitstun = 5`.
  it("never inflicts fewer than 4 frames", () => {
    expect(computeHitstun(0)).toBe(4);
    expect(computeHitstun(fx(1))).toBe(4);
    expect(computeHitstun(fx(12.5))).toBe(4);
    expect(computeHitstun(fx(15))).toBe(5);
  });

  // ssbu_ref.mjs `isTumble`: `floor(kb × 0.4) − 1 + 1 ≥ 32`, i.e. kb ≥ 80 —
  // tumble is the reaction frames (hitstun + 1) reaching 32, as in rubendal
  // SSBU-Calculator (https://github.com/rubendal/SSBU-Calculator), whose
  // `Hitstun` is `floor(kb × 0.4) − 1`. In hitstun frames that is 31.
  it("crosses into tumble at 80 knockback: 31 frames of hitstun, 32 reaction frames", () => {
    expect(computeHitstun(fx(79.9))).toBeLessThan(TUMBLE_HITSTUN);
    expect(computeHitstun(fx(80))).toBeGreaterThanOrEqual(TUMBLE_HITSTUN);
    expect(computeHitstun(fx(82.4))).toBeGreaterThanOrEqual(TUMBLE_HITSTUN);
    for (let q = 0; q <= 2000; q++) {
      expect(computeHitstun(fx(q / 4)) >= TUMBLE_HITSTUN, `kb ${q / 4}`).toBe(ref.isTumble(q / 4));
    }
  });

  it("applies 0.4 exactly, not the Q12 approximation of it", () => {
    // fx(0.4) is 0.39990, which would floor 100 knockback to 38 frames.
    expect(computeHitstun(fx(100))).toBe(39);
    expect(computeHitstun(fx(200))).toBe(79);
  });
});

describe("the balloon speed-up (init_damage_speed_up)", () => {
  // rubendal SSBU-Calculator `InitDamageSpeedUp`: 1× at 30 frames of FAF, 6× at 80, linear between.
  it("scales its first-frame multiplier from 1x at 30 FAF to 6x at 80", () => {
    expect(damageSpeedUpMaxMag(30)).toBe(ONE);
    expect(damageSpeedUpMaxMag(55)).toBe(fx(3.5));
    expect(damageSpeedUpMaxMag(80)).toBe(fx(6));
    expect(damageSpeedUpMaxMag(200)).toBe(fx(6));
  });

  // SmashWiki "Hitstun": 90 and 145 knockback give 33 and 41 frames in
  // Ultimate (36 and 58 in Smash 4); rubendal's port gives 49 at 200 and 61 at 250.
  it.each([
    [90, 33],
    [145, 41],
    [200, 49],
    [250, 61],
  ])("turns %i knockback into %i real frames of hitstun", (kb, frames) => {
    expect(effectiveHitstun(fx(kb), true)).toBe(frames);
  });

  it("matches the reference port at every knockback up to 500", () => {
    for (let q = 0; q <= 2000; q++) {
      const kb = fx(q / 4);
      expect(effectiveHitstun(kb, true), `kb ${q / 4}`).toBe(
        Math.max(4, ref.speedUp(toFloat(kb)).framesWithSpeedUp - 1),
      );
    }
  });

  // SmashWiki "Hitstun": past 200 the effect stops scaling and hitstun grows at
  // (kb − 200) × 0.25 — which falls out of the 6× cap, within a frame.
  it("grows by (kb - 200) x 0.25 past 200, within a frame", () => {
    const at200 = effectiveHitstun(fx(200), true);
    for (let kb = 200; kb <= 500; kb += 0.25) {
      const extra = effectiveHitstun(fx(kb), true) - at200;
      expect(Math.abs(extra - Math.floor((kb - 200) * 0.25)), `kb ${kb}`).toBeLessThanOrEqual(1);
    }
  });

  it("never takes a tumbling hit below tumble", () => {
    // Tumble starts at 80 knockback (ssbu_ref.mjs `isTumble`), so the sweep does too.
    for (let q = 320; q <= 2000; q++) {
      expect(effectiveHitstun(fx(q / 4), true), `kb ${q / 4}`).toBeGreaterThanOrEqual(TUMBLE_HITSTUN);
    }
  });

  it("is the plain base when the hit is not sped up (set knockback, no tumble)", () => {
    expect(effectiveHitstun(fx(145), false)).toBe(computeHitstun(fx(145)));
  });

  it("walks the same schedule one real frame at a time", () => {
    for (const kb of [90, 145, 200, 250]) {
      const faf = computeHitstun(fx(kb)) + 1;
      const max = damageSpeedUpMaxMag(faf);
      let frame = faf * ONE;
      let real = 0;
      let mag = max;
      while (mag > ONE) {
        mag = damageSpeedUpMag(frame, faf, max);
        frame -= mag < ONE ? ONE : mag;
        real += 1;
      }
      real += Math.ceil(frame / ONE);
      expect(real - 1).toBe(effectiveHitstun(fx(kb), true));
    }
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

  // SmashWiki "Stale-move negation" (https://www.ssbwiki.com/Stale-move_negation),
  // Ultimate: 0.09, 0.08545, 0.07635, 0.0679, 0.05945, 0.05035, 0.04255, 0.03345,
  // 0.025 — and the freshness bonus only for a move absent from the queue.
  it.each([
    [0, 0.09],
    [1, 0.08545],
    [2, 0.07635],
    [3, 0.0679],
    [4, 0.05945],
    [5, 0.05035],
    [6, 0.04255],
    [7, 0.03345],
    [8, 0.025],
  ])("takes the published %i-th slot reduction off, with no freshness bonus", (i, reduction) => {
    const queue = new Array<MoveSlot>(9).fill("jab1");
    queue[i] = slot;
    expect(toFloat(computeStaleness(queue, slot).damage)).toBeCloseTo(1 - reduction, 3);
  });

  it("bottoms out at 1 − 0.5305 with the whole queue full of one move", () => {
    const queue = new Array<MoveSlot>(9).fill(slot);
    expect(toFloat(computeStaleness(queue, slot).damage)).toBeCloseTo(0.4695, 3);
  });

  it("counts a slot that hit a shield at 0.85 of its reduction", () => {
    const queue: MoveSlot[] = [slot];
    expect(toFloat(computeStaleness(queue, slot, [true]).damage)).toBeCloseTo(1 - 0.09 * 0.85, 3);
    expect(toFloat(computeStaleness(queue, slot, [false]).damage)).toBeCloseTo(0.91, 3);
  });

  it("matches the reference port for any queue and shield pattern", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.boolean(), fc.boolean()), { maxLength: 9 }),
        (entries) => {
          const queue = entries.map(([mine]) => (mine ? slot : "jab1") as MoveSlot);
          const shields = entries.map(([, onShield]) => onShield);
          const ours = toFloat(computeStaleness(queue, slot, shields).damage);
          const theirs = ref.staleMult(entries.map(([mine]) => mine), shields);
          expect(Math.abs(ours - theirs)).toBeLessThan(2 / ONE);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("damps the knockback effect to 0.3 of the damage effect", () => {
    const queue = new Array<MoveSlot>(9).fill(slot);
    const s = computeStaleness(queue, slot);
    // Damage falls 53.05%; the knockback formula's d falls only 0.3 of that.
    expect(toFloat(s.knockback)).toBeCloseTo(1 - 0.5305 * 0.3, 3);
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
    const bent = applyDI(fx(90), -1, 0);
    expect(toFloat(bent - fx(90))).toBeCloseTo(toFloat(DI_MAX_DEVIATION), 2);
  });

  it("bends the other way for the opposite perpendicular", () => {
    expect(applyDI(fx(90), 1, 0)).toBeLessThan(fx(90));
  });

  // rubendal SSBU-Calculator `DI`: "Cannot DI if launch angle is less than DI
  // angle change param" — |atan2(ly, lx)| < 0.17 rad, so a launch straight ahead.
  it("leaves a launch within 0.17 rad of straight ahead alone", () => {
    expect(applyDI(fx(0), 0, 1)).toBe(fx(0));
    expect(applyDI(fx(9), 0, -1)).toBe(fx(9));
    expect(applyDI(fx(352), 0, 1)).toBe(fx(352));
    // …but not straight behind: atan2 of a backward launch is near ±π.
    expect(applyDI(fx(180), 0, 1)).not.toBe(fx(180));
  });

  // SmashWiki "Directional influence" (https://www.ssbwiki.com/Directional_influence):
  // at most 0.17 rad, less as the stick is tilted less. rubendal `DI`:
  // `variation = |X·ly − Y·lx| / |L|`, linear — not squared.
  it("bends a diagonal stick linearly, by the sine of its angle to the launch", () => {
    const bent = toFloat(applyDI(fx(90), -1, 1) - fx(90));
    // 45° off the launch: sin 45° = 0.7071 of the full bend (squared would be 0.5).
    expect(bent).toBeCloseTo(9.74 * 0.7071, 1);
  });

  it("matches the reference port for every launch angle and digital stick", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 359 }),
        fc.integer({ min: -1, max: 1 }),
        fc.integer({ min: -1, max: 1 }),
        (deg, sx, sy) => {
          const diag = sx !== 0 && sy !== 0 ? Math.SQRT1_2 : 1;
          const lx = toFloat(cosDeg(fx(deg)));
          const ly = toFloat(sinDeg(fx(deg)));
          const theirs = (ref.di(lx, ly, sx * diag, sy * diag) * 180) / Math.PI;
          const ours = toFloat(applyDI(fx(deg), sx, sy));
          const d = ((((ours - theirs) % 360) + 540) % 360) - 180;
          expect(Math.abs(d)).toBeLessThan(0.02);
        },
      ),
      { numRuns: 2000 },
    );
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

describe("stickSensibility", () => {
  // rubendal SSBU-Calculator `StickSensibility`: |v| < 24 reads 0, beyond 120
  // reads full, v/120 between — the 24/120 dead zone DI and LSI read through.
  it.each([
    [0, 0],
    [23, 0],
    [-23, 0],
    [24, 0.2],
    [60, 0.5],
    [-60, -0.5],
    [120, 1],
    [127, 1],
    [-128, -1],
  ])("reads raw %i as %f", (raw, expected) => {
    expect(toFloat(stickSensibility(raw))).toBeCloseTo(expected, 3);
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

  // SmashWiki "Directional influence": "LSI has no effect if the launch angle is
  // between 65° and 115°, or between 245° and 295°"; rubendal `LSI` uses strict
  // inequalities, so 65° and 115° themselves are still influenced.
  it("still scales a launch at exactly 65 or 115 degrees, as the calculator does", () => {
    for (const deg of [65, 115, 245, 295]) {
      for (const sy of [-1, 1]) {
        expect(toFloat(applyLSI(fx(10), sy, fx(deg)))).toBeCloseTo(10 * ref.lsi(sy, deg), 2);
      }
    }
  });

  it("does nothing with the stick at neutral", () => {
    expect(applyLSI(fx(10), 0, fx(0))).toBe(fx(10));
  });
});

describe("resolveAngle", () => {
  // SmashWiki "Sakurai angle" (https://www.ssbwiki.com/Sakurai_angle), Ultimate:
  // aerial victims 38° at any knockback; grounded 0° up to 60 knockback, 38° from
  // 88, linear between. rubendal SSBU-Calculator `SakuraiAngle` adds the 1°
  // offset inside the ramp: min((kb − 60)/(88 − 60) × 38 + 1, 38).
  it("sends an airborne victim at 38 degrees whatever the knockback", () => {
    expect(SAKURAI_AIRBORNE).toBe(fx(38));
    for (const kb of [0, 30, 60, 74, 88, 200]) {
      expect(resolveAngle({ angle: SAKURAI_ANGLE }, false, fx(kb))).toBe(SAKURAI_AIRBORNE);
    }
  });

  it("sends a grounded victim flat below 60 knockback and at 38 degrees from 88", () => {
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, true, fx(59.99))).toBe(SAKURAI_GROUNDED);
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, true, fx(88))).toBe(fx(38));
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, true, fx(150))).toBe(fx(38));
  });

  it("ramps a grounded victim's angle between 60 and 88 knockback, as the calculator does", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), fc.boolean(), (kb, grounded) => {
        const ours = toFloat(resolveAngle({ angle: SAKURAI_ANGLE }, grounded, fx(kb)));
        const theirs = ref.sakuraiAngle(toFloat(fx(kb)), !grounded);
        expect(Math.abs(ours - theirs)).toBeLessThan(2 / ONE);
      }),
      { numRuns: 1000 },
    );
    // Worked: 74 knockback is halfway up the ramp, (74 − 60)/28 × 38 + 1 = 20°.
    expect(toFloat(resolveAngle({ angle: SAKURAI_ANGLE }, true, fx(74)))).toBeCloseTo(20, 3);
  });

  it("leaves an ordinary angle alone", () => {
    expect(resolveAngle({ angle: fx(45) }, true, fx(100))).toBe(fx(45));
  });

  // SmashWiki "Sakurai angle": "moves with a launch angle of 0 have been given the
  // Sakurai angle-like property of changing to 32 degrees if they deal 120 units of
  // knockback or more"; rubendal `js/knockback.js` applies it to 0 and 180.
  it("lifts a flat launch to 32 degrees from 120 knockback, grounded or not", () => {
    expect(resolveAngle({ angle: fx(0) }, true, fx(119.99))).toBe(fx(0));
    expect(resolveAngle({ angle: fx(0) }, true, fx(120))).toBe(fx(32));
    expect(resolveAngle({ angle: fx(0) }, false, fx(150))).toBe(fx(32));
    // A backward flat launch stays backward: 180° becomes 148° (UNVERIFIED mirror of 32°).
    expect(resolveAngle({ angle: fx(180) }, true, fx(120))).toBe(fx(148));
    expect(resolveAngle({ angle: fx(180) }, true, fx(100))).toBe(fx(180));
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

describe("applyDI with a soft stick", () => {
  // Plan 1 (D54): Btn.Soft quarters the DI. Under the linear rule a quarter of
  // the bend is a stick at a quarter of its throw (UNVERIFIED, as D54 says).
  // Straight up, because a launch straight ahead cannot be DI'd at all.
  it("bends a quarter as far as a full perpendicular push", () => {
    const full = applyDI(fx(90), -1, 0) - fx(90);
    const soft = applyDI(fx(90), -1, 0, true) - fx(90);
    expect(SOFT_DI_SHIFT).toBe(2);
    expect(soft).toBe(full >> SOFT_DI_SHIFT);
    expect(soft).toBeGreaterThan(0);
  });

  it("bends the other way just as softly", () => {
    expect(applyDI(fx(90), 1, 0, true) - fx(90)).toBe(-((applyDI(fx(90), -1, 0) - fx(90)) >> SOFT_DI_SHIFT));
  });

  it("does nothing at neutral", () => {
    expect(applyDI(fx(45), 0, 0, true)).toBe(fx(45));
  });
});
