import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fx } from "../fixed";
import {
  ATTACK,
  CATCH,
  atkPower,
  catchClear,
  catchClearAll,
  clear,
  clearAll,
  decimalRatio,
  frame,
  intangible,
  loop,
  momentum,
  motionRate,
  reverseLr,
  script,
  setFlag,
  shieldSetoffMul,
  spawnProjectile,
  superArmour,
  unknown,
  wait,
  wholeHit,
} from "./dsl";
import { flatten, runScript } from "./interpreter";
import type { AcmdCommand, Rate } from "./types";

const hit = (id: number, damage = 1) =>
  ATTACK({ id, bone: "top", damage, angle: 45, kbg: 100, bkb: 30, size: 2, x: 0, y: 5, z: 4 });

/** Game frames, from 1 to `upTo`, on which attack `id` is live. */
function liveFrames(commands: readonly AcmdCommand[], id: number, upTo = 40): number[] {
  const s = script("game_test", "test", commands);
  const out: number[] = [];
  for (let g = 1; g <= upTo; g++) if (runScript(s, g).attacks.some((a) => a.id === id)) out.push(g);
  return out;
}

describe("frame and wait at the default rate", () => {
  it("opens a hitbox on frame n and closes it n frames after a wait", () => {
    // Mario's jab: frame(2) ATTACK … wait(2) clear_all — active 2–3, as UFD quotes it:
    // https://ultimateframedata.com/mario (Jab 1, "Hitbox 2-3").
    expect(liveFrames([frame(2), hit(0), wait(2), clearAll()], 0)).toEqual([2, 3]);
  });

  it("runs commands before any frame() on game frame 1", () => {
    expect(liveFrames([hit(0), wait(3), clearAll()], 0)).toEqual([1, 2, 3]);
  });

  it("clears one slot and leaves the others", () => {
    const cmds = [frame(3), hit(0), hit(1), frame(5), clear(0), frame(7), clearAll()];
    expect(liveFrames(cmds, 0)).toEqual([3, 4]);
    expect(liveFrames(cmds, 1)).toEqual([3, 4, 5, 6]);
  });

  it("unrolls a loop: Mario's down air drill hits on 5, 7, 9, 11 and 13", () => {
    // https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Mario/data.json, game_AttackAirLw
    const cmds = [frame(5), loop(5, [hit(0), wait(1), clearAll(), wait(1)]), frame(23), hit(5), wait(1), clearAll()];
    expect(liveFrames(cmds, 0)).toEqual([5, 7, 9, 11, 13]);
    expect(liveFrames(cmds, 5)).toEqual([23]);
  });

  it("treats a frame() already passed as no wait at all", () => {
    expect(liveFrames([frame(6), hit(0), frame(4), clear(0), wait(1), clearAll()], 0)).toEqual([]);
  });
});

describe("FT_MOTION_RATE", () => {
  it("speeds the script up below 1", () => {
    // Two motion frames per game frame: motion 1, 3, 5 … so frame(5) is game frame 3.
    expect(liveFrames([motionRate(0.5), frame(5), hit(0), wait(4), clearAll()], 0)).toEqual([3, 4]);
  });

  it("slows it down above 1", () => {
    expect(liveFrames([motionRate(2), frame(3), hit(0), wait(1), clearAll()], 0)).toEqual([5, 6]);
  });

  it("reaches frame(11) on game frame 10 at FSM 0.9, exactly (Review Focus #3)", () => {
    // 1 + 9 × (10 / 9) = 11. Q12's 1.111084 per frame would reach 10.99976 and fire a frame late.
    expect(liveFrames([motionRate(0.9), frame(11), hit(0), wait(1), clearAll()], 0)[0]).toBe(10);
  });

  it("reaches frame(4) on game frame 2 at three motion frames per game frame", () => {
    expect(liveFrames([motionRate([1, 3]), frame(4), hit(0)], 0)[0]).toBe(2);
  });

  it("changes rate mid-script from the motion frame it is on", () => {
    // Rate 1 to frame 3 (game 3), then 0.5: motion 3, 5, 7 → frame(7) on game 5.
    expect(liveFrames([frame(3), motionRate(0.5), frame(7), hit(0)], 0)[0]).toBe(5);
  });

  it("reports the floored motion frame for the bone table", () => {
    const s = script("game_test", "test", [motionRate(2)]);
    expect([1, 2, 3, 4, 5].map((g) => runScript(s, g).motionFrame)).toEqual([1, 1, 2, 2, 3]);
  });

  it("spells decimals as exact fractions and refuses a rate that is not one", () => {
    expect(decimalRatio(0.91)).toEqual([91, 100]);
    expect(decimalRatio(1.25)).toEqual([5, 4]);
    expect(decimalRatio(2)).toEqual([2, 1]);
    expect(decimalRatio(0.123456)).toEqual([1929, 15625]);
    expect(() => motionRate(Number.NaN)).toThrow(/positive rate/);
    expect(() => motionRate(0)).toThrow(/positive rate/);
  });

  it("refuses a decimal that is not a short exact one, and says to spell it [p, q]", () => {
    // 1 / 3 is 0.3333333333333333: sixteen digits, not a rate anyone wrote.
    expect(() => motionRate(1 / 3)).toThrow(/use \[p, q\]/);
    expect(() => motionRate(0.1 + 0.2)).toThrow(/use \[p, q\]/);
    expect(() => motionRate(1.2345678)).toThrow(/use \[p, q\]/);
    expect(() => decimalRatio(1e-7)).toThrow(/use \[p, q\]/);
    expect(() => decimalRatio(1e21)).toThrow(/use \[p, q\]/);
    expect(() => motionRate(2_000_000)).toThrow(/positive rate/);
  });

  it("takes a fraction of positive integers up to a million, and nothing else", () => {
    expect(motionRate([1, 3])).toEqual({ op: "motionRate", rate: [1, 3] });
    expect(motionRate([1_000_000, 999_999])).toEqual({ op: "motionRate", rate: [1_000_000, 999_999] });
    for (const bad of [[0, 1], [1, 0], [-1, 2], [1.5, 2], [1, Number.NaN], [1_000_001, 1], [1, 1_000_001]] as const) {
      expect(() => motionRate([bad[0], bad[1]]), JSON.stringify(bad)).toThrow(/positive rate/);
    }
  });

  it("fires frame(4) on game frame 2 at [1, 3] and frame(11) on game frame 10 at [9, 10]", () => {
    expect(liveFrames([motionRate([1, 3]), frame(4), hit(0)], 0)[0]).toBe(2);
    expect(liveFrames([motionRate([9, 10]), frame(11), hit(0)], 0)[0]).toBe(10);
  });

  it("does not drift over a chain of rate changes (the review's minimal repro)", () => {
    // Every rate here is an exact two-digit decimal. Chained through Q12 or through float
    // fractions this fired on game frame 187; the exact answer is 186 (BigInt oracle below).
    const chain = [
      frame(5), motionRate(1.82), frame(8), motionRate(1.83), frame(38),
      motionRate(2.89), frame(56), motionRate(2.75), frame(77), wait(4), hit(0),
    ];
    expect(liveFrames(chain, 0, 300)[0]).toBe(186);
  });

  it("does no BigInt work at sim time: a built script carries its fire frames", () => {
    const s = script("game_test", "test", [motionRate(0.91), frame(5), hit(0), wait(3), clearAll()]);
    const real = globalThis.BigInt;
    globalThis.BigInt = (() => {
      throw new Error("BigInt called inside runScript");
    }) as unknown as BigIntConstructor;
    try {
      expect([1, 4, 5, 6, 8, 9, 20].map((g) => runScript(s, g).attacks.length)).toEqual([0, 0, 1, 1, 0, 0, 0]);
    } finally {
      globalThis.BigInt = real;
    }
  });
});

describe("one-shot and stateful commands", () => {
  const s = script("game_test", "test", [
    frame(4),
    spawnProjectile("fireball"),
    superArmour(true),
    setFlag("FIGHTER_STATUS_ATTACK_AIR_FLAG_ENABLE_LANDING"),
    hit(0, 8),
    frame(6),
    atkPower(0, 5),
    frame(9),
    superArmour(false),
    clearAll(),
  ]);

  it("fires a spawn on exactly one frame", () => {
    const frames = [1, 2, 3, 4, 5, 6, 7].filter((g) => runScript(s, g).fired.some((c) => c.op === "spawnProjectile"));
    expect(frames).toEqual([4]);
  });

  it("holds super armour between its on and off", () => {
    expect([3, 4, 8, 9].map((g) => runScript(s, g).superArmour)).toEqual([false, true, true, false]);
  });

  it("keeps a flag once set", () => {
    expect(runScript(s, 3).flags).toEqual([]);
    expect(runScript(s, 12).flags).toEqual(["FIGHTER_STATUS_ATTACK_AIR_FLAG_ENABLE_LANDING"]);
  });

  it("changes a live hitbox's damage with ATK_POWER and keeps the slot", () => {
    expect(runScript(s, 5).attacks[0].damage).toBe(fx(8));
    expect(runScript(s, 6).attacks[0].damage).toBe(fx(5));
  });
});

describe("momentum windows", () => {
  const s = script("game_test", "test", [frame(3), momentum(1, 2, 4, 0), frame(5), momentum(9, 9, 0, 1)]);

  it("is live from its frame through its hold", () => {
    expect([2, 3, 7, 8].map((g) => runScript(s, g).momentum?.until ?? null)).toEqual([null, 7, 7, null]);
  });

  it("lets the lower-order entry win where two overlap, as the legacy list did", () => {
    expect(runScript(s, 5).momentum?.x).toBe(fx(1));
  });
});

describe("purity", () => {
  it("returns the same state for the same frame and never mutates the script", () => {
    const cmds = [frame(2), hit(0), wait(2), clearAll(), frame(6), hit(1), motionRate(0.5), frame(12), clear(1)];
    const s = script("game_test", "test", cmds);
    const snapshot = JSON.stringify(s);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (g) => {
        const a = runScript(s, g);
        const b = runScript(s, g);
        return (
          JSON.stringify({ ...a, shieldSetoff: [...a.shieldSetoff] }) ===
          JSON.stringify({ ...b, shieldSetoff: [...b.shieldSetoff] })
        );
      }),
    );
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("the rest of the command set", () => {
  const catcher = (id: number) => CATCH({ id, bone: "top", size: 3, x: 0, y: 6, z: 6 });
  const catchIds = (cmds: readonly AcmdCommand[], g: number) =>
    runScript(script("game_test", "test", cmds), g).catches.map((c) => c.id);

  it("opens catches by id and closes one, then all", () => {
    const cmds = [frame(2), catcher(1), catcher(0), frame(4), catchClear(1), frame(6), catchClearAll()];
    expect([1, 2, 3, 4, 5, 6, 7].map((g) => catchIds(cmds, g))).toEqual([[], [0, 1], [0, 1], [0], [0], [], []]);
  });

  it("keeps catches and attacks in separate slots, so clearAll leaves a catch alone", () => {
    const st = runScript(script("game_test", "test", [catcher(0), hit(0), clearAll()]), 1);
    expect(st.attacks).toEqual([]);
    expect(st.catches.map((c) => c.id)).toEqual([0]);
  });

  describe("ATK_SET_SHIELD_SETOFF_MUL", () => {
    const mul = (cmds: readonly AcmdCommand[], g: number) =>
      runScript(script("game_test", "test", cmds), g).shieldSetoff.get(0);

    it("holds the multiplier for the hitbox it was set on", () => {
      const cmds = [frame(2), hit(0), shieldSetoffMul(0, 1.5), frame(5), clearAll()];
      expect([1, 2, 4].map((g) => mul(cmds, g))).toEqual([undefined, fx(1.5), fx(1.5)]);
    });

    // UNVERIFIED: whether the game keeps the multiplier on a slot after AttackModule::clear or a
    // new ATTACK in that slot. smash-script only binds the call (HDR-Development/smash-script
    // src/macros.rs, `ATK_SET_SHIELD_SETOFF_MUL(fighter, id, val)` → sv_animcmd) and documents
    // nothing; the replica treats the multiplier as part of the hitbox, so it goes with it.
    it("drops it with the hitbox: clear, clearAll, and a fresh ATTACK in the same slot all reset it", () => {
      const set = [frame(2), hit(0), shieldSetoffMul(0, 1.5)];
      expect(mul([...set, frame(4), clear(0)], 4)).toBeUndefined();
      expect(mul([...set, frame(4), clearAll()], 4)).toBeUndefined();
      expect(mul([...set, frame(4), hit(0)], 4)).toBeUndefined();
      expect(mul([...set, frame(4), hit(0), shieldSetoffMul(0, 2)], 4)).toBe(fx(2));
    });

    it("leaves another slot's multiplier alone when one slot is cleared", () => {
      const cmds = [hit(0), hit(1), shieldSetoffMul(1, 3), frame(3), clear(0)];
      expect(runScript(script("game_test", "test", cmds), 3).shieldSetoff.get(1)).toBe(fx(3));
    });
  });

  it("tracks WHOLE_HIT, with intangible as its XLU shorthand", () => {
    const cmds = [frame(3), intangible(true), frame(6), intangible(false), frame(8), wholeHit("HIT_STATUS_INVINCIBLE")];
    const at = (g: number) => runScript(script("game_test", "test", cmds), g).wholeHit;
    expect([2, 3, 5, 6, 8].map(at)).toEqual([
      "HIT_STATUS_NORMAL",
      "HIT_STATUS_XLU",
      "HIT_STATUS_XLU",
      "HIT_STATUS_NORMAL",
      "HIT_STATUS_INVINCIBLE",
    ]);
  });

  it("clears a flag that setFlag(…, false) turns off, and keeps the others", () => {
    const cmds = [setFlag("A"), setFlag("B"), frame(3), setFlag("A", false)];
    const flagsAt = (g: number) => runScript(script("game_test", "test", cmds), g).flags;
    expect([2, 3].map(flagsAt)).toEqual([["A", "B"], ["B"]]);
  });

  it("reports reverseLr and unknown as fired on their frame and changes nothing else", () => {
    const s = script("game_test", "test", [frame(3), reverseLr(), unknown("sv_animcmd::wait_loop_clear()")]);
    const quiet = runScript(s, 2);
    const st = runScript(s, 3);
    expect(st.fired.map((c) => c.op)).toEqual(["reverseLr", "unknown"]);
    expect(runScript(s, 4).fired).toEqual([]);
    expect({ ...st, fired: [], motionFrame: 0 }).toEqual({ ...quiet, fired: [], motionFrame: 0 });
  });

  it("unrolls a loop inside a loop, in order", () => {
    const inner = loop(2, [hit(0), wait(1), clearAll(), wait(1)]);
    const cmds = [loop(2, [inner, wait(2)])];
    expect(liveFrames(cmds, 0)).toEqual([1, 3, 7, 9]);
    expect(flatten(script("game_test", "test", [loop(2, [loop(3, [wait(1)])])]))).toHaveLength(6);
  });

  it("runs a zero-count loop as nothing", () => {
    expect(liveFrames([loop(0, [hit(0)]), frame(2), hit(1)], 0)).toEqual([]);
  });
});

describe("DSL arguments are checked when the script is written", () => {
  it("takes frames, waits, loop counts and holds that are whole numbers", () => {
    expect(() => frame(1)).not.toThrow();
    expect(() => wait(0)).not.toThrow();
    expect(() => loop(0, [])).not.toThrow();
    expect(() => momentum(1, 2, 0)).not.toThrow();
  });

  it.each([
    ["frame(0)", () => frame(0)],
    ["frame(-3)", () => frame(-3)],
    ["frame(2.5)", () => frame(2.5)],
    ["frame(NaN)", () => frame(Number.NaN)],
    ["frame(Infinity)", () => frame(Number.POSITIVE_INFINITY)],
    ["wait(-1)", () => wait(-1)],
    ["wait(0.5)", () => wait(0.5)],
    ["wait(NaN)", () => wait(Number.NaN)],
    ["loop(-1, [])", () => loop(-1, [])],
    ["loop(1.5, [])", () => loop(1.5, [])],
    ["loop(NaN, [])", () => loop(Number.NaN, [])],
    ["momentum hold -1", () => momentum(1, 2, -1)],
    ["momentum hold 0.5", () => momentum(1, 2, 0.5)],
    ["momentum hold NaN", () => momentum(1, 2, Number.NaN)],
  ])("refuses %s", (_name, make) => {
    expect(make).toThrow(/whole number/);
  });
});

// ---------------------------------------------------------------------------------------------
// Exactness. The oracle below is deliberately not the interpreter's algorithm: it walks game
// frame by game frame with BigInt rationals, advancing the motion frame one game frame at a time
// and running every command that has come due, so it shares nothing with the closed form
// `runScript` is built on. (Ported from the Task 12 review's oracle.)
// ---------------------------------------------------------------------------------------------

type Q = { readonly n: bigint; readonly d: bigint };

const big = (n: number | bigint): bigint => BigInt(n);
const ZERO = big(0);

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < ZERO ? -a : a;
  let y = b < ZERO ? -b : b;
  while (y !== ZERO) [x, y] = [y, x % y];
  return x === ZERO ? big(1) : x;
}

function q(n: bigint, d: bigint = big(1)): Q {
  const g = gcdBig(n, d);
  return { n: n / g, d: d / g };
}

const qAdd = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qCmp = (a: Q, b: Q): number => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};

/** One step of a generated script. A rate is `[num, den]`: game frames per motion frame. */
type Step =
  | { readonly t: "frame"; readonly n: number }
  | { readonly t: "wait"; readonly n: number }
  | { readonly t: "rate"; readonly num: number; readonly den: number; readonly arg: number | Rate }
  | { readonly t: "mark"; readonly id: number };

interface Oracle {
  /** The game frame each mark runs on. */
  readonly fires: Map<number, number>;
  /** The floored motion frame shown on each game frame stepped, from 1. */
  readonly motion: number[];
}

/**
 * Steps one game frame at a time, running every command that has come due, until the script
 * has run out and `tail` more game frames have been shown (or `maxFrame`).
 */
function oracle(steps: readonly Step[], maxFrame: number, tail = 0): Oracle {
  let g0 = big(1);
  let m0 = q(big(1));
  let rn = big(1);
  let rd = big(1);
  let target = q(big(1));
  let pc = 0;
  let endAt = maxFrame;
  const fires = new Map<number, number>();
  const motion: number[] = [];
  // Per game frame the motion frame advances rd / rn.
  const motionAt = (g: bigint): Q => qAdd(m0, q((g - g0) * rd, rn));
  for (let gi = 1; gi <= endAt; gi++) {
    const g = big(gi);
    while (pc < steps.length) {
      const c = steps[pc];
      if (c.t === "frame") {
        const f = q(big(c.n));
        if (qCmp(f, target) > 0) target = f;
        pc++;
        continue;
      }
      const m = motionAt(g);
      if (qCmp(m, target) < 0) break;
      if (c.t === "wait") target = qAdd(m, q(big(c.n)));
      else if (c.t === "rate") {
        m0 = m;
        g0 = g;
        rn = big(c.num);
        rd = big(c.den);
      } else fires.set(c.id, gi);
      pc++;
    }
    const shown = motionAt(g);
    motion.push(Number(shown.n / shown.d));
    if (pc >= steps.length && endAt === maxFrame) endAt = Math.min(maxFrame, gi + tail);
  }
  return { fires, motion };
}

function buildScript(steps: readonly Step[]) {
  const cmds = steps.map((c): AcmdCommand => {
    switch (c.t) {
      case "frame":
        return frame(c.n);
      case "wait":
        return wait(c.n);
      case "rate":
        return motionRate(c.arg);
      case "mark":
        return hit(c.id);
    }
  });
  return script("game_test", "test", cmds);
}

/** The game frame on which the interpreter opens each mark, by bisecting on "is it live yet". */
function interpreterFires(steps: readonly Step[], maxFrame: number): Map<number, number | undefined> {
  const s = buildScript(steps);
  const out = new Map<number, number | undefined>();
  for (const c of steps) {
    if (c.t !== "mark") continue;
    const live = (g: number) => runScript(s, g).attacks.some((a) => a.id === c.id);
    if (!live(maxFrame)) {
      out.set(c.id, undefined);
      continue;
    }
    let lo = 1;
    let hi = maxFrame;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (live(mid)) hi = mid;
      else lo = mid + 1;
    }
    out.set(c.id, lo);
  }
  return out;
}

const MAX_GAME_FRAME = 20_000;

/** True when every mark fires on the game frame the oracle says, and every game frame shows its motion frame. */
function matchesOracle(steps: readonly Step[]): boolean {
  const want = oracle(steps, MAX_GAME_FRAME, 40);
  const got = interpreterFires(steps, MAX_GAME_FRAME);
  for (const [id, g] of got) if (want.fires.get(id) !== g) return false;
  const s = buildScript(steps);
  return want.motion.every((m, i) => runScript(s, i + 1).motionFrame === m);
}

interface RateSpec {
  readonly num: number;
  readonly den: number;
  readonly arg: number | Rate;
}

/** `[p, q]`, given as a fraction. */
const fractionArb = (max: number): fc.Arbitrary<RateSpec> =>
  fc.tuple(fc.integer({ min: 1, max }), fc.integer({ min: 1, max })).map(([p, d]) => ({ num: p, den: d, arg: [p, d] as Rate }));

/** k / 10^digits, given as the decimal a script author would type. */
const decimalArb = (digits: number, maxValue: number): fc.Arbitrary<RateSpec> => {
  const den = 10 ** digits;
  return fc.integer({ min: 1, max: maxValue * den }).map((k) => ({ num: k, den, arg: k / den }));
};

interface SegmentSpec {
  readonly lead: number;
  readonly pause: number;
  readonly rate: RateSpec;
  readonly run: number;
}

const segmentArb = (rate: fc.Arbitrary<RateSpec>): fc.Arbitrary<SegmentSpec> =>
  fc.record({
    lead: fc.integer({ min: 0, max: 6 }),
    pause: fc.integer({ min: 0, max: 4 }),
    rate,
    run: fc.integer({ min: 1, max: 12 }),
  });

/** frame, [wait], rate, frame, mark — per segment — then one last frame and mark. */
function stepsOf(segments: readonly SegmentSpec[], tail: number): Step[] {
  const steps: Step[] = [];
  let f = 1;
  let id = 0;
  for (const s of segments) {
    f += s.lead;
    steps.push({ t: "frame", n: f });
    if (s.pause > 0) steps.push({ t: "wait", n: s.pause });
    steps.push({ t: "rate", num: s.rate.num, den: s.rate.den, arg: s.rate.arg });
    f += s.run;
    steps.push({ t: "frame", n: f }, { t: "mark", id: id++ });
  }
  f += tail;
  steps.push({ t: "frame", n: f }, { t: "mark", id: id });
  return steps;
}

describe("fire frames are exact for every rate (Review Focus #3)", () => {
  const tailArb = fc.integer({ min: 1, max: 15 });

  it("agrees with the BigInt stepper for a single [p, q] rate, on fire frames and motion frames", () => {
    fc.assert(
      fc.property(fc.array(segmentArb(fractionArb(30)), { minLength: 1, maxLength: 1 }), tailArb, (segs, tail) =>
        matchesOracle(stepsOf(segs, tail)),
      ),
      { numRuns: 300 },
    );
  });

  it("agrees with the BigInt stepper for a single k/1000 rate", () => {
    fc.assert(
      fc.property(fc.array(segmentArb(decimalArb(3, 10)), { minLength: 1, maxLength: 1 }), tailArb, (segs, tail) =>
        matchesOracle(stepsOf(segs, tail)),
      ),
      { numRuns: 300 },
    );
  });

  it("agrees with the BigInt stepper over 2 to 8 chained rate changes with waits between", () => {
    const rate = fc.oneof(fractionArb(20), decimalArb(1, 10), decimalArb(2, 10), decimalArb(3, 10));
    fc.assert(
      fc.property(fc.array(segmentArb(rate), { minLength: 2, maxLength: 8 }), tailArb, (segs, tail) =>
        matchesOracle(stepsOf(segs, tail)),
      ),
      { numRuns: 300 },
    );
  });

  it("agrees with the oracle on the review's minimal repro", () => {
    const rates = [1.82, 1.83, 2.89, 2.75];
    const steps: Step[] = [{ t: "frame", n: 5 }];
    const frames = [8, 38, 56, 77];
    rates.forEach((r, i) => {
      steps.push({ t: "rate", num: Math.round(r * 100), den: 100, arg: r }, { t: "frame", n: frames[i] });
    });
    steps.push({ t: "wait", n: 4 }, { t: "mark", id: 0 });
    expect(oracle(steps, 1000).fires.get(0)).toBe(186);
    expect(interpreterFires(steps, 1000).get(0)).toBe(186);
  });
});
