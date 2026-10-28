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
 * The motion frame is kept as an exact fraction, never as Q12: a rate such as
 * 0.9 accumulated in Q12 reaches 10.99976 after nine frames instead of 11, and
 * `frame(11)` would fire a game frame late. Review Focus #3.
 */

import type { AcmdCommand, AcmdScript, AttackParams, CatchParams, HitStatus } from "./types";

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
  /** `ATK_SET_SHIELD_SETOFF_MUL` per attack id. */
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

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x === 0 ? 1 : x;
}

/** Exact motion position: `n / d` motion frames. */
interface Frac {
  readonly n: number;
  readonly d: number;
}

function reduce(n: number, d: number): Frac {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameState {
  const attacks = new Map<number, AttackParams>();
  const catches = new Map<number, CatchParams>();
  const shieldSetoff = new Map<number, number>();
  const flags = new Set<string>();
  const windows: { x: number; y: number; start: number; until: number; order: number }[] = [];
  const fired: AcmdCommand[] = [];
  let superArmour = false;
  let wholeHit: HitStatus = "HIT_STATUS_NORMAL";

  // The current constant-rate segment: from game frame g0 at motion m0, the
  // motion advances rateDen / rateNum per game frame.
  let g0 = 1;
  let m0: Frac = { n: 1, d: 1 };
  let rateNum = 1;
  let rateDen = 1;
  const motionAt = (g: number): Frac => reduce(m0.n * rateNum + (g - g0) * rateDen * m0.d, m0.d * rateNum);

  // Where the script is holding until, as a motion frame.
  let target: Frac = { n: 1, d: 1 };
  let last = 1;
  /** The first game frame, not before the previous command, whose motion reaches `target`. */
  const due = (): number => {
    const gap = target.n * m0.d - m0.n * target.d; // (target − m0) · target.d · m0.d
    let g = g0;
    if (gap > 0) {
      const num = gap * rateNum;
      const den = target.d * m0.d * rateDen;
      g = g0 + Math.floor((num + den - 1) / den);
    }
    return g > last ? g : last;
  };

  for (const c of flatten(script)) {
    if (c.op === "frame") {
      if (c.frame * target.d > target.n) target = { n: c.frame, d: 1 };
      continue;
    }
    const e = due();
    if (e > gameFrame) break;
    last = e;
    if (c.op === "wait") {
      const m = motionAt(e);
      target = { n: m.n + c.frames * m.d, d: m.d };
      continue;
    }
    if (e === gameFrame) fired.push(c);
    switch (c.op) {
      case "attack":
        attacks.set(c.params.id, c.params);
        break;
      case "catch":
        catches.set(c.params.id, c.params);
        break;
      case "clearAll":
        attacks.clear();
        break;
      case "clear":
        attacks.delete(c.id);
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
      case "motionRate":
        m0 = motionAt(e);
        g0 = e;
        rateNum = c.rate[0];
        rateDen = c.rate[1];
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

  const m = motionAt(gameFrame);
  return {
    attacks: [...attacks.values()].sort((a, b) => a.id - b.id),
    catches: [...catches.values()].sort((a, b) => a.id - b.id),
    shieldSetoff,
    flags: [...flags].sort(),
    superArmour,
    wholeHit,
    momentum,
    motionFrame: Math.floor(m.n / m.d),
    fired,
  };
}
