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

import { BUFFER_FRAMES, GLANCING_BLOW_DEPTH, SMASH_INPUT_WINDOW } from "@/engine/constants";
import { abs, fx } from "@/engine/fixed";
import { platformCentreX } from "@/engine/physics";
import { LEDGE_GETUP_DISTANCE, LEDGE_GETUP_FRAMES } from "@/engine/states";

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
  isHelpless,
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
import { ghostContext, ghostStep, landsOn, overFloor } from "./recovery";

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
  // Off the stage means in the air, on the ledge or helpless (Plan 5 final wave, fix round
  // 1, ruling R-FW1l): one standing on a floor past the ledge, as on Town & City's outer
  // platforms, is past it only in x (`isOffstage`), and guarding the ledge from it was
  // swinging at nothing (the idle table's fox-pikachu, 3,061 frames).
  if (target.grounded && target.ledge === null && !isHelpless(target)) return NOTHING;
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
      return { score: 380, input: backOff(ctx) };
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
  // through the target. Pressed in a ledge get-up, a swing waits for the get-up too, and
  // comes out from a standstill where it puts the fighter (fix round 1, ruling R-FW1n:
  // `gotUp`); pressed in a jab whose next hit it starts, it is that hit, from here and now
  // (ruling R-FW1o: `continues`).
  const waits = self.action === "attack" || self.action === "landingLag" || self.action === "land" || self.action === "ledgeGetUp";
  if (swinging && (self.grounded || self.action === "ledgeGetUp") && (free(self) || waits)) {
    const swing = (stale ? toward | Btn.Soft : 0) | Btn.Attack;
    if (waits ? waitedLands(ctx, swing) : swingLands(ctx, swing)) return { score: 400, input: swing };
    if (waits) return { score: 400, input: 0 };
    if (self.action === "dashStart" || self.action === "run") return { score: 400, input: 0 };
    const pick = landingSwing(ctx);
    if (pick !== null) return { score: 400, input: pick };
    // At point blank with nothing that lands and no room behind to step back, a judged way
    // out (fix round 2, ruling R-FW1q: `wayOut`), never the fall-through's swing below.
    if (abs(dx) < POINT_BLANK) return { score: 400, input: stepBack(ctx) ? backOff(ctx) : wayOut(ctx) };
  }
  // On the ground the stale direction is pressed as `pressToward` presses it: at point
  // blank a dash or a run lets go (ruling R-FW1a's stop) and a shield is let down, where
  // the whole stick held through carried a dash past the target and off the ledge (fix
  // round 1, ruling R-FW1n: the re-review's marth-mario@townAndCity), or turned a shield
  // into a roll away. Beyond point blank it is the whole stick, as before.
  const press = stale ? (self.grounded ? pressToward(self, dx) : toward) : 0;
  // At point blank no swing goes unjudged (fix round 2, ruling R-FW1q). In the air or in a
  // jumpsquat (`wayOut`'s short hop), the aerial that lands (`judgedAerial`), and otherwise
  // none, the stick on past the target; on the ground, no swing, which the judged branch
  // above throws. Beyond point blank the fall-through stays as it was.
  // When (fix round 3, ruling R-FW1u): on the swing's beat (`swinging`), as every swing
  // here is, except the first aerial of a jump, pressed whenever it lands on the jump's
  // rise or from its jumpsquat, and an aerial's press waiting in the buffer, which reads
  // the stick as it comes out (`buffered`). Pressed whenever it would land through the
  // fall as well, aerial after aerial, it doubled the knock-offs by point-blank aerials
  // over the 27 sweep sets (859 to 1,712) and the self-destructs after them; on the beat
  // alone, a jump's 3 frames at point blank past a player on a platform fell between
  // beats on every pass of a 50-frame loop (fox-kirby@smallBattlefield, the first hit on
  // frame 608).
  if (abs(dx) < POINT_BLANK) {
    if (!self.grounded || self.action === "jumpSquat") {
      const b = self.bufferedAction;
      const buffered = b !== null && b.kind === "attack" && ctx.view.frame + 1 - b.frame <= BUFFER_FRAMES;
      const rising = self.action === "jumpSquat" || self.action === "jump";
      const aerial = swinging || buffered || rising ? judgedAerial(ctx) : null;
      return { score: 400, input: aerial ?? toward };
    }
    return { score: 400, input: press };
  }
  return { score: 400, input: press | (swinging ? Btn.Attack : 0) };
};

/**
 * The aerials a CPU judges at point blank (ruling R-FW1q), in the order it tries them: down,
 * neutral, forward and back. Down first: in the measured scenes (six fighters on Kirby,
 * Pikachu and Mario at 0.5 to 1.5, a short hop) the down air lands in all but a few, from
 * any frame of the hop. No up air: Up in the air is a tap jump's press.
 */
function aerialSwings(self: FighterState): readonly InputFrame[] {
  const forward = self.facing > 0 ? Btn.Right : Btn.Left;
  const back = self.facing > 0 ? Btn.Left : Btn.Right;
  return [Btn.Down | Btn.Attack, Btn.Attack, forward | Btn.Attack, back | Btn.Attack];
}

/** UNVERIFIED (CPU judgement): the steps a short hop's aerial may take to begin (`swingRuns`' lead), past any jumpsquat on the roster. */
const HOP_LEAD = 10;

/**
 * The aerial that lands, pressed now in the air or in a jumpsquat (where it comes out on
 * the first airborne frame), judged as a ground swing is (`swingRuns`), or null. Not from
 * inside a move: a press there waits, and the move in progress is not it.
 */
function judgedAerial(ctx: BehaviourContext): InputFrame | null {
  const { self } = ctx.view;
  if (self.action === "attack" || self.action === "special") return null;
  for (const aerial of aerialSwings(self)) if (swingRuns(ctx, (k) => (k === 1 ? aerial : aerial & ~Btn.Attack), HOP_LEAD)) return aerial;
  return null;
}

/**
 * The way out at point blank when no ground swing lands and there is no room to step back
 * (Plan 5 final wave, fix round 2, ruling R-FW1q: marth-kirby@smallBattlefield, Marth's
 * back to the ledge, Kirby 0.92 in front, the fall-through's forward tilt whiffing for
 * 4,733 frames): a short hop with an aerial that lands, judged as the whole press (the hop
 * now, the aerial from the jumpsquat's next frame on: `swingRuns`), which the jumpsquat and
 * the air then press only as `judgedAerial` judges it. Chosen from data over the jump past
 * the target: of 2,048 scenes (every pair, 3.25 in from Small Battlefield's and Final
 * Destination's ledges, 0 to 5 apart, the target facing either way) a ground swing lands
 * in 2,010, 12 level with the target step back toward the middle, and in all 26 others a
 * short hop's aerial lands (Marth on Kirby and Pikachu, Link on Pikachu): a jump past was
 * never the only way. With none, nothing is pressed: never a swing that would not land.
 */
function wayOut(ctx: BehaviourContext): InputFrame {
  const { self } = ctx.view;
  for (const aerial of aerialSwings(self)) if (swingRuns(ctx, (k) => (k === 1 ? Btn.Jump : aerial), HOP_LEAD)) return Btn.Jump;
  return 0;
}

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
  // In a shield a direction is a roll, not a step (fix round 1, ruling R-FW1n): the shield
  // is let down first.
  if (isShielding(self.action)) return 0;
  if (toward === 0 || abs(dx) >= POINT_BLANK) return toward;
  if (self.action === "dashStart" || self.action === "run") return 0;
  return toward | Btn.Soft;
}

/** UNVERIFIED (CPU judgement): the most frames a let-go's slide is run for (`slidesOff`), past any dash's or run's on the roster. */
const SLIDE_FRAMES = 30;

/**
 * Whether `input` lets go of a dash or a run whose slide would carry the fighter off the
 * floor it stands on with no floor under the fall: past the ledge, off the stage (Plan 5
 * final wave, fix round 1, ruling R-FW1n), or off a platform's edge where nothing is below
 * (fix round 2, ruling R-FW1p: Town & City's outer platforms past the ledges).
 * The point-blank stop lets go of the stick (`pressToward`, `attack`), and the stand or
 * the run's brake it ends in slides on the dash's speed, off an edge as any other ground
 * state but a shield, a dodge or a grab does (`GROUND_EXIT`). The re-review's
 * marth-mario@townAndCity: Mario standing at the right ledge, Marth's stop 3.4 short of him
 * slid him past and off, on to the ledge, 5,766 frames round. The slide is the fighter's
 * own copy run by the engine's rules (`ghostStep`), `input` and then nothing. Down, Up and
 * a part-way push are a let-go too; a direction or a button is not.
 */
export function slidesOff(ctx: BehaviourContext, input: InputFrame): boolean {
  const { self } = ctx.view;
  const def = ctx.fighterDef;
  if (def === null || !self.grounded || (self.action !== "dashStart" && self.action !== "run")) return false;
  if ((input & (Btn.Left | Btn.Right | Btn.Attack | Btn.Special | Btn.Shield | Btn.Jump | Btn.Grab)) !== 0) return false;
  // The floor it slides on: the stage between its ledges, or the soft platform under it.
  // Off a platform's edge it falls, and lands if a floor is under that fall (fix round 2,
  // ruling R-FW1p: `overFloor`; past the main ledge, off Town & City's outer platforms,
  // nothing is).
  const stageFrame = ctx.state.stageFrame;
  const onMain = self.y <= ctx.stage.groundY + fx(4);
  const under = onMain ? null : (ctx.stage.platforms.find((p) => abs(p.y - self.y) <= fx(1) && abs(platformCentreX(p, stageFrame) - self.x) <= p.halfWidth) ?? null);
  if (!onMain && under === null) return false;
  const f = cloneFighter(self);
  const g = ghostContext(def, ctx.view.frame, f);
  let prev: InputFrame = 0;
  for (let k = 1; k <= SLIDE_FRAMES; k++) {
    const now = k === 1 ? input : 0;
    g.frame = ctx.view.frame + k;
    ghostStep(f, now, prev, g);
    prev = now;
    const left = under === null ? ctx.stage.leftLedge : platformCentreX(under, stageFrame + k) - under.halfWidth;
    const right = under === null ? ctx.stage.rightLedge : platformCentreX(under, stageFrame + k) + under.halfWidth;
    if (f.x < left || f.x > right) return !overFloor(def, { ...f, grounded: false, platform: -1 }, ctx.stage, ctx.view.frame + k, stageFrame + k);
    // Still on it: a sweeping platform carries it, as the engine carries a fighter
    // standing there after the step's own movement (`resolveCollision`; fix round 3,
    // re-review 3's Minor 1: Smashville's platform swept the fighter off where the copy,
    // standing still on it, stayed on).
    if (under?.motion !== undefined) f.x += platformCentreX(under, stageFrame + k) - platformCentreX(under, stageFrame + k - 1);
    if (f.vx === 0) return false;
  }
  return false;
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

/**
 * The context a swing pressed now comes out from, for one that does not come out at once
 * (`attack`'s `waits`). In a ledge get-up: a standstill where the get-up puts the fighter,
 * `LEDGE_GETUP_DISTANCE` in from the ledge on the floor (`finishLedgeOption`), facing as it
 * faces (ruling R-FW1n). In a move whose follow-up the press starts at once, a jab's next
 * hit (`MoveDef.followUp`): the fighter as it is, so `swingLands` runs that hit by the
 * engine's own rule (ruling R-FW1o). Otherwise the press waits in the buffer for the move
 * or the landing to end: a standstill where it stands (`standing`).
 */
function comesOut(ctx: BehaviourContext, swing: InputFrame): BehaviourContext {
  const { self } = ctx.view;
  if (self.action === "ledgeGetUp") return gotUp(ctx);
  if (self.action === "attack" && continues(ctx, swing)) return ctx;
  return standing(ctx);
}

/**
 * Whether a swing pressed now that does not come out at once (`attack`'s `waits`) lands
 * as it comes out (`comesOut`). The buffer keeps the button and reads the stick on the
 * step the swing comes out, from whatever is held then, which is not decided yet: so it is
 * judged both ways, as pressed and as the button alone (fix round 2, ruling R-FW1s: a
 * forward tilt pressed in a ledge get-up came out a jab with the stick let go, and missed
 * at the edge of reach). A jab's next hit takes its stick now (`continues`).
 */
function waitedLands(ctx: BehaviourContext, swing: InputFrame): boolean {
  const out = comesOut(ctx, swing);
  if (!swingLands(out, swing)) return false;
  const button = swing & ~(Btn.Left | Btn.Right | Btn.Up | Btn.Down | Btn.Soft);
  return out === ctx || button === swing || swingLands(out, button);
}


/**
 * Whether `swing`, pressed now in the fighter's move, starts that move's follow-up on this
 * step (a jab's next hit: the attack status's `followUp`, from its third frame), read off
 * one step of the fighter's own copy (`ghostStep`), not restated.
 */
function continues(ctx: BehaviourContext, swing: InputFrame): boolean {
  const { self } = ctx.view;
  const def = ctx.fighterDef;
  if (def === null || self.move === null || def.moves[self.move]?.followUp === undefined) return false;
  const f = cloneFighter(self);
  ghostStep(f, swing, 0, ghostContext(def, ctx.view.frame + 1, f));
  return f.action === "attack" && f.move !== self.move;
}

/**
 * The context as if the fighter stood where its ledge get-up puts it (`finishLedgeOption`),
 * as a swing pressed in the get-up comes out (ruling R-FW1n), on the step it comes out:
 * the get-up's last (`LEDGE_GETUP_FRAMES`), so the target carried on its velocity and its
 * pose read for the frames left (fix round 2, ruling R-FW1s: judged as if the get-up ended
 * now, a jab at the edge of reach missed the pose that was there when it came out).
 */
function gotUp(ctx: BehaviourContext): BehaviourContext {
  const { self, target } = ctx.view;
  const side = self.ledge?.side ?? (self.x > 0 ? 1 : -1);
  const ledge = side > 0 ? ctx.stage.rightLedge : ctx.stage.leftLedge;
  const at: FighterState = { ...self, x: ledge - side * LEDGE_GETUP_DISTANCE, y: ctx.stage.groundY, grounded: true, platform: self.ledge?.platform ?? self.platform, ledge: null, action: "stand", actionFrame: 0, move: null, vx: 0, vy: 0, kinetic: emptyKinetic() };
  const left = Math.max(0, LEDGE_GETUP_FRAMES - self.actionFrame - 1);
  const later = target === null ? null : { ...target, x: target.x + target.vx * left, y: target.y + target.vy * left };
  const dx = later === null ? ctx.view.dx : later.x - at.x;
  const dy = later === null ? ctx.view.dy : later.y - at.y;
  return { ...ctx, view: { ...ctx.view, self: at, target: later, dx, dy, frame: ctx.view.frame + left, facingTarget: (dx >= 0 ? 1 : -1) === at.facing } };
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
  const back = backOff(ctx);
  return back !== 0 && !isOffstage({ ...ctx.view.self, x: ctx.view.self.x + (back === Btn.Right ? POINT_BLANK : -POINT_BLANK) }, ctx.stage);
}

/**
 * The press of a step back (ruling R-FW1b): away from the target in x, or toward the
 * stage's middle when the target is level with it (fix round 1: one hanging on the ledge
 * right under the fighter, where the press away was no press at all and the fighter stood
 * over it, its swings passing over, for minutes).
 */
function backOff(ctx: BehaviourContext): InputFrame {
  const { self, dx } = ctx.view;
  return dx !== 0 ? towardX(dx, 0) : towardX(self.x, Math.trunc((ctx.stage.leftLedge + ctx.stage.rightLedge) / 2));
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
  return swingRuns(ctx, (k) => (k === 1 ? input : input & ~Btn.Attack), 0);
}

/**
 * `swingLands` for a press that is a sequence (Plan 5 final wave, fix round 2, ruling
 * R-FW1q): `held(k)` is what is held on the copy's `k`th step, and the swing may begin up
 * to `lead` steps in, after a short hop's jumpsquat, or as one pressed in the jumpsquat
 * comes out on the first airborne frame. The swing is the first move begun after now (a
 * move already in progress is not it). A copy in the air that comes down on a floor of the
 * stage (`landsOn`, where the real fighter lands) has landed, and its swing with it: the
 * copy itself has no floor.
 */
function swingRuns(ctx: BehaviourContext, held: (k: number) => InputFrame, lead: number): boolean {
  const { self, target } = ctx.view;
  const def = ctx.fighterDef;
  const targetDef = target === null ? undefined : ctx.matchDefs[target.port];
  if (def === null || target === null || targetDef === undefined) return true;
  const f = cloneFighter(self);
  const g = ghostContext(def, ctx.view.frame, f);
  let prev: InputFrame = 0;
  let begun = false;
  for (let k = 1; k <= SWING_LOOKAHEAD_FRAMES; k++) {
    const was = { x: f.x, y: f.y, move: f.move, actionFrame: f.actionFrame, action: f.action };
    const now = held(k);
    g.frame = ctx.view.frame + k;
    ghostStep(f, now, prev, g);
    prev = now;
    if (f.y < was.y && !f.grounded && landsOn(f.x, was.y, f.y, ctx.stage, ctx.state.stageFrame + k)) return false;
    const fresh = f.action === "attack" && (was.action !== "attack" || f.move !== was.move || f.actionFrame < was.actionFrame);
    begun ||= fresh && (k > 1 || self.action !== "attack" || f.move !== self.move);
    const move = begun && f.action === "attack" && f.move !== null ? def.moves[f.move] : undefined;
    if (move === undefined) {
      if (begun || k > lead) return false;
      continue;
    }
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
 * The ground states whose next step reads a fresh Down as a drop through the soft
 * platform under the fighter (`handleActionable`: `downPressed && dropThroughPlatform`,
 * ahead of the crouch). A crouch's start and end only buffer, and in the crouch itself
 * Down is already held.
 */
const DROPS_FROM: readonly ActionState[] = ["stand", "walk", "dashStart", "run", "runBrake"];

/**
 * Change height to match the target: jump to the platform they are on, or drop
 * through the one this fighter is standing on.
 *
 * The drop (Plan 5 final wave, fix round 1, ruling R-FW1k): Down in a state that reads
 * it as one (`DROPS_FROM`), and in no other, so nothing at all in a crouch. It cannot
 * lock, because it keeps no clock: whether it presses Down is the state's alone, so there
 * is no phase to fall into step with the crouch's 5 and 5. Its Down is fresh unless Down
 * was held the frame before, and a hold it begins drops on its first frame, so a held
 * Down was another behaviour's: holding it on ends in a crouch, and in the crouch nothing
 * is pressed, so the fighter stands again with Down let go (its start, the crouch and its
 * end: ten frames at most) and its next Down is fresh. The old pulse, Down 4 frames in
 * 10, locked against the crouch's 5 and 5: every fresh Down fell on the crouch's last
 * frame, and the CPU crouched above its target for minutes (nine matchups of the idle
 * table). Only the main floor is hard, so a grounded fighter above it stands on a soft
 * platform.
 */
export const platformMove: Behaviour = (ctx) => {
  const { self, target, dy } = ctx.view;
  if (!canAct(self) || !target) return NOTHING;
  if (!self.grounded) return climb(ctx);

  const aboveGround = self.y > ctx.stage.groundY + fx(4);

  if (dy < -VERTICAL_REACH && aboveGround) {
    // Standing on a soft platform with the target below it: fall through.
    return { score: 260, input: DROPS_FROM.includes(self.action) ? Btn.Down : 0 };
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

/**
 * In the air under a target standing on a soft platform above it (Plan 5 final wave, fix
 * round 1, ruling R-FW1k widened: the re-review's mario-samus on Battlefield, never a hit
 * in 120 s): get up on to that platform. Its full hop (`platformMove` on the ground) can
 * top out below the platform (Mario's at 17.6 under Battlefield's at 24.1), and below its
 * floor the target is out of every aerial's reach, so the swings `attack` threw there hit
 * nothing and spent the climb. So until its feet are above the target's floor: the stick
 * toward the target, no swing, and its midair jump at the top of the hop if it has one
 * (`jumpsUsed` below `ctx.jumps`): pressed from the top on (`vy` at or below zero) and
 * held, so one press is one jump. Above the floor it lands there, and the fight is
 * `attack`'s. Under
 * the target's own platform only (as `platformMove`'s jump), more than a unit below its
 * floor, and a target reeling on the platform is not standing there.
 */
function climb(ctx: BehaviourContext): BehaviourResult {
  const { self, target } = ctx.view;
  if (target === null || !target.grounded || REELING_ACTIONS.includes(ctx.view.targetAction)) return NOTHING;
  if (target.y <= ctx.stage.groundY + fx(4) || self.y >= target.y - fx(1)) return NOTHING;
  // Under the target's own platform, not another at its height (Battlefield's two sides).
  const its = ctx.stage.platforms.find((p) => abs(p.y - target.y) <= fx(1) && abs(p.x - target.x) <= p.halfWidth);
  if (its === undefined || abs(its.x - self.x) > its.halfWidth + fx(10)) return NOTHING;
  const jump = self.vy <= 0 && self.jumpsUsed < ctx.jumps ? Btn.Jump : 0;
  // Toward the target, but over the main stage while under the floor (fix round 2, ruling
  // R-FW1p): a target on Town & City's outer platforms stands past the ledge, and below
  // that platform there is no floor out there, where `recover` would take over. Above
  // it, over the platform, the fighter is over a floor (`overFloor`) and lands on it.
  const aim = Math.min(Math.max(target.x, ctx.stage.leftLedge), ctx.stage.rightLedge);
  return { score: 440, input: towardX(self.x, aim) | jump };
}

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
