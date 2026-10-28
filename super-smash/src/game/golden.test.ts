import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { cpuInput, type CpuWorld } from "@/ai/cpu";
import { meleeReachFromDef, stageViewFromDef } from "@/ai/behaviours";
import { mixBool, mixInt, mixString } from "@/engine/hash";
import { kineticSumX, kineticSumY } from "@/engine/kinetic";
import { createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { ActionState, FighterState, GameState, InputFrame, MatchRules, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";

import { SCRIPTED_MATCH, scriptedInputs } from "./goldenScript";

/**
 * The strangler's safety net (Plan 2, Tasks 0 and 0b).
 *
 * Five matches on the real roster and real stages: four CPU-vs-CPU stock
 * matches (levels 9 and 7) for 3,600 frames each, and one scripted timed match
 * with the Smash Ball on (`goldenScript.ts`) that walks both ports through the
 * grabs, throws, shield break, spot dodge, ledge jump and soft-stick paths no
 * CPU ever takes. Every frame's `digest` is folded into a running hash, and
 * every 100 frames that hash is compared with the committed one — so a
 * difference that heals before the next sample (a projectile one unit faster,
 * a status one frame longer) is still caught.
 *
 * Deliberately not `hashState`: Plan 2 adds fields to `FighterState`, and
 * `hashState` must cover them (that is its job), so its value changes on every
 * such task even when nobody moves differently. This digest changes only when
 * *behaviour* changes. A refactor task must leave it untouched; a behaviour task
 * regenerates it on purpose and says so in its commit message:
 *
 *   UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
 */

const FIXTURE = join(import.meta.dirname, "__golden__", "engine-trace.json");
const EVERY = 100;
const LEVELS = [9, 7] as const;

const FIGHTER_BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const CTX: SimContext = {
  fighter(id) {
    const d = FIGHTER_BY_ID.get(id);
    if (d === undefined) throw new Error(`unknown fighter ${id}`);
    return d;
  },
  stage(id) {
    const s = STAGE_BY_ID.get(id);
    if (s === undefined) throw new Error(`unknown stage ${id}`);
    return s;
  },
};

/** One frame's keys for every port, given the state they will be applied to. */
type Driver = (state: GameState, frame: number) => readonly InputFrame[];

interface Match {
  readonly name: string;
  readonly stage: string;
  readonly fighters: readonly string[];
  readonly seed: number;
  readonly rules: MatchRules;
  readonly frames: number;
  /** Only the CPU matches are held to the combat floor; the script's coverage is pinned instead. */
  readonly cpu: boolean;
  /** A fresh driver for one play-through, so a CPU's own seed starts over. */
  readonly driver: () => Driver;
}

const CPU_RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

function cpuMatch(name: string, stage: string, fighters: readonly [string, string], seed: number): Match {
  return {
    name,
    stage,
    fighters,
    seed,
    rules: CPU_RULES,
    frames: 3600,
    cpu: true,
    driver() {
      const view = stageViewFromDef(CTX.stage(stage));
      const worlds: CpuWorld[] = fighters.map((id) => {
        const def = CTX.fighter(id);
        return { stage: view, jumps: def.attributes.jumps, meleeReach: meleeReachFromDef(def) };
      });
      let cpuSeed = seed ^ 0x1f2e3d4c;
      return (state) =>
        fighters.map((_, port) => {
          const r = cpuInput(state, port, LEVELS[port], cpuSeed, worlds[port]);
          cpuSeed = r.seed;
          return r.input;
        });
    },
  };
}

const MATCHES: readonly Match[] = [
  cpuMatch("mario-fox-battlefield", "battlefield", ["mario", "fox"], 101),
  cpuMatch("donkeyKong-pikachu-finalDestination", "finalDestination", ["donkeyKong", "pikachu"], 202),
  cpuMatch("link-samus-smashville", "smashville", ["link", "samus"], 303),
  cpuMatch("kirby-marth-pokemonStadium2", "pokemonStadium2", ["kirby", "marth"], 404),
  {
    ...SCRIPTED_MATCH,
    cpu: false,
    driver() {
      const inputs = scriptedInputs(SCRIPTED_MATCH.steps);
      return (_state, frame) => inputs(frame);
    },
  },
];

/**
 * Every `ActionState` the five matches must visit between them: all 42. A
 * `Record` rather than a list, so a new state is a compile error here until
 * somebody pins it. Measured 2026-10-27, again after the Plan 2 final fix wave: the CPU
 * matches reach 34, the script 41 — everything but `entering`, which Final Destination's
 * floor-level spawn turns into a landing on frame 1, and which the Battlefield match keeps.
 */
const MUST_VISIT: Record<ActionState, true> = {
  stand: true,
  walk: true,
  dashStart: true,
  run: true,
  runBrake: true,
  turnaround: true,
  crouchStart: true,
  crouch: true,
  crouchEnd: true,
  jumpSquat: true,
  jump: true,
  fall: true,
  land: true,
  landingLag: true,
  attack: true,
  special: true,
  grab: true,
  grabHold: true,
  pummel: true,
  throw: true,
  shieldStart: true,
  shield: true,
  shieldRelease: true,
  shieldStun: true,
  shieldBroken: true,
  spotDodge: true,
  roll: true,
  airDodge: true,
  hitstun: true,
  tumble: true,
  grabbed: true,
  thrown: true,
  downed: true,
  getUp: true,
  ledgeHang: true,
  ledgeGetUp: true,
  ledgeAttack: true,
  ledgeRoll: true,
  ledgeJump: true,
  respawnPlatform: true,
  dead: true,
  entering: true,
};

/**
 * What `Btn.Soft` changes, each of which some frame must exercise: a held
 * direction that walks instead of dashing, a fresh direction plus attack that
 * tilts instead of smashing, and DI bent a quarter as far.
 */
type SoftPath = "walk" | "tilt" | "DI";
const SOFT_PATHS: readonly SoftPath[] = ["walk", "tilt", "DI"];

/**
 * The kinds of hit the scripted match lands (`hitKind`), measured from a run
 * after the Plan 2 final fix wave (the same five as after Task 21): the forward
 * throw, a forward smash and a soft forward tilt, the neutral special's fireball
 * (a projectile), and the short-hop neutral air that deals 0.85×. The jabs on
 * Fox's shield and his KO are checked by count.
 */
const SCRIPT_HITS: readonly string[] = ["fthrow", "fsmash", "ftilt", "neutralB", "nair (short hop)"];
const TILTS: readonly MoveSlot[] = ["ftilt", "utilt", "dtilt"];
const DIRECTIONS = Btn.Left | Btn.Right | Btn.Up | Btn.Down;

/**
 * Everything a presentation layer (the renderer, the CPU, the HUD) reads, and
 * nothing Plan 2 adds. Exactly:
 * - the frame, the RNG seed, the global freeze, the timer and the outcome;
 * - per fighter: position, velocity, facing, grounded, action, action frame,
 *   move, charge, damage, stocks, hitstun, hitlag, shield, jumps used,
 *   intangible, invincible, fast fall, short hop, who it is grabbing, Final
 *   Smash standby, costume and frames since a direction press;
 * - the Smash Ball: active, position, velocity, health and drift timer;
 * - each projectile's position.
 */
function digest(s: GameState): number {
  let x = mixInt(0x811c9dc5, s.frame);
  x = mixInt(x, s.rngSeed);
  x = mixInt(x, s.freezeFrames);
  x = mixInt(x, s.timeRemaining);
  if (s.outcome === null) x = mixInt(x, 0);
  else {
    x = mixString(x, s.outcome.kind);
    for (const port of s.outcome.placings) x = mixInt(x, port);
  }
  for (const f of s.fighters) {
    x = mixInt(x, f.x);
    x = mixInt(x, f.y);
    x = mixInt(x, f.vx);
    x = mixInt(x, f.vy);
    x = mixInt(x, f.facing);
    x = mixBool(x, f.grounded);
    x = mixString(x, f.action);
    x = mixInt(x, f.actionFrame);
    x = f.move === null ? mixInt(x, 0) : mixString(x, f.move);
    x = mixInt(x, f.charge);
    x = mixInt(x, f.damage);
    x = mixInt(x, f.stocks);
    x = mixInt(x, f.hitstun);
    x = mixInt(x, f.hitlag);
    x = mixInt(x, f.shieldHealth);
    x = mixInt(x, f.jumpsUsed);
    x = mixInt(x, f.intangible);
    x = mixInt(x, f.invincible);
    x = mixBool(x, f.fastFalling);
    x = mixBool(x, f.shortHop);
    x = mixInt(x, f.grabbing);
    x = mixInt(x, f.finalSmashReady);
    x = mixInt(x, f.costume);
    x = mixInt(x, f.framesSinceDirPress);
  }
  const ball = s.smashBall;
  x = mixBool(x, ball.active);
  x = mixInt(x, ball.x);
  x = mixInt(x, ball.y);
  x = mixInt(x, ball.vx);
  x = mixInt(x, ball.vy);
  x = mixInt(x, ball.health);
  x = mixInt(x, ball.driftTimer);
  x = mixInt(x, s.projectiles.length);
  for (const p of s.projectiles) {
    x = mixInt(x, p.x);
    x = mixInt(x, p.y);
  }
  return x >>> 0;
}

/** Which soft-stick paths one fighter took on one frame, from its state either side of it. */
function softPaths(before: FighterState, after: FighterState, input: InputFrame, prev: InputFrame): SoftPath[] {
  if ((input & Btn.Soft) === 0 || (input & DIRECTIONS) === 0) return [];
  const out: SoftPath[] = [];
  if (after.action === "walk") out.push("walk");
  const attackPressed = (input & Btn.Attack) !== 0 && (prev & Btn.Attack) === 0;
  if (attackPressed && after.action === "attack" && after.move !== null && TILTS.includes(after.move)) {
    out.push("tilt");
  }
  // A launch parked by a hit fires on the last frame of hitlag, bent by the
  // direction held then. Being grabbed or KO'd also clears it, but launches nothing.
  const launched = before.pendingFacing !== 0 && after.pendingFacing === 0;
  if (launched && after.action !== "grabbed" && after.action !== "dead") out.push("DI");
  return out;
}

/**
 * What landed a hit, named by the attacker's move slot. A short-hop aerial is its
 * own kind (it deals 0.85×, SPEC §4), and a hit with no move left on the attacker
 * is a projectile that outlived it.
 */
function hitKind(attacker: FighterState): string {
  const move = attacker.move ?? "projectile";
  return attacker.shortHop ? `${move} (short hop)` : move;
}

/**
 * What must hold on every frame, whatever the fighters do: `vx`/`vy` are
 * exactly the energies' sum, and every number a fighter carries is an integer
 * (Q12 or a count). The static guards cannot see every write
 * (`velocity-writes.test.ts` lists its blind spots); this sees their effect,
 * on every frame of all five matches.
 */
function invariantBreaks(f: FighterState, frame: number): string[] {
  const at = `frame ${frame}, port ${f.port}`;
  const out: string[] = [];
  if (f.vx !== kineticSumX(f) || f.vy !== kineticSumY(f)) {
    out.push(`${at}: vx/vy ${f.vx}/${f.vy}, energies ${kineticSumX(f)}/${kineticSumY(f)}`);
  }
  for (const leaf of nonIntegers(f, "fighter")) out.push(`${at}: ${leaf}`);
  return out;
}

/** Every numeric leaf under `value` that is not an integer, as `path = value`. */
function nonIntegers(value: unknown, path: string): string[] {
  if (typeof value === "number") return Number.isInteger(value) ? [] : [`${path} = ${value}`];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => nonIntegers(v, `${path}.${key}`));
}

interface Played {
  readonly digests: number[];
  readonly hits: number;
  readonly shieldHits: number;
  readonly kos: number;
  readonly actions: ReadonlySet<ActionState>;
  readonly soft: ReadonlySet<SoftPath>;
  /** Every kind of hit landed, as `hitKind` names it. */
  readonly hitKinds: ReadonlySet<string>;
  /** The first few frames that broke `invariantBreaks`, if any did. */
  readonly invariantBreaks: readonly string[];
}

function play(match: Match): Played {
  let state = createInitialState(
    match.stage,
    match.fighters.map((defId) => ({ defId })),
    match.rules,
    match.seed,
    CTX,
  );
  const inputsFor = match.driver();
  let prev: readonly InputFrame[] = match.fighters.map(() => 0);
  let roll = 0x811c9dc5;
  const digests: number[] = [];
  const actions = new Set<ActionState>();
  const soft = new Set<SoftPath>();
  const hitKinds = new Set<string>();
  const breaks: string[] = [];
  let hits = 0;
  let shieldHits = 0;
  let kos = 0;
  for (let frame = 1; frame <= match.frames; frame++) {
    const inputs = inputsFor(state, frame);
    const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
    for (let port = 0; port < out.state.fighters.length; port++) {
      const after = out.state.fighters[port];
      actions.add(after.action);
      for (const p of softPaths(state.fighters[port], after, inputs[port], prev[port])) soft.add(p);
      if (breaks.length < 5) breaks.push(...invariantBreaks(after, frame));
    }
    state = out.state;
    prev = inputs;
    hits += out.events.hits.length;
    for (const h of out.events.hits) hitKinds.add(hitKind(out.state.fighters[h.attacker]));
    shieldHits += out.events.shieldHits.length;
    kos += out.events.kos.length;
    roll = mixInt(roll, digest(state));
    if (frame % EVERY === 0) digests.push(roll >>> 0);
  }
  return { digests, hits, shieldHits, kos, actions, soft, hitKinds, invariantBreaks: breaks };
}

describe("engine golden trace", () => {
  const played = new Map(MATCHES.map((m) => [m.name, play(m)]));
  const all = MATCHES.map((m) => played.get(m.name)!);

  // A trace of idle fighters would pass every refactor and prove nothing.
  // Measured 2026-10-27 after the Plan 2 final fix wave, CPU matches then the
  // script: hits 14/10/13/22 and 5, shield hits 0/1/2/1 and 3, KOs 1/2/1/0 and 1.
  function expectCombat(): void {
    const cpu = MATCHES.filter((m) => m.cpu).map((m) => played.get(m.name)!);
    for (const p of cpu) expect(p.hits).toBeGreaterThan(5);
    expect(cpu.reduce((n, p) => n + p.shieldHits + p.kos, 0)).toBeGreaterThan(2);
  }

  // The code a refactor moves is only guarded if a match runs it, so the
  // states and soft-stick paths visited are pinned, not just counted.
  function expectCoverage(): void {
    const actions = new Set(all.flatMap((p) => [...p.actions]));
    const unvisited = (Object.keys(MUST_VISIT) as ActionState[]).filter((a) => !actions.has(a));
    expect(unvisited, "action states no match reaches").toEqual([]);
    const soft = new Set(all.flatMap((p) => [...p.soft]));
    expect(SOFT_PATHS.filter((p) => !soft.has(p)), "Btn.Soft paths no match takes").toEqual([]);
  }

  // A re-tuned step can keep every state and still stop landing a hit: air
  // friction (Task 21) left Fox out of the short-hop nair's reach while the
  // script still reached `jump`, `attack` and `land`. So the script's hits are
  // pinned by kind, from a run, not just its states.
  function expectScriptHits(): void {
    const script = played.get(SCRIPTED_MATCH.name)!;
    expect(SCRIPT_HITS.filter((k) => !script.hitKinds.has(k)), "hits the scripted match no longer lands").toEqual([]);
    expect(script.shieldHits, "the three jabs on Fox's shield").toBeGreaterThanOrEqual(3);
    expect(script.kos, "Fox's self-destruct").toBeGreaterThanOrEqual(1);
  }

  function expectInvariants(): void {
    for (const m of MATCHES) expect(played.get(m.name)!.invariantBreaks, m.name).toEqual([]);
  }

  // All run when regenerating too, so a degenerate trace cannot be recorded.
  it("exercises combat, not an idle screen", expectCombat);
  it("visits every action state and every soft-stick path", expectCoverage);
  it("lands every kind of hit the scripted match lands", expectScriptHits);
  it("keeps vx/vy the energies' sum, and every fighter number an integer, on every frame", expectInvariants);

  if (process.env.UPDATE_GOLDEN === "1") {
    it("writes the golden trace", () => {
      // A failed test above does not stop this one, so it checks again first.
      expectCombat();
      expectCoverage();
      expectScriptHits();
      expectInvariants();
      const out: Record<string, number[]> = {};
      for (const m of MATCHES) out[m.name] = played.get(m.name)!.digests;
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + "\n");
    });
    return;
  }

  const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, number[] | undefined>;
  for (const m of MATCHES) {
    it(`replays ${m.name} exactly`, () => {
      const want = expected[m.name];
      if (want === undefined) {
        expect.fail(`no golden trace for ${m.name}: regenerate with UPDATE_GOLDEN=1`);
      }
      const got = played.get(m.name)!.digests;
      expect(got.length).toBe(want.length);
      const firstDiff = got.findIndex((v, i) => v !== want[i]);
      const span = `frames ${firstDiff * EVERY + 1}-${(firstDiff + 1) * EVERY}`;
      expect(firstDiff, `first divergence in ${span}`).toBe(-1);
    });
  }
});
