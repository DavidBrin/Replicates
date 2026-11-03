/**
 * The CPU's Plan 5 offence (Task 19): what it does with the specials Plan 5
 * gave the roster, the Final Smash and the Smash Ball, and with a fighter in
 * its hands or its mouth.
 *
 * Same rules as `behaviours.ts`: a pure function of the context, every random
 * number from `ctx.rolls`, and the opponent seen only through `ctx.view`. The
 * CPU knows its *own* moveset (`ctx.fighterDef`, the copied neutral special
 * included: `cpuDef`) and the moves the match's fighters have (`ctx.matchDefs`),
 * which is what a player knows about the fighters on screen, and sees
 * projectiles and the Smash Ball, which are on screen for everybody.
 *
 * One roll a decision (ruling R-T18e, R-T18g): a reaction to a threat (a
 * projectile to reflect, a swing to counter) rolls once, on the one frame the
 * threat is timed for, or on the frame it is first seen when that is already
 * later (ruling R-T19f); a special used on the CPU's own initiative (a charge, a
 * smash-input special) rolls once an opening (`opening`), on the first frame the
 * opponent's new action is seen or the CPU's own begins; a sideways recovery
 * rolls once an offstage episode (ruling R-T19i). Nothing rolls a rate per frame. A behaviour carrying on with something already begun (holding a
 * charge, a reflector, a throw already chosen) reads the fighter's own state and
 * rolls nothing.
 *
 * Every Special press is made from a state free to act (`free`), where the
 * engine reads it on the next step; none waits in the buffer, so a buffered
 * Special is still only ever `recover`'s up special (`cpu.ts`, `specialPending`).
 */

import { LAUNCH_SPEED_DECAY, SMASH_CHARGE_MAX } from "@/engine/constants";
import { endDash, finalSmashActive, holdsAloft, inDash, isFinalSlot } from "@/engine/final";
import { stopsAtEdge } from "@/engine/groundExit";
import { inhaleMayCatch } from "@/engine/inhale";
import { ONE, abs, fx } from "@/engine/fixed";
import { emptyCombat } from "@/engine/combat";
import { emptyKinetic, kineticClear } from "@/engine/kinetic";
import { integrate, platformCentreX, resolveCollision } from "@/engine/physics";
import { cloneFighter } from "@/engine/simulate";
import { advanceFighter, applyMovement, interpretInput, onLanded, onLeftGround, updateInputTracking, type StateContext } from "@/engine/states";
import { begunInAir } from "@/engine/upSpecial";
import { smashHoldFrame } from "@/engine/acmd/run";
import { fighterParams } from "@/engine/params";
import { articleOf, findProjectileDef, isFinalProjectile } from "@/engine/projectile";
import {
  Btn,
  type ActionState,
  type FighterDef,
  type FighterState,
  type Hitbox,
  type InputFrame,
  type MoveDef,
  type MoveSlot,
  type ProjectileDef,
  type ProjectileState,
  type StageDef,
} from "@/engine/types";
import {
  HELD_ACTIONS,
  ROLL_SPECIAL,
  THREAT_RANGE,
  VERTICAL_REACH,
  canAct,
  dodgeDrift,
  free,
  fullHopPulse,
  isHelpless,
  isOffstage,
  isShielding,
  moveReach,
  pulse,
  towardX,
  type Behaviour,
  type BehaviourContext,
  type BehaviourResult,
  type FiringBands,
  type RecoveryMove,
  type StageView,
} from "./behaviours";
import { ghostContext, ghostStep, overFloor, recoveryFromDef, sideRecoveryFromDef, upBInReach, upBPlan } from "./recovery";
import { counterWait, specialWith } from "./defence";
import { leavesFloor, pressToward } from "./offence";

const NOTHING: BehaviourResult = { score: 0, input: 0 };

/* -------------------------------------------------------------- shared -- */

/* A state free to act is `behaviours.ts`'s `free`, which the shield shares (ruling R-T19g). */

/**
 * An opening (ruling R-T18e): the first frame the opponent's new action is seen,
 * or the first frame of the CPU's own new one. A special used on the CPU's own
 * initiative is decided here, one roll, and on no other frame.
 */
export function opening(ctx: BehaviourContext): boolean {
  return ctx.view.targetActionAge === 0 || ctx.view.self.actionFrame === 0;
}

/** The one special-use roll (`ROLL_SPECIAL`) against the level's `specialSkill`. */
function skilled(ctx: BehaviourContext): boolean {
  return ctx.rolls[ROLL_SPECIAL] < ctx.tuning.specialSkill;
}

/* `specialWith` (a fighter's special with a property) and the counter's timing are
 * `defence.ts`'s, which `shield` reads too (ruling R-T19l). */

/** A projectile's definition, from the fighter whose moveset defines it (`ProjectileState.source`). */
function projectileDefOf(ctx: BehaviourContext, p: ProjectileState): ProjectileDef | undefined {
  const source = ctx.matchDefs.find((d) => d?.id === p.source) ?? (ctx.fighterDef?.id === p.source ? ctx.fighterDef : undefined);
  return source === undefined || source === null ? undefined : findProjectileDef(source, p.defId);
}

/** In the move in `slot` (a special). */
function inMove(f: FighterState, slot: MoveSlot): boolean {
  return f.action === "special" && f.move === slot;
}

/**
 * The ends of the floor `f` stands on: a soft platform's, where the stage's clock has
 * it (`platformCentreX`), or the main stage's ledges. Null in the air.
 */
function floorEnds(f: FighterState, stage: StageView, stageFrame: number): { readonly left: number; readonly right: number } | null {
  if (!f.grounded) return null;
  for (const p of stage.platforms) {
    const centre = platformCentreX(p, stageFrame);
    if (abs(f.y - p.y) <= fx(1) && abs(f.x - centre) <= p.halfWidth) return { left: centre - p.halfWidth, right: centre + p.halfWidth };
  }
  return { left: stage.leftLedge, right: stage.rightLedge };
}

/**
 * How far the fighter's own momentum slides it toward `dir` (−1, 1) on the ground: its
 * speed braked by its traction a frame (`ground_brake`: a special's FALL kinetic
 * grounded, `kineticExec`), 0 when it moves the other way or not at all.
 */
function slideToward(ctx: BehaviourContext, dir: number): number {
  const { self } = ctx.view;
  if (self.vx === 0 || self.vx > 0 !== dir > 0 || ctx.fighterDef === null) return 0;
  return abs(dodgeDrift(self.vx, fighterParams(ctx.fighterDef).ground_brake, Number.MAX_SAFE_INTEGER));
}

/**
 * The edge-room check (Plan 5, Task 19; the review's M6 shares it): whether, on the
 * ground, there is room on the floor the fighter stands on (`floorEnds`: a soft
 * platform's ends, or the main stage's ledges) toward `dir` (−1 left, 1 right) for the
 * slide of its own momentum (`slideToward`) and `extra` more. A Final Smash's dash
 * wants `FINAL_SMASH_EDGE_ROOM` more toward its target; a counter or a reflector,
 * standing where it is pressed, the slide alone (`slideStaysOn`). (Task 19 fix round
 * 1's sweep: Critical Hit begun from a run on Battlefield's side platform, 15 from its
 * end, slid off it in its windup, and its dash flew on through the air to the blast
 * line: measured to the main stage's ledge, 36 away, the check had passed.)
 */
export function roomAhead(ctx: BehaviourContext, dir: number, extra: number): boolean {
  const { self } = ctx.view;
  const floor = floorEnds(self, ctx.stage, ctx.state.stageFrame);
  if (floor === null) return false;
  const room = dir >= 0 ? floor.right - self.x : self.x - floor.left;
  return room >= slideToward(ctx, dir) + extra;
}

/**
 * Whether a move that stands the fighter where it is (a counter, a reflector) keeps it
 * on its floor when pressed now (the Task 19 review's M6: Marth's counter pressed from
 * a run 3.6 from the ledge slid him off it): its momentum's slide fits the floor ahead
 * (`roomAhead`). In the air there is no slide (each one is kept off the stage's
 * outside by its own check).
 */
function slideStaysOn(ctx: BehaviourContext): boolean {
  const { self } = ctx.view;
  return !self.grounded || self.vx === 0 || roomAhead(ctx, self.vx > 0 ? 1 : -1, 0);
}

/* ---------------------------------------------------------- Final Smash -- */

/**
 * UNVERIFIED (tuning): how far off level a target may be for a Final Smash that
 * fires straight ahead along the stage (Zero Laser, Mario Finale, the Ancient
 * Bow and Arrow) to be worth it.
 */
export const FINAL_SMASH_BAND = fx(20);

/**
 * UNVERIFIED (tuning): how far ahead a trapping Final Smash's first hit is
 * trusted to reach when its own boxes say nothing (`finalReach`), and how close a
 * dash that ignores the edge wants its target (point-blank).
 */
export const FINAL_SMASH_RANGE = fx(30);

/**
 * UNVERIFIED (tuning): how far ahead a dashing Final Smash (Critical Hit, Volt
 * Tackle) is used on a target in its path, at most; its own travel caps it
 * (`dashTravel`).
 */
export const FINAL_SMASH_DASH_RANGE = fx(120);

/**
 * UNVERIFIED (tuning): how much floor a dashing Final Smash needs ahead of its
 * user to be started, past its own momentum's slide (`roomAhead`): one begun at the
 * edge slides off it during its windup and dashes from the air (seen in the Task 19
 * sweep: Critical Hit off Smashville).
 */
export const FINAL_SMASH_EDGE_ROOM = fx(10);

/** Reeling, lying down, landing, helpless: an opponent who cannot act soon, for a smash's charge or a Final Smash's dash to wait on. */
const CANNOT_ACT_SOON: readonly ActionState[] = ["downed", "shieldBroken", "landingLag", "specialLanding", "specialFall", "tumble", "tumbleFall", "hitstun"];

/**
 * What the opponent is doing that keeps them where they are through a Final
 * Smash's windup: reeling, lying down, landing, helpless, or committed to a move,
 * a shield or a grab of their own. A Final Smash is unblockable (SmashWiki
 * "Unblockable attack"), so a shield is no escape.
 */
const COMMITTED: readonly ActionState[] = [...CANNOT_ACT_SOON, "attack", "special", "shieldStart", "shield", "shieldStun", "grab", "grabHold"];

/** How far the move's own dash windows carry it (`MoveDef.momentum`): the sum of each window's speed over its frames. */
export function dashTravel(move: MoveDef): number {
  let travel = 0;
  for (const w of move.momentum ?? []) travel += abs(w.x) * ((w.hold ?? 0) + 1);
  return travel;
}

/** The reach of a Final Smash's first hit, from its own boxes (`moveReach`), or `FINAL_SMASH_RANGE` with none. */
export function finalReach(move: MoveDef): number {
  const reach = moveReach(move);
  return reach > 0 ? reach : FINAL_SMASH_RANGE;
}

/**
 * UNVERIFIED (CPU judgement; ruling D10): after holding the Smash Ball's power this long, a
 * CPU holding a travelling Final Smash goes to point blank of its target on its floor
 * (`overdueApproach`) and fires it from a standstill once the target can be caught
 * (`fireFinalSmash`, `hittable`), whiff check or not, so no Smash Ball is held back from
 * everybody for good (D58's M2). 1,200 frames, the one Final Smash limit published, the FS Meter's (SmashWiki
 * "Final Smash": "a charged FS Meter now has a time limit of 20 seconds"); the Smash Ball's
 * own standby has none (R-FW2m).
 */
export const FINAL_SMASH_HOLD_LIMIT = 1200;

/**
 * How many more frames `f` cannot act, as its own state says (Plan 6, Task 24): a hold's
 * remaining grab time, its hitstun (a reel, a tumble, a broken shield's stun), a landing's
 * remaining lag. 0 when it can act, or when the state does not say (lying down, whose end
 * is the player's).
 */
export function holdLeft(f: Pick<FighterState, "action" | "hitstun" | "grabTimer" | "charge" | "actionFrame">): number {
  if (f.action === "grabbed" || f.action === "cargoHeld") return f.grabTimer;
  if (f.hitstun > 0) return f.hitstun;
  if (f.action === "landingLag" || f.action === "specialLanding") return Math.max(0, f.charge - f.actionFrame);
  return 0;
}

/**
 * The move frame on which `fs`'s first trap reaches a target `ahead` in front from a
 * standstill (Plan 6, Task 24): its earliest trapping box's frame within the move's reach
 * (`finalReach`), else the dash's first window's frame plus the frames its speed needs for
 * the distance past that reach.
 */
export function connectFrame(fs: MoveDef, ahead: number): number {
  const traps = fs.hitboxes.filter((h) => h.trap !== false);
  const first = traps.length === 0 ? 1 : Math.min(...traps.map((h) => h.startFrame));
  const reach = finalReach(fs);
  const dash = fs.momentum?.[0];
  if (ahead <= reach || dash === undefined || dash.x === 0) return first;
  return Math.max(first, dash.frame) + Math.ceil((ahead - reach) / abs(dash.x));
}

/**
 * What a target does that has, or is about to have, intangibility or invincibility (Task 24
 * fix round 1): the respawn's platform and its entry, a dodge, a tech, a get-up, and the
 * ledge's options. A trap that reaches it through them whiffs (the review's FD probe: a
 * Volt Tackle fired at a just-respawned Mario, invincible 59, passed through him, and its
 * whiff carried Pikachu to the blast line).
 */
const SOON_UNHITTABLE: readonly ActionState[] = [
  "respawnPlatform",
  "entering",
  "dead",
  "spotDodge",
  "roll",
  "airDodge",
  "tech",
  "techRoll",
  "getUp",
  "ledgeHang",
  "ledgeGetUp",
  "ledgeAttack",
  "ledgeRoll",
  "ledgeJump",
];

/**
 * Whether a travelling Final Smash's trap can catch `target` (Task 24 fix round 1): neither
 * invincible nor intangible as the view shows it, nor in an action that is about to make it so
 * (`SOON_UNHITTABLE`). As the grab reads a target (ruling R-FW1r), the view's invincibility
 * as it is, its intangibility once the view has seen it begin (ruling R-T19k).
 */
export function hittable(target: Pick<FighterState, "action" | "invincible" | "intangible">): boolean {
  return target.invincible === 0 && target.intangible === 0 && !SOON_UNHITTABLE.includes(target.action);
}

/**
 * UNVERIFIED (CPU judgement; Task 24 fix round 1): past `FINAL_SMASH_HOLD_LIMIT`, how far ahead
 * of it the CPU wants its target to fire at, at most: point blank (`FINAL_SMASH_RANGE`), where
 * the start's slowing of the others (`SLOW_OPPONENT`, Volt Tackle's (9, 45): Task 11) keeps a
 * free target inside the trap's reach through the windup. And at least `FINAL_SMASH_EDGE_ROOM`,
 * so that floor for the dash's room check (`roomAhead`) is ahead of it even with the target at
 * a ledge.
 */
export const OVERDUE_AHEAD_MIN = FINAL_SMASH_EDGE_ROOM;

/**
 * Is anybody's Final Smash out: a fighter in one, or a projectile one launched? The
 * engine's own rule (`final.ts`'s `finalSmashActive`), its projectiles told by the
 * match's definitions as `step()` tells them (`isFinalProjectile`).
 */
function finalSmashOut(ctx: BehaviourContext): boolean {
  const projectileOut = ctx.state.projectiles.some((p) => {
    const def = ctx.matchDefs.find((d) => d?.id === p.source);
    return def !== undefined && isFinalProjectile(def, p.defId);
  });
  return finalSmashActive(ctx.state, projectileOut);
}

/**
 * Use the Smash Ball's power (SmashWiki "Final Smash": the neutral special is
 * replaced by it), knowing how each Final Smash goes (`final.ts`):
 *
 *  - one that fires straight ahead and traps nobody (Zero Laser, Mario Finale,
 *    the Ancient Bow and Arrow) is aimed along the stage: facing the target, the
 *    target about level (`FINAL_SMASH_BAND`) and on a floor or committed
 *    (`COMMITTED`), the user over the stage;
 *  - one that traps with its first hit is used with the target inside that hit's
 *    reach (`finalReach`, from its own boxes), in front, and committed: its windup
 *    is long (Jungle Rush's trap comes out on 29, Team Star Fox's on 28), and a
 *    target free to move walks out of it; and, as the one that fires along the stage,
 *    with the user over the stage (Plan 5 final wave, ruling R-FW1d; the final
 *    review's M1: Kirby started Ultra Sword off the stage in 5 of 123 natural uses, and
 *    under stress whiffed it at a recovering Samus and fell short);
 *  - one that dashes (Critical Hit, Volt Tackle; `MoveDef.momentum`) only from the
 *    ground, with floor ahead for its momentum's slide and `FINAL_SMASH_EDGE_ROOM`
 *    more (`roomAhead`: the floor it stands on, a soft platform's end included), and
 *    the target in its path,
 *    level and in front, within its travel (`dashTravel`). One whose grounded dash
 *    stops at the edge (`MoveDef.dashEnd.edge`, Critical Hit) is safe to whiff; one
 *    that ignores the edge (Volt Tackle) whiffed carries on past its window and falls
 *    off the side blast line (SmashWiki "Volt Tackle": "it is fairly easy to
 *    self-destruct off the side blast line if the player misses"; the Task 19 sweep:
 *    a 166-unit dash ended 273 units on, at Task 15's 4.5 a frame; 4.1 since Plan 5
 *    final wave 2, fix round 3, ruling R-FW2q), so it is used only point-blank
 *    (`FINAL_SMASH_RANGE`) from a standstill on a target held where it stands, on the
 *    ground and unable to act soon (`CANNOT_ACT_SOON`; ruling R-T19d): never toward
 *    an open blast line on a chance. Not where its dash (`dashTravel`) would end over
 *    the stage either (ruling R-T19h): a whiff carries on past its dash windows (about
 *    255 units at 4.5 a frame, the Task 19 review's M2), and Pokémon Stadium 2, wider than the dash,
 *    let one fire at a free target from near a ledge. (In the sweep a target merely
 *    committed was not enough: Volt Tackle's startup sparks knocked an aerial one
 *    behind Pikachu; nor was a run, or a stand still sliding from one: its speed slid
 *    Pikachu past the target in the windup, and the dash went on alone.)
 *  - a travelling one that ignores the edge also fires, whiff or not, at a target the view
 *    has seen held until it lands, beyond point blank (`holdLeft`, `connectFrame`),
 *    stopping first if it is moving (Plan 6, Task 24); and once the power has been held
 *    `FINAL_SMASH_HOLD_LIMIT` frames (ruling D10), at point blank, the CPU going there first
 *    (`overdueApproach`); either only at a target its trap can catch (`hittable`; Task 24 fix
 *    round 1).
 *
 * It turns to face the target first (a grounded turn is an input), at point blank with
 * the press that does not carry it past (ruling R-FW1a: `pressToward`; the review's I1:
 * the CPU held the power through a dash dance, which stopped the Smash Ball for
 * everybody). No roll: the power is a sure thing, kept until the moment comes.
 *
 * Until it is, a travelling one that ignores the edge (Volt Tackle) takes its user to a
 * spot it would fire from (`finalSmashSpot`; Plan 5 final wave 2, fix round 1, ruling
 * R-FW2n).
 */
export const finalSmash: Behaviour = (ctx) => {
  const fire = fireFinalSmash(ctx);
  if (fire.score > 0) return fire;
  const overdue = overdueApproach(ctx);
  return overdue.score > 0 ? overdue : finalSmashSpot(ctx);
};

/** Whether `self` has held the Smash Ball's power `FINAL_SMASH_HOLD_LIMIT` frames or more (ruling D10). */
function overdueHolding(self: FighterState): boolean {
  return self.finalSmashReady > 0 && self.combat.standbyFrames >= FINAL_SMASH_HOLD_LIMIT;
}

/**
 * Past the time limit (ruling D10, made firm in Task 24's fix rounds 1 and 2), a CPU holding a
 * travelling Final Smash starts nothing else on the ground (in a move or a landing it lets go, so
 * nothing follows; a shield is left to its own behaviour) and goes to where it fires from: on its own floor, `OVERDUE_AHEAD_MIN` to `FINAL_SMASH_RANGE` short of its target and
 * `SPOT_EDGE_ROOM` inside the floor's ends, on the side it is on (the other where that side has
 * no room), facing it, still; there it waits for the target to be catchable (`hittable`, on the
 * ground), and `fireFinalSmash` fires. Its score beats every attack and movement but loses to the
 * survival behaviours and a shield's decision (Task 24 fix round 1: against an idle player the
 * limit fired 578-2,116 frames late, the CPU busy attacking). Where its target is on no floor
 * level with it, there is no such place, and the CPU fights on as before (`approach` takes it
 * up to a platform). As `finalSmashSpot`, it moves by `goToSpot`'s rules and never presses
 * what takes it off its floor (`keepFloor`).
 */
function overdueApproach(ctx: BehaviourContext): BehaviourResult {
  const { self, target, dx, dy } = ctx.view;
  const def = ctx.fighterDef;
  const fs = def?.moves.finalSmash;
  if (def === null || fs === undefined || target === null || !overdueHolding(self) || dashTravel(fs) === 0) return NOTHING;
  if (!canAct(self) || !self.grounded || abs(dy) > VERTICAL_REACH || finalSmashOut(ctx)) return NOTHING;
  const floor = floorEnds(self, ctx.stage, ctx.state.stageFrame);
  if (floor === null) return NOTHING;
  const tx = self.x + dx;
  const stretch = (dir: number) => {
    const from = Math.max(dir > 0 ? tx - FINAL_SMASH_RANGE : tx + OVERDUE_AHEAD_MIN, floor.left + SPOT_EDGE_ROOM);
    const to = Math.min(dir > 0 ? tx - OVERDUE_AHEAD_MIN : tx + FINAL_SMASH_RANGE, floor.right - SPOT_EDGE_ROOM);
    return from <= to ? { x: Math.min(Math.max(self.x, from), to), dir, from, to } : null;
  };
  const side = dx >= 0 ? 1 : -1;
  const spot = stretch(side) ?? stretch(-side);
  if (spot === null) return NOTHING;
  // Not yet free to move but able to act (in a move: a jab's loop, a smash's charge, a special's;
  // or landing), it lets go, so that nothing new follows: an attack under way finishes, but no
  // jab loops on, no smash charges, and no press is buffered for the next one (Task 24 fix round
  // 2: a rapid jab looped on 446 frames past the limit against an idle Mario on Battlefield, and
  // on Pokémon Stadium 2 an Attack pressed in a landing came out as a smash that KO'd him). Not
  // a shield, which its own behaviour keeps up or lets go.
  if (!free(self)) return isShielding(self.action) ? NOTHING : { score: OVERDUE_SCORE, input: 0 };
  return keepFloor(ctx, moveToSpot(ctx, def, spot, OVERDUE_SCORE));
}

/** UNVERIFIED (CPU judgement): `overdueApproach`'s score, above every attack and movement (at most 700), below the survival behaviours (900 and up). */
const OVERDUE_SCORE = 890;

/** `finalSmash`'s use of the power, where the moment has come; NOTHING where it has not. */
function fireFinalSmash(ctx: BehaviourContext): BehaviourResult {
  const { self, target, targetAction, dx, dy, facingTarget } = ctx.view;
  const fs = ctx.fighterDef?.moves.finalSmash;
  if (self.finalSmashReady <= 0 || fs === undefined || target === null || !free(self) || finalSmashOut(ctx)) return NOTHING;
  const ahead = abs(dx);
  const committed = COMMITTED.includes(targetAction);
  const travel = dashTravel(fs);
  // A travelling one that will connect needs no whiff check (Plan 6, Task 24), and after the
  // time limit none is wanted (ruling D10).
  let whiffFree = false;
  if (travel > 0) {
    if (!self.grounded || abs(dy) > VERTICAL_REACH || ahead > Math.min(travel, FINAL_SMASH_DASH_RANGE)) return NOTHING;
    if (!roomAhead(ctx, dx >= 0 ? 1 : -1, FINAL_SMASH_EDGE_ROOM)) return NOTHING;
    const still = (self.action === "stand" || self.action === "crouch") && self.vx === 0;
    const held = still && target.grounded && CANNOT_ACT_SOON.includes(targetAction);
    // Proven held (Plan 6, Task 24): its hold, once the view has seen it (`targetActionAge`),
    // outlasts the reaction and the frames until the trap reaches it. Not at point blank, where
    // the startup's sparks hit it first, and a hit ends its stun: there R-T19d's `held` rule
    // stands, with its whiff check. Conservative under a slowdown: a slowed target's hold lasts
    // longer than its state reads.
    // Either one only at a target its trap can catch when it arrives (`hittable`; Task 24 fix
    // round 1: a respawn's invincibility let the tackle through, and its whiff killed Pikachu).
    const catchable = target.grounded && hittable(target);
    const proven = still && catchable && ctx.view.targetActionAge >= 0 && ahead > FINAL_SMASH_RANGE && holdLeft(target) > ctx.tuning.reactionFrames + connectFrame(fs, ahead);
    // Past the time limit (ruling D10), at point blank, where the start's slowing keeps it in
    // the trap's reach (`OVERDUE_AHEAD_MIN`'s note); `overdueApproach` brings it there.
    const overdue = still && catchable && overdueHolding(self) && ahead <= FINAL_SMASH_RANGE;
    // On the move at a target seen held: stop now, to fire from the standstill, where the hold
    // outlasts the stop too and the slide (`slideToward`, its own braking) leaves the target
    // beyond point blank (Plan 6, Task 24: the CPU is seldom still when a hold begins). Not one
    // that stops at the edge (Critical Hit), which fires from a run as before (R-P6-15).
    if (fs.dashEnd?.edge !== true && !still && catchable && ctx.view.targetActionAge >= 0) {
      const slide = slideToward(ctx, dx >= 0 ? 1 : -1);
      const stopFrames = Math.ceil(abs(self.vx) / fighterParams(ctx.fighterDef!).ground_brake);
      if (ahead - slide > FINAL_SMASH_RANGE && holdLeft(target) > ctx.tuning.reactionFrames + stopFrames + connectFrame(fs, ahead - slide)) return { score: 880, input: 0 };
    }
    whiffFree = proven || overdue;
    const safe = fs.dashEnd?.edge === true || (ahead <= FINAL_SMASH_RANGE && held) || whiffFree;
    if (!safe) return NOTHING;
  } else if (fs.final?.trap === true) {
    if (abs(dy) > VERTICAL_REACH || ahead > finalReach(fs) || !committed || isOffstage(self, ctx.stage)) return NOTHING;
  } else {
    if (abs(dy) > FINAL_SMASH_BAND || isOffstage(self, ctx.stage) || (!target.grounded && !committed)) return NOTHING;
  }
  if (!facingTarget) return self.grounded ? { score: 880, input: pressToward(self, dx) } : NOTHING;
  // Its own safety, read where it is (Plan 5 final wave, fix round 3, ruling R-FW1t; part 2
  // fix round 1, ruling R-FW2n): one that travels (`dashTravel`) and does not stop at the
  // edge is fired only where its whiff ends somewhere it comes back from (`whiffComesBack`).
  // The target is judged on the view as above (R-T19d); the user's own position is not delayed.
  if (travel > 0 && !whiffFree && !(fs.dashEnd?.edge === true && self.grounded) && !whiffComesBack(ctx)) return NOTHING;
  return { score: 900, input: pulse(ctx.view.frame, self.port, 2, 1) ? Btn.Special : 0 };
}

/**
 * UNVERIFIED (CPU judgement): how far ahead of its spot the CPU wants its target at least,
 * so that standing there it has the target in front of it, not level with it.
 */
export const SPOT_MIN_AHEAD = fx(4);

/**
 * UNVERIFIED (CPU judgement): how far from its spot it runs rather than walks (a walk's
 * let-go slides a unit and a half, a run's about fifteen).
 */
export const SPOT_WALK = fx(16);

/**
 * UNVERIFIED (CPU judgement): how far short of its spot's target-side end it stops when it
 * still has to turn round there, for the turn's own step (a quarter of a unit for Pikachu's).
 */
export const SPOT_TURN_ROOM = fx(0.5);

/**
 * UNVERIFIED (CPU judgement): how far inside each ledge a spot is (`finalSmashSpotFor`):
 * more than a frame of Pikachu's run (2.04), the most it can stop past a stretch's end by
 * letting go a frame late, so that it stops on its floor (Plan 5 final wave 2, fix round 2,
 * re-review 2's N3: a stretch at the very ledge walked it off).
 */
export const SPOT_EDGE_ROOM = fx(3);

/** UNVERIFIED (CPU judgement): the most steps a let-go's slide is followed for (`slideStop`). */
const SPOT_SLIDE_FRAMES = 60;

/**
 * One table a fighter and a stage's geometry (`stageKey`): the bands depend on nothing else
 * (`firingBands`). A cache of a pure function, so whether it already holds a pair changes no
 * answer; it is filled where a CPU's world is built (`spotBands`), so a match's worlds, and the
 * next match's over the same stage and fighter, share one table.
 */
const BANDS = new WeakMap<FighterDef, Map<string, FiringBands>>();

/** A stage view's geometry as a key: two views of one stage are one key. */
function stageKey(stage: StageView): string {
  return JSON.stringify(stage);
}

/**
 * The spots on the main floor from which `def`'s travelling Final Smash, pressed from a
 * standstill facing right or left, would be fired by `whiffComesBack`'s own reading (Plan 5
 * final wave 2, fix round 1, ruling R-FW2n): every whole unit between the ledges, its whiff
 * run (`whiffEnd`) and judged (on a floor, or `recoversFrom`). They read nothing but the
 * fighter's definition and the stage's geometry, so they are worked out once a pair and kept
 * (`BANDS`); the stage's clock is taken at 0 (a moving soft platform where it starts), and the
 * live check at the moment of firing (`whiffComesBack`) has the last word.
 */
export function firingBands(def: FighterDef, stage: StageView): FiringBands {
  let byStage = BANDS.get(def);
  if (byStage === undefined) {
    byStage = new Map();
    BANDS.set(def, byStage);
  }
  const key = stageKey(stage);
  const known = byStage.get(key);
  if (known !== undefined) return known;
  const r = recoveryFromDef(def);
  const runs = (dir: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let x = Math.ceil(stage.leftLedge / ONE) * ONE; x <= stage.rightLedge; x += ONE) {
      const f = standingAt(def, stage, x, dir);
      const end = whiffEnd(def, f, stage, 0, 0);
      const back = end !== null && (end.fighter.grounded || recoversFrom(def, end.fighter, stage, r, def.attributes.jumps, end.steps, end.steps));
      if (!back) continue;
      const last = out.at(-1);
      if (last !== undefined && last[1] === x - ONE) last[1] = x;
      else out.push([x, x]);
    }
    return out;
  };
  const bands = { right: runs(1), left: runs(-1) };
  byStage.set(key, bands);
  return bands;
}

/** A Final Smash its CPU goes to a spot to fire (`finalSmashSpot`): one that travels and does not stop at the edge on the ground (Volt Tackle). */
function firedFromSpot(fs: MoveDef): boolean {
  return dashTravel(fs) > 0 && fs.dashEnd?.edge !== true;
}

/**
 * The firing bands `def`'s CPU goes to its spot by on `stage` (`goToSpot`): its Final Smash's
 * where that is one fired from a spot (`firedFromSpot`, Volt Tackle), null for any other.
 * Worked out with the CPU's world at match start (`cpuWorldFromDef`, which `matchCpuWorlds`
 * builds as the match is created), and only read after (`BehaviourContext.firingBands`): a
 * pure function of the fighter's definition and the stage, built before the first tick and
 * never changed, so the same on both machines and in every rolled-back re-simulation (Plan 5
 * final wave, part 5: worked out on the first decision that needed them, they took 45 to 105
 * ms of one frame for Pikachu, once a match, and came out empty on five stages of six).
 */
export function spotBands(def: FighterDef, stage: StageView): FiringBands | null {
  const fs = def.moves.finalSmash;
  return fs !== undefined && firedFromSpot(fs) ? firingBands(def, stage) : null;
}

/** A fighter standing still on the main floor at `x`, facing `dir`, with the power: what `firingBands` runs its whiff from. */
function standingAt(def: FighterDef, stage: StageView, x: number, dir: number): FighterState {
  return {
    port: 0,
    defId: def.id,
    costume: 0,
    x,
    y: stage.groundY,
    vx: 0,
    vy: 0,
    facing: dir,
    grounded: true,
    platform: 0,
    action: "stand",
    actionFrame: 30,
    move: null,
    charge: 0,
    damage: 0,
    stocks: 3,
    jumpsUsed: 0,
    airDodged: false,
    fastFalling: false,
    shortHop: false,
    shieldHealth: fx(50),
    hitstun: 0,
    hitlag: 0,
    launchSpeed: 0,
    pendingKnockback: 0,
    pendingAngle: 0,
    pendingFacing: 0,
    balloon: false,
    intangible: 0,
    invincible: 0,
    grabbedBy: -1,
    grabbing: -1,
    grabTimer: 0,
    ledge: null,
    ledgeRegrabs: 0,
    ledgeLockout: 0,
    airTime: 0,
    finalSmashReady: 1,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
  };
}

/** Where the CPU fires from (`finalSmashSpotFor`): the nearest point `x`, facing `dir`, of the stretch `from`..`to` it fires from. */
export interface FinalSmashSpot {
  readonly x: number;
  readonly dir: number;
  readonly from: number;
  readonly to: number;
}

/**
 * The nearest spot on the main floor the CPU would fire its travelling Final Smash from
 * with its target ahead (Plan 5 final wave 2, fix round 1, ruling R-FW2n): in one of its
 * stage's firing bands (`bands`, `firingBands`) facing the target, and with the target
 * `SPOT_MIN_AHEAD` to `FINAL_SMASH_RANGE` ahead, as the point-blank use wants it, and
 * `SPOT_EDGE_ROOM` inside the ledges. Null where there is none.
 */
export function finalSmashSpotFor(bands: FiringBands, stage: StageView, selfX: number, targetX: number): FinalSmashSpot | null {
  let best: FinalSmashSpot | null = null;
  for (const dir of [1, -1]) {
    const lo = dir > 0 ? targetX - FINAL_SMASH_RANGE : targetX + SPOT_MIN_AHEAD;
    const hi = dir > 0 ? targetX - SPOT_MIN_AHEAD : targetX + FINAL_SMASH_RANGE;
    for (const [a, b] of dir > 0 ? bands.right : bands.left) {
      const from = Math.max(a, lo, stage.leftLedge + SPOT_EDGE_ROOM);
      const to = Math.min(b, hi, stage.rightLedge - SPOT_EDGE_ROOM);
      if (from > to) continue;
      const x = Math.min(Math.max(selfX, from), to);
      if (best === null || abs(x - selfX) < abs(best.x - selfX)) best = { x, dir, from, to };
    }
  }
  return best;
}

/**
 * Where the fighter comes to rest on its floor if it lets go now: its own copy slid by the
 * engine's rules (`ghostStep`), as `slidesOff` slides it. Null if it is still moving after
 * `SPOT_SLIDE_FRAMES` steps.
 */
function slideStop(ctx: BehaviourContext, def: FighterDef): number | null {
  const f = cloneFighter(ctx.view.self);
  const g = ghostContext(def, ctx.view.frame, f);
  for (let k = 1; k <= SPOT_SLIDE_FRAMES; k++) {
    g.frame = ctx.view.frame + k;
    ghostStep(f, 0, 0, g);
    if (f.vx === 0) return f.x;
  }
  return null;
}

/**
 * While it holds a travelling Final Smash that ignores the edge (Volt Tackle), the CPU goes
 * to the nearest spot it would fire it from with its target ahead (`finalSmashSpotFor`),
 * turns to face the target there, and waits, from where `fireFinalSmash` fires when the
 * target is held point-blank (ruling R-T19d unchanged) (Plan 5 final wave 2, fix round 1,
 * ruling R-FW2n: judged by where the whiff ends, the CPU's Volt Tackles were still 0 on
 * Battlefield and Small Battlefield over the sweep). It does so only while the target is
 * busy (`COMMITTED`: in a move, a shield, a landing or a reel), which is when it is about to
 * be held. A target free to act is fought as before: going to the spot then, the CPU stood
 * off an idle player's free target for up to 5,469 frames (the idle-human probe, ball on)
 * and a free CPU target for good. On its own floor and free to act only; where no spot has
 * the target ahead (a target in the stage's middle, say), it does nothing.
 *
 * Getting there: Smashville's stretch is 5 units wide, so it lets go where its slide stops
 * in the stretch (`slideStop`), runs from `SPOT_WALK` away and walks nearer, and, arriving
 * facing away, stops `SPOT_TURN_ROOM` short of the stretch's target-side end, then turns
 * with a walk's first step. No press it makes takes it off its floor (`leavesFloor`,
 * `slidesOff`'s floor model; fix round 2, re-review 2's N3): one that would is not made,
 * and a let-go that would slide it off is a shield, which stops at the edge, as the CPU's
 * own let-go guard does (`cpuInput`).
 */
function finalSmashSpot(ctx: BehaviourContext): BehaviourResult {
  return keepFloor(ctx, goToSpot(ctx));
}

/** A move to a spot that would take the fighter off its floor (`leavesFloor`) is not made: it lets go, or shields where the let-go would slide it off. */
function keepFloor(ctx: BehaviourContext, go: BehaviourResult): BehaviourResult {
  if (go.score === 0) return go;
  if (!leavesFloor(ctx, go.input)) return go;
  return { score: go.score, input: go.input !== 0 && !leavesFloor(ctx, 0) ? 0 : Btn.Shield };
}

/** `finalSmashSpot`'s way to its spot, before the floor is checked. */
function goToSpot(ctx: BehaviourContext): BehaviourResult {
  const { self, target, dx, dy } = ctx.view;
  const def = ctx.fighterDef;
  const fs = def?.moves.finalSmash;
  // Its stage's bands, from its world (`spotBands`, built at match start): none, no spot.
  const bands = ctx.firingBands;
  if (def === null || fs === undefined || bands === undefined || self.finalSmashReady <= 0 || target === null || !free(self) || !self.grounded) return NOTHING;
  if (!firedFromSpot(fs) || abs(dy) > VERTICAL_REACH || finalSmashOut(ctx)) return NOTHING;
  if (!COMMITTED.includes(ctx.view.targetAction)) return NOTHING;
  const spot = finalSmashSpotFor(bands, ctx.stage, self.x, self.x + dx);
  if (spot === null) return NOTHING;
  return moveToSpot(ctx, def, spot, 450);
}

/** The CPU's way to `spot` and its stand there facing `spot.dir`, scored `score` (`goToSpot`'s, shared with `overdueApproach`). */
function moveToSpot(ctx: BehaviourContext, def: FighterDef, spot: FinalSmashSpot, score: number): BehaviourResult {
  const { self } = ctx.view;
  // The part of the stretch it stops in: all of it facing the target, short of the target's
  // side by the turn's room facing away.
  const room = self.facing === spot.dir ? 0 : Math.min(SPOT_TURN_ROOM, (spot.to - spot.from) >> 1);
  const from = spot.dir > 0 ? spot.from : spot.from + room;
  const to = spot.dir > 0 ? spot.to - room : spot.to;
  if (self.vx !== 0) {
    // Moving: it lets go once its slide would stop in the stretch or past it; short of it,
    // it keeps going.
    const stop = slideStop(ctx, def);
    if (stop === null || (self.vx > 0 ? stop >= from : stop <= to)) return { score, input: 0 };
    const way = self.vx > 0 ? to - self.x : from - self.x;
    return { score, input: abs(way) >= SPOT_WALK ? towardX(0, way) : towardX(0, way) | Btn.Soft };
  }
  if (self.x < from || self.x > to) {
    const way = (self.x < from ? from : to) - self.x;
    return { score, input: abs(way) >= SPOT_WALK ? towardX(0, way) : towardX(0, way) | Btn.Soft };
  }
  if (self.facing !== spot.dir) return { score, input: towardX(0, spot.dir) | Btn.Soft };
  // There, facing the busy target: it stands still, so that it is still standing when the
  // target is held (`fireFinalSmash` fires from a standstill only).
  return { score, input: 0 };
}

/**
 * UNVERIFIED (CPU judgement): steps past its move's own length a whiff is followed, so a
 * part whose air length is the longer still ends inside the run.
 */
const WHIFF_MARGIN = 30;

/**
 * The stage as the engine collides a body with it, from the CPU's view of it: the main
 * platform between its ledges, and the soft platforms (Plan 5 final wave 2, fix round 1,
 * ruling R-FW2n). What a whiff's run lands on, walks off and falls past.
 */
function floorsOf(stage: StageView): StageDef {
  return {
    id: "whiffFloors",
    name: "a whiff's floors",
    series: "",
    platforms: [
      { x: (stage.leftLedge + stage.rightLedge) >> 1, y: stage.groundY, halfWidth: (stage.rightLedge - stage.leftLedge) >> 1, soft: false, ledges: true },
      ...stage.platforms.map((p) => ({ x: p.x, y: p.y, halfWidth: p.halfWidth, soft: true, ledges: false, ...(p.motion !== undefined ? { motion: p.motion } : {}) })),
    ],
    blastZone: { left: stage.blastLeft, right: stage.blastRight, top: stage.blastTop, bottom: stage.blastBottom },
    spawns: [{ x: 0, y: stage.groundY }],
    theme: "",
  };
}

/**
 * Where a travelling Final Smash, pressed now and whiffed, leaves its user as its move
 * ends (Plan 5 final wave 2, fix round 1, ruling R-FW2n): a copy of the fighter stepped by
 * `step()`'s own rules for one fighter (its status, its movement and the hold of an aerial
 * Final Smash, `holdsAloft`; its collision with the stage's floors, `resolveCollision`, its
 * edge rule and its landings), nobody else there, so nothing it would trap stops it. Null
 * when a blast line takes it on the way. Not modelled: a ledge (no Final Smash part takes
 * one), a wall (the dash runs along a floor or through the open air), and the bake's body
 * (the attributes' box is the ECB here). Pure: the fighter is copied.
 */
export function whiffEnd(def: FighterDef, self: FighterState, stage: StageView, frame0: number, stageFrame0: number): { readonly fighter: FighterState; readonly steps: number } | null {
  const floors = floorsOf(stage);
  const f = cloneFighter(self);
  const ctx: StateContext = { def, stage: floors, frame: frame0, stageFrame: stageFrame0, fighters: [f] };
  const limit = (def.moves.finalSmash?.totalFrames ?? 0) + WHIFF_MARGIN;
  let prev: InputFrame = 0;
  for (let i = 1; i <= limit; i++) {
    const input = i === 1 ? Btn.Special : 0;
    const now = { ...ctx, frame: frame0 + i, stageFrame: stageFrame0 + i };
    updateInputTracking(f, input, prev);
    const intent = interpretInput(f, input, prev);
    prev = input;
    if (!f.grounded && f.ledge === null) f.airTime += 1;
    advanceFighter(f, intent, now);
    if (i > 1 && !(f.action === "special" && isFinalSlot(f.move))) return { fighter: f, steps: i };
    let at = { x: f.x, y: f.y };
    if (holdsAloft(f, def)) kineticClear(f);
    else {
      applyMovement(f, intent, now);
      at = { x: f.x, y: f.y };
      integrate(f);
    }
    const underfoot = f.grounded && f.platform >= 0 ? floors.platforms[f.platform] : undefined;
    const outward = underfoot === undefined ? 0 : f.x >= platformCentreX(underfoot, now.stageFrame) ? 1 : -1;
    const move = f.move === null ? undefined : def.moves[f.move];
    const edgeEnds = move?.dashEnd?.edge === true && underfoot !== undefined && inDash(f, move);
    const overEdge = edgeEnds && abs(f.x - platformCentreX(underfoot!, now.stageFrame)) > underfoot!.halfWidth;
    const fromAir = begunInAir(f);
    const out = resolveCollision(f, at.x, at.y, floors, def.attributes, now.stageFrame, { cliffStop: stopsAtEdge(f, outward) || edgeEnds });
    if (overEdge) endDash(f, move!);
    if (out.landed) onLanded(f, now, fromAir);
    else if (out.leftGround) onLeftGround(f);
    if (f.x < stage.blastLeft || f.x > stage.blastRight || f.y < stage.blastBottom || f.y > stage.blastTop) return null;
  }
  return { fighter: f, steps: limit };
}

/**
 * Whether the CPU's own recovery model gets this fighter back from where it is, in the
 * air (Plan 5 final wave 2, fix round 1, ruling R-FW2n), as `recover` would set about it:
 * its own fall lands on a floor (`overFloor`); or its up special, now, reaches the stage or
 * the nearer ledge with one of its sticks (`upBPlan`); or, with a midair jump left, the up
 * special does from the top of that jump, drifting toward the ledge. Helpless, nothing
 * does. A "no" may be a fighter `recover` would still save, by drifting closer first: the
 * model is the cautious one.
 */
export function recoversFrom(def: FighterDef, self: FighterState, stage: StageView, r: RecoveryMove | null, jumps: number, frame0: number, stageFrame0: number): boolean {
  if (isHelpless(self)) return false;
  if (overFloor(def, self, stage, frame0, stageFrame0)) return true;
  if (r === null) return false;
  const ledge = self.x < 0 ? stage.leftLedge : stage.rightLedge;
  if (upBPlan(self, ledge, stage, r, frame0) !== null) return true;
  if (self.jumpsUsed >= jumps) return false;
  const f = cloneFighter(self);
  const ctx = ghostContext(def, frame0, f);
  const toward = towardX(f.x, ledge);
  let prev: InputFrame = 0;
  for (let i = 1; i <= JUMP_APEX_FRAMES; i++) {
    const input = i === 1 ? toward | Btn.Jump : toward;
    ctx.frame = frame0 + i;
    ghostStep(f, input, prev, ctx);
    prev = input;
    if (i > 1 && f.vy <= 0) break;
  }
  return upBPlan(f, ledge, stage, r, ctx.frame) !== null;
}

/** UNVERIFIED (CPU judgement): the most frames `recoversFrom` follows a midair jump's rise. */
const JUMP_APEX_FRAMES = 60;

/**
 * Whether a travelling Final Smash, whiffed from here, ends where its user comes back
 * from (Plan 5 final wave 2, fix round 1, ruling R-FW2n, in place of part 1's R-FW1t, which
 * fired only where the whole whiff stayed on the floor and so never fired Volt Tackle):
 * judged by where it ends (`whiffEnd`), not by its path. On a floor, it fires; in the air,
 * if the CPU's own recovery model gets it back from there (`recoversFrom`); not past a
 * blast line, and not helpless. Of the roster's Final Smashes only Critical Hit and Volt
 * Tackle travel; Critical Hit's dash stops at the edge on the ground (`MoveDef.dashEnd.edge`),
 * so only Volt Tackle is judged here. (Part 1's scene, fox-pikachu@townAndCity, seed 97040:
 * a level-7 Pikachu at -45.3 facing left, whose dash took him off the left ledge and on
 * past the blast line: still not fired.)
 */
function whiffComesBack(ctx: BehaviourContext): boolean {
  const def = ctx.fighterDef;
  if (def === null) return false;
  const end = whiffEnd(def, ctx.view.self, ctx.stage, ctx.view.frame, ctx.state.stageFrame);
  if (end === null) return false;
  if (end.fighter.grounded) return true;
  return recoversFrom(def, end.fighter, ctx.stage, ctx.recovery, ctx.jumps, ctx.view.frame + end.steps, ctx.state.stageFrame + end.steps);
}

/* ----------------------------------------------------------- Smash Ball -- */

/**
 * UNVERIFIED (tuning): how high above the stage a CPU with no definition of its
 * own believes it can reach the Smash Ball. One with a definition reads its own
 * two jumps (`ballReach`).
 */
export const BALL_REACH_HEIGHT = fx(45);

/** UNVERIFIED (tuning): the frames ahead on its drift the CPU aims at the Smash Ball, about an aerial's startup. */
export const BALL_LEAD = 6;

/**
 * UNVERIFIED (CPU judgement): how near counts as there in the chase (the Task 19
 * review's M11): under the stage's top, at a ledge, at the ball's height, and under
 * it, where it stops walking.
 */
const BALL_NEAR = fx(4);

/**
 * UNVERIFIED (CPU judgement): the body's middle, above its feet, where a swing at the
 * ball is aimed from, and how far above or below it the ball has to be for an up or
 * a down aerial.
 */
const BALL_BODY = fx(6);

/** UNVERIFIED (CPU judgement): within this many of its pokes' reach (`meleeReach`) of the ball's x it jumps for it. */
const BALL_JUMP_REACHES = 2;

/** How high above the stage this fighter reaches: its full hop and its midair jump, and an attack's reach above that. */
export function ballReach(def: FighterDef | null): number {
  if (def === null) return BALL_REACH_HEIGHT;
  const p = fighterParams(def);
  return p.jump_y + p.jump_aerial_y + VERTICAL_REACH;
}

/**
 * Go and break the Smash Ball while nobody has its power: only one over the main
 * stage (it never leaves it: `simulate.ts`, `keepOverStage`) and within its own
 * two jumps of the stage (`ballReach`). On the ground it walks under it and
 * jumps for it, or swings at it at body height; in the air it drifts to it, jumps
 * again below it, and swings an aerial at it, an up aerial when the ball is above.
 * No roll: it is on screen for everybody, and nothing is decided that a level
 * would fumble twice.
 */
export const smashBall: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const ball = ctx.state.smashBall;
  if (!ball.active || !canAct(self) || ctx.state.fighters.some((f) => f.finalSmashReady > 0)) return NOTHING;
  if (isOffstage(self, ctx.stage) || self.y < ctx.stage.groundY - BALL_NEAR) return NOTHING;
  if (ball.x < ctx.stage.leftLedge || ball.x > ctx.stage.rightLedge || ball.y > ctx.stage.groundY + ballReach(ctx.fighterDef)) return NOTHING;
  // Where it will be when a swing comes out (`BALL_LEAD`), on its own drift: in
  // plain view. Measured from the middle of the body, where the swings are aimed.
  const bx = ball.x + ball.vx * BALL_LEAD - self.x;
  const by = ball.y + ball.vy * BALL_LEAD - (self.y + BALL_BODY);
  // Toward it, but never out past the ledge after it: the ball turns back there.
  const outward = (bx > 0 && self.x >= ctx.stage.rightLedge - BALL_NEAR) || (bx < 0 && self.x <= ctx.stage.leftLedge + BALL_NEAR);
  const toward = outward ? 0 : towardX(0, bx);
  const swinging = pulse(ctx.view.frame, self.port, 10, 3);
  const inReach = abs(bx) <= ctx.meleeReach && abs(by) <= VERTICAL_REACH;
  // Scored over a swing at the opponent (`attack`, 400-480): the ball is a Final
  // Smash, and it decays on its own while nobody commits to it (`simulate.ts`).
  const score = 420 + 60 * ctx.tuning.aggression;
  if (!self.grounded) {
    // The aerial that covers where it is: up, down, or all round the body.
    const aim = by > BALL_BODY ? Btn.Up : by < -BALL_BODY ? Btn.Down : 0;
    if (inReach) return { score: 490, input: aim | (swinging ? Btn.Attack : 0) };
    // UNVERIFIED (CPU judgement): its midair jump pressed two frames in eight, past its top.
    const again = by > VERTICAL_REACH && self.jumpsUsed < ctx.jumps && self.vy <= 0 && pulse(ctx.view.frame, self.port, 8, 2);
    return { score, input: toward | (again ? Btn.Jump : 0) };
  }
  if (inReach && by <= BALL_NEAR) {
    // Facing it first: a grounded turn is an input.
    if (bx * self.facing < 0) return { score: 490, input: toward };
    return { score: 490, input: swinging ? Btn.Attack : 0 };
  }
  const jump = by > BALL_NEAR && abs(bx) <= ctx.meleeReach * BALL_JUMP_REACHES && fullHopPulse(ctx.view.frame, self.port);
  return { score, input: (abs(bx) > BALL_NEAR ? toward : 0) | (jump ? Btn.Jump : 0) };
};

/* ----------------------------------------------------- reflect, counter -- */

/**
 * UNVERIFIED (tuning): the move frames after the reflector comes up the CPU aims a
 * projectile to meet it on (Fox's comes up on 4, Mario's Cape on 9).
 */
export const REFLECT_AIM = 2;

/**
 * Steps from now until `p` meets a bubble of `radius` at `bx, by`, or null if it
 * is moving away, still, or passes above or below it. Along its own `vx`, as it
 * flies straight; a falling or bouncing one is judged at its height now.
 */
export function framesToMeet(p: ProjectileState, pdef: ProjectileDef, bx: number, by: number, radius: number): number | null {
  if (p.vx === 0) return null;
  const reach = radius + pdef.hitbox.radius;
  if (abs(p.y - by) > reach) return null;
  const gap = bx - p.x;
  if (gap !== 0 && gap > 0 !== p.vx > 0) return null;
  const left = abs(gap) - reach;
  return left <= 0 ? 0 : Math.ceil(left / abs(p.vx));
}

/**
 * UNVERIFIED (CPU judgement): how much wider than its bubble a looping reflector
 * (Fox's) reads a projectile still coming at it, to keep holding it up.
 */
const REFLECT_HOLD_MARGIN = fx(4);

/**
 * Reflect a projectile about to arrive (Fox's Reflector, Mario's Cape): one its
 * data calls reflectable (`ProjectileDef.reflectable`; no Final Smash's is, being
 * unblockable). Decided once a projectile (rulings R-T18e, R-T19f): on the one frame
 * that brings the reflector up `REFLECT_AIM` frames before it meets the bubble, or,
 * one first seen already closer than that but not too close, on the frame it first
 * appears (age 0: a projectile is in the state from its first frame). The Cape, a
 * side special, is pressed toward the projectile, which turns Mario to it
 * (`beginSpecial`). Not from a run whose slide would carry it off (`slideStaysOn`).
 * Holding B keeps a reflector that loops up (Fox's), while a projectile still
 * comes.
 */
export const reflect: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const pick = specialWith(ctx.fighterDef, (m) => m.reflector !== undefined);
  if (pick === null) return NOTHING;
  const r = pick.move.reflector!;
  // Up already: a looping one is held while something still comes at it.
  if (inMove(self, pick.slot)) {
    if (r.loop === undefined) return NOTHING;
    const coming = ctx.state.projectiles.some((p) => {
      const pdef = p.owner === self.port ? undefined : projectileDefOf(ctx, p);
      return pdef?.reflectable === true && framesToMeet(p, pdef, self.x, self.y + r.y, r.radius + REFLECT_HOLD_MARGIN) !== null;
    });
    return coming ? { score: 640, input: pick.dir | Btn.Special } : NOTHING;
  }
  // Not off the stage: a reflector there spends the fall it has left.
  if (!free(self) || isOffstage(self, ctx.stage) || !slideStaysOn(ctx)) return NOTHING;
  for (const p of ctx.state.projectiles) {
    if (p.owner === self.port) continue;
    // Reflectable by its own data (a Final Smash's are not: SmashWiki "Unblockable attack").
    const pdef = projectileDefOf(ctx, p);
    if (pdef?.reflectable !== true) continue;
    const face = pick.slot === "sideB" ? (p.x >= self.x ? 1 : -1) : self.facing;
    const meets = framesToMeet(p, pdef, self.x + face * r.x, self.y + r.y, r.radius);
    if (meets === null) continue;
    const aim = r.active[0] + REFLECT_AIM;
    const timed = meets === aim || (p.age === 0 && meets >= r.active[0] && meets < aim);
    if (!timed) continue;
    if (!skilled(ctx)) return NOTHING;
    const stick = pick.slot === "sideB" ? towardX(self.x, p.x) : pick.dir;
    return { score: 640, input: stick | Btn.Special, decided: true };
  }
  return NOTHING;
};

/**
 * Counter a swing it sees coming (Marth's Counter), timed off the swing's move
 * data as the parry is (`swingHitFrame`): decided once a swing (rulings R-T18e,
 * R-T19f), on the counter's decision frame (`counterWait`, which `shield` reads too:
 * ruling R-T19l): the frame that puts its first hit `COUNTER_AIM` frames into the
 * counter's live frames, or, for a swing first seen with its hit already sooner than
 * that but still inside them, the frame it is first seen; never a frame the attacker
 * is frozen on. Before the shield (`BEHAVIOURS`): on that frame the counter decides
 * first, and the shield only if the counter didn't take the swing. Not a grab (it
 * goes through a counter) and not a Final Smash (SmashWiki "Unblockable attack":
 * "cannot be defended against with a shield or a counterattack"). Not from a run
 * whose slide would carry it off (`slideStaysOn`).
 */
export const counter: Behaviour = (ctx) => {
  const { self, target, distance, facingTarget } = ctx.view;
  const pick = specialWith(ctx.fighterDef, (m) => m.counter !== undefined);
  // Not off the stage: a counter there spends the fall it has left.
  if (pick === null || target === null || !free(self) || isOffstage(self, ctx.stage)) return NOTHING;
  if (distance > THREAT_RANGE || !facingTarget) return NOTHING;
  if (counterWait(ctx.view, ctx.matchDefs[target.port], pick.move.counter!) !== 0 || !slideStaysOn(ctx) || !skilled(ctx)) return NOTHING;
  return { score: 630, input: pick.dir | Btn.Special, decided: true };
};

/* ------------------------------------------------------------- charges -- */

/** UNVERIFIED (tuning): farther than this, a CPU with a stored charge to build charges it. */
export const CHARGE_FAR = fx(60);


/**
 * How far a projectile flies in its life: its speed a frame, a full charge's where
 * it has one (`ProjectileDef.charged`), gaining as it accelerates
 * (`ProjectileDef.accelerate`: the Super Missile), along its own way. One that runs
 * along the ground (`ProjectileDef.crawl`: Thunder Jolt), fired `grounded`, runs its
 * wave's life at its wave's speed (Plan 6, Task 16).
 */
export function projectileRange(p: ProjectileDef, full = false, grounded = true): number {
  if (grounded && p.crawl !== undefined) return p.crawl.speed * p.crawl.life;
  let speed = abs(full && p.charged !== undefined ? p.charged.vx : p.vx);
  let range = 0;
  for (let age = 1; age <= p.lifetime; age++) {
    if (p.accelerate !== undefined && age > p.accelerate.after) speed = Math.min(p.accelerate.maxSpeed, speed + p.accelerate.perFrame);
    range += speed;
  }
  return range;
}

/** How far a move hits: its boxes' reach, or its projectiles' flight (`projectileRange`), whichever is further. */
export function moveRange(move: MoveDef, full = false): number {
  let range = moveReach(move);
  for (const p of move.projectiles ?? []) range = Math.max(range, projectileRange(p, full));
  return range;
}

/**
 * Whether a move's release can hurt anybody: a box of its own or of a projectile it
 * launches that deals damage, not a windbox, which only pushes (F.L.U.D.D.'s water:
 * `mario.ts`, `waterPump`), nor a catch.
 */
function releaseHurts(move: MoveDef): boolean {
  const hurts = (hb: Pick<Hitbox, "damage" | "windbox" | "grabbing">) => hb.damage > 0 && hb.windbox !== true && hb.grabbing !== true;
  return move.hitboxes.some(hurts) || (move.projectiles ?? []).some((p) => hurts(p.hitbox));
}

/** The target in front, level, and within `range`: where a straight shot meets it. */
function linedUp(ctx: BehaviourContext, range: number): boolean {
  const { dx, dy, facingTarget } = ctx.view;
  return facingTarget && abs(dy) <= VERTICAL_REACH && abs(dx) <= range;
}

/**
 * Charges (Plan 5, Tasks 2-6, and Task 13's held smashes): what a CPU does with a
 * move that charges.
 *
 *  - **Stored charges** (Charge Shot, Giant Punch, F.L.U.D.D.; `StoreCharge`):
 *    with no full charge kept, it starts one while the opponent is far
 *    (`CHARGE_FAR`), lets the move build it, and puts it away with its shield if
 *    the opponent comes close (`storeMain`); with a full one kept, it lets it go
 *    lined up, inside the move's range (`moveRange`). Starting and firing are each
 *    one roll an opening. One whose release only pushes (`releaseHurts`: no box of
 *    it deals damage, F.L.U.D.D.'s water) it lets go only at an opponent off the
 *    stage, where a push is a gimp, and otherwise keeps (Plan 5 final wave: R-FW1c's
 *    probe had a Mario CPU charge and spray an idle player for 120 s without a hit).
 *  - **Held B charges** (`HoldCharge`) with a projectile (Hero's Bow): started the
 *    same way, lined up and far; held while the opponent stays out of reach and
 *    the charge is short of full, let go otherwise.
 *  - **Held smashes**: from the smash's own hold frame (`smashHoldFrame`) to the
 *    published most (`SMASH_CHARGE_MAX`), the attack button stays down while the
 *    opponent cannot act soon (`CANNOT_ACT_SOON`): a charge times itself on the
 *    move's own data. Read every frame of the charge, from the opponent as the CPU
 *    sees them then and its own charge; no roll.
 */
export const storeCharge: Behaviour = (ctx) => {
  const { self, target, targetAction, distance } = ctx.view;
  const def = ctx.fighterDef;
  if (def === null || !canAct(self) || target === null) return NOTHING;

  // A smash under way, its charge to decide.
  if (self.action === "attack" && self.move !== null && def.moves[self.move]?.chargeable === true) {
    const hold = smashHoldFrame(def, self);
    if (self.combat.smashLetGo || self.actionFrame > hold + SMASH_CHARGE_MAX) return NOTHING;
    const waiting = CANNOT_ACT_SOON.includes(targetAction) && self.charge < SMASH_CHARGE_MAX;
    return waiting ? { score: 485, input: Btn.Attack } : NOTHING;
  }

  const store = specialWith(def, (m) => m.specialCharge?.mode === "store");
  const bow = specialWith(def, (m) => m.specialCharge?.mode === "hold" && (m.projectiles?.length ?? 0) > 0);

  // In the charge already.
  for (const pick of [store, bow]) {
    if (pick === null || !inMove(self, pick.slot)) continue;
    const sc = pick.move.specialCharge!;
    if (sc.mode === "store") {
      // The move builds the charge on its own; put it away if the opponent closes in.
      return distance <= THREAT_RANGE ? { score: 470, input: Btn.Shield } : { score: 450, input: 0 };
    }
    const full = self.charge >= sc.frames;
    const keep = !full && distance > THREAT_RANGE;
    return { score: 450, input: keep ? pick.dir | Btn.Special : 0 };
  }

  if (!free(self) || !self.grounded || !opening(ctx)) return NOTHING;
  if (store !== null) {
    const sc = store.move.specialCharge!;
    const full = self.combat.storedCharge >= sc.frames;
    const pushOnly = !releaseHurts(store.move);
    if (full && linedUp(ctx, moveRange(store.move, true)) && (!pushOnly || isOffstage(target, ctx.stage))) return skilled(ctx) ? { score: 470, input: store.dir | Btn.Special } : NOTHING;
    if (!full && distance > CHARGE_FAR) return skilled(ctx) ? { score: 350, input: store.dir | Btn.Special } : NOTHING;
  }
  if (bow !== null && distance > CHARGE_FAR && linedUp(ctx, moveRange(bow.move))) {
    return skilled(ctx) ? { score: 350, input: bow.dir | Btn.Special } : NOTHING;
  }
  return NOTHING;
};

/**
 * A side special with a smash-input version (Plan 5, Task 13d: Samus's Super
 * Missile, Link's smash-thrown Boomerang; `MoveDef.smashInput`): thrown from a
 * standstill at an opponent lined up beyond close range and inside its flight,
 * as a flick toward them with B (a fresh direction, so within the move's own
 * window of it). One roll an opening. Not while one of its article is still out
 * (Link has one Boomerang).
 */
export const smashSpecial: Behaviour = (ctx) => {
  const { self, target, dx, dy, distance } = ctx.view;
  const side = ctx.fighterDef?.moves.sideB;
  const smash = side?.smashInput === undefined ? undefined : ctx.fighterDef?.moves[side.smashInput.slot];
  if (smash === undefined || target === null || !free(self) || !self.grounded) return NOTHING;
  // A standstill: no direction held, so the press toward the opponent is a fresh flick.
  if (self.action !== "stand" && self.action !== "crouch") return NOTHING;
  if (abs(dy) > VERTICAL_REACH || distance <= THREAT_RANGE || abs(dx) > moveRange(smash)) return NOTHING;
  const articles = new Set((smash.projectiles ?? []).map(articleOf));
  const out = ctx.state.projectiles.some((p) => {
    const pdef = p.owner === self.port ? projectileDefOf(ctx, p) : undefined;
    return pdef !== undefined && articles.has(articleOf(pdef));
  });
  if (out || !opening(ctx) || !skilled(ctx)) return NOTHING;
  return { score: 360, input: towardX(0, dx) | Btn.Special };
};

/* --------------------------------------------------- holding, being held -- */

/** UNVERIFIED (tuning): Donkey Kong carries his cargo this many frames, at most, toward the edge before he throws it. */
export const CARGO_CARRY_FRAMES = 40;

/** UNVERIFIED (tuning): closer to the ledge than this, he throws at once. */
export const CARGO_EDGE = fx(25);

/** UNVERIFIED (tuning): the chance a grab, each time the hold comes back, pummels rather than throws. */
export const PUMMEL_CHANCE = 0.5;

/**
 * UNVERIFIED (tuning): of the grabs that throw rather than pummel, the share a fighter whose
 * forward throw is a carry (`MoveDef.cargo`: Donkey Kong's Kong Karry) lifts, whichever way it
 * faces, and carries to the nearer edge (Plan 6, Task 25: in Plan 5's sweep he lifted only when
 * he had grabbed facing that edge, and never did).
 */
export const CARGO_CHANCE = 0.5;

/**
 * With a fighter on its shoulders, in its mouth or in its hands, do something
 * with them before they struggle free:
 *
 *  - **a carry** (Donkey Kong's Kong Karry, Plan 5, Task 8): walk toward the
 *    nearer edge, and throw toward it once there (`CARGO_EDGE`) or once the
 *    carry has lasted `CARGO_CARRY_FRAMES`; never off the floor it walks on, a
 *    platform's end included, a sweeping one's too (`carriesOff`, whoever presses the
 *    direction: Plan 5 final wave, part 5, and its fix round 1), so short of a
 *    platform's end it stands until it throws;
 *  - **a mouthful** (Kirby's Inhale, Task 9): one is taken from a standstill or
 *    the air at an opponent in front inside the move's own reach (`MoveDef.inhale`,
 *    its boxes' `moveReach`), one roll an opening; with them in his mouth, Kirby
 *    spits them out as a star when facing the nearer edge, else swallows them for
 *    their neutral special (a Kirby with a Copy Ability has no Inhale until he
 *    loses it: `cpuDef`);
 *  - **a grab**: one decision each time the hold comes back (its first frame):
 *    pummel (`PUMMEL_CHANCE`), or throw toward the nearer edge, forward or back;
 *    a carry's forward throw (`CARGO_CHANCE`) is lifted whichever way it faces.
 *    Decided, so the level's fumble cannot turn a throw into another pummel.
 *    Through the catch, each pummel and the throw it presses nothing, so no other
 *    behaviour's press waits in the buffer to decide for it (a buffered attack is
 *    a pummel, or out of Kong Karry's lift an instant cargo throw).
 */
export const holding: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const nearer = self.x < 0 ? ctx.stage.leftLedge : ctx.stage.rightLedge;
  const out = towardX(self.x, nearer);
  if (self.action === "cargoCarry") {
    const throwNow = abs(self.x - nearer) <= CARGO_EDGE || self.actionFrame >= CARGO_CARRY_FRAMES;
    return { score: 530, input: out | (throwNow && pulse(ctx.view.frame, self.port, 2, 1) ? Btn.Attack : 0) };
  }
  if (self.action === "inhaleHold") {
    const facingOut = (nearer - self.x) * self.facing > 0;
    return { score: 530, input: pulse(ctx.view.frame, self.port, 2, 1) ? (facingOut ? Btn.Attack : Btn.Special) : 0 };
  }
  if (self.action === "grab" || self.action === "pummel" || self.action === "throw" || (self.action === "grabHold" && self.actionFrame > 0)) return { score: 530, input: 0 };
  const inhale = ctx.fighterDef?.moves.neutralB;
  // From a standstill or the air, as above: on the ground at more than a walk's speed (a
  // dash, a run, the run's brake) the Inhale slides on that speed past an opponent it was
  // aimed at from in reach (Plan 5 final wave, fix round 1: kirby-marth@pokemonStadium2 off
  // the committed stages, a whiff every 64 frames; fix round 2, ruling R-FW1r: the slide
  // itself, not a list of the states that slide, so the run's brake too).
  const def = ctx.fighterDef;
  const sliding = self.grounded && def !== null && abs(self.vx) > fighterParams(def).walk_speed_max;
  if (inhale?.inhale !== undefined && free(self) && !sliding && opening(ctx)) {
    const { target, dx, dy, facingTarget } = ctx.view;
    const inReach = target !== null && facingTarget && abs(dy) <= VERTICAL_REACH && abs(dx) <= moveReach(inhale);
    // One the engine would catch (`inhaleMayCatch`: not on a ledge, nor a Kirby with a
    // mouthful; fix round 2: a Kirby inhaling at a Fox hanging on Final Destination's ledge,
    // 2,701 frames, once the point blank's unjudged swing no longer hit him after it).
    const targetDef = target === null ? undefined : ctx.matchDefs[target.port];
    const catchable = target !== null && (targetDef === undefined || inhaleMayCatch(self, target, targetDef));
    // Neither intangible nor invincible (ruling R-FW1r: a respawn's invincibility, which
    // the Inhale passed through 30 frames into it).
    if (inReach && catchable && target.intangible === 0 && target.invincible === 0 && target.grabbedBy < 0 && skilled(ctx)) return { score: 450, input: Btn.Special };
  }
  if (self.action === "grabHold") {
    if (ctx.rolls[ROLL_SPECIAL] < PUMMEL_CHANCE && ctx.fighterDef?.moves.pummel !== undefined) return { score: 530, input: Btn.Attack, decided: true };
    // A carry is lifted forward, whichever way he faces; the carry walks to the edge (Plan 6, Task 25).
    const lifts = ctx.fighterDef?.moves.fthrow?.cargo === true && ctx.rolls[ROLL_SPECIAL] < PUMMEL_CHANCE + (1 - PUMMEL_CHANCE) * CARGO_CHANCE;
    if (lifts) return { score: 530, input: self.facing > 0 ? Btn.Right : Btn.Left, decided: true };
    return { score: 530, input: out, decided: true };
  }
  return NOTHING;
};

/**
 * Whether `input`, pressed in a carry on the ground, walks Donkey Kong off the floor he stands
 * on (`leavesFloor`, whose copy carries the cargo, and for which any fall in a carry is leaving):
 * then its direction is not pressed, whoever asks for it (`decideCpu`; Plan 5 final wave, part 5,
 * the substitute confirm's out-of-range item 2). `holding` pressed toward the nearer ledge on
 * every frame of a carry, its throw only on its pulse's frames: in the part 5 sweep against
 * passive players, 123 of 711 carries walked off (one past Battlefield's ledge on the carry's
 * first frame, 122 off a side platform's end and on through the air with the walk's speed), and
 * Donkey Kong was KO'd after 9 of them; with this, none of 709.
 */
export function carriesOff(ctx: BehaviourContext, input: InputFrame): boolean {
  const { self } = ctx.view;
  if (self.action !== "cargoCarry" || !self.grounded || (input & (Btn.Left | Btn.Right)) === 0) return false;
  return leavesFloor(ctx, input);
}

/** Held, carried, in a mouth, on a star (`HELD_ACTIONS`, where `survive` is silent), or stunned with the shield broken: what a mash shortens. */
const MASHED: readonly ActionState[] = [...HELD_ACTIONS, "shieldBroken"];

/**
 * The frames between mash presses at this level. UNVERIFIED (tuning): a mash is
 * the same hand as SDI's (`sdiSkill`), from a press every 2 frames at the top to
 * one every 8 at the bottom.
 */
export function mashPeriod(sdiSkill: number): number {
  return 2 + Math.round((1 - sdiSkill) * 6);
}

/**
 * Mash out (SmashWiki "Grab": the grab period "can be decreased by button mashing";
 * "Shield break" for the stun): a shield press and a fresh direction, left and
 * right in turn, every `mashPeriod` frames. Shield rather than an attack, so a
 * press still in the buffer when it comes free is a shield, not a swing.
 * Not a Final Smash's trap, which no mash shortens.
 */
export const mash: Behaviour = (ctx) => {
  const { self } = ctx.view;
  if (!MASHED.includes(self.action)) return NOTHING;
  if (self.action === "shieldBroken" && !self.grounded) return NOTHING;
  const period = mashPeriod(ctx.tuning.sdiSkill);
  if (!pulse(ctx.view.frame, self.port, period, 1)) return { score: 1010, input: 0 };
  const side = Math.trunc(ctx.view.frame / period) % 2 === 0 ? Btn.Left : Btn.Right;
  return { score: 1010, input: Btn.Shield | side };
};

/* -------------------------------------------------------- side recovery -- */

/**
 * UNVERIFIED (tuning): how far below and above the stage's top a fighter is
 * "level with it", where a sideways recovery is tried: the plan's 15 below, and
 * 40 above rather than its 20, since a side special falls before it carries
 * (Fox Illusion 27 in its 17 frames of startup, `fox.ts`); its own path decides
 * whether it gets the fighter back.
 */
export const SIDE_RECOVER_BELOW = fx(15);
export const SIDE_RECOVER_ABOVE = fx(40);

/**
 * Recover sideways with a special that carries the fighter (Fox Illusion, Skull
 * Bash; `sideRecoveryFromDef`): off the stage, level with it, once the jumps are
 * gone, and only where the move's own path, run by the engine's rules as the up
 * special's is (`upBPath`, `upBInReach`), comes down on the stage or within a ledge
 * grab: a side special spent offstage that does not get the fighter back was a
 * self-destruct (Task 13b's classification). Before the up special, so the up
 * special is still there after it where the side special leaves the fighter free.
 *
 * One `recoverySkill` roll an offstage episode (ruling R-T19i, R-T18e's one-roll
 * rule; the Task 19 review's M3): on the first frame of its window, the first its
 * path gets it back, decided, so no jitter or fumble undoes it; a failed roll leaves
 * the episode to the up special. The frame before is rebuilt one frame back on the
 * fighter's own velocity, as `threatBefore` rebuilds a threat (`sideBefore`).
 */
export const sideRecover: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const side = ctx.fighterDef === null ? null : sideRecoveryFromDef(ctx.fighterDef);
  if (side === null || !sideWindow(ctx, self)) return NOTHING;
  const ledge = self.x < 0 ? ctx.stage.leftLedge : ctx.stage.rightLedge;
  const toward = towardX(self.x, ledge);
  if (!upBInReach(self, ledge, ctx.stage, side, toward, ctx.view.frame)) return NOTHING;
  const before = sideBefore(ctx, self);
  if (before !== null && sideWindow(ctx, before) && upBInReach(before, ledge, ctx.stage, side, toward, ctx.view.frame - 1)) return NOTHING;
  if (ctx.rolls[ROLL_SPECIAL] >= ctx.tuning.recoverySkill) return NOTHING;
  return { score: 960, input: side.press!(toward), decided: true };
};

/** The side special's window, but for its path: free, in the air, off the stage, its jumps gone, level with the stage's top (`SIDE_RECOVER_BELOW`, `SIDE_RECOVER_ABOVE`). */
function sideWindow(ctx: BehaviourContext, f: FighterState): boolean {
  if (!free(f) || f.grounded || !isOffstage(f, ctx.stage) || f.jumpsUsed < ctx.jumps) return false;
  return f.y >= ctx.stage.groundY - SIDE_RECOVER_BELOW && f.y <= ctx.stage.groundY + SIDE_RECOVER_ABOVE;
}

/**
 * The fighter the frame before, one step back (`stepBack`), where it can be told it
 * was in the same window: the same action, a frame younger; or, on a fall's
 * first frame, the jump it came over the top of (`airMain` turns a jump into a fall
 * at the top: the fall's speed is then one to two frames of gravity), with no jump of
 * its own spent since. Null where it was in another action (a jump's first frame
 * spends one; a fall begun out of a move, a dodge or a reel): the window opens now.
 */
function sideBefore(ctx: BehaviourContext, f: FighterState): FighterState | null {
  if (ctx.fighterDef === null) return null;
  const back = stepBack(ctx.fighterDef, f);
  if (f.actionFrame > 0) return { ...back, actionFrame: f.actionFrame - 1 };
  if (f.action !== "fall") return null;
  const g = fighterParams(ctx.fighterDef).air_accel_y;
  return f.vy <= -g && f.vy > -2 * g ? { ...back, action: "jump" } : null;
}

/**
 * The fighter one step back, by the engine's own step (R-T19i's rebuild): where it was
 * (`integrate` moved it by this step's speed) and how fast it moved then. Gravity's step
 * is given back to its fall (`gravityStep`: none at its top fall speed or a fast
 * fall's, where it already was), and its launch's decay (`LAUNCH_SPEED_DECAY`) to the
 * launch. The stick that step isn't kept anywhere; it is taken as held toward the
 * nearer ledge, as `recover` holds it off the stage, so one step of air acceleration
 * (`airControlX`) comes back off the drift, none at its top speed, where it already was.
 */
function stepBack(def: FighterDef, f: FighterState): FighterState {
  const p = fighterParams(def);
  const k = f.kinetic;
  const terminal = f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable;
  const gravityY = k.gravityY > -terminal ? k.gravityY + p.air_accel_y : k.gravityY;
  const launch = f.launchSpeed > 0 ? f.launchSpeed + LAUNCH_SPEED_DECAY : 0;
  const scale = (v: number) => (f.launchSpeed > 0 ? Math.trunc((v * launch) / f.launchSpeed) : v);
  const home = f.x < 0 ? 1 : -1;
  const capped = home > 0 ? k.controlX >= p.air_speed_x_stable : k.controlX <= -p.air_speed_x_stable;
  const controlX = capped ? k.controlX : k.controlX - home * (p.air_accel_x_add + p.air_accel_x_mul);
  const kinetic = { ...k, gravityY, controlX, damageX: scale(k.damageX), damageY: scale(k.damageY) };
  return {
    ...f,
    x: f.x - f.vx,
    y: f.y - f.vy,
    vx: kinetic.controlX + kinetic.stopX + kinetic.motionX + kinetic.damageX,
    vy: kinetic.gravityY + kinetic.motionY + kinetic.damageY,
    launchSpeed: launch,
    kinetic,
    airTime: Math.max(0, f.airTime - 1),
  };
}
