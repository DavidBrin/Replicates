/**
 * Runs a `game_` script to a given game frame, deterministically.
 *
 * Pure: `runScript(script, g)` replays the script from its first command every
 * time it is asked, so there is no per-fighter script cursor in `GameState`
 * to clone, hash or roll back — the move's game frame (`moveFrameOf(actionFrame)`)
 * is the whole state. Scripts are a few dozen commands; replaying is cheaper
 * than the bookkeeping a cursor would need.
 *
 * Timing. Game frame 1 is the first frame of the status. The motion frame
 * starts at 1 and advances by `1 / rate` per game frame, where the rate is the
 * last `FT_MOTION_RATE` (game frames per motion frame). `frame(n)` holds the
 * script until the motion frame reaches n; `wait(n)` holds it until n motion
 * frames past where it is. A command runs on the first game frame on which
 * every hold before it is satisfied. At the default rate, therefore,
 * `frame(n)` runs on game frame n — Ultimate Frame Data's frame n, which is how
 * the community quotes ACMD (DECISIONS D17).
 *
 * Exactness. The motion frame is an exact rational, never Q12 and never a
 * float: a rate such as 0.9 accumulated in Q12 reaches 10.99976 after nine
 * frames instead of 11, and `frame(11)` would fire a game frame late (Review
 * Focus #3). Chained rate changes multiply denominators together, which no
 * 53-bit double holds exactly, so the rational arithmetic is BigInt — but it is
 * done once per script, not per frame. `scheduleOf` walks the script a single
 * time (the DSL's `script()` does it when the script is built) and records the
 * game frame each command first runs on, plus the motion segments between rate
 * changes. `runScript` then compares plain integers against that table: no
 * BigInt, no division and no float at sim time.
 */

import type { AcmdCommand, AcmdScript, AttackParams, CatchParams, HitStatus, Rate } from "./types";

export interface ActiveMomentum {
  readonly x: number;
  readonly y: number;
  /** The last game frame of the hold. */
  readonly until: number;
}

export interface ScriptFrameState {
  /** Live ATTACK slots, by id ascending. */
  readonly attacks: readonly AttackParams[];
  /** Live CATCH slots, by id ascending. */
  readonly catches: readonly CatchParams[];
  /** `ATK_SET_SHIELD_SETOFF_MUL` per live attack id. */
  readonly shieldSetoff: ReadonlyMap<number, number>;
  readonly flags: readonly string[];
  readonly superArmour: boolean;
  readonly wholeHit: HitStatus;
  /** The live scripted velocity, if any, with the lowest `order`. */
  readonly momentum: ActiveMomentum | null;
  /** The motion frame this game frame shows, floored — what a bone table is indexed by. */
  readonly motionFrame: number;
  /** Commands that ran on exactly this game frame, in script order. */
  readonly fired: readonly AcmdCommand[];
}

/** The largest numerator or denominator an `FT_MOTION_RATE` fraction may have. */
export const MAX_RATE_TERM = 1_000_000;

/** A positive rate whose numerator and denominator are whole numbers no larger than `MAX_RATE_TERM`. */
export function isRate(rate: readonly [number, number]): rate is Rate {
  return rate.every((t) => Number.isSafeInteger(t) && t >= 1 && t <= MAX_RATE_TERM);
}

/** Throws unless `v` is a whole number of at least `min`; the argument check the DSL and the scheduler share. */
export function assertWhole(what: string, v: number, min: number): void {
  if (!Number.isSafeInteger(v) || v < min) {
    throw new Error(`${what} needs a whole number of at least ${min}, got ${String(v)}`);
  }
}

const flatCache = new WeakMap<AcmdScript, readonly AcmdCommand[]>();

/** The script with every `loop` unrolled. Cached per script object. */
export function flatten(script: AcmdScript): readonly AcmdCommand[] {
  let flat = flatCache.get(script);
  if (flat === undefined) {
    const out: AcmdCommand[] = [];
    const walk = (cmds: readonly AcmdCommand[]): void => {
      for (const c of cmds) {
        if (c.op === "loop") for (let i = 0; i < c.count; i++) walk(c.body);
        else out.push(c);
      }
    };
    walk(script.commands);
    flat = out;
    flatCache.set(script, flat);
  }
  return flat;
}

/**
 * A stretch of game frames at one constant rate, from game frame `from`: the
 * motion frame there is `base` plus a fraction that is already folded into
 * `carry` (below), and it advances `den / num` per game frame.
 */
interface MotionSegment {
  readonly from: number;
  /** The floored motion frame on game frame `from`. */
  readonly base: number;
  /** The segment's rate, game frames per motion frame, as `[num, den]`. */
  readonly num: number;
  readonly den: number;
  /**
   * The smallest remainder (of `k · den` modulo `num`, k game frames in) that
   * carries the fractional part of the motion frame at `from` over to the next
   * whole motion frame. It is `ceil(num · (1 − fraction))`, worked out once in BigInt.
   */
  readonly carry: number;
}

/** Everything `runScript` needs that depends on the script alone. */
export interface Schedule {
  /** The unrolled commands. */
  readonly commands: readonly AcmdCommand[];
  /** The game frame each command first runs on; non-decreasing. `frame` entries are unused. */
  readonly fire: readonly number[];
  /** The motion segments, by `from` ascending. */
  readonly segments: readonly MotionSegment[];
}

// BigInt through function calls rather than `1n` literals: the compile target predates them.
const big = (n: number): bigint => BigInt(n);
const BIG_ZERO = big(0);
const BIG_ONE = big(1);

function gcd(a: bigint, b: bigint): bigint {
  let x = a < BIG_ZERO ? -a : a;
  let y = b < BIG_ZERO ? -b : b;
  while (y !== BIG_ZERO) [x, y] = [y, x % y];
  return x === BIG_ZERO ? BIG_ONE : x;
}

/** An exact position in motion frames: `n / d`, reduced. */
interface Frac {
  readonly n: bigint;
  readonly d: bigint;
}

function frac(n: bigint, d: bigint): Frac {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

const ceilDiv = (n: bigint, d: bigint): bigint => (n + d - BIG_ONE) / d;

function gameFrameOf(g: bigint): number {
  const n = Number(g);
  if (!Number.isSafeInteger(n)) throw new Error(`script runs a command on game frame ${String(g)}, past safe integers`);
  return n;
}

function segmentAt(from: bigint, m: Frac, rate: readonly [bigint, bigint]): MotionSegment {
  const whole = m.n / m.d;
  const part = m.n - whole * m.d; // the fraction is part / m.d, in [0, m.d)
  return {
    from: gameFrameOf(from),
    base: gameFrameOf(whole),
    num: Number(rate[0]),
    den: Number(rate[1]),
    carry: Number(ceilDiv(rate[0] * (m.d - part), m.d)),
  };
}

/** Walk the script once, in exact arithmetic, and record when each command runs. */
function compile(script: AcmdScript): Schedule {
  const commands = flatten(script);
  const fire: number[] = [];

  // The current constant-rate segment: from game frame g0 at motion m0, the
  // motion advances rd / rn per game frame.
  let g0 = BIG_ONE;
  let m0: Frac = { n: BIG_ONE, d: BIG_ONE };
  let rn = BIG_ONE;
  let rd = BIG_ONE;
  const segments: MotionSegment[] = [segmentAt(g0, m0, [rn, rd])];
  const motionAt = (g: bigint): Frac => frac(m0.n * rn + (g - g0) * rd * m0.d, m0.d * rn);

  // Where the script is holding until, as a motion frame.
  let target: Frac = { n: BIG_ONE, d: BIG_ONE };
  let last = BIG_ONE;
  /** The first game frame, not before the previous command, whose motion reaches `target`. */
  const due = (): bigint => {
    const gap = target.n * m0.d - m0.n * target.d; // (target − m0) · target.d · m0.d
    const g = gap > BIG_ZERO ? g0 + ceilDiv(gap * rn, target.d * m0.d * rd) : g0;
    return g > last ? g : last;
  };

  for (const c of commands) {
    if (c.op === "frame") {
      assertWhole("frame", c.frame, 1);
      const f = big(c.frame);
      if (f * target.d > target.n) target = { n: f, d: BIG_ONE };
      fire.push(gameFrameOf(last));
      continue;
    }
    const e = due();
    last = e;
    fire.push(gameFrameOf(e));
    if (c.op === "wait") {
      assertWhole("wait", c.frames, 0);
      const m = motionAt(e);
      target = { n: m.n + big(c.frames) * m.d, d: m.d };
    } else if (c.op === "motionRate") {
      if (!isRate(c.rate)) throw new Error(`motionRate needs a positive rate of whole numbers up to ${MAX_RATE_TERM}, got ${String(c.rate)}`);
      m0 = motionAt(e);
      g0 = e;
      rn = big(c.rate[0]);
      rd = big(c.rate[1]);
      segments.push(segmentAt(g0, m0, [rn, rd]));
    }
  }
  return { commands, fire, segments };
}

const scheduleCache = new WeakMap<AcmdScript, Schedule>();

/** The script's fire frames and motion segments. Built on first ask (the DSL's `script()` asks) and cached per script object. */
export function scheduleOf(script: AcmdScript): Schedule {
  let s = scheduleCache.get(script);
  if (s === undefined) {
    s = compile(script);
    scheduleCache.set(script, s);
  }
  return s;
}

/** The floored motion frame on game frame `g`, from the segment in force there. Integers only. */
function motionFrameAt(segments: readonly MotionSegment[], g: number): number {
  let i = segments.length - 1;
  while (i > 0 && segments[i].from > g) i--;
  const s = segments[i];
  const t = (g - s.from) * s.den;
  const r = ((t % s.num) + s.num) % s.num;
  return s.base + (t - r) / s.num + (r >= s.carry ? 1 : 0);
}

export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameState {
  const { commands, fire, segments } = scheduleOf(script);
  const attacks = new Map<number, AttackParams>();
  const catches = new Map<number, CatchParams>();
  const shieldSetoff = new Map<number, number>();
  const flags = new Set<string>();
  const windows: { x: number; y: number; start: number; until: number; order: number }[] = [];
  const fired: AcmdCommand[] = [];
  let superArmour = false;
  let wholeHit: HitStatus = "HIT_STATUS_NORMAL";

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.op === "frame" || c.op === "wait") continue; // timing only; already folded into `fire`
    const e = fire[i];
    if (e > gameFrame) break;
    if (e === gameFrame) fired.push(c);
    switch (c.op) {
      case "attack":
        attacks.set(c.params.id, c.params);
        shieldSetoff.delete(c.params.id); // UNVERIFIED: a new hitbox starts at the default multiplier
        break;
      case "catch":
        catches.set(c.params.id, c.params);
        break;
      case "clearAll":
        attacks.clear();
        shieldSetoff.clear();
        break;
      case "clear":
        attacks.delete(c.id);
        shieldSetoff.delete(c.id);
        break;
      case "catchClearAll":
        catches.clear();
        break;
      case "catchClear":
        catches.delete(c.id);
        break;
      case "atkPower": {
        const a = attacks.get(c.id);
        if (a !== undefined) attacks.set(c.id, { ...a, damage: c.damage });
        break;
      }
      case "shieldSetoffMul":
        shieldSetoff.set(c.id, c.mul);
        break;
      case "setFlag":
        if (c.on) flags.add(c.flag);
        else flags.delete(c.flag);
        break;
      case "superArmour":
        superArmour = c.on;
        break;
      case "wholeHit":
        wholeHit = c.status;
        break;
      case "momentum":
        windows.push({ x: c.x, y: c.y, start: e, until: e + c.hold, order: c.order });
        break;
      case "motionRate": // the rate change is a segment in the schedule
      case "spawnProjectile":
      case "reverseLr":
      case "unknown":
        break;
    }
  }

  let momentum: ActiveMomentum | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const w of windows) {
    if (gameFrame < w.start || gameFrame > w.until || w.order >= best) continue;
    best = w.order;
    momentum = { x: w.x, y: w.y, until: w.until };
  }

  return {
    attacks: [...attacks.values()].sort((a, b) => a.id - b.id),
    catches: [...catches.values()].sort((a, b) => a.id - b.id),
    shieldSetoff,
    flags: [...flags].sort(),
    superArmour,
    wholeHit,
    momentum,
    motionFrame: motionFrameAt(segments, gameFrame),
    fired,
  };
}
