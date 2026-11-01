/**
 * The CPU's offence and its movement (Plan 5 final wave, ruling R-FW1j: split out of
 * `behaviours.ts`): `edgeguard`, `attack` (and the point-blank turn and swing, rulings
 * R-FW1a and R-FW1b: `pressToward`, `swingLands`), `platformMove`, `approach`, `retreat`,
 * `centre` and `idle`. Plan 5's specials are `specials.ts`'s.
 *
 * The rules `behaviours.ts` sets out hold here: no unseeded randomness and no wall clock
 * (every roll from `ctx.rolls`), and the opponent seen only through `ctx.view`.
 */

import { Btn, type ActionState, type FighterState, type InputFrame } from "@/engine/types";
import { cloneFighter } from "@/engine/simulate";
import { emptyKinetic } from "@/engine/kinetic";

import { deepestReach, hitboxWorldPos, hurtboxCapsule } from "@/engine/hitbox";
import { fighterHurtboxes } from "@/engine/acmd/hurtboxes";

import { GLANCING_BLOW_DEPTH, SMASH_INPUT_WINDOW } from "@/engine/constants";
import { abs, fx } from "@/engine/fixed";

import {
  type Behaviour,
  type BehaviourContext,
  type BehaviourResult,
  boxCapsule,
  canAct,
  free,
  fullHopPulse,
  GRAB_RANGE,
  isAttacking,
  isOffstage,
  isShielding,
  pulse,
  REELING_ACTIONS,
  SHIELD_ACTIONS,
  ROLL_EDGEGUARD,
  ROLL_MOVE,
  shortHopPulse,
  strikes,
  THREAT_RANGE,
  towardX,
  VERTICAL_REACH,
} from "./behaviours";
import { ghostContext, ghostStep } from "./recovery";

const NOTHING: BehaviourResult = { score: 0, input: 0 };

/**
 * Take the stage's edge away while the opponent is offstage.
 *
 * The highest-value thing in the game and the last thing a CPU learns, so it is
 * gated hard on `edgeguardSkill`: nothing below level 3 ever does it, and only
 * the top levels leave the stage to do it.
 */
export const edgeguard: Behaviour = (ctx) => {
  const { self, target, dx } = ctx.view;
  const { stage, tuning } = ctx;
  if (!canAct(self) || !target) return NOTHING;
  if (tuning.edgeguardSkill <= 0) return NOTHING;
  if (!isOffstage(target, stage) || isOffstage(self, stage)) return NOTHING;
  // A chance over a window (ruling R-T19j): rolled every frame the opponent is off
  // the stage, so the longer they are off, the likelier it goes to the ledge at all.
  if (ctx.rolls[ROLL_EDGEGUARD] >= tuning.edgeguardSkill) return NOTHING;

  const ledge = target.x < 0 ? stage.leftLedge : stage.rightLedge;
  const atLedge = abs(self.x - ledge) < fx(8);

  if (!atLedge) return { score: 500, input: towardX(self.x, ledge) };

  // Off the stage after them, but only for CPUs good enough to get back.
  const chaseOff = tuning.edgeguardSkill > 0.6 && target.y > stage.groundY - fx(24);
  if (chaseOff) {
    const out = towardX(0, dx);
    const swinging = pulse(ctx.view.frame, self.port, 12, 3);
    return { score: 520, input: out | (swinging ? Btn.Attack : 0) };
  }

  // Otherwise hold the ledge's inside edge and cover the get-up.
  const swinging = pulse(ctx.view.frame, self.port, 16, 3);
  return { score: 500, input: towardX(self.x, 0) | (swinging ? Btn.Down | Btn.Attack : 0) };
};

/**
 * Pick a move and throw it.
 *
 * The weighting is the situational one SPEC §6 implies: an aerial when the
 * target is above, a grab when they are shielding, a smash when they are in
 * hitstun at a percent where a smash kills, a tilt otherwise. `moveChoiceSkill`
 * decides how often that reasoning is used at all versus a plain jab — a low
 * level does hit you, it just hits you with the wrong thing.
 *
 * Smash versus tilt is produced the way a human produces it, through the
 * keyboard rules in SPEC §6 rather than by asking for a smash: the engine reads
 * an attack within `SMASH_INPUT_WINDOW` frames of a *fresh* direction press as a
 * smash, so a smash is "flick the stick and hit attack on the same frame" and a
 * tilt is "hold the direction until the window has lapsed, then attack".
 * `framesSinceDirPress` is the fighter's own state, so the CPU can read it
 * without seeing anything a player could not.
 */
export const attack: Behaviour = (ctx) => {
  const { self, target, targetAction, dx, dy, distance, facingTarget } = ctx.view;
  const { tuning } = ctx;
  if (!canAct(self) || !target) return NOTHING;
  if (distance > ctx.meleeReach) return NOTHING;
  // Nothing lands on a body that cannot be hit (Plan 5, Task 19): a roll, a dodge,
  // a ledge's intangibility, a respawn's invincibility, as the CPU sees them, with
  // the action it has noticed (ruling R-T19k: `observe`), so a slow level still
  // swings into the start of a roll. Swinging into one again and again was the
  // sweep's commonest loop (dash attacks into a roll; a jab at an edge at a fighter
  // hanging there).
  if (target.intangible > 0 || target.invincible > 0) return NOTHING;

  const toward = towardX(0, dx);
  if (!facingTarget && self.grounded && toward !== 0) {
    // Turning is an input, not a free action; hold the direction one frame. At point
    // blank, the press that turns it without carrying it past the target (ruling
    // R-FW1a: `pressToward`); and too close for any swing it has, it goes on stepping
    // back, turned away, until one would land (ruling R-FW1b: `stepBack`).
    if (abs(dx) < POINT_BLANK && free(self) && self.action !== "dashStart" && self.action !== "run" && landingSwing(facing(ctx)) === null && stepBack(ctx)) {
      return { score: 380, input: towardX(dx, 0) };
    }
    return { score: 380, input: pressToward(self, dx) };
  }

  const swinging = pulse(ctx.view.frame, self.port, 10, 3);

  // The same move on the same shield, time after time (Plan 5, Task 19: the jab
  // loops): its own last swings that connected are in its stale queue, marked when
  // they met a shield (`CombatState.staleShield`). After `SHIELD_LOOP` in a row it
  // stops poking: a grab goes through the shield, from further out it walks in to
  // grab range.
  if (SHIELDS_AND_DROPS.includes(targetAction) && pokingShield(self)) {
    if (distance <= GRAB_RANGE) return { score: 460, input: swinging ? Btn.Grab : 0 };
    return { score: 410, input: toward };
  }
  // A per-opportunity choice (ruling R-T19j): rolled every frame, but a swing comes
  // out only on its pulse's press, so each swing's move is its own roll.
  const smart = ctx.rolls[ROLL_MOVE] < tuning.moveChoiceSkill;

  if (smart) {
    // Above: an up aerial from a short hop, or an up tilt from the ground.
    if (dy > VERTICAL_REACH) {
      if (self.grounded) {
        const hopping = shortHopPulse(ctx.view.frame, self.port);
        return { score: 430, input: (hopping ? Btn.Jump : 0) | Btn.Up | (swinging ? Btn.Attack : 0) };
      }
      return { score: 430, input: Btn.Up | (swinging ? Btn.Attack : 0) };
    }

    // Shielding: a grab goes straight through it.
    if (isShielding(targetAction) && distance <= GRAB_RANGE) {
      return { score: 460, input: swinging ? Btn.Grab : 0 };
    }

    // Reeling at a killing percent: commit to a smash.
    if (REELING_ACTIONS.includes(targetAction) && target.damage >= fx(80)) {
      return { score: 480, input: smashInput(ctx, toward) };
    }

    // Below and airborne: a down aerial, which is where the meteors live.
    if (dy < -VERTICAL_REACH && !self.grounded) {
      return { score: 420, input: Btn.Down | (swinging ? Btn.Attack : 0) };
    }
  }

  // The default: a tilt if the direction has gone stale, a jab if it has not —
  // never an accidental smash, which is the classic keyboard misfire.
  const stale = self.framesSinceDirPress > SMASH_INPUT_WINDOW;
  // A swing on the ground that would not land is not thrown (Plan 5 final wave, ruling
  // R-FW1b): judged on the frame it would be pressed, by the move's own boxes run by the
  // engine's rules from here against the target's body (`swingLands`). A dash's swing is
  // its dash attack, whose slide carries it past a target too close: it ends the dash
  // instead (ruling R-FW1a's stop, before a swing). From a standstill it swings the first
  // of its jab and tilts that lands (`landingSwing`), and with none, at point blank, it
  // steps back a frame (`stepBack`). Pressed during its own swing or a landing's lag, a
  // swing waits in the buffer to come out from a standstill where it stands, so it is
  // judged from there (`standing`), and one that would not land is not pressed: the
  // first free frame chooses (the review's whiff loop was swing after swing, each
  // pressed inside the last). Its forward tilt is pressed with a part-way push, which is
  // a tilt whatever was held before: a direction the CPU let go of (a dash it ended)
  // and pressed again with the button was a fresh flick, and so a smash, which slid it
  // through the target.
  const waits = self.action === "attack" || self.action === "landingLag" || self.action === "land";
  if (swinging && self.grounded && (free(self) || waits)) {
    const swing = (stale ? toward | Btn.Soft : 0) | Btn.Attack;
    if (swingLands(waits ? standing(ctx) : ctx, swing)) return { score: 400, input: swing };
    if (waits) return { score: 400, input: 0 };
    if (self.action === "dashStart" || self.action === "run") return { score: 400, input: 0 };
    const pick = landingSwing(ctx);
    if (pick !== null) return { score: 400, input: pick };
    if (abs(dx) < POINT_BLANK && stepBack(ctx)) return { score: 400, input: towardX(dx, 0) };
  }
  return {
    score: 400,
    input: (stale ? toward : 0) | (swinging ? Btn.Attack : 0),
  };
};

/**
 * UNVERIFIED (CPU judgement, measured; Plan 5 final wave, ruling R-FW1a): nearer than this
 * in x, a target is point blank. A full press there starts a dash, or restarts one the
 * other way (`groundMain`), whose first frame alone carries the fighter about two units
 * (an initial dash, `dash_speed`: 1.87 to 2.25 across the roster), past a target that
 * near before it can face it, so the next frame it is behind again: the final review's
 * I1, a CPU turning every frame beside a standing opponent and never attacking. The
 * review's figure, about three frames of an initial dash; measured, the idle-human
 * probe's dash dances (29 of 64 matchups for 30 s or more) were gone at every distance
 * from 3 to 12.
 */
export const POINT_BLANK = fx(6);

/**
 * The press that moves a grounded fighter toward a target `dx` away in x (ruling
 * R-FW1a): the whole stick from `POINT_BLANK` or further. Nearer, in a dash or a run it
 * lets go of the stick for a frame, which ends the dash (`stand`) or brakes the run
 * (`runBrake`); from anything else, a part-way push (`Btn.Soft`), which walks and never
 * dashes, never makes a smash and never a stick jump (`interpretInput`). The one place
 * the rule is written: `attack`'s turn, `finalSmash`'s turn (`specials.ts`) and
 * `approach` press through it.
 */
export function pressToward(self: FighterState, dx: number): InputFrame {
  const toward = towardX(0, dx);
  if (toward === 0 || abs(dx) >= POINT_BLANK) return toward;
  if (self.action === "dashStart" || self.action === "run") return 0;
  return toward | Btn.Soft;
}

/**
 * The swings a CPU standing on the ground can choose, in the order it tries them (ruling
 * R-FW1b): its jab, and its forward, up and down tilts, each with a part-way push
 * (`Btn.Soft`), so a tilt is never a smash and an Up never a stick jump.
 */
const GROUND_SWINGS: readonly ((toward: InputFrame) => InputFrame)[] = [
  () => Btn.Attack,
  (toward) => toward | Btn.Soft | Btn.Attack,
  () => Btn.Up | Btn.Soft | Btn.Attack,
  () => Btn.Down | Btn.Soft | Btn.Attack,
];

/** The first of `GROUND_SWINGS` that lands from where the fighter stands (`swingLands`), or null. */
function landingSwing(ctx: BehaviourContext): InputFrame | null {
  const toward = towardX(0, ctx.view.dx);
  for (const swing of GROUND_SWINGS) {
    const input = swing(toward);
    if (swingLands(ctx, input)) return input;
  }
  return null;
}

/** The context as if the fighter stood still where it is, as a swing pressed in its own swing or a landing comes out (`attack`). */
function standing(ctx: BehaviourContext): BehaviourContext {
  const self: FighterState = { ...ctx.view.self, action: "stand", actionFrame: 0, move: null, vx: 0, vy: 0, kinetic: emptyKinetic() };
  return { ...ctx, view: { ...ctx.view, self } };
}

/** The context as if the fighter faced its target from where it stands: what a turn would swing from (`attack`'s step back). */
function facing(ctx: BehaviourContext): BehaviourContext {
  const self: FighterState = { ...ctx.view.self, facing: ctx.view.dx >= 0 ? 1 : -1 };
  return { ...ctx, view: { ...ctx.view, self, facingTarget: true } };
}

/**
 * Whether a step back, away from the target (ruling R-FW1b), keeps the fighter on the
 * stage: not within `POINT_BLANK` of the ledge behind it, where walking away from the
 * target would walk it off.
 */
function stepBack(ctx: BehaviourContext): boolean {
  const { self, dx } = ctx.view;
  return !isOffstage({ ...self, x: self.x + (dx > 0 ? -POINT_BLANK : POINT_BLANK) }, ctx.stage);
}

/** UNVERIFIED (CPU judgement): the most frames a swing is run for (`swingLands`), past any first hit on the roster. */
const SWING_LOOKAHEAD_FRAMES = 40;

/**
 * Whether `input`, pressed now (nothing held the frame before), starts a swing whose
 * boxes reach the target's body (ruling R-FW1b): the fighter's own copy run by the
 * engine's rules (`ghostStep`), the swing's live boxes on each of its frames placed where
 * the copy is then (a dash attack's slide included), swept as the engine sweeps them, and
 * reaching the target's hurt capsules (the bake's, `fighterHurtboxes`, with one; Plan 2's
 * single capsule without) at least a glancing blow deep, the target carried on its own
 * velocity, as the parry carries a swing (`parry`). True without the data to judge it
 * (no definitions): the swing it always threw. Not modelled: the target's own animation
 * past the frame seen (its pose as it is now).
 */
function swingLands(ctx: BehaviourContext, input: InputFrame): boolean {
  const { self, target } = ctx.view;
  const def = ctx.fighterDef;
  const targetDef = target === null ? undefined : ctx.matchDefs[target.port];
  if (def === null || target === null || targetDef === undefined) return true;
  const f = cloneFighter(self);
  const g = ghostContext(def, ctx.view.frame, f);
  let prev: InputFrame = 0;
  for (let k = 1; k <= SWING_LOOKAHEAD_FRAMES; k++) {
    const was = { x: f.x, y: f.y };
    const now = k === 1 ? input : input & ~Btn.Attack;
    g.frame = ctx.view.frame + k;
    ghostStep(f, now, prev, g);
    prev = now;
    const move = f.action === "attack" && f.move !== null ? def.moves[f.move] : undefined;
    if (move === undefined) return false;
    const moveFrame = f.actionFrame + 1;
    const live = move.hitboxes.filter(
      (hb) =>
        strikes(hb) &&
        hb.startFrame <= moveFrame &&
        moveFrame <= hb.endFrame &&
        (hb.whileGrounded === undefined || hb.whileGrounded === f.grounded) &&
        !((hb.situation === "ground" && !target.grounded) || (hb.situation === "air" && target.grounded)),
    );
    if (live.length === 0) continue;
    const at = { x: target.x + target.vx * k, y: target.y + target.vy * k };
    const body = (ctx.bake === undefined ? null : fighterHurtboxes(targetDef, { ...target, ...at }, ctx.view.frame + k, ctx.bake)) ?? [hurtboxCapsule(at, targetDef.attributes)];
    for (const hb of live) {
      const box = boxCapsule(f, hb);
      const from = hitboxWorldPos(was.x, was.y, f.facing, hb);
      if (deepestReach(from.x, from.y, box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1, box.r, body).depth >= GLANCING_BLOW_DEPTH) return true;
    }
  }
  return false;
}

/** UNVERIFIED (CPU judgement): the swings in a row on a shield, one move, that make a loop to break. */
export const SHIELD_LOOP = 3;

/** A shield up, coming up, stunned or just let go: the defence a poke loop meets. */
const SHIELDS_AND_DROPS: readonly ActionState[] = [...SHIELD_ACTIONS, "shieldRelease"];

/** Its last `SHIELD_LOOP` swings that connected were one move, every one on a shield. */
function pokingShield(f: FighterState): boolean {
  const q = f.staleQueue;
  if (q.length < SHIELD_LOOP) return false;
  for (let i = 0; i < SHIELD_LOOP; i++) if (q[i] !== q[0] || f.combat.staleShield[i] !== true) return false;
  return true;
}

/**
 * Flick-and-hit: the two-frame pattern that reads as a smash.
 *
 * When the engine's smash window is already open the attack goes out with the
 * direction on the same frame. When it is not, the direction is released for a
 * frame first, because a direction that has been held for twenty frames cannot
 * produce a fresh press — and without a fresh press the same input is a tilt.
 */
function smashInput(ctx: BehaviourContext, toward: InputFrame): InputFrame {
  const { self } = ctx.view;
  if (toward === 0) return Btn.Attack;
  if (self.framesSinceDirPress <= SMASH_INPUT_WINDOW) return toward | Btn.Attack;
  return pulse(ctx.view.frame, self.port, 2, 1) ? toward | Btn.Attack : 0;
}

/**
 * Change height to match the target: jump to the platform they are on, or drop
 * through the one this fighter is standing on.
 */
export const platformMove: Behaviour = (ctx) => {
  const { self, target, dy } = ctx.view;
  if (!canAct(self) || !target) return NOTHING;
  if (!self.grounded) return NOTHING;

  const aboveGround = self.y > ctx.stage.groundY + fx(4);

  if (dy < -VERTICAL_REACH && aboveGround) {
    // Standing on a soft platform with the target below it: fall through.
    return { score: 260, input: pulse(ctx.view.frame, self.port, 10, 4) ? Btn.Down : 0 };
  }

  if (dy > VERTICAL_REACH) {
    const overhead = ctx.stage.platforms.some(
      (p) => p.y > self.y + fx(4) && abs(p.x - self.x) <= p.halfWidth + fx(10),
    );
    if (!overhead) return NOTHING;
    const jumping = fullHopPulse(ctx.view.frame, self.port);
    return { score: 250, input: (jumping ? Btn.Jump : 0) | towardX(0, ctx.view.dx) };
  }

  return NOTHING;
};

/** Close the distance. The behaviour `aggression` scales directly. */
export const approach: Behaviour = (ctx) => {
  const { self, target, dx, dy, distance } = ctx.view;
  if (!canAct(self) || !target) return NOTHING;
  // The same threshold `attack` swings at, so there is no band of distances
  // where neither behaviour will act — that gap is what let a CPU stand still
  // and punch nothing for the rest of the match.
  if (distance <= ctx.meleeReach) return NOTHING;

  // On the ground, the press that does not dash past a target straight above or below
  // (ruling R-FW1a: `pressToward`), which turned it every frame under a falling target.
  let input = self.grounded ? pressToward(self, dx) : towardX(0, dx);
  // Jumping toward a target well above is the same decision as platformMove,
  // scored lower here so the platform-aware version wins when it applies.
  if (dy > VERTICAL_REACH * 2 && self.grounded && fullHopPulse(ctx.view.frame, self.port)) {
    input |= Btn.Jump;
  }
  return { score: 200 * ctx.tuning.aggression, input };
};

/**
 * Back off: when this fighter is the one at a killing percent, when the target
 * is winding up a smash, or simply because the level is a patient one.
 */
export const retreat: Behaviour = (ctx) => {
  const { self, target, dx, distance } = ctx.view;
  const { stage } = ctx;
  if (!canAct(self) || !target) return NOTHING;

  const losing = self.damage > target.damage + fx(40);
  // A charging smash is only a reason to leave once the CPU has noticed the
  // swing — `targetAction` is the perceived one, so this respects the delay.
  const charging = isAttacking(ctx.view.targetAction) && target.charge > 0 && distance < THREAT_RANGE;
  if (!losing && !charging) return NOTHING;

  // Never retreat over the ledge — that is how a CPU walks off the stage it
  // was trying to survive on.
  const away = towardX(dx, 0);
  const nextX = self.x + (away === Btn.Right ? fx(6) : away === Btn.Left ? -fx(6) : 0);
  if (nextX < stage.leftLedge || nextX > stage.rightLedge) return NOTHING;

  return { score: 190 * (1 - ctx.tuning.aggression), input: away };
};

/** UNVERIFIED (CPU judgement): how near the middle of the stage counts as there, for `centre`. */
export const CENTRE_BAND = fx(20);

/**
 * With nobody to fight (the opponent between stocks, on the respawn platform or
 * entering), walk back toward the middle of the stage rather than stand where the
 * last exchange left it (Plan 5, Task 19: the sweep's long runs at an edge, most
 * of them while the opponent respawned). Scored only above `idle`.
 */
export const centre: Behaviour = (ctx) => {
  const { self, target } = ctx.view;
  if (target !== null || !canAct(self) || !self.grounded) return NOTHING;
  const mid = Math.trunc((ctx.stage.leftLedge + ctx.stage.rightLedge) / 2);
  if (abs(self.x - mid) <= CENTRE_BAND) return NOTHING;
  return { score: 50, input: towardX(self.x, mid) };
};

/** The floor: always available, so `cpuInput` always has an answer. */
export const idle: Behaviour = () => ({ score: 1, input: 0 });
