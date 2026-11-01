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
import { FINAL_LAB } from "./goldenFinalLab";
import { BEAM_LAB } from "./goldenBeamLab";
import { DASH_LAB } from "./goldenDashLab";
import { PROJECTILE_PATHS, projectilePathsOf, type ProjectilePath } from "./projectilePaths";

/**
 * The strangler's safety net (Plan 2, Tasks 0 and 0b).
 *
 * Fourteen matches on the real roster and real stages: four CPU-vs-CPU stock
 * matches (levels 9 and 7) for 3,600 frames each, a fifth with the Smash Ball on
 * (Plan 5 final wave, ruling R-FW1e: the CPU's Smash Ball and Final Smash decisions,
 * last in `MATCHES`), one scripted timed match
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
 * its fix round 1, 600 after Task 13d, 800 after Task 13d's fix round 1): Samus's bomb
 * settles and goes off on its timer, her Charge Shot and Link's arrow clank, a Charge
 * Shot flies out its life, one clanks with Link's jab and he rebounds, the smash-input
 * specials, Samus's Super Missile and Link's smash-thrown Boomerang, each land their
 * hit, and Link throws with his Boomerang out, which fails; a 400-frame Final
 * Smash lab (`goldenFinalLab.ts`, Task 15, ruling P5-R14): Donkey Kong, given the
 * Smash Ball's power in its setup, traps Mario in Jungle Rush, plays its scene and
 * launches him; and a 950-frame beams lab (`goldenBeamLab.ts`, Task 16), four on
 * Battlefield: Samus's Zero Laser charges, then strikes Donkey Kong again at each of
 * its boxes' rehits, its fringe beams beside its beam, Mario Finale's flames, used in
 * the air, which holds him there, strike Samus again at theirs, and the Ancient Arrow,
 * in the air too, flies and strikes Mario; and a 300-frame dash lab (`goldenDashLab.ts`,
 * Task 16 fix round 4): Pikachu whiffs Volt Tackle in the air, held through its
 * startup, then tackles, carries on and falls off the side blast line, and Fox whiffs
 * Team Star Fox in the air, held through its start.
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
/** The Smash Ball on (Plan 5 final wave, ruling R-FW1e): the CPU's `smashBall` and `finalSmash` decisions. */
const BALL_RULES: MatchRules = { ...CPU_RULES, smashBall: true };

function cpuMatch(name: string, stage: string, fighters: readonly [string, string], seed: number, rules: MatchRules = CPU_RULES): Match {
  return {
    name,
    stage,
    fighters,
    seed,
    rules,
    frames: 3600,
    cpu: true,
    driver() {
      const view = stageViewFromDef(CTX.stage(stage));
      const defs = fighters.map((id) => CTX.fighter(id));
      // Plan 5, Task 19: the match's own fighter lookup, so a Kirby CPU's copy is the one it runs;
      // Task 18 fix round 2: the bake it steps with, so a parry's swing must reach the body the engine hits.
      const worlds: CpuWorld[] = defs.map((def) => cpuWorldFromDef(def, view, defs, (id) => CTX.fighter(id), CTX.bake));
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
  {
    ...FINAL_LAB,
    cpu: false,
    driver() {
      return (_state, frame) => FINAL_LAB.inputs(frame);
    },
  },
  {
    ...BEAM_LAB,
    cpu: false,
    driver() {
      return (_state, frame) => BEAM_LAB.inputs(frame);
    },
  },
  {
    ...DASH_LAB,
    cpu: false,
    driver() {
      return (_state, frame) => DASH_LAB.inputs(frame);
    },
  },
  // Plan 5 final wave (ruling R-FW1e; the final review's M5): the one CPU match with the
  // Smash Ball on, so the CPU's own Smash Ball and Final Smash decisions are in the trace.
  // Both CPUs break a ball and land their Final Smash: Samus (level 9) fires Zero Laser
  // along Town & City's floor, and Kirby (level 7) traps Samus in Ultra Sword.
  cpuMatch("samus-kirby-townAndCity-ball", "townAndCity", ["samus", "kirby"], 606, BALL_RULES),
];

/**
 * Every `ActionState` the fourteen matches must visit between them: all 59. A `Record`
 * rather than a list, so a new state is a compile error here until somebody pins it. Measured 2026-10-27, again after the Plan 2 final fix wave: the CPU
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
 * Plan 5 Task 13b's fix round 1 (the CPU's up special press holds Up from the frame
 * it decides on; drop-through by status) adds no action. The four CPU matches reach
 * 35 between them, down from 42: none pummels, throws, is grabbed or thrown,
 * rebounds or is shield-stunned any more, which the script and the labs reach. All
 * 58 are visited.
 * Plan 5 Task 14 added `finalTrapped`, a fighter caught in a cinematic Final Smash.
 * No fighter had a Final Smash until Task 15, so no golden match could trap anybody:
 * it was the one action exempted, by name (ruling P5-R14). Task 15 gave five
 * fighters theirs and staged one in an eleventh match, the Final Smash lab
 * (`goldenFinalLab.ts`), which traps Mario, and dropped the exemption. All 59 are
 * visited.
 * Plan 5 Task 18 (the CPU techs its landings, air-dodges out of hitstun and parries)
 * adds no action. The four CPU matches reach 36 between them, up from 35: all four
 * tech-roll and two tech in place, kirby-marth grabs and is shield-stunned, and
 * mario-fox and link-samus rebound; none lies down (`downed`, `getUp`), ledge-rolls
 * or spot-dodges any more. The states and projectile labs lie down and get up, and
 * the script ledge-rolls and spot-dodges. All 59 are visited.
 * Its fix round 1 (a tech is one roll a landing, an escape one a cancel, a parry
 * one a swing, timed off its move data) adds no action. The four CPU matches reach
 * 40 between them, up from 36: all four lie a fighter down and get it up again
 * (a failed roll is a missed tech), and kirby-marth grabs, pummels and is grabbed;
 * none is shield-stunned, ledge-rolls or spot-dodges, which the script does. All
 * 59 are visited.
 * Plan 5 Task 19 (the CPU uses its specials: Final Smash, Smash Ball, reflect,
 * counter, stored charges, smash-input specials, a carry, a mouthful, a throw, a
 * mash, a sideways recovery) adds no action. The four CPU matches reach 44 between
 * them, up from 40: kirby-marth inhales (`inhaleHold`, `swallowed`, `spatStar`),
 * ledge-attacks and trumps a ledge, link-samus ledge-rolls, mario-fox spot-dodges,
 * and three are shield-stunned; none grabs, is grabbed or pummels any more (the
 * golden's grab was kirby-marth's), which the script and the states lab reach.
 * No golden CPU match has the Smash Ball on, so no Final Smash there; the Final
 * Smash and beams labs play them. All 59 are visited.
 * Its second part (the CPU's quality: a shield one decision a threat, held through
 * the swing; loops broken; back to the middle while the opponent respawns; the
 * recovery strategy; a wall tech) adds no action. The four CPU matches reach 48
 * between them, up from 44: kirby-marth grabs, pummels and throws and is grabbed
 * and thrown again (a shield held through a swing is grabbed); none gets up from
 * lying down or trumps a ledge any more, which the states lab and the script do.
 * All 59 are visited.
 * Task 18's fix round 2 (one tech roll a tumble for the floor; the tech holds the
 * stick before a landing; the parry's reach the engine's hit test) adds no action.
 * The four CPU matches reach 44 between them, down from 48: they get up from lying
 * down again (a missed tech's bounce is no longer rolled again), and none crouches,
 * ledge-jumps, ledge-rolls or is shield-stunned any more, which the script and the
 * labs reach. All 59 are visited.
 * Task 19's fix round 1 (one decision a threat for a counter, a reflector and the
 * shield, the shield's for a threat first seen in a reel, a landing's lag or a
 * get-up on that action's last frame; the opponent's intangibility seen with its
 * action; one side-recovery roll an episode) adds no action. The four CPU matches
 * reach 44 between them, as before: link-samus ledge-jumps, and none ledge-attacks
 * any more, which the script does. All 59 are visited.
 * Task 18's fix round 3 (the parry places a swing where its own momentum carries it;
 * a floor met too fast to tech spends no roll; before its hold, `tech` keeps Down out
 * of the frame and holds nothing; a ceiling stop is no floor met) adds no action. The
 * four CPU matches reach 47 between them, up from 44: kirby-marth crouches again, and two
 * are shield-stunned again; none loses an action the four reached. All 59 are visited.
 * Task 19's fix round 2 (the counter before the shield; the shield's press comes out as
 * the press it judged; its decision on a ledge get-up's last frame, a fixed chain's and
 * once at the hand-off; its hold through the shieldstun; the opponent's intangibility
 * hidden only where it began in the frames the view hasn't caught up with) adds no
 * action. The four CPU matches reach 46 between them, down from 47: kirby-marth
 * ledge-rolls, and none gets up from lying down or is shield-stunned any more, which the
 * states lab and the script reach. All 59 are visited.
 * Plan 5's final wave, part 1 (the CPU turns and swings at point blank without dashing
 * past the target, and throws no ground swing that would not land, rulings R-FW1a and
 * R-FW1b; a threat frozen at its first sight decided once, R-FW1h; a recovery line
 * through the stage's wall no way back, R-FW1f; an up special's press never on a tap
 * jump's step, R-FW1g) adds no action. The four CPU matches reach 46 between them, as
 * before: they get up from lying down and are shield-stunned again, and none ledge-rolls
 * or rebounds any more, which the script and the projectile lab reach. The ball-on CPU
 * match (R-FW1e) reaches nothing the four do not. All 59 are visited.
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
  finalTrapped: true,
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
 * - the frame, the RNG seed, the global freeze, the timer, the outcome, and the
 *   stage's clock that moving platforms run on (`stageFrame`, Plan 5 Task 14 fix
 *   round 1, ruling R-T14f: the 3D stage places them by it);
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
  x = mixInt(x, s.stageFrame);
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
 * on every frame of all thirteen matches.
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
  /** Every move a fighter was in, as `"<fighter> <slot>"` (Plan 5, Task 13d fix round 1). */
  readonly moves: ReadonlySet<string>;
  /** The first few frames that broke `invariantBreaks`, if any did. */
  readonly invariantBreaks: readonly string[];
  /** Smash Balls broken, and Final Smashes started (Plan 5 final wave, ruling R-FW1e). */
  readonly ballsBroken: number;
  readonly finalSmashes: number;
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
  const moves = new Set<string>();
  /** The paths each projectile (by `instanceId`) reached. */
  const reached = new Map<number, Set<ProjectilePath>>();
  const breaks: string[] = [];
  let hits = 0;
  let shieldHits = 0;
  let kos = 0;
  let ballsBroken = 0;
  let finalSmashes = 0;
  for (let frame = 1; frame <= match.frames; frame++) {
    const inputs = inputsFor(state, frame);
    const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
    for (let port = 0; port < out.state.fighters.length; port++) {
      const after = out.state.fighters[port];
      actions.add(after.action);
      if (after.move !== null) moves.add(`${after.defId} ${after.move}`);
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
    if (out.events.smashBallBroken !== null) ballsBroken++;
    finalSmashes += out.events.finalSmashes.length;
    roll = mixInt(roll, digest(state));
    if (frame % EVERY === 0) digests.push(roll >>> 0);
  }
  const projectilePaths = new Map<ProjectilePath, number>();
  for (const set of reached.values()) for (const path of set) projectilePaths.set(path, (projectilePaths.get(path) ?? 0) + 1);
  return { digests, hits, shieldHits, kos, actions, soft, hitKinds, projectilePaths, launched, moves, invariantBreaks: breaks, ballsBroken, finalSmashes };
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
  // Plan 5 Task 13b's fix round 1 (the CPU's up special press holds Up and never
  // Down from the frame it decides on until the special comes out, a buffered press
  // included, ruling R-T13b-c; a soft platform dropped through only in a fall, a
  // jump, special fall, a tumble's fall out of hitstun or a Fire Fox aimed down,
  // R-T13b-d; a B-reverse turns the speed round with the fighter, once, R-T13b-e;
  // the aerial up special stales as the up special, R-T13b-f) moved the four CPU
  // matches, each on the first frame a CPU that had decided on its up special held
  // Up where it used to drift: mario-fox on 262 (the 201-300 sample),
  // donkeyKong-pikachu on 1190 (1101-1200), link-samus on 1341 (1301-1400) and
  // kirby-marth on 802 (801-900). Hits 18, 32, 25 and 26; shield hits 0, 6, 0 and 0;
  // KOs 2, 0, 0 and 1 (were 34/32/22/19, 1/6/0/0 and 1/0/1/1): Mario twice in
  // special fall, his up special each time buffered through a forward air that
  // carried him under Battlefield's stage (frames 368 and 1671; the first came out a
  // Cape before), and Marth by a hit, tumbling at 105%. The script and the five labs
  // are byte-identical (the projectile lab's 600 frames untouched, ruling R-T11a). So
  // now: hits 18/32/25/26, 6, 0, 1, 4, 1 and 2; shield hits 0/6/0/0, 3, 0, 0, 0, 0
  // and 0; KOs 2/0/0/1, 1, 2, 0, 0, 0 and 0.
  // Plan 5 Task 13d's fix round 1 (one Boomerang out at a time, a throw with one out
  // being the failed throw, ruling R-T13d-d; a reflected Super Missile neither waits
  // again nor is clamped to 4.2, R-T13d-e; Fox Illusion's published landing lag of 16,
  // in `aerialLandingLag`) left the nine other traces byte-identical, and the
  // projectile lab's first 600 frames: no golden match has two Boomerangs out,
  // reflects a Super Missile or lands an aerial Fox Illusion. The projectile lab
  // appends frames 601-800 (ruling R-T11a): Link throws the Boomerang on 601 and, with
  // it out, throws again on 651, which fails (`expectSmashSpecials`); no hit. Every
  // count is as it was.
  // Plan 5 Task 13b's fix round 2 (a tumble's fall lands on a soft platform, ruling
  // R-T13b-g) left every trace byte-identical: no golden fighter comes down onto a
  // soft platform in a tumble's fall with Down held. Every count is as it was.
  // Plan 5 Task 15 (five cinematic Final Smashes; the far-end compile, ruling
  // P5-R19; the scene through the end's launch) left the ten traces byte-identical:
  // no golden match breaks a Smash Ball (the scripted match has it on, the others
  // off), and no move they run gained a far end. It added the Final Smash lab (`goldenFinalLab.ts`, ruling P5-R14), which
  // stages Jungle Rush to reach `finalTrapped`: 33 hits (the trap, 31 punches, the
  // uppercut), no shield hit, no KO. So now: hits 18/32/25/26, 6, 0, 1, 4, 1, 2 and
  // 33; shield hits 0/6/0/0, 3, 0, 0, 0, 0, 0 and 0; KOs 2/0/0/1, 1, 2, 0, 0, 0, 0
  // and 0.
  // Plan 5 Task 14's fix round 1 adds the stage's clock (`stageFrame`, ruling R-T14f),
  // which stops for a Final Smash's scene and a KO's freeze, to `digest`, so every
  // trace's digests move from the first sample. With the field left out of `digest`,
  // ten traces stay byte-identical (a KO's freeze stopping Smashville's platform moves
  // no golden fighter) and the Final Smash lab alone moves, from its 1-100 sample: its
  // user is intangible from the step the power is spent (ruling R-T14i), one step
  // sooner. Every count is as it was.
  // Plan 5 Task 15's fix round 1 (Ultra Sword's ten blows, Volt Tackle's startup and
  // trap, Critical Hit's edge stop, ruling R-T15e to R-T15h; a start's ordinary hit,
  // R-T15j) left ten traces byte-identical: no other golden match uses a Final Smash.
  // The Final Smash lab moves from its 301-400 sample alone: Jungle Rush's end is 61
  // frames (its FT_MOTION_RATE 0.8 from 30, ruling R-T15i), so Donkey Kong stands on
  // 304, not 312. Every count is as it was.
  // Plan 5 Task 16 (a box with a rehit strikes a fighter again that many frames after
  // it struck them, a script's own `Rehit` and a legacy move's alike; the three Final
  // Smashes that trap nobody) moved one trace and added one. kirby-marth moves from the
  // 701-800 sample: Marth's up smash on 711, a limb script, lands its launcher (3.78%)
  // and now, its `Rehit=2` run out, its sword on 713 (16.38%; SmashWiki "Marth (SSBU)":
  // "The weak grounded hit can knock nearby opponents into the main attack"), and again
  // on 1001 and 1003. Hits 26, shield hits 0 and KOs 1 there, as before, Marth's KO
  // coming on 2668, not 1886. Setting the scripts' rehit back alone, every trace
  // replays. The ten other traces are byte-identical. It added the beams lab
  // (`goldenBeamLab.ts`): 21 hits (Zero Laser's fifteen on Donkey Kong, Mario Finale's
  // five on Samus, the Ancient Arrow on Mario), no shield hit, one KO (Samus, off the
  // stage). So now: hits 18/32/25/26, 6, 0, 1, 4, 1, 2, 33 and 21; shield hits
  // 0/6/0/0, 3, 0, 0, 0, 0, 0, 0 and 0; KOs 2/0/0/1, 1, 2, 0, 0, 0, 0, 0 and 1.
  // Plan 5 Task 16's fix round 1 (a Final Smash is out while its projectiles are,
  // ruling R-T16a; an aerial one that traps nobody holds its user, and every Final
  // Smash ending in the air gives back the midair jumps, R-T16b; Zero Laser's start,
  // per-box rehits, scripted record clears and fringe beams, R-T16c to R-T16e; the
  // arrow hits fighters only and freezes nobody, R-T16g and R-T16h; a clank re-arms a
  // rehit box, R-T16i) moved the beams lab alone, re-timed (its steps are this task's
  // own, ruling R-T13c-f): Zero Laser is 263 frames, its fringe beams reach the lower
  // platforms where Link and Mario stood, and its last hit came on 407, not 213. So
  // Link and Mario start on the top platform, and both use theirs in the air, which
  // the lab had not visited. 950 frames, from its first sample: 51 hits (Zero Laser's
  // 48 on Donkey Kong: its charge 3, its muzzle 1, its beam 13, its fringe beams 28,
  // its end and blasts 3; Mario Finale's two on Samus; the Ancient Arrow on Mario), no
  // shield hit, two KOs (Donkey Kong, launched by the laser's end, and Samus, off the
  // stage). The eleven other traces are byte-identical: no other golden match uses a
  // Final Smash or a box with a per-box rehit, a part or a scripted clear, and no
  // golden clank meets a rehit box. So now: hits 18/32/25/26, 6, 0, 1, 4, 1, 2, 33 and
  // 51; shield hits 0/6/0/0, 3, 0, 0, 0, 0, 0, 0 and 0; KOs 2/0/0/1, 1, 2, 0, 0, 0, 0,
  // 0 and 2.
  // Plan 5 Task 16's fix round 4 (an aerial Final Smash holds its user only before its
  // part's first travel window, and from it on a dash keeps its ordinary kinetics, ruling
  // R-T16l amended; the travel read from what the engine applies, R-T16n) moved no trace
  // by itself: no golden match used a Final Smash dash or a cinematic one in the air. It
  // added the dash lab (`goldenDashLab.ts`): Pikachu, held through Volt Tackle's startup
  // at (-150, 30), tackles on 47-83 and carries on, falling, off the side blast line on
  // 136, and Fox, held through Team Star Fox's start at 50.45 up on 178-261, falls with
  // his midair jump back and lands on 290. No hit, one KO. Zero Laser's beam on its
  // muzzle's axis, 15 up, its fringe beams at 29 and 1 and its blasts with them (ruling
  // R-T16o), moved the beams lab alone, from its 101-200 sample (its steps are this
  // task's own, ruling R-T13c-f; none re-timed): the lower fringe beam strikes Donkey
  // Kong 15 times, not 12, so Zero Laser's end lands on 412, not 407, and he is KO'd on
  // 593, not 587; everything from Mario Finale on is as it was. 54 hits there. The
  // eleven other traces are byte-identical. So now: hits 18/32/25/26, 6, 0, 1, 4, 1, 2,
  // 33, 54 and 0; shield hits 0/6/0/0, 3, 0, 0, 0, 0, 0, 0, 0 and 0; KOs 2/0/0/1, 1, 2,
  // 0, 0, 0, 0, 0, 2 and 1.
  // Plan 5 Task 18 (the CPU techs a tumble's landing, in its hitstun or after it,
  // onto the stage or a soft platform; air-dodges out of hitstun once the cancel
  // opens, where the dodge stays over the stage, rulings P5-R20 and P5-R21; parries
  // by letting go of its shield as it sees a swing start; holds jump in a wall tech
  // below the ledge) moved the four CPU matches from their first sample. Each CPU
  // decision draws five more rolls (the tech and parry rolls, and a jitter for each
  // of the three new behaviours), so a roll lands elsewhere and the level-7 CPU's
  // keys first differ on frame 10 in mario-fox, 13 in donkeyKong-pikachu, 12 in
  // link-samus and 4 in kirby-marth; then the defence takes over. The four lay a
  // fighter down 17 times between them before; now none does, and they tech 19
  // times (mario-fox 5, donkeyKong-pikachu 8, link-samus 3, kirby-marth 3). Hits 25,
  // 18, 25 and 16; shield hits 0, 0, 0 and 2; KOs 0, 1, 0 and 1 (were 18/32/25/26,
  // 0/6/0/0 and 2/0/0/1): Donkey Kong in special fall on 2550, a self-destruct, and
  // Marth by a hit, tumbling at 112.2% on 2509. donkeyKong-pikachu's six shield hits
  // before were all parries, each on a shield `shield` had just let go of;
  // kirby-marth's two now are a shield hit and Marth's parry on 3523. The script and the eight labs
  // are byte-identical: no CPU plays in them. So now: hits 25/18/25/16, 6, 0, 1, 4,
  // 1, 2, 33, 54 and 0; shield hits 0/0/0/2, 3, 0, 0, 0, 0, 0, 0, 0 and 0; KOs
  // 0/1/0/1, 1, 2, 0, 0, 0, 0, 0, 2 and 1.
  // Its fix round 1 (rulings R-T18d to R-T18f: a tech decided once a landing, on the
  // first frame its fall, run by the engine's rules, has the floor within nine frames
  // and a press that would tech it, so a failed roll is a missed tech; an escape
  // once, as the cancel opens; a parry once a swing, timed off the swing's move
  // data, from a droppable shield; the cancel read at hitstun 2, not 1) moved the
  // four CPU matches, each where a CPU's tech decision
  // first falls on another frame: kirby-marth on 139 (the 101-200 sample),
  // link-samus on 308 (301-400), mario-fox on 631 and donkeyKong-pikachu on 673
  // (601-700). The roll layout is unchanged, so nothing moves before that. They lay a
  // fighter down 6 times between them (0 before) and tech 10 times (19). Hits 40,
  // 24, 19 and 30; shield hits 1, 1, 0 and 0; KOs 1, 2, 0 and 1 (were 25/18/25/16,
  // 0/0/0/2 and 0/1/0/1): Fox in special fall on 2954 and Donkey Kong on 1390,
  // self-destructs; Pikachu by a hit, tumbling at 153% on 3133; Marth by a hit,
  // tumbling at 159.5% on 3496. The two shield hits are both parries by a shield
  // `shield` let go of; no golden CPU decides a parry. The script and the eight labs
  // are byte-identical. So now: hits 40/24/19/30, 6, 0, 1, 4, 1, 2, 33, 54 and 0;
  // shield hits 1/1/0/0, 3, 0, 0, 0, 0, 0, 0, 0 and 0; KOs 1/2/0/1, 1, 2, 0, 0, 0, 0,
  // 0, 2 and 1.
  // Plan 5 Task 19 (the CPU uses Plan 5's specials, `ai/specials.ts`: a Final Smash and
  // the Smash Ball, a reflector, a counter, stored and held charges and held smashes,
  // the smash-input specials, a carry, Kirby's Inhale, a grab's throw and a mash, and a
  // sideways recovery; each decision draws a ninth roll, `ROLL_SPECIAL`, and nine more
  // jitters, one per new behaviour; and the Smash Ball keeps over the stage, between
  // `SMASH_BALL_FLOOR` and `SMASH_BALL_CEILING` above it) moved five traces. The four CPU
  // matches move from their first sample: the roll layout changed (thirty draws a
  // frame, from twenty), and on frames 3 and 4 the CPUs open with a special: Mario starts
  // F.L.U.D.D.'s charge and Donkey Kong Giant Punch's, far apart, and Link and Samus each
  // flick a smash-input special (the smash-thrown Boomerang, the Super Missile) from a
  // standstill. Kirby inhales seven times, spitting Marth twice and swallowing him once. Hits 24, 35, 24
  // and 26; shield hits 1, 0, 3 and 1; KOs 1, 1, 0 and 1 (were 40/24/19/30, 1/1/0/0 and
  // 1/2/0/1): Fox by a hit, tumbling at 51.3% on 1456; Donkey Kong in his up special on
  // 2968, a self-destruct; Marth by a hit, tumbling at 124.1% on 3155. The script moves
  // from its 901-1000 sample, where its Smash Ball spawns (frame 900): only the ball
  // moves, on every frame from 902, turning back at the stage's ends where it drifted
  // off to |x| 275 and 163 up before; both fighters are byte-identical (a probe compared
  // every frame), and neither touches the ball. The eight labs are byte-identical. So
  // now: hits 24/35/24/26, 6, 0, 1, 4, 1, 2, 33, 54 and 0; shield hits 1/0/3/1, 3, 0, 0,
  // 0, 0, 0, 0, 0 and 0; KOs 1/1/0/1, 1, 2, 0, 0, 0, 0, 0, 2 and 1.
  // Its second part (the CPU's quality: `shield` decides once a threat and holds a
  // shield through the swing, ruling R-T18g; `attack` swings at nothing it cannot hit
  // and grabs a shield it has poked three times running; `centre` walks back to the
  // middle while the opponent respawns; `recover` jumps before an up special that would
  // not get it back, waits for its jump's top, plans no grab of a ledge held in a ledge
  // option and no line into the stage's wall, re-presses after a tap jump and steers its
  // up special through a fumble; no aerial near the edge that would leave no way back,
  // `aerialStrands`; a tech for a tumble into the stage's side; one more jitter roll
  // a frame, `centre`'s) moved the four CPU matches from their first sample, on the
  // frame a CPU first decides otherwise: mario-fox on 2, kirby-marth on 3, donkeyKong-
  // pikachu on 19 and link-samus on 22. Hits 29, 27, 36 and 39; shield hits 0, 0, 2 and
  // 1; KOs 0, 0, 0 and 1 (were 24/35/24/26, 1/0/3/1 and 1/1/0/1): Marth in special
  // fall at 105.1% on 2892. Nobody else is KO'd in 3,600 frames: no golden CPU
  // self-destructs out of an aerial at the edge any more (the Task 13b fix round 1's
  // mario-fox lost two stocks that way). The script and the eight labs are
  // byte-identical. So now: hits 29/27/36/39, 6, 0, 1, 4, 1, 2, 33, 54 and 0; shield
  // hits 0/0/2/1, 3, 0, 0, 0, 0, 0, 0, 0 and 0; KOs 0/0/0/1, 1, 2, 0, 0, 0, 0, 0, 2 and 1.
  // Plan 5 Task 18's fix round 2 (rulings R-T18h to R-T18k: one tech roll a tumble
  // for the floor and one for the stage's side; `tech` holds the stick, decided, from
  // 12 frames out until the landing, so nothing steers a fall off its decision frame,
  // and its fall model runs that stick; the parry's reach is the engine's hit test,
  // the bake's body first, the swing where it is now) moved the four CPU matches, each
  // from the sample where a CPU first holds its stick for a landing where another
  // behaviour had it before: donkeyKong-pikachu on 129 (the 101-200 sample),
  // link-samus on 274 (201-300), mario-fox on 618 (601-700) and kirby-marth on 961
  // (901-1000). They tech 25 times between them (19 before) and lie down 11 times (2):
  // a missed tech's bounce is no longer rolled again. Hits 39, 42, 34 and 29; shield
  // hits 0, 1, 0 and 0; KOs 0, 0, 2 and 1 (were 29/27/36/39, 0/0/2/1 and 0/0/0/1): Link
  // and Samus by hits, tumbling at 127.6% on 2983 and 147.8% on 3436, and Marth in
  // special fall at 122.9% on 3111. Two parries are decided: Donkey Kong's on 740
  // lands on 742; Mario's on 2970, against the back of Fox's forward smash, 4 off,
  // lands nothing: the smash's own momentum carries Fox 3 further off by its first
  // live frame, and the parry places a swing where it is (ruling R-T18j). The
  // script and the eight labs are byte-identical. So now: hits 39/42/34/29, 6, 0, 1,
  // 4, 1, 2, 33, 54 and 0; shield hits 0/1/0/0, 3, 0, 0, 0, 0, 0, 0, 0 and 0; KOs
  // 0/0/2/1, 1, 2, 0, 0, 0, 0, 0, 2 and 1.
  // Plan 5 Task 19's fix round 1 moved the four CPU matches again. Three from the
  // first frame a CPU swings at an opponent whose intangibility or invincibility it
  // has not yet seen (ruling R-T19k: it comes with the action noticed): mario-fox on
  // 48 and donkeyKong-pikachu on 33 (the 1-100 sample), kirby-marth on 171 (101-200);
  // link-samus on 224 (201-300), where Samus, seeing Link's swing as she reels,
  // decides her shield on the reel's last frame (ruling R-T19g). Between them they
  // raise a shield 81 times (31 before) and parry 15 times (1); they tech 15 times (25)
  // and lie down 7 times (11). Hits 40, 43, 29 and 27; shield hits 4, 11, 0 and 0; KOs
  // 0, 0, 1 and 0 (were 39/42/34/29, 0/1/0/0 and 0/0/2/1): Samus, knocked off by Link's
  // dash attack at 54.9%, reaches the ledge on her up special's fall while Link holds
  // it in his get-up, and falls past it on 1948. The script and the eight labs are
  // byte-identical. So now: hits 40/43/29/27, 6, 0, 1, 4, 1, 2, 33, 54 and 0; shield
  // hits 4/11/0/0, 3, 0, 0, 0, 0, 0, 0, 0 and 0; KOs 0/0/1/0, 1, 2, 0, 0, 0, 0, 0, 2
  // and 1.
  // Plan 5 Task 18's fix round 3 (rulings R-T18m and R-T18p to R-T18r: the parry places
  // a swing where its own velocity carries it by its hit frame, swept from that step's
  // start; a floor met faster than a press can tech spends no roll; before its hold,
  // `tech` keeps Down out of the frame where it held a decided neutral, which took the
  // frame from every other behaviour; a ceiling stop is no floor met; a ceiling bounce
  // kept the stop's zero, until fix round 4) moved three CPU matches, each from the
  // first such frame where another behaviour now steers the level-9 CPU: donkeyKong-
  // pikachu on 277 (the 201-300 sample), kirby-marth on 961 (901-1000) and link-samus
  // on 1036 (1001-1100), all three `approach`, drifting toward the opponent. mario-fox
  // has no such frame, and every CPU decision in it is as before: its trace is
  // byte-identical. The four tech 18 times between them (15 before) and lie down 4
  // times (7). Hits 43, 26 and 25; shield hits 15, 0 and 2; KOs 0, 0 and 1 (were
  // 43/29/27, 11/0/0 and 0/1/0): Samus's self-destruct on 1948 is gone, and Marth goes
  // by a hit, tumbling at 129.5% on 3469. No golden CPU decides a parry. The script and
  // the eight labs are byte-identical. So now: hits 40/43/26/25, 6, 0, 1, 4, 1, 2, 33,
  // 54 and 0; shield hits 4/15/0/2, 3, 0, 0, 0, 0, 0, 0, 0 and 0; KOs 0/0/0/1, 1, 2, 0,
  // 0, 0, 0, 0, 2 and 1.
  // Plan 5 Task 19's fix round 2 (ruling R-T19k amended: the view hides only the
  // intangibility that began in the frames it hasn't caught up with, read off the
  // engine's own clocks, and keeps one it has seen across the target's actions) moved
  // all four CPU matches, each from the first swing it changes: donkeyKong-pikachu on 33
  // (the 1-100 sample), where Pikachu no longer swings at Donkey Kong's roll, intangible
  // since the entry drop; kirby-marth on 994 (901-1000), mario-fox on 2756 (2701-2800)
  // and link-samus on 1464 (1401-1500), where the level-7 Marth and Fox and the level-9
  // Link turn to swing at a tech or a roll whose own intangibility began fewer frames ago
  // than their reaction time (shown before, with the action noticed). Between them they
  // raise a shield 77 times (79 before), tech 17 times (18) and lie down once (4).
  // Hits 37, 29, 26 and 18; shield hits 5, 10, 0 and 0; KOs 0, 0,
  // 0 and 1 (were 40/43/26/25, 4/15/0/2 and 0/0/0/1): link-samus's counts are as before;
  // Marth, launched by Kirby's dash attack on 2130, comes back on his up special to the
  // ledge Kirby holds in a ledge roll and falls past it on 2429 at 101.2%, where he went
  // by a hit on 3469 before. No golden CPU counters. The script and the eight labs are
  // byte-identical. So now: hits 37/29/26/18, 6, 0, 1, 4, 1, 2, 33, 54 and 0; shield
  // hits 5/10/0/0, 3, 0, 0, 0, 0, 0, 0, 0 and 0; KOs 0/0/0/1, 1, 2, 0, 0, 0, 0, 0, 2 and 1.
  // Plan 5 Task 18's fix round 4 (ruling R-T18s: a ceiling bounce keeps the gravity from
  // before the collision again, as rubendal does, not the ceiling stop's zero) left every
  // trace byte-identical, so the counts are as above.
  // Plan 5's final wave, part 1 moved the four CPU matches, each from the first decision
  // it changes: mario-fox on 45 (the 1-100 sample, its digest from 101-200), where Mario's
  // approach toward Fox 1.9 above him presses part-way, not the whole stick (ruling R-FW1a:
  // `pressToward`); donkeyKong-pikachu on 70, where Pikachu's forward tilt is pressed
  // part-way, never a smash (R-FW1b); link-samus on 71 and kirby-marth on 70, where Link's
  // and Marth's dash attacks would have slid past their targets before their boxes came
  // out, and they end the run instead (R-FW1b). Hits 44, 47, 30 and 34; shield hits 2, 7,
  // 1 and 2; KOs 0, 0, 0 and 1 (were 37/29/26/18, 5/10/0/0 and 0/0/0/1): Marth by a hit,
  // tumbling at 126.8% on 3279, where he fell past a held ledge on 2429 before. The
  // script and the eight labs are byte-identical. It added the ball-on CPU match
  // (R-FW1e): Samus (level 9) breaks the first Smash Ball on 1278 and lands Zero Laser on
  // 1383; Kirby (level 7) breaks the next on 2446 and traps Samus in Ultra Sword on 2491;
  // Kirby falls on 3546 at 93.3%, a self-destruct out of a jump. 46 hits, no shield hit,
  // one KO. So now: hits 44/47/30/34, 6, 0, 1, 4, 1, 2, 33, 54, 0 and 46; shield hits
  // 2/7/1/2, 3, 0, 0, 0, 0, 0, 0, 0, 0 and 0; KOs 0/0/0/1, 1, 2, 0, 0, 0, 0, 0, 2, 1 and 1.
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
    // Fix round 1 (ruling R-T13d-d): Link throws with his Boomerang out, and the throw fails.
    expect(lab.moves.has("link sideBFailed"), "the projectile lab's failed throw").toBe(true);
  }

  // Plan 5, Task 16: the beams lab plays the three Final Smashes that trap nobody
  // (`goldenBeamLab.ts`); no other golden match uses one.
  function expectBeams(): void {
    const lab = played.get(BEAM_LAB.name)!;
    expect(["samus finalSmash", "mario finalSmash", "link finalSmash"].filter((m) => !lab.moves.has(m)), "Final Smashes the beams lab no longer plays").toEqual([]);
    expect(["hugeFlame", "ancientArrow"].filter((id) => !lab.launched.has(id)), "Final Smash projectiles the beams lab no longer launches").toEqual([]);
    expect(lab.hits, "Zero Laser's 51 on Donkey Kong, Mario Finale's two on Samus and the Ancient Arrow on Mario").toBe(54);
  }

  // Plan 5, Task 16 fix round 4: the dash lab whiffs a Final Smash dash and a cinematic
  // Final Smash in the air (`goldenDashLab.ts`); no other golden match uses one in the
  // air. Held through its startup only, Volt Tackle carries Pikachu off the side blast
  // line (ruling R-T16l, amended): the match's one KO. Held to its end, he would have
  // fallen onto the stage.
  function expectDashes(): void {
    const lab = played.get(DASH_LAB.name)!;
    expect(["pikachu finalSmash", "fox finalSmash"].filter((m) => !lab.moves.has(m)), "Final Smashes the dash lab no longer whiffs").toEqual([]);
    expect(lab.actions.has("finalTrapped"), "nobody trapped: both whiff").toBe(false);
    expect([lab.hits, lab.kos], "no hit, and Volt Tackle's self-destruct").toEqual([0, 1]);
  }

  // Plan 5 final wave (ruling R-FW1e; the final review's M5): the ball-on CPU match runs
  // the CPU's Smash Ball chase and its Final Smash, so a change to either moves the trace.
  // Pinned by what it plays, not only by its digest: a ball broken, and a Final Smash
  // started by a CPU (both, as measured: Samus's on 1383 and Kirby's on 2491).
  function expectCpuFinalSmash(): void {
    const m = played.get("samus-kirby-townAndCity-ball")!;
    expect(m.ballsBroken, "Smash Balls broken in the ball-on CPU match").toBeGreaterThan(0);
    expect(m.finalSmashes, "Final Smashes started by its CPUs").toBeGreaterThan(0);
    expect([...m.moves].some((x) => x.endsWith(" finalSmash")), "a CPU in its Final Smash").toBe(true);
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
  it("plays the beams and the arrow in the beams lab", expectBeams);
  it("whiffs a dash and a cinematic Final Smash in the air in the dash lab", expectDashes);
  it("breaks the Smash Ball and uses a Final Smash in the ball-on CPU match", expectCpuFinalSmash);
  it("keeps vx/vy the energies' sum, every fighter number an integer, and every fighter out of the stage, on every frame", expectInvariants);

  if (process.env.UPDATE_GOLDEN === "1") {
    it("writes the golden trace", () => {
      // A failed test above does not stop this one, so it checks again first.
      expectCombat();
      expectCoverage();
      expectScriptHits();
      expectProjectilePaths();
      expectSmashSpecials();
      expectBeams();
      expectDashes();
      expectCpuFinalSmash();
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
