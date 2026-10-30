import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { cpuInput, cpuWorldFromDef, type CpuWorld } from "@/ai/cpu";
import { stageViewFromDef } from "@/ai/behaviours";
import { FNV_OFFSET, mixBool, mixInt, mixString } from "@/engine/hash";
import { kineticSumX, kineticSumY } from "@/engine/kinetic";
import { launchWorldAngle } from "@/engine/knockback";
import { toFloat } from "@/engine/fixed";
import { createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { ActionState, FighterState, GameState, InputFrame, MatchRules, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";
import { stateInvariantBreaks } from "./stateInvariants";

import { TECH_LAB } from "./goldenLab";
import { SCRIPTED_MATCH, scriptedInputs } from "./goldenScript";
import { STATES_LAB } from "./goldenStatesLab";

/**
 * The strangler's safety net (Plan 2, Tasks 0 and 0b).
 *
 * Seven matches on the real roster and real stages: four CPU-vs-CPU stock
 * matches (levels 9 and 7) for 3,600 frames each, one scripted timed match
 * with the Smash Ball on (`goldenScript.ts`) that walks both ports through the
 * grabs, throws, shield break, spot dodge, ledge jump and soft-stick paths no
 * CPU ever takes, a 100-frame tech lab (`goldenLab.ts`, Plan 3 Task 12):
 * three fighters launched by hand into the floor, the wall and the underside,
 * and a 400-frame states lab (`goldenStatesLab.ts`, Plan 5 Task 8, ruling
 * P5-R14): scripted keys for the Plan 5 states nothing else reaches, Donkey
 * Kong's cargo first.
 * Every frame's `digest` is folded into a running hash, and
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
 *
 * A regenerated trace also needs its digest rewritten in `rulesVersion.test.ts`
 * (`RULES_PIN.golden`), which fails until it is. `ENGINE_RULES_VERSION` itself
 * bumps once per plan, not per task.
 */

const FIXTURE = join(import.meta.dirname, "__golden__", "engine-trace.json");
const EVERY = 100;
const LEVELS = [9, 7] as const;

const FIGHTER_BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const BASE: SimContext = {
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
// As the game plays (Plan 4): the committed bake — limb-bone hitboxes, per-bone
// hurtboxes, the bone-derived ECB — and the limb-bone scripts it can place (Task 13).
const CTX: SimContext = bakedContext(BASE, readBakeFromDisk());

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
  /** Shape the initial state before the first step, for a match that starts mid-launch. */
  readonly setup?: (state: GameState) => void;
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
      const worlds: CpuWorld[] = fighters.map((id) => cpuWorldFromDef(CTX.fighter(id), view));
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
  {
    ...TECH_LAB,
    cpu: false,
    driver() {
      return (_state, frame) => TECH_LAB.inputs(frame);
    },
  },
  {
    ...STATES_LAB,
    cpu: false,
    driver() {
      return (_state, frame) => STATES_LAB.inputs(frame);
    },
  },
];

/**
 * Every `ActionState` the seven matches must visit between them: all 52. A
 * `Record` rather than a list, so a new state is a compile error here until
 * somebody pins it. Measured 2026-10-27, again after the Plan 2 final fix wave: the CPU
 * matches reach 34, the script 41 — everything but `entering`, which Final Destination's
 * floor-level spawn turns into a landing on frame 1, and which the Battlefield match keeps.
 * Plan 3 Task 12 added the four tech states and `tumbleFall`. A tumble that lands in
 * hitstun too fast to tech bounces; one whose hitstun runs out in the air becomes
 * `tumbleFall` and lies down (`downed`, `getUp`) on landing unless it techs, so the CPU
 * matches reach all three. The script techs Fox on two of its landings (`tech`) and the
 * tech lab reaches `techRoll`, `techWall` and `techCeiling`, which no scripted fight gets
 * to without off-stage play. Task 15 added `ledgeTrumped`: three of the four CPU matches
 * reached it then (four trumps between them, as its re-review counted: the draft's "all
 * four" was before only a hanging fighter could be trumped), two fighters going for one
 * ledge being what recovering CPUs do. After Task 18 none does (the CPUs space by the
 * imported scripts' reach), so the script trumps Mario on 1788 (`goldenScript.ts`).
 * Plan 4 Task 12 (the baked world, at SSBU's sizes): the CPU matches reach 39, the script
 * 44 and the tech lab its 7; the Donkey Kong and Pikachu match trumps a ledge once again,
 * and the script still trumps Mario, on 1786. Task 13 (the limb-bone scripts on; the CPUs
 * space by their baked reach): the CPU matches reach 32 — none grabs, spot-dodges,
 * techs, ledge-rolls, is shield-stunned or trumps a ledge — and the script and the
 * lab, unchanged, cover those. Task 13b's fix round 1 (Link's and Marth's blades
 * held along the drawn ones): 31 — a shield is stunned now, and none crouches,
 * grabs, spot-dodges, techs, ledge-rolls, breaks a shield or trumps a ledge.
 * Plan 5 Task 4 (Mario's Cape, which moves mario-fox): 33 — mario-fox crouches and
 * trumps a ledge now, and no CPU ledge-attacks; none grabs, spot-dodges, techs,
 * ledge-rolls or breaks a shield. Its fix round 1 (the Cape's aerial motion, a
 * backward side-B turning): 34 — donkeyKong-pikachu tech-rolls and ledge-rolls, and
 * none trumps a ledge any more; none grabs, spot-dodges, ledge-attacks or breaks a
 * shield. Plan 5 Task 4b added `specialFall` and `specialLanding`: 36 — mario-fox,
 * link-samus and kirby-marth each fall helpless after an up special and land into
 * the special landing, and donkeyKong-pikachu techs; none ledge-rolls any more, and
 * none crouches, grabs, spot-dodges, ledge-attacks, breaks a shield or trumps a
 * ledge. Its fix round 1 (the CPU's up special model, the hard helpless cap):
 * 35 — all four fall helpless and land into the special landing now,
 * link-samus spot-dodges and two ledge-attack; none techs, tech-rolls or is
 * shield-stunned any more, and none crouches, grabs, ledge-rolls, breaks a
 * shield or trumps a ledge.
 * Plan 5 Task 8 added `cargoCarry` and `cargoHeld`, Donkey Kong's carry and the
 * fighter carried. No golden CPU grabs and the script has no Donkey Kong, so a
 * seventh match, the states lab (ruling P5-R14: visited, not exempted), carries
 * Mario twice: he mashes out of the first carry, and the second ends in a cargo
 * up throw that lands. Tasks 9, 11 and 12 extend it for their own states.
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
  specialFall: true,
  specialLanding: true,
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
  tumbleFall: true,
  tech: true,
  techRoll: true,
  techWall: true,
  techCeiling: true,
  ledgeHang: true,
  ledgeGetUp: true,
  ledgeAttack: true,
  ledgeRoll: true,
  ledgeJump: true,
  ledgeTrumped: true,
  cargoCarry: true,
  cargoHeld: true,
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
  let x = mixInt(FNV_OFFSET, s.frame);
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
  if (launched && after.action === "tumble" && diBentTheLaunch(before, after)) out.push("DI");
  return out;
}

/**
 * Did DI actually bend the launch that fired this frame? Only a tumbling launch
 * is DI-able, and one within 0.17 rad of straight ahead is not DI-able at all
 * (`launchDiAble`), so "a launch fired while a soft direction was held" is not
 * the path: a launch DI ignored left it untaken. This reads the effect, not the
 * rule: the direction the launch left in (its DAMAGE energy) against the one the
 * hit parked, which differ by more than a rounding error and by no more than
 * DI's 9.74° (a bounce at release, which turns a launch right round, is not DI).
 */
function diBentTheLaunch(before: FighterState, after: FighterState): boolean {
  const parked = toFloat(launchWorldAngle(before.pendingAngle, before.pendingFacing));
  const fired = (Math.atan2(after.kinetic.damageY, after.kinetic.damageX) * 180) / Math.PI;
  const turned = Math.abs(((fired - parked + 540) % 360) - 180);
  return turned > 0.1 && turned <= 9.75;
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
 * exactly the energies' sum, every number a fighter carries is an integer
 * (Q12 or a count), and the stale queue's parallel array has its length (and
 * across fighters and the stage, `stateInvariantBreaks`: no ledge held twice, no
 * fighter inside the stage). The static guards cannot see every write
 * (`velocity-writes.test.ts` lists its blind spots); this sees their effect,
 * on every frame of all seven matches.
 */
function invariantBreaks(f: FighterState, frame: number): string[] {
  const at = `frame ${frame}, port ${f.port}`;
  const out: string[] = [];
  if (f.vx !== kineticSumX(f) || f.vy !== kineticSumY(f)) {
    out.push(`${at}: vx/vy ${f.vx}/${f.vy}, energies ${kineticSumX(f)}/${kineticSumY(f)}`);
  }
  for (const leaf of nonIntegers(f, "fighter")) out.push(`${at}: ${leaf}`);
  // `combat.staleShield` is `staleQueue`'s parallel array (the invariant is
  // documented on `CombatState.staleShield`): a drift would stale a move at the
  // wrong rate without throwing.
  if (f.combat.staleShield.length !== f.staleQueue.length) {
    out.push(`${at}: staleShield ${f.combat.staleShield.length} marks, staleQueue ${f.staleQueue.length} entries`);
  }
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
  match.setup?.(state);
  const inputsFor = match.driver();
  let prev: readonly InputFrame[] = match.fighters.map(() => 0);
  let roll = FNV_OFFSET;
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
    if (breaks.length < 5) breaks.push(...stateInvariantBreaks(out.state, CTX.stage(match.stage), frame));
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
  // Measured 2026-10-29 on Plan 4 Task 13 (the baked world, with the limb-bone
  // scripts on), the four CPU matches in `MATCHES` order, then the script, then the
  // tech lab: hits 19/36/13/11, 6 and 0; shield hits 0/3/0/0, 3 and 0; KOs 1/1/3/2,
  // 1 and 2, and the same again after Task 12's fix round 1 (the ECB's top from the
  // body, not the arms; the underside asks where the feet were), which moved only
  // link-samus from frame 2232 and the lab's ceiling tech from frame 1 to 3. Task 13's
  // fix round 1 (Samus's grabs and seven held slots back on their legacy moves) moved
  // only mario-fox, from frame 2034: hits 16, shield hits 0, KOs 3 there. Task 13b
  // (six held clips re-posed and back on their scripts, and the clips whose striking
  // limb was not the script's) moved mario-fox from the 2001-2100 sample, back to
  // hits 19, shield hits 0, KOs 1, and kirby-marth from the first sample: hits 15,
  // shield hits 0, KOs 2; the other four are unchanged. Its fix round 1 (Link's and
  // Marth's blades held along the drawn ones) moved link-samus and kirby-marth from
  // the first sample: hits 18 and 13, shield hits 0 and 1, KOs 4 and 2.
  // Plan 5 Task 4 (Mario's Cape turns its victim, stalls, and has the game's 110°,
  // FKB 80 boxes) moved only mario-fox, from the 201-300 sample: the CPU's up-B
  // press, buffered through a fair offstage, comes out as a Cape on frame 300, which
  // now stalls, so Mario's first stock goes on frame 370, not 338, and the match
  // differs from there: hits 11, shield hits 0, KOs 4 (were 19, 0 and 1), all four
  // self-destructs. Its fix round 1 moved three: mario-fox from the 201-300 sample
  // (that Cape now restricts Mario's drift for its 58 frames), and donkeyKong-pikachu
  // from 1401-1500 and link-samus from 2501-2600 (a side-B pressed backward now turns
  // the fighter round first): hits 14, 34 and 18; shield hits 0, 1 and 0; KOs 2, 1
  // and 4. Then: hits 14/34/18/13, 6 and 0; shield hits 0/1/0/1, 3 and 0; KOs
  // 2/1/4/2, 1 and 2, every one a self-destruct: on the frame before it the
  // fighter was in no hitstun and had no launch left.
  // Plan 5 Task 4b (an up special ends helpless, so no CPU up-Bs twice in one
  // airtime, and the CPU spends it by where it goes) moved all four CPU matches:
  // mario-fox from the 201-300 sample, link-samus from 101-200, kirby-marth from
  // 301-400 and donkeyKong-pikachu from 1301-1400: hits 17, 24, 19 and 40; shield
  // hits 0, 1, 0 and 0; KOs 1, 2, 1 and 1. So now: hits 17/40/24/19, 6 and 0;
  // shield hits 0/0/1/0, 3 and 0; KOs 1/1/2/1, 1 and 2. Two are the first KOs by a
  // hit in these matches (Donkey Kong in donkeyKong-pikachu and Samus in
  // link-samus, each still tumbling from a hit); the rest are still
  // self-destructs, none of them in special fall (Mario during a Cape, Samus
  // during a Missile, Marth during Dolphin Slash).
  // Its fix round 1 (the CPU models its up special by the engine's own rules,
  // stick and helpless cap included; a helpless fall's drift is capped hard;
  // Link's grounded Spin Attack ends free to act) moved the same four from the
  // same samples: hits 17, 33, 20 and 23; shield hits 0 in all four; KOs 1, 2, 0
  // and 1. So now: hits 17/33/20/23, 6 and 0; shield hits 0/0/0/0, 3 and 0; KOs
  // 1/2/0/1, 1 and 2. One KO is by a hit (Marth in kirby-marth, tumbling); the
  // others are self-destructs: Mario during a Cape, Donkey Kong during a
  // Headbutt, and Pikachu in special fall after a Quick Attack.
  // Plan 5 Task 7 (throws read ATTACK_ABS, pummels are catch-only, and both run
  // their scripts) moved only the script, from its 201-300 sample: the pummel's
  // script freezes 14 frames and lasts its 6, and the forward throw lands with no
  // freeze, so the throw is pressed on 238 and lands on 250 (`goldenScript.ts`), and
  // from 300 on both fighters are where they were. No CPU match grabs, so the four
  // and the lab keep their traces: hits 17/33/20/23, 6 and 0; shield hits 0/0/0/0,
  // 3 and 0; KOs 1/2/0/1, 1 and 2, as before.
  // Its fix round 1 (a script's first actionable frame counted in game frames
  // through its FT_MOTION_RATE, which re-times eleven running moves; a throw's
  // release freezing the one thrown alone; Marth's catch stops; throw
  // invincibility; the grab timer running through a pummel's freeze) moved two:
  // kirby-marth from the 101-200 sample (Kirby's jab and neutral and up airs end
  // sooner) and link-samus from 1001-1100 (Link's jab, down tilt and forward air
  // re-timed): hits 23 and 21, shield hits 0 and 1, KOs 2 and 2. So now: hits
  // 17/33/21/23, 6 and 0; shield hits 0/0/1/0, 3 and 0; KOs 1/2/2/2, 1 and 2.
  // Plan 5 Task 8 (Donkey Kong's cargo) left the six byte-identical (the CPUs
  // grab nobody; the script has no Donkey Kong) and added the states lab: one hit
  // (the cargo up throw), no shield hits, no KO. So now: hits 17/33/21/23, 6, 0
  // and 1; shield hits 0/0/1/0, 3, 0 and 0; KOs 1/2/2/2, 1, 2 and 0.
  // (Task 12's, before the limb-bone scripts: hits 15/32/13/17, shield hits
  // 1/2/0/1, KOs 1/0/3/1. Plan 3's, on Plan 2's boxes: hits 12/18/7/11, shield hits
  // 0/3/2/0, KOs 3/1/1/2.)
  // The floors below are what a refactor must not drop, not these counts.
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
  it("keeps vx/vy the energies' sum, every fighter number an integer, and every fighter out of the stage, on every frame", expectInvariants);

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
