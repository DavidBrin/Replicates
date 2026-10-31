import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { cpuInput, cpuWorldFromDef, type CpuWorld } from "@/ai/cpu";
import { stageViewFromDef } from "@/ai/behaviours";
import { FNV_OFFSET, mixBool, mixInt, mixString } from "@/engine/hash";
import { kineticSumX, kineticSumY } from "@/engine/kinetic";
import { launchWorldAngle } from "@/engine/knockback";
import { toFloat } from "@/engine/fixed";
import { findProjectileDef } from "@/engine/projectile";
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
import { INHALE_LAB } from "./goldenInhaleLab";
import { CRAWL_LAB } from "./goldenCrawlLab";
import { STATES_LAB } from "./goldenStatesLab";
import { PROJECTILE_LAB } from "./goldenProjectileLab";
import { PROJECTILE_PATHS, projectilePathsOf, type ProjectilePath } from "./projectilePaths";

/**
 * The strangler's safety net (Plan 2, Tasks 0 and 0b).
 *
 * Ten matches on the real roster and real stages: four CPU-vs-CPU stock
 * matches (levels 9 and 7) for 3,600 frames each, one scripted timed match
 * with the Smash Ball on (`goldenScript.ts`) that walks both ports through the
 * grabs, throws, shield break, spot dodge, ledge jump and soft-stick paths no
 * CPU ever takes, a 100-frame tech lab (`goldenLab.ts`, Plan 3 Task 12):
 * three fighters launched by hand into the floor, the wall and the underside,
 * and a 600-frame states lab (`goldenStatesLab.ts`, Plan 5 Task 8, ruling
 * P5-R14): scripted keys for the Plan 5 states nothing else reaches, Donkey
 * Kong's cargo first and the footstools after (Task 11), a 400-frame Inhale lab (`goldenInhaleLab.ts`, Task 9,
 * ruling R-T8e): Kirby against Mario, the spit and the swallow, and a 200-frame
 * crawl lab (`goldenCrawlLab.ts`, Task 12, ruling R-T8e): Pikachu crawls, down
 * tilts out of the crawl, and crawls off the stage's edge onto the ledge, and a
 * projectile lab (`goldenProjectileLab.ts`, Task 13c, ruling R-T8e; 300 frames after
 * its fix round 1, 600 after Task 13d): Samus's bomb settles and goes off on its
 * timer, her Charge Shot and Link's arrow clank, a Charge Shot flies out its life,
 * one clanks with Link's jab and he rebounds, and the smash-input specials, Samus's
 * Super Missile and Link's smash-thrown Boomerang, each land their hit.
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

/** A projectile's definition, from its source fighter's. */
const projectileDefOf = (p: GameState["projectiles"][number]) => findProjectileDef(CTX.fighter(p.source), p.defId);

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
  {
    ...INHALE_LAB,
    cpu: false,
    driver() {
      return (_state, frame) => INHALE_LAB.inputs(frame);
    },
  },
  {
    ...CRAWL_LAB,
    cpu: false,
    driver() {
      return (_state, frame) => CRAWL_LAB.inputs(frame);
    },
  },
  {
    ...PROJECTILE_LAB,
    cpu: false,
    driver() {
      return (_state, frame) => PROJECTILE_LAB.inputs(frame);
    },
  },
];

/**
 * Every `ActionState` the ten matches must visit between them: all 58. A
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
 * Plan 5 Task 7b (a freeze of n frames counts its own frame; its damage leaves
 * the 1v1 multiplier out) moved all four CPU matches: they reach 44 between them
 * now — kirby-marth grabs, throws, is grabbed and thrown and spot-dodges,
 * link-samus is shield-stunned, mario-fox trumps a ledge, and two tech-roll —
 * and lose none of the 35.
 * Plan 5 Task 9 added `inhaleHold`, `swallowed` and `spatStar`, Kirby's Inhale. No
 * golden CPU inhales (a CPU fires specials only to recover), and the states lab
 * must stay as it is (ruling R-T8e), so an eighth match, the Inhale lab, has Kirby
 * spit Mario as a star and then swallow him for a Copy Ability.
 * Plan 5 Task 7b's fix round 1 (the 1v1 bonus on the damage alone, not the
 * knockback) moved all four CPU matches again: they reach 39 between them, newly
 * pummelling and teching in place, and no longer trumping a ledge, ledge-attacking,
 * ledge-rolling, tech-rolling, throwing, being thrown or being shield-stunned; the
 * script, re-tuned, still trumps Mario (`goldenScript.ts`), and its nair no longer
 * tumbles Fox, so `tumbleFall`, `downed` and `getUp` are the four CPU matches' and
 * the states lab's. All 55 are visited.
 * Plan 5 Task 11 added `footstooled`, a fighter stood on by a footstool jump. No
 * golden match footstools (all eight traces were byte-identical with footstools
 * on), so the states lab appends 200 frames after its 400 (ruling R-T11a: its
 * earlier steps and samples untouched): Mario jumps off Donkey Kong's head
 * standing (`footstooled`) and then in the air (his tumble down and lie-down).
 * All 56 are visited.
 * Plan 5 Task 12 added `crawl`, Pikachu's. No golden CPU crawls (the eight traces
 * were byte-identical with crawling in), and neither lab has a crawler; a lab's
 * fighters are fixed for the match, so appending to one (ruling R-T11a) cannot
 * reach it. So a ninth match, the crawl lab (ruling R-T8e), has Pikachu crawl
 * both ways, down tilt out of the crawl, and crawl off the edge onto the ledge.
 * All 57 are visited.
 * Plan 5 Task 13c's fix round 1 added `rebound`, a clank's recoil (ruling
 * R-T13c-a). No golden CPU match and no other lab rebounds, so the projectile lab,
 * this task's own (ruling R-T13c-f), appends 100 frames after its 200: Link jabs into
 * a Charge Shot and rebounds. All 58 are visited.
 * Plan 5 Task 13b (the up specials as published; the CPU recovers with them) adds
 * no action: an aerial up special of its own (`upBAir`) is a move in `special`, and a
 * landing during one is the `specialLanding` the helpless fall already lands in. The
 * four CPU matches reach 42 between them, up from 40: they rebound off a clank and
 * throw and are thrown now, and none trumps a ledge. All 58 are visited.
 * Plan 5 Task 13d (smash-input specials) adds no action either: a side special's
 * smash version (`sideBSmash`) is a move in `special`, and the Super Missile lands
 * into the aerials' `landingLag`. The projectile lab, appended after its 300 (ruling
 * R-T11a), now also tumbles Samus into `tumbleFall`, `downed` and `getUp`, which the
 * CPU matches and the states lab already reach. All 58 are visited.
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
  crawl: true,
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
  rebound: true,
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
  footstooled: true,
  inhaleHold: true,
  swallowed: true,
  spatStar: true,
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
 * on every frame of all ten matches.
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
  /** What the match's projectiles came to (`ProjectilePath`): how many projectiles reached each. */
  readonly projectilePaths: ReadonlyMap<ProjectilePath, number>;
  /** Every projectile launched, by definition id (Plan 5, Task 13d). */
  readonly launched: ReadonlySet<string>;
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
  const launched = new Set<string>();
  /** The paths each projectile (by `instanceId`) reached. */
  const reached = new Map<number, Set<ProjectilePath>>();
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
    for (const [id, path] of projectilePathsOf(state, out.state, out.events.clanks, projectileDefOf)) {
      const set = reached.get(id) ?? new Set<ProjectilePath>();
      set.add(path);
      reached.set(id, set);
    }
    for (const p of out.state.projectiles) if (!state.projectiles.some((q) => q.instanceId === p.instanceId)) launched.add(p.defId);
    state = out.state;
    prev = inputs;
    hits += out.events.hits.length;
    for (const h of out.events.hits) hitKinds.add(hitKind(out.state.fighters[h.attacker]));
    shieldHits += out.events.shieldHits.length;
    kos += out.events.kos.length;
    roll = mixInt(roll, digest(state));
    if (frame % EVERY === 0) digests.push(roll >>> 0);
  }
  const projectilePaths = new Map<ProjectilePath, number>();
  for (const set of reached.values()) for (const path of set) projectilePaths.set(path, (projectilePaths.get(path) ?? 0) + 1);
  return { digests, hits, shieldHits, kos, actions, soft, hitKinds, projectilePaths, launched, invariantBreaks: breaks };
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
  // Plan 5 Task 7b (one hitlag convention: a freeze of n frames counts the frame
  // it starts on, so every hit's freeze is a frame shorter, and its damage leaves
  // the 1v1 multiplier out, so a 1v1 hit's is shorter again where the bonus
  // crossed a frame) moved five: mario-fox from the 801-900 sample, the other
  // three CPU matches from the first, and the script from 201-300 (its pummel's
  // freeze, 14 frames, now holds 13 past the hit's). The two labs hold: the tech
  // lab lands no hit, and the states lab's one, the cargo up throw, freezes
  // nobody. Hits 19, 16, 21 and 21; shield hits 0, 0, 1 and 0; KOs 3, 2, 0 and 0.
  // So now: hits 19/16/21/21, 6, 0 and 1; shield hits 0/0/1/0, 3, 0 and 0; KOs
  // 3/2/0/0, 1, 2 and 0, every one a self-destruct: Mario twice during a Cape and
  // Fox during Fire Fox in mario-fox, Donkey Kong during a Headbutt and Pikachu in
  // special fall in donkeyKong-pikachu.
  // Plan 5 Task 9 (Kirby's Inhale) left the seven byte-identical (no CPU inhales;
  // neither lab has a Kirby) and added the Inhale lab: four hits (the spit's 7.20%,
  // the swallow's 12% and two copied Fireballs of 7.20%), no shield hits, no KO. So
  // now: hits 19/16/21/21, 6, 0, 1 and 4; shield hits 0/0/1/0, 3, 0, 0 and 0; KOs
  // 3/2/0/0, 1, 2, 0 and 0.
  // Plan 5 Task 7b's fix round 1 (ruling R-7b-b: the 1v1 bonus scales the damage
  // dealt and no longer the knockback, `d` or the percent; R-7b-c: an armoured
  // fighter freezes too, which no match reaches) moved seven, every match with a
  // launch in a one-on-one: mario-fox from the 801-900 sample, the other three CPU
  // matches from the first, the script from 201-300 (the forward throw launches Fox
  // less far; two steps re-tuned, `goldenScript.ts`), the states lab from 201-300
  // (the cargo up throw's launch) and the Inhale lab from 301-400 (the star's and the
  // copied Fireballs'). The tech lab lands no hit and holds. Hits 32, 20, 18 and 21;
  // shield hits 0 in all four; KOs 1, 2, 1 and 0. So now: hits 32/20/18/21, 6, 0, 1
  // and 4; shield hits 0/0/0/0, 3, 0, 0 and 0; KOs 1/2/1/0, 1, 2, 0 and 0. One is by
  // a hit (Samus in link-samus, tumbling at 104%); the rest are self-destructs:
  // Mario during a Cape, Donkey Kong and Pikachu in special fall, Fox in the script,
  // and the tech lab's two.
  // Plan 5 Task 9's fix round 1 (the Inhale's published boxes, 63 frames, held
  // loop and pull; the swallow's star; copies that end cleanly) moved only the
  // Inhale lab, from its 101-200 sample, where its steps are re-tuned
  // (`goldenInhaleLab.ts`: the second inhale pulls Mario in, held, and the swallow's
  // star carries him out). Still four hits there, no shield hit, no KO; the other
  // seven are byte-identical, so the counts are as above.
  // Plan 5 Task 7b's fix round 2 (the 1v1 bonus never reaches a shield, ruling
  // R-7b-d; a trade never shortens a freeze, ruling R-7b-e, which no match reaches
  // in a way that shows) moved only the script, from its 401-500 sample: its three
  // jabs on Fox's shield, a one-on-one, take less of it, so it breaks on 659, not
  // 649, and one step is re-tuned (`goldenScript.ts`). Still six hits there, three
  // on the shield and one KO; the other seven are byte-identical, so the counts are
  // as above.
  // Plan 5 Task 11 (footstool jumps) left all eight traces byte-identical as they
  // were (no CPU or scripted match footstools) and appended frames 401-600 to the
  // states lab (ruling R-T11a), whose first four samples are unchanged: two
  // footstools, neither a hit (a footstool deals none), so the counts are as above.
  // Its fix round 1 (a fighter in hitstun can be stood on; a run of footstools
  // shortens with fall speed; only a jump pressed that frame footstools; the
  // footstooler acts from the bounce's frame 8 and is intangible on 9-12) moved only
  // the states lab, from its 401-500 sample: Mario is intangible on 452-455 and
  // 492-495, every other named frame as before. The other seven are byte-identical
  // (no golden CPU footstools), so the counts are as above.
  // Plan 5 Task 12 (Pikachu crawls) left all eight traces byte-identical (no golden
  // CPU crawls) and added the crawl lab: one hit (the down tilt out of the crawl,
  // 7.56%), no shield hits, no KO. So now: hits 32/20/18/21, 6, 0, 1, 4 and 1;
  // shield hits 0/0/0/0, 3, 0, 0, 0 and 0; KOs 1/2/1/0, 1, 2, 0, 0 and 0.
  // Plan 5 Task 13 (moves with momentum, a projectile, armour or a smash charge run
  // their scripts; a script's ATTACK_SETOFF_KIND_OFF box cannot clank; Kirby's Stone
  // lands as a stone; the CPU's up special model keeps a script's legacy momentum)
  // moved five, each where a freed move first comes out: mario-fox from the
  // 1801-1900 sample (Fox's forward smash on 1810, a limb script now), link-samus
  // from 201-300 (Link's Spin Attack on 163: its blade boxes from frame 4, not 7,
  // and its end at 74, not 77), kirby-marth from 2401-2500 (Marth's up smash on
  // 2409), the script from 1501-1600 (Mario's Fireball, from its script, hits Fox on
  // 1576, not 1577) and the Inhale lab from 201-300 (the copied Fireballs, a frame
  // earlier too: 286 and 340). The other four are byte-identical. No pin trips and no
  // step is re-tuned. Hits 32, 26 and 21 in the three CPU matches; shield hits 0, 0
  // and 1; KOs 1, 1 and 0, Samus's in link-samus by a hit, tumbling at 144% on 2978.
  // The script and the Inhale lab keep their 6 and 4 hits and their KOs. So now: hits
  // 32/20/26/21, 6, 0, 1, 4 and 1; shield hits 0/0/0/1, 3, 0, 0, 0 and 0; KOs
  // 1/2/1/0, 1, 2, 0, 0 and 0.
  // Plan 5 Task 12's fix round 2 (ruling R-T12d: no ground status survives leaving
  // the ground; `GROUND_EXIT`) moved only mario-fox, from the 1601-1700 sample: Mario
  // dashes into a shield on 1665 and slides, and the shield now stops at the stage's
  // edge (79.99, on 1685; SmashWiki "Shield": Ultimate's shields are not edge-slipped)
  // where it slid off before. With the shield rows alone set back, all nine traces
  // replay, so the rest of the class (the falls and the lags) moves no golden match.
  // Hits 38, shield hits 5, KOs 1 there (were 32, 0 and 1). So now: hits
  // 38/20/26/21, 6, 0, 1, 4 and 1; shield hits 5/0/0/1, 3, 0, 0, 0 and 0; KOs
  // 1/2/1/0, 1, 2, 0, 0 and 0.
  // Plan 5 Task 13's fix round 1 (rulings R-T13d to R-T13h: a motion rate set before
  // a script's first frame() runs from frame 1, so Mario's Fireball launches on 17;
  // a smash holds the frame before its START_SMASH_HOLD; Link's Spin Attack runs its
  // published 7-39 and 77; THRU tramples; Kirby's Stone has its landing hit) moved
  // four. Three return to their traces from before Task 13, byte for byte: the
  // script from the 1501-1600 sample and the Inhale lab from 201-300 (the Fireball
  // and the copied ones on 1577, 287 and 341 again), and link-samus from 201-300
  // (the Spin Attack on 163 on its published frames, as its legacy table had them).
  // kirby-marth moves from 1801-1900: Marth's forward smash on 1868 holds a frame
  // earlier. Hits 18 and 19, shield hits 0 and 1, KOs 1 and 1 there (Samus by a hit
  // at 104% on 2967, as before Task 13; Marth by a hit, tumbling at 110.3% on 2729).
  // mario-fox, donkeyKong-pikachu and the three other labs are byte-identical. No pin
  // trips and no step is re-tuned. So now: hits 38/20/18/19, 6, 0, 1, 4 and 1; shield
  // hits 5/0/0/1, 3, 0, 0, 0 and 0; KOs 1/2/1/1, 1, 2, 0, 0 and 0.
  // Plan 5 Task 12's fix round 3 (rulings R-T12e to R-T12g: the rolls and the spot
  // dodge stop at the edge, SmashWiki "Roll" and "Tech"; so does a waveland, SmashWiki
  // "Wavedash"; and a grounded attack against its own movement, SmashWiki "Dash
  // attack", a push carrying it off into a fall) moved three CPU matches:
  // mario-fox from the 201-300 sample (Fox's roll stops at the stage's left edge on
  // 263, where it rolled off onto the ledge before), donkeyKong-pikachu from 2301-2400
  // (Donkey Kong's dash attack stops at the left edge on 2394) and kirby-marth from
  // 3301-3400 (Marth's roll stops at the right edge on 3383). Setting each ruling
  // back alone: the rolls alone move kirby-marth, the attack stop alone moves
  // donkeyKong-pikachu, each of the two moves mario-fox, and the spot dodge and the
  // waveland move nothing here. Hits 34, 22 and 20; shield hits 2, 1 and 0; KOs 1, 2
  // and 1 there. link-samus, the script and the four labs are byte-identical. So now:
  // hits 34/22/18/20, 6, 0, 1, 4 and 1; shield hits 2/1/0/0, 3, 0, 0, 0 and 0; KOs
  // 1/2/1/1, 1, 2, 0, 0 and 0.
  // Plan 5 Task 13c (projectiles bounce, settle, lodge, turn and home as their pages
  // publish and stop at undersides; each clanks by its script's Clang_Rebound, a
  // clank weighs each side after its multipliers, and fifteen legacy moves' boxes
  // take their scripts' clang) left all nine traces byte-identical: the few
  // projectiles the CPU matches throw meet nothing those rules changed, and no clank
  // in them changes its outcome. It added the projectile lab (ruling R-T8e; the Task
  // 6 carry): Samus's bomb settles and goes off on its timer, a Charge Shot and an
  // arrow clank, and a Charge Shot flies out its life (`PROJECTILE_PATHS`), with no
  // hit, shield hit or KO. So now: hits 34/22/18/20, 6, 0, 1, 4, 1 and 0; shield hits
  // 2/1/0/0, 3, 0, 0, 0, 0 and 0; KOs 1/2/1/1, 1, 2, 0, 0, 0 and 0.
  // Plan 5 Task 13's fix round 2 (ruling R-T13i: every legacy smash holds on its
  // published "Charges between"; R-T13j: Kirby's Stone on its published timeline,
  // its stone, its armour and its hold; R-T13k: a Stone landing early plays on to 11)
  // moved only kirby-marth, from the 2401-2500 sample: Kirby's up smash on 2421 holds
  // on 8, not 11. Hits 18, shield hits 0 and KOs 0 there (were 20, 0 and 1: Marth's
  // KO by a hit on 2729 no longer comes). No golden match uses the Stone. The other
  // nine are byte-identical. So now: hits 34/22/18/18, 6, 0, 1, 4, 1 and 0; shield
  // hits 2/1/0/0, 3, 0, 0, 0, 0 and 0; KOs 1/2/1/0, 1, 2, 0, 0, 0 and 0.
  // Plan 5 Task 13c's fix round 1 (R-T13c-a: a clank freezes both sides and rebounds
  // the loser; R-T13c-b: aerials clank only with projectiles; R-T13c-c to e: the
  // boomerang skims floors, the arrow and the Fireball fly as published) moved three
  // traces, all by the new flights, none by a clank: the script from the 1501-1600
  // sample (Mario's Fireball, out on 1570 at 1.4 and -10 degrees, now hits Fox on
  // 1582, not 1577), the Inhale lab from 301-400 (Kirby's copied Fireball hits Mario
  // on 342, not 341), and the projectile lab from its first sample (the arrow's
  // flight; the shot and the arrow still clank on 75). The projectile lab appends
  // frames 201-300 (ruling R-T13c-f): Link jabs into a Charge Shot, they clank and he
  // rebounds; no hit. The four CPU matches and the other labs are byte-identical, and
  // every count is as it was: hits 34/22/18/18, 6, 0, 1, 4, 1 and 0; shield hits
  // 2/1/0/0, 3, 0, 0, 0, 0 and 0; KOs 1/2/1/0, 1, 2, 0, 0, 0 and 0.
  // Plan 5 Task 13's fix round 3 (ruling R-T13l: a smash, once let go, never charges
  // again; R-T13m: a Stone's stone ends cleanly) moved only kirby-marth, from the
  // 2401-2500 sample: Marth's up smash on 2409, let go on 2411 and pressed again on
  // 2418, no longer rewinds to its hold frame to charge; it plays on and meets Kirby's
  // shield on 2421. Hits 30, shield hits 1 and KOs 0 there (were 18, 0 and 0). No
  // golden match uses the Stone. The other nine are byte-identical. So now: hits
  // 34/22/18/30, 6, 0, 1, 4, 1 and 0; shield hits 2/1/0/1, 3, 0, 0, 0, 0 and 0; KOs
  // 1/2/1/0, 1, 2, 0, 0, 0 and 0.
  // Plan 5 Task 13c's fix round 2 (ruling R-T13c-g: a clank is resolved once per
  // meeting, by each side's strongest box) left all ten traces byte-identical: the
  // only golden meeting of several boxes is the projectile lab's on frame 240, where
  // every pair already weighed the shot as the stronger. It is one clank event now,
  // not three; the counts above stand.
  // Plan 5 Task 13b (the up specials aim, turn, travel and last as their pages
  // publish and land into their own landing lag; a falling fighter holding down
  // drops through a soft platform; the CPU runs its up special's own path, aims it
  // and wall jumps first) moved the four CPU matches: mario-fox from the 201-300
  // sample, donkeyKong-pikachu from 701-800, link-samus from 101-200 and kirby-marth
  // from 501-600. Hits 34, 32, 22 and 19; shield hits 1, 6, 0 and 0; KOs 1, 0, 1 and
  // 1 (were 34/22/18/30, 2/1/0/1 and 1/2/1/0): Mario during a Cape, as before; Link
  // and Marth in special fall. The script and the five labs are byte-identical. So
  // now: hits 34/32/22/19, 6, 0, 1, 4, 1 and 0; shield hits 1/6/0/0, 3, 0, 0, 0, 0
  // and 0; KOs 1/0/1/1, 1, 2, 0, 0, 0 and 0.
  // Plan 5 Task 13d (a side special pressed within its move's published window of a
  // smash flick is its smash version: Samus's Super Missile, Link's smash-thrown
  // Boomerang; Samus's missiles out at a time; the Super Missile's landing lag) left
  // the nine other traces byte-identical, and the projectile lab's first 300 frames:
  // no golden CPU presses a side special fresh (the CPUs' side specials come out of
  // the buffer, never a smash), and no golden match had more missiles out than the
  // limits allow. The projectile lab appends frames 301-600 (ruling R-T11a): the
  // Super Missile hits Link on 368 and the smash-thrown Boomerang hits Samus on 473
  // (`expectSmashSpecials`). So now: hits 34/32/22/19, 6, 0, 1, 4, 1 and 2; shield
  // hits 1/6/0/0, 3, 0, 0, 0, 0 and 0; KOs 1/0/1/1, 1, 2, 0, 0, 0 and 0.
  // (Plan 4 Task 12's, before the limb-bone scripts: hits 15/32/13/17, shield hits
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

  // The projectile lab is there to reach these (Task 13c): a re-tuned step that
  // stops one shows here, not just in its digest.
  function expectProjectilePaths(): void {
    const paths = new Set(all.flatMap((p) => [...p.projectilePaths.keys()]));
    expect(PROJECTILE_PATHS.filter((p) => !paths.has(p)), "projectile ends no match reaches").toEqual([]);
    const lab = played.get(PROJECTILE_LAB.name)!;
    expect(PROJECTILE_PATHS.filter((p) => !lab.projectilePaths.has(p)), "projectile ends the projectile lab no longer reaches").toEqual([]);
    // By count, per projectile: three clank (the shot and the arrow, and the third
    // shot on Link's jab), two expire (the bomb and the second shot), one bomb
    // settles and goes off. That a clank ends only the projectile at its point, not
    // any gone that frame, `projectilePaths.test.ts` shows on crafted steps.
    expect(Object.fromEntries(lab.projectilePaths), "the projectile lab's projectiles, by what they came to").toEqual({ expired: 2, settled: 1, exploded: 1, clanked: 3 });
  }

  // Plan 5, Task 13d: the projectile lab smash-inputs both side specials, and each
  // lands its hit there (`goldenProjectileLab.ts`); no other golden match does.
  function expectSmashSpecials(): void {
    const lab = played.get(PROJECTILE_LAB.name)!;
    expect(["superMissile", "boomerangSmash"].filter((id) => !lab.launched.has(id)), "smash-input specials the projectile lab no longer launches").toEqual([]);
    expect(lab.hits, "the Super Missile on Link and the smash-thrown Boomerang on Samus").toBe(2);
  }

  function expectInvariants(): void {
    for (const m of MATCHES) expect(played.get(m.name)!.invariantBreaks, m.name).toEqual([]);
  }

  // All run when regenerating too, so a degenerate trace cannot be recorded.
  it("exercises combat, not an idle screen", expectCombat);
  it("visits every action state and every soft-stick path", expectCoverage);
  it("lands every kind of hit the scripted match lands", expectScriptHits);
  it("lets a projectile expire, settle, explode and clank", expectProjectilePaths);
  it("smash-inputs both side specials in the projectile lab", expectSmashSpecials);
  it("keeps vx/vy the energies' sum, every fighter number an integer, and every fighter out of the stage, on every frame", expectInvariants);

  if (process.env.UPDATE_GOLDEN === "1") {
    it("writes the golden trace", () => {
      // A failed test above does not stop this one, so it checks again first.
      expectCombat();
      expectCoverage();
      expectScriptHits();
      expectProjectilePaths();
      expectSmashSpecials();
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
