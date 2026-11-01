/**
 * The CPU's recovery (Plan 5 final wave, ruling R-FW1j: split out of `behaviours.ts`):
 * its model of its own up special and of its own fall, run by the engine's own rules on a
 * copy of the fighter (`ghostStep`, `upBPath`, `upBReach`, `upBPlan`, `ghostFall`,
 * `framesToFloor`, `framesToWall`), whether an aerial near the edge strands it
 * (`aerialStrands`), and `recover`, the behaviour that gets it back to the stage.
 *
 * The rules `behaviours.ts` sets out hold here: no unseeded randomness and no wall clock
 * (every roll from `ctx.rolls`), and the opponent seen only through `ctx.view`.
 */

import {
  Btn,
  CONTROL_STICK_JUMP_OFF,
  type ActionState,
  type FighterDef,
  type FighterState,
  type InputFrame,
  type MoveSlot,
  type StageDef,
} from "@/engine/types";
import { cloneFighter } from "@/engine/simulate";

import { advanceFighter, applyMovement, interpretInput, updateInputTracking, type StateContext } from "@/engine/states";
import { HARD_PLATFORM_DEPTH, integrate, platformCentreX } from "@/engine/physics";
import { WALL_JUMP_WINDOW, WALL_TECH_JUMP_FRAMES } from "@/engine/wallJump";

import { airDodgeFrames } from "@/engine/airDodge";

import { BUFFER_FRAMES, LAUNCH_SPEED_DECAY, LEDGE_GRAB_BACK_PENALTY, LEDGE_GRAB_RANGE_X, LEDGE_GRAB_RANGE_Y, TAP_JUMP_FRAMES } from "@/engine/constants";
import { ONE, abs, fx, mul } from "@/engine/fixed";
import { fighterParams } from "@/engine/params";

import {
  type Behaviour,
  type BehaviourContext,
  type BehaviourResult,
  canAct,
  dodgeCarriesOffstage,
  fullHopPulse,
  isHelpless,
  isOffstage,
  LEDGE_OPTIONS,
  pulse,
  type RecoveryMove,
  ROLL_RECOVER,
  type StageView,
  towardX,
} from "./behaviours";

const NOTHING: BehaviourResult = { score: 0, input: 0 };

/**
 * A fighter's up special as `recover` judges it, or null when it has none. Its
 * movement is no longer read off a momentum list (Task 13 put moves on their
 * scripts, and Task 13b gave up specials launches, phases and aims): the model
 * runs the move itself, so a move whose data changes keeps a working model.
 */
export function recoveryFromDef(def: FighterDef): RecoveryMove | null {
  const slot: MoveSlot = def.moves.upBAir !== undefined ? "upBAir" : "upB";
  const move = def.moves[slot];
  if (move === undefined) return null;
  const p = fighterParams(def);
  const second = (move.momentum ?? []).find((w) => w.second === true);
  return {
    def,
    slot,
    totalFrames: move.fromAir?.totalFrames ?? move.totalFrames,
    params: p,
    helplessDrift: mul(p.air_speed_x_stable, move.helpless?.airSpeed ?? ONE),
    aim: move.aim?.kind ?? "none",
    secondAim: second?.aimAt ?? 0,
    wallJump: def.attributes.canWallJump,
  };
}

/** One frame of an up special's path: where the fighter is, relative to where it was, its vertical speed, its facing, and whether it is helpless. */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
  readonly vy: number;
  readonly facing: number;
  readonly helpless: boolean;
}

/**
 * A fighter's side special as a sideways recovery (Plan 5, Task 19), modelled as
 * `recoveryFromDef` models its up special, or null when its side special carries
 * it nowhere (no `MoveDef.momentum` window with a sideways speed: Samus's
 * Missile, Link's Boomerang). Pressed with its side and B, never Up or Down
 * (`specialSlot`); held toward the ledge through it.
 */
export function sideRecoveryFromDef(def: FighterDef): RecoveryMove | null {
  const move = def.moves.sideB;
  if (move === undefined || !(move.momentum ?? []).some((w) => w.x !== 0)) return null;
  const p = fighterParams(def);
  return {
    def,
    slot: "sideB",
    totalFrames: move.fromAir?.totalFrames ?? move.totalFrames,
    params: p,
    helplessDrift: mul(p.air_speed_x_stable, move.helpless?.airSpeed ?? ONE),
    aim: "none",
    secondAim: 0,
    wallJump: def.attributes.canWallJump,
    press: (stick) => (stick & (Btn.Left | Btn.Right)) | Btn.Special,
  };
}

/**
 * The stick through an up special: `first` held until the move reaches move
 * frame `switchAt`, then `then` (a second leg aimed another way); the same for
 * a move with one aim. Direction bits only.
 */
export interface UpBStick {
  readonly first: InputFrame;
  readonly then: InputFrame;
  readonly switchAt: number;
}

const one = (stick: InputFrame): UpBStick => ({ first: stick, then: stick, switchAt: 0 });

/** No floor, no ledge, no blast line in reach: the move's own path and nothing else. */
const GHOST_STAGE: StageDef = {
  id: "upBGhost",
  name: "up special path",
  series: "",
  platforms: [],
  blastZone: { left: -fx(100_000), right: fx(100_000), top: fx(100_000), bottom: -fx(100_000) },
  spawns: [{ x: 0, y: 0 }],
  theme: "",
};

/** A ghost run's `StateContext`: `step()`'s for one fighter alone on `GHOST_STAGE`, its `frame` set by the caller each step. */
export type GhostContext = { -readonly [K in keyof StateContext]: StateContext[K] };

export function ghostContext(def: FighterDef, frame: number, f: FighterState): GhostContext {
  return { def, stage: GHOST_STAGE, frame, fighters: [f] };
}

/**
 * One step of a copy of a fighter by `step()`'s own per-frame rules for one fighter
 * alone in the air: the one copy of them that every model run steps (Plan 5, Task 19
 * fix round 1, the review's M7: `upBPath`, `ghostFall`, `aerialStrands`,
 * `freeNextStep`). In `step()`'s order: the input read (`updateInputTracking`,
 * `interpretInput`), the hitstun counted down before the status, as `step()` counts
 * it (the review's M7: two of the four copies had left this out), the airtime, the
 * status (`advanceFighter`), the movement (`applyMovement`) and the move
 * (`integrate`), on the step `ctx.frame` runs. Left out, as no ghost run meets them:
 * a freeze (none starts in hitlag, and nothing hits a ghost), and the bookkeeping
 * `step()` does as a hitstun runs out (`comboHits`, `balloon`), which moves nothing
 * (the fall reads `balloon` only while the hitstun lasts: `hitstunGravityOptions`).
 */
export function ghostStep(f: FighterState, input: InputFrame, prev: InputFrame, ctx: GhostContext): void {
  updateInputTracking(f, input, prev);
  const intent = interpretInput(f, input, prev);
  if (f.hitstun > 0) f.hitstun -= 1;
  if (!f.grounded && f.ledge === null) f.airTime += 1;
  advanceFighter(f, intent, ctx);
  applyMovement(f, intent, ctx);
  integrate(f);
}

/** Whether `f` is in the special `r` models: its up special (either version), or its side special for a sideways one. */
function inUpB(f: Pick<FighterState, "action" | "move">, r: RecoveryMove): boolean {
  return f.action === "special" && (f.move === r.slot || (r.slot === "upBAir" && f.move === "upB"));
}

/**
 * Where the up special takes the fighter, frame by frame, for `frames` frames:
 * started on the first of them (Up and Special pressed with `stick`'s first
 * direction), or carried on from where it is if the fighter is already in it,
 * then the helpless fall. Each frame is `step()`'s for one fighter alone in the
 * air, on a copy (`ghostStep`). Not modelled: a hit, a landing, a ledge or a wall on
 * the way (the caller reads those off the path); a blast line is the caller's
 * too. `stop`, if given, ends the path at the first point it accepts.
 */
export function upBPath(
  r: RecoveryMove,
  self: FighterState,
  stick: UpBStick | InputFrame,
  frames: number,
  frame0 = 0,
  stop?: (p: PathPoint) => boolean,
): PathPoint[] {
  const plan = typeof stick === "number" ? one(stick) : stick;
  const f = cloneFighter(self);
  // The frame number is the one thing that changes: the buffer reads it.
  const ctx = ghostContext(r.def, frame0, f);
  const started = inUpB(f, r);
  // The move frame the next step runs: the press is move frame 1.
  let moveFrame = started ? f.actionFrame + 2 : 1;
  let prev: InputFrame = 0;
  const out: PathPoint[] = [];
  for (let i = 0; i < frames; i++) {
    const dir = moveFrame >= plan.switchAt && plan.switchAt > 0 ? plan.then : plan.first;
    const input = i === 0 && !started ? (r.press ?? upBPress)(dir) : dir;
    ctx.frame = frame0 + i + 1;
    ghostStep(f, input, prev, ctx);
    prev = input;
    moveFrame += 1;
    const p = { x: f.x - self.x, y: f.y - self.y, vy: f.vy, facing: f.facing, helpless: f.action === "specialFall" };
    out.push(p);
    if (stop?.(p) === true) break;
  }
  return out;
}

/**
 * The sticks worth holding through the up special, toward the ledge first
 * (`toward` −1 or 1): one side or none for a move the stick only drifts, turns
 * or tilts; the octants that lead toward the stage for one it aims (Fox); and
 * for one with two legs (Pikachu), pairs of them, the second turned from the
 * first, after one leg alone. Few on purpose: each is a run of the move.
 */
export function upBSticks(r: RecoveryMove, toward: number): UpBStick[] {
  const T: InputFrame = toward > 0 ? Btn.Right : Btn.Left;
  const A: InputFrame = toward > 0 ? Btn.Left : Btn.Right;
  if (r.aim === "octant") return [T | Btn.Up, T, Btn.Up, T | Btn.Down, 0].map(one);
  if (r.aim === "legs") {
    const firsts: InputFrame[] = [T | Btn.Up, Btn.Up, T];
    const out: UpBStick[] = [];
    for (const first of firsts) for (const then of [T | Btn.Up, T, Btn.Up]) if (then !== first) out.push({ first, then, switchAt: r.secondAim });
    return [...out, ...firsts.map(one)];
  }
  return [T, 0, A].map(one);
}

/**
 * The press that starts the up special, with a plan's stick (ruling R-T13b-c): its
 * side, Up and Special, never Down. Up and Down cancel (`stickY` 0), so a press with
 * both is a side special: Fox's `T | Down` plan pressed whole came out as Fox Illusion
 * (the Task 13b review's I-1). The plan's Down is held from the move's second frame
 * on, which is where Fire Fox reads its aim (`upSpecial.ts`).
 */
export function upBPress(stick: InputFrame): InputFrame {
  return upBHold(stick) | Btn.Special;
}

/** A plan's stick with Up and without Down: what the CPU holds until its up special comes out (ruling R-T13b-c). */
export function upBHold(stick: InputFrame): InputFrame {
  return (stick & ~Btn.Down) | Btn.Up;
}

/** The stick a plan holds on the move frame the fighter's next step runs (its first, outside the move). */
export function upBStickNow(plan: UpBStick, self: FighterState, r: RecoveryMove): InputFrame {
  const next = inUpB(self, r) ? self.actionFrame + 2 : 1;
  return plan.switchAt > 0 && next >= plan.switchAt ? plan.then : plan.first;
}

/**
 * How many steps from now this fighter's fall meets a floor, if it does within
 * `horizon`, or null. The fall is the engine's own: a copy of the fighter run
 * through `step()`'s per-frame rules for one fighter alone in the air, with
 * `stick` held and nothing else pressed (as `upBPath` runs an up special), so
 * with that stick held the count goes down by exactly one a frame (`tech` holds
 * it; ruling R-T18i); `fresh`, pressed now rather than held from before (a fast
 * fall's Down). A floor is the stage between its ledges or a soft platform, met
 * coming down on its span, ends included, as the engine lands a body
 * (`resolveCollision`), a sweeping platform where the stage's clock will have it.
 * Not modelled: the ECB's bottom (the origin lands).
 */
export function framesToFloor(def: FighterDef, self: FighterState, stage: StageView, frame0: number, horizon: number, stageFrame0 = 0, stick: InputFrame = 0, fresh = false): number | null {
  return floorContact(def, self, stage, frame0, horizon, stageFrame0, stick, fresh)?.frames ?? null;
}

/**
 * `framesToFloor`'s fall, and the launch's speed on the step that meets the floor,
 * as the engine reads it there (`launchBefore`, before the collision): a window's
 * press techs no contact faster than `TECH_FLOOR_MAX_SPEED` (`techOrBounce`).
 */
export function floorContact(def: FighterDef, self: FighterState, stage: StageView, frame0: number, horizon: number, stageFrame0 = 0, stick: InputFrame = 0, fresh = false): { readonly frames: number; readonly speed: number } | null {
  // The highest surface it could come down on within `horizon`: one under it, or
  // one no higher than its rise can take it (a soft platform, or the stage from off
  // its side), which a fall from under that height lands on on the way down. Out of
  // reach of the fastest fall those frames allow, there is nothing to run. Gravity
  // and a launch's decay each speed a fall by at most their own whole rate a frame,
  // and a fresh fast fall starts at the fast-fall speed, so the bound needs no
  // rounding room (a launch's speed-up runs faster, so then the fall is run).
  const params = fighterParams(def);
  const top = self.y + Math.max(0, self.vy) * horizon;
  let surface: number | null = top >= stage.groundY ? stage.groundY : null;
  for (const p of stage.platforms) if (p.y <= top && (surface === null || p.y > surface)) surface = p.y;
  if (surface === null) return null;
  if (self.kinetic.speedUpMax <= 0) {
    const accel = params.air_accel_y + LAUNCH_SPEED_DECAY;
    const down = Math.max(0, -self.vy, fresh && (stick & Btn.Down) !== 0 ? params.dive_speed_y : 0);
    const reach = horizon * down + (accel * horizon * (horizon + 1)) / 2;
    if (self.y - surface > reach) return null;
  }
  let speed = 0;
  const frames = ghostFall(def, self, frame0, horizon, (prevX, prevY, f, k) => {
    speed = f.launchSpeed;
    return f.y < prevY && landsOn(f.x, prevY, f.y, stage, stageFrame0 + k);
  }, stick, fresh ? 0 : stick);
  return frames === null ? null : { frames, speed };
}

/** UNVERIFIED (CPU judgement): the frames of its own fall `overFloor` runs, past a fall from any stage's top platform to the one under it. */
export const FLOOR_FALL_FRAMES = 90;

/**
 * Whether this fighter, in the air, is over a floor its own fall comes down on (Plan 5
 * final wave, fix round 2, ruling R-FW1p): `floorStick` has a stick for it.
 */
export function overFloor(def: FighterDef, self: FighterState, stage: StageView, frame0: number, stageFrame0 = 0): boolean {
  return floorStick(def, self, stage, frame0, stageFrame0) !== null;
}

/**
 * The stick that brings this fighter's own fall down on a floor, or null (Plan 5 final
 * wave, fix round 2, ruling R-FW1p): the stage between its ledges or a soft platform,
 * read as `framesToFloor` reads it, within `FLOOR_FALL_FRAMES`. Nothing held (0) if that
 * lands, else the stick held toward the stage's middle if that does, which takes the
 * drift it carries off (a fighter drifting out over a platform it would overshoot with
 * the stick let go). Then it is not recovering, wherever it is in x: past the main ledge
 * over Town & City's outer platforms (`isOffstage` reads x alone) the fall lands on the
 * platform. The floor is there for that stick only, so `recover` holds it (fix round 3,
 * ruling R-FW1v: credited the inward stick and held neutral, Dolphin Slash angled out
 * past the platform's end). Pure, and run only over a floor's span (a sweeping platform
 * where the stage's clock has it), a little wider for the drift.
 */
export function floorStick(def: FighterDef, self: FighterState, stage: StageView, frame0: number, stageFrame0 = 0): InputFrame | null {
  if (self.grounded) return 0;
  const spans = (x: number) =>
    (x >= stage.leftLedge && x <= stage.rightLedge && self.y >= stage.groundY) ||
    stage.platforms.some((p) => p.y <= self.y && abs(x - platformCentreX(p, stageFrame0)) <= p.halfWidth + FLOOR_DRIFT);
  if (!spans(self.x)) return null;
  const inward = towardX(self.x, Math.trunc((stage.leftLedge + stage.rightLedge) / 2));
  for (const stick of [0, inward]) if (framesToFloor(def, self, stage, frame0, FLOOR_FALL_FRAMES, stageFrame0, stick) !== null) return stick;
  return null;
}

/** UNVERIFIED (CPU judgement): how far past a floor's span `overFloor` still runs the fall, for the drift it carries. */
const FLOOR_DRIFT = fx(10);

/**
 * How many steps from now this fighter's fall, run as `framesToFloor` runs it,
 * meets the main stage's side, under its top (Plan 5, Task 19: a wall tech, the
 * Task 18 review's carry), if it does within `horizon`, or null. The side is the
 * ledge's x, from the top down `HARD_PLATFORM_DEPTH`; met from outside it. Not
 * modelled, as there: the ECB's half-width (the origin meets it).
 */
export function framesToWall(def: FighterDef, self: FighterState, stage: StageView, frame0: number, horizon: number): number | null {
  const under = (y: number) => y < stage.groundY && y > stage.groundY - HARD_PLATFORM_DEPTH;
  if (!isOffstage(self, stage) || self.y >= stage.groundY) return null;
  return ghostFall(def, self, frame0, horizon, (prevX, _prevY, f) => {
    const left = prevX < stage.leftLedge && f.x >= stage.leftLedge;
    const right = prevX > stage.rightLedge && f.x <= stage.rightLedge;
    return (left || right) && under(f.y);
  });
}

/**
 * A copy of the fighter run through `step()`'s per-frame rules for one fighter
 * alone in the air (`ghostStep`) with `stick` held and nothing else pressed (as
 * `upBPath` runs an up special), until `meets` accepts a frame, `k` steps on: that `k`, or null
 * within `horizon`. `before` is what was held the frame before now: the stick
 * itself, held from before, or nothing, for a fresh press.
 */
function ghostFall(def: FighterDef, self: FighterState, frame0: number, horizon: number, meets: (prevX: number, prevY: number, f: FighterState, k: number) => boolean, stick: InputFrame = 0, before: InputFrame = stick): number | null {
  const f = cloneFighter(self);
  const ctx = ghostContext(def, frame0, f);
  for (let k = 1; k <= horizon; k++) {
    const prevX = f.x;
    const prevY = f.y;
    ctx.frame = frame0 + k;
    ghostStep(f, stick, k === 1 ? before : stick, ctx);
    if (meets(prevX, prevY, f, k)) return k;
  }
  return null;
}

/**
 * Whether a body moving down from `prevY` to `y` at `x` meets the stage or a soft
 * platform, a sweeping one where the stage's clock has it (`platformCentreX`).
 */
export function landsOn(x: number, prevY: number, y: number, stage: StageView, stageFrame: number): boolean {
  const crosses = (surface: number) => prevY >= surface && y <= surface;
  if (x >= stage.leftLedge && x <= stage.rightLedge && crosses(stage.groundY)) return true;
  return stage.platforms.some((p) => abs(x - platformCentreX(p, stageFrame)) <= p.halfWidth && crosses(p.y));
}

/**
 * Get back to the stage. Jump while jumps remain, up-B once they do not — and
 * at low levels, sometimes neither, which is where level-1 CPUs go to die. A
 * fighter that can wall jump kicks off the stage's wall first, where it is close
 * under the ledge; the up special is pressed with the stick its own path says
 * gets the fighter back, and that stick is held through it (Plan 5, Task 13b).
 */
export const recover: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const { stage, tuning } = ctx;

  // Helpless (Plan 5, Task 4b): the up special is spent and nothing else comes
  // out, so all that is left is to drift home, at every level, as the air
  // dodge's steering below is. Never down: a fast fall is all it could add.
  if (isHelpless(self)) {
    const home = isOffstage(self, stage) || self.y < stage.groundY ? (self.x < 0 ? stage.leftLedge : stage.rightLedge) : 0;
    return { score: 950, input: towardX(self.x, home) };
  }
  if (!canAct(self)) return NOTHING;

  // A wall tech's first frames (Plan 5, Task 10; the Task 10 review's carry): a
  // jump input then, the button or Up held, kicks off the wall as a wall tech
  // jump (`tryWallTechJump`), which rises and spends no jump. Below the ledge
  // that is height the fighter needs, so it holds jump; anywhere else it holds
  // neither jump nor Up, which another behaviour's Up would turn into one. The
  // press is read on the next step, one frame further into the tech
  // (`advanceFighter`). Recovery judgement, so a failed roll forgets it, as the
  // jump back is forgotten below.
  if (self.action === "techWall" && self.actionFrame < WALL_TECH_JUMP_FRAMES) {
    const helps = self.y < stage.groundY && ctx.rolls[ROLL_RECOVER] < tuning.recoverySkill;
    return { score: 950, input: helps ? Btn.Jump : 0 };
  }

  if (self.action === "ledgeHang") {
    // Climbing costs nothing and the ledge regrab limit is six, so there is no
    // level at which hanging forever is the right answer.
    return { score: 700, input: pulse(ctx.view.frame, self.port, 12, 4) ? Btn.Up : 0 };
  }

  // In an air dodge the fighter cannot act until it ends, and a neutral one
  // keeps falling (Plan 3, Task 20b): whatever else it was chasing, it steers
  // back over the stage rather than drifting out past the ledge, judged over
  // the frames its own dodge has left (Task 20c). Steering is drift, which this
  // behaviour does at every level (the level-1 failure below is the button,
  // not the stick), so it is not gated by `recoverySkill` either.
  if (self.action === "airDodge") {
    const left = airDodgeFrames(ctx.airDodge, self.charge) - self.actionFrame;
    if (dodgeCarriesOffstage(self, stage, ctx.airBrake, left)) return { score: 900, input: towardX(self.x, 0) };
  }

  const offstage = isOffstage(self, stage);
  const belowStage = self.y < stage.groundY - fx(4);
  const r = ctx.recovery;

  // In its own up special (Plan 5, Task 13b): the stick aims the move and steers
  // it, so this behaviour keeps it whatever else would press. Off the stage it
  // holds the stick that, run on from here, gets it back (`upBPlan`), or with none
  // that does the first of them, toward the stage; over the stage, none, so the
  // move flies as authored and nothing aims it off (a second leg pressed away by
  // another behaviour once took a Pikachu off Battlefield). At every level: like
  // the helpless drift above, it is steering, not the button. Decided (Task 19):
  // the up special's stick was chosen when it was pressed, and a level's fumble
  // dropping it on an aim frame threw the move away (the Task 13b sweep's level-7
  // self-destruct).
  const nearer = self.x < 0 ? stage.leftLedge : stage.rightLedge;
  const ledgeFree = !ledgeHeldInOption(ctx, nearer);
  // Over a floor its own fall lands on, it is not recovering, wherever it is in x (Plan 5
  // final wave, fix round 2, ruling R-FW1p: Town & City's outer platforms), and it holds
  // the stick that fall was run with (`floorStick`; fix round 3, ruling R-FW1v). In its
  // up special it holds that stick, decided. Out of it, a floor the fall lands on with the
  // stick let go leaves the fight to the other behaviours, as before, and one it lands on
  // only with the stick held inward, it holds inward itself. So no floor is credited to a
  // stick nothing holds: in the up special the stick is decided, and out of it the read
  // runs again on every step from wherever another behaviour's stick has taken the fall,
  // with the jump and the up special still there.
  const floor = !self.grounded && (offstage || belowStage) && ctx.fighterDef !== null ? floorStick(ctx.fighterDef, self, stage, ctx.view.frame, ctx.state.stageFrame) : null;
  if (r !== null && inUpB(self, r)) {
    if (self.grounded || (!offstage && !belowStage)) return { score: 950, input: 0, decided: true };
    if (floor !== null) return { score: 950, input: floor, decided: true };
    const toward = nearer > self.x ? 1 : -1;
    const plan = upBPlan(self, nearer, stage, r, ctx.view.frame, ledgeFree) ?? upBSticks(r, toward)[0];
    return { score: 950, input: upBStickNow(plan, self, r), decided: true };
  }

  if (self.grounded || (!offstage && !belowStage) || floor === 0) return NOTHING;
  if (floor !== null) return { score: 900, input: floor };

  const nearerLedge = nearer;
  const drift = towardX(self.x, nearerLedge);

  // The level-1 self-destruct, made explicit rather than emergent: it drifts
  // back but forgets the button, runs out of altitude and dies. At level 9 the
  // roll never fails. A per-frame reaction delay (ruling R-T19j): each frame off the
  // stage it may forget, so a low level acts late, by when the stage is out of reach.
  if (ctx.rolls[ROLL_RECOVER] >= tuning.recoverySkill) {
    return { score: 900, input: drift };
  }

  // A wall jump first, where the fighter can make one: touching the stage's wall
  // below the ledge, falling, it presses away from the wall (Plan 5, Task 13b; the
  // Task 10 review). It gains height and costs no jump, and special fall refuses
  // one (SmashWiki "Helpless", https://www.ssbwiki.com/Helpless: "unable to take
  // any action"), so it has to come before the up special.
  // Only from a jump or a fall, where the engine tries one (`airMain`; Task 19: in
  // an aerial the press away did nothing and held off the up special's, which
  // then ran out of the buffer).
  const side = self.combat.wallSide;
  const canKick = self.action === "jump" || self.action === "fall";
  if (r !== null && r.wallJump && canKick && side !== 0 && self.combat.wallFrames <= WALL_JUMP_WINDOW && self.vy <= 0 && self.y < stage.groundY) {
    return { score: 950, input: side < 0 ? Btn.Right : Btn.Left };
  }

  // ...and close to the wall under the ledge, it drifts into it to kick off it
  // rather than spend the up special, unless waiting is no longer safe.
  const underLedge = self.y < stage.groundY - fx(4) && self.y > stage.groundY - HARD_PLATFORM_DEPTH;
  if (r !== null && r.wallJump && canKick && underLedge && abs(self.x - nearerLedge) <= WALL_SEEK_RANGE && !upBNowOrNever(self, stage, r, ctx.view.frame)) {
    return { score: 950, input: drift };
  }

  const outOfJumps = self.jumpsUsed >= ctx.jumps;
  const deep = self.y < stage.groundY - fx(20);

  const jumping = fullHopPulse(ctx.view.frame, self.port);

  // Up-B is the last resource, so it is spent only when the jump is gone or
  // the fighter is already too low for a jump alone to reach the ledge. It
  // leaves the fighter helpless (Plan 5, Task 4b), so it is spent once the
  // ledge is in its reach, or as soon as waiting longer would put the ledge
  // out of it; until then the fighter drifts closer, and jumps if it can.
  if (outOfJumps || deep) {
    // The stick it would hold through the up special, read off the move's own path
    // (Plan 5, Task 13b: `upBPlan`), and pressed with it as the move starts. A
    // ledge held in a ledge option is no grab (Task 19: `ledgeHeldInOption`).
    const plan = r === null ? null : upBPlan(self, nearerLedge, stage, r, ctx.view.frame, ledgeFree);
    if (r !== null && plan === null) {
      // No stick gets it back yet. Waiting is safe until it is now or never; and
      // with its midair jump still there, it jumps first, whatever (Task 19, the
      // Task 13b review's M-11: up specials spent now or never with the jump unused).
      if (!outOfJumps) {
        // UNVERIFIED (CPU judgement): now or never, a jump pressed every other frame.
        const now = upBNowOrNever(self, stage, r, ctx.view.frame) ? pulse(ctx.view.frame, self.port, 2, 1) : jumping;
        return { score: 950, input: drift | (now ? Btn.Jump : 0) };
      }
      // Still rising (a jump just spent): every frame up is height the up special
      // starts from, and it sets its own launch when it comes out, so it waits for
      // the top (Task 19: the sweep's up specials spent three frames into the jump
      // before them, the jump's rise thrown away).
      if (self.vy > 0 || !upBNowOrNever(self, stage, r, ctx.view.frame)) return { score: 950, input: drift };
    }
    // Decided: every frame up to the one the special comes out holds Up and never
    // Down (ruling R-T13b-c), so whichever frame the press lands on, or a buffered
    // one fires on, reads as the up special and not a side or neutral one. A held
    // Up turns into a tap jump five frames on, which takes the buffer from a
    // Special pressed during an aerial (Task 19, the Task 13b fix round 1's
    // concern): it presses again on the first frame Special is up after that. And
    // it never presses Special on the step that tap jump fires (Plan 5 final wave,
    // ruling R-FW1g; Task 20 fix round 1's probe 3): a jump outranks a special in the
    // buffer (`bufferPress`), so that press was lost and the up special came out 3 to
    // 22 frames late. It waits that one step and presses on the next, where the
    // Special it held off is up (`tapJumped`).
    const b = self.bufferedAction;
    const displaced = b !== null && b.kind === "jump" && ctx.view.frame + 1 - b.frame <= BUFFER_FRAMES;
    const heldBefore = pulse(ctx.view.frame - 1, self.port, 6, 3) && !tapJumped(self, 0);
    const firing = (displaced ? !heldBefore : pulse(ctx.view.frame, self.port, 6, 3)) && !tapJumped(self, 1);
    const stick = plan === null ? drift : upBStickNow(plan, self, r!);
    return { score: 950, input: firing ? upBPress(stick) : upBHold(stick) };
  }

  return { score: 900, input: drift | (jumping ? Btn.Jump : 0) };
};

/**
 * Whether a held Up's tap jump fires on the step `ahead` from now (1: the next step,
 * the one this frame's press is read on; 0: the step just run): the fighter's own Stick
 * Jump on (`CombatState.controls`; Plan 5, Task 20), Up the last direction pressed, and
 * held to the window's end (`interpretInput`: `TAP_JUMP_FRAMES` after the press, counted
 * on the step that reads the input). `recover` holds Up throughout, so it is held.
 */
function tapJumped(self: FighterState, ahead: number): boolean {
  if ((self.combat.controls & CONTROL_STICK_JUMP_OFF) !== 0 || self.lastDirPressed !== Btn.Up) return false;
  return self.framesSinceDirPress + ahead === TAP_JUMP_FRAMES;
}

/**
 * UNVERIFIED (CPU judgement): within this of a ledge, or past one, an aerial is
 * checked for a way back before it is pressed (`aerialStrands`). The Task 13b
 * re-review counted the self-destructs out of aerials begun within 30 of the ledge.
 */
const EDGE_AERIAL_RANGE = fx(30);

/** The actions an Attack press starts or buffers an aerial from, in the air. */
const AERIAL_FROM: readonly ActionState[] = ["jump", "fall", "attack"];

/**
 * Would `input`, pressed now, start an aerial (or buffer one in an aerial under
 * way) that leaves the fighter no way back (Plan 5, Task 19: the Task 13b
 * re-review's offstage aerials from the edge, the main lever on its
 * self-destructs; M-11's long offstage aerials with no plan back)? Only near a
 * ledge or past one. The aerial is run by the engine's own rules on a copy
 * (`ghostStep`), as `upBPath` runs an up special: the press, then a stick held until
 * the aerial is over. It is safe if the copy comes down on the stage on the way, or
 * after it is back over the stage above its top, or can still get back: its up
 * special has a plan from there (`upBPlan`), or its midair jump does and the up
 * special has one from the jump's top.
 *
 * The stick after the press is either the aerial's own, held, or the one the CPU holds
 * once it is off the stage, toward the stage's middle (`recover`'s drift); it must be
 * safe with both (Plan 5 final wave, fix round 3, ruling R-FW1w: fox-donkeyKong@
 * townAndCity, seed 3541). Fox's down air 0.85 past the ledge was run with only its own
 * stick, Down, and drifted out over open air to 116, from where the jump and Fire Fox
 * reach the ledge. The CPU held the stick in: the down air ended under the stage at 82.8,
 * 91.7 below its top, where the jump met the stage's underside and Fire Fox fell short.
 */
export function aerialStrands(ctx: BehaviourContext, input: InputFrame): boolean {
  const { self } = ctx.view;
  const { stage } = ctx;
  if ((input & Btn.Attack) === 0 || self.grounded || !AERIAL_FROM.includes(self.action)) return false;
  if (ctx.recovery === null || ctx.fighterDef === null) return false;
  const nearEdge = isOffstage(self, stage) || abs(self.x - stage.leftLedge) <= EDGE_AERIAL_RANGE || abs(self.x - stage.rightLedge) <= EDGE_AERIAL_RANGE;
  if (!nearEdge) return false;
  const own = input & (Btn.Left | Btn.Right | Btn.Up | Btn.Down);
  const middle = Math.trunc((stage.leftLedge + stage.rightLedge) / 2);
  return [() => own, (f: FighterState) => towardX(f.x, middle)].some((after) => strandsHolding(ctx, input, after));
}

/** `aerialStrands` with `after(copy)` held from the step after the press. */
function strandsHolding(ctx: BehaviourContext, input: InputFrame, after: (f: FighterState) => InputFrame): boolean {
  const { self } = ctx.view;
  const { stage } = ctx;
  const def = ctx.fighterDef!;
  const r = ctx.recovery!;
  const f = cloneFighter(self);
  const gctx = ghostContext(def, ctx.view.frame, f);
  let prev: InputFrame = 0;
  let begun = false;
  for (let k = 1; k <= AERIAL_LOOKAHEAD_FRAMES; k++) {
    const prevY = f.y;
    const now = k === 1 ? input : after(f);
    gctx.frame = ctx.view.frame + k;
    ghostStep(f, now, prev, gctx);
    prev = now;
    if (f.y < prevY && prevY >= stage.groundY && f.y <= stage.groundY && f.x >= stage.leftLedge && f.x <= stage.rightLedge) return false;
    if (f.action === "attack") begun = true;
    else if (begun) break;
  }
  if (!isOffstage(f, stage) && f.y >= stage.groundY) return false;
  const ledge = f.x < 0 ? stage.leftLedge : stage.rightLedge;
  if (upBPlan(f, ledge, stage, r, gctx.frame) !== null) return false;
  if (f.jumpsUsed >= ctx.jumps) return true;
  // Its midair jump, then the up special from the jump's top.
  const j = cloneFighter(f);
  const jctx = ghostContext(def, gctx.frame, j);
  const home = towardX(j.x, ledge);
  let jprev: InputFrame = 0;
  for (let k = 1; k <= AERIAL_LOOKAHEAD_FRAMES; k++) {
    const now = (k === 1 ? Btn.Jump : 0) | home;
    jctx.frame = gctx.frame + k;
    ghostStep(j, now, jprev, jctx);
    jprev = now;
    if (k > 1 && j.vy <= 0) break;
  }
  return upBPlan(j, ledge, stage, r, jctx.frame) === null && !(j.y >= stage.groundY && !isOffstage(j, stage));
}

/** UNVERIFIED (CPU judgement): the most frames an aerial, or a jump's rise, is run for (`aerialStrands`). */
const AERIAL_LOOKAHEAD_FRAMES = 120;

/**
 * Whether the opponent holds the ledge at `ledgeX` in a ledge option, as the CPU
 * sees it (Plan 5, Task 19): `findLedgeGrab` refuses that ledge to anybody else
 * until the option has left it. One hanging there is trumped off by a grab, so a
 * hang is no hold.
 */
function ledgeHeldInOption(ctx: BehaviourContext, ledgeX: number): boolean {
  const t = ctx.view.target;
  return t !== null && t.ledge !== null && LEDGE_OPTIONS.includes(ctx.view.targetAction) && t.x < 0 === ledgeX < 0;
}

/**
 * UNVERIFIED (CPU judgement, no source): frames of falling the CPU allows for
 * between deciding to up special and the move's first frame (its press pulses
 * three frames on, three off), at the fighter's own fall speed.
 */
const UPB_DECISION_FRAMES = 6;

/**
 * UNVERIFIED (CPU judgement, Plan 5, Task 13b): how far from the stage's wall,
 * under the ledge, a fighter that can wall jump drifts into it to kick off it
 * before it spends the up special.
 */
const WALL_SEEK_RANGE = fx(10);

/**
 * UNVERIFIED (CPU judgement): helpless frames `upBInReach` follows past the
 * move's end, enough to come back down to a ledge from any up special's height.
 */
const UPB_LOOKAHEAD_FRAMES = 120;

/**
 * Whether the up special, used now (or carried on) with `stick`, gets the
 * fighter back (Plan 5, Task 4b fix round 1; Task 13b): somewhere on its path
 * (`upBPath`, the move and then the helpless fall) the fighter comes down on
 * the main stage, between its ledges, or is falling within a ledge grab of it
 * (`LEDGE_GRAB_RANGE_X`, less from behind, and `LEDGE_GRAB_RANGE_Y` below, as
 * `findLedgeGrab` measures; the body's own half-width, which only adds reach,
 * is left out). A path through a blast line does not, nor a helpless fall
 * already below grabbing height, which can only go on down.
 *
 * Task 19: `ledgeFree` false is a ledge somebody holds in a ledge option, which
 * `findLedgeGrab` refuses: then only coming down on the stage gets it back. And
 * whether the path on the way passes through the main stage's solid body, under
 * its top (`throughWall`): the engine's stage stops a body there, so a line that
 * does is one the model cannot vouch for, and it is no way back (Plan 5 final wave,
 * ruling R-FW1f; the Task 4b re-review's carry, 28 of 1,888 "yes" at Task 4b): the
 * path stops where it meets the body. Not modelled, as for the ledge: the body's
 * half-width (the origin meets the wall), so a line that only grazes it with the
 * body's side is still judged by the origin.
 */
export function upBReach(
  self: FighterState,
  ledge: number,
  stage: StageView,
  r: RecoveryMove,
  stick: UpBStick | InputFrame = 0,
  frame0 = 0,
  ledgeFree = true,
): { readonly reached: boolean; readonly throughWall: boolean } {
  const toward = ledge > self.x ? 1 : -1;
  let prevY = self.y;
  let reached = false;
  let throughWall = false;
  upBPath(r, self, stick, r.totalFrames + UPB_LOOKAHEAD_FRAMES, frame0, (p) => {
    const x = self.x + p.x;
    const y = self.y + p.y;
    if (x < stage.blastLeft || x > stage.blastRight || y < stage.blastBottom || y > stage.blastTop) return true;
    // How far past the ledge, toward the stage: positive is over it.
    const past = (x - ledge) * toward;
    const onStage = x >= stage.leftLedge && x <= stage.rightLedge;
    if (past > 0 && onStage && p.vy <= 0 && prevY >= stage.groundY && y <= stage.groundY) return (reached = true);
    const drop = stage.groundY - y;
    // Facing the ledge as the path faces it then (the move may have turned it).
    const range = p.facing === toward ? LEDGE_GRAB_RANGE_X : mul(LEDGE_GRAB_RANGE_X, LEDGE_GRAB_BACK_PENALTY);
    if (ledgeFree && p.vy <= 0 && past <= 0 && -past <= range && drop >= 0 && drop <= LEDGE_GRAB_RANGE_Y) return (reached = true);
    if (onStage && y < stage.groundY && y > stage.groundY - HARD_PLATFORM_DEPTH) return (throughWall = true);
    prevY = y;
    return p.helpless && drop > LEDGE_GRAB_RANGE_Y;
  });
  return { reached, throughWall };
}

/** Whether the up special with `stick` gets the fighter back (`upBReach`). */
export function upBInReach(self: FighterState, ledge: number, stage: StageView, r: RecoveryMove, stick: UpBStick | InputFrame = 0, frame0 = 0, ledgeFree = true): boolean {
  return upBReach(self, ledge, stage, r, stick, frame0, ledgeFree).reached;
}

/**
 * The first stick, in `upBSticks`' order, with which the up special gets the
 * fighter back from here, or null. Used before the move, to decide to spend it,
 * and during it, to hold the stick that keeps it on course. A line through the
 * stage's wall is no way back (`upBReach`; ruling R-FW1f, where Task 19 had taken one
 * when no other got back), so the plan in the move is the plan it was pressed with,
 * not a diagonal into the wall.
 */
export function upBPlan(self: FighterState, ledge: number, stage: StageView, r: RecoveryMove, frame0 = 0, ledgeFree = true): UpBStick | null {
  const toward = ledge > self.x ? 1 : -1;
  for (const plan of upBSticks(r, toward)) if (upBReach(self, ledge, stage, r, plan, frame0, ledgeFree).reached) return plan;
  return null;
}

/**
 * Whether it is now or never for the up special: a few more frames of falling
 * (`UPB_DECISION_FRAMES`) and the move's highest point, from the fighter's
 * speed now and with the stick at rest, would no longer lift it to grabbing
 * height under the ledge. Then `recover` spends it even out of reach, as the
 * last thing left.
 */
export function upBNowOrNever(self: FighterState, stage: StageView, r: RecoveryMove, frame0 = 0): boolean {
  let apex = 0;
  for (const p of upBPath(r, self, 0, r.totalFrames, frame0)) if (p.y > apex) apex = p.y;
  const terminal = self.fastFalling ? r.params.dive_speed_y : r.params.air_speed_y_stable;
  return stage.groundY - LEDGE_GRAB_RANGE_Y - self.y + UPB_DECISION_FRAMES * terminal >= apex;
}
