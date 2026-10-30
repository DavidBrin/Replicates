/**
 * Cargo (Plan 5, Task 8): Donkey Kong's forward throw lifts the fighter he holds
 * onto his shoulders, and he carries them — walking, turning and jumping —
 * until he throws them in any of four directions or they struggle free.
 *
 * SmashWiki "Donkey Kong (SSBU)/Forward throw"
 * (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Forward_throw):
 * - "The carry's duration is equal to ((90 + 1.7p) * 11 / 6) - g, where p is the
 *   opponent's percent at the time of the carry's initiation, and g is the grab
 *   time passed prior to it": "165 frames if initiated immediately out of a grab,
 *   and 105 frames if initiated after 60 grab frames" at 0%;
 * - "As with standard grabs, button mashing reduces this amount by 8 frames per
 *   stick input, and 14.4 frames per button input";
 * - "while carrying an opponent or heavy item, Donkey Kong's walk speed and
 *   acceleration are increased by 1.1×".
 * SmashWiki "Donkey Kong (SSBU)" (https://www.ssbwiki.com/Donkey_Kong_(SSBU)),
 * Kong Karry: g is the grab time passed "(including button mashing)", and grab
 * time is fixed at the grab, "not affected by pummeling or external damage"
 * (SmashWiki "Grab", https://www.ssbwiki.com/Grab), so g is the grab's own length
 * less what is left of it (`CombatState.grabLength`; Task 8 fix round 1). In the
 * carry he acts as usual "aside from being unable to use his other moves and
 * having only one jump" (the page's overview): his ground jump, and no air jump.
 * SmashWiki "Forward throw" (https://www.ssbwiki.com/Forward_throw, "Notable
 * forward throws"): the cargo "allows Donkey Kong to move and jump while holding
 * the opponent, as well as perform four cargo throws ... by pressing the attack
 * button alongside a direction", and "like regular grabs, the carried opponent
 * can break free via button mashing, triggering a grab release".
 *
 * SSBU's statuses (skyline-smash `lua_const.rs`,
 * https://github.com/ultimate-research/skyline-smash/blob/0c2e7189c46fecb07a3370f487e0e22585dad21e/src/lua_const.rs):
 * the carrier's FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT, _WALK, _TURN,
 * _JUMP_SQUAT, _JUMP, _FALL and _LANDING are one replica status, `cargoCarry`;
 * the carried fighter's FIGHTER_STATUS_KIND_SHOULDERED_DONKEY is `cargoHeld`.
 * Where it rides is `held.ts`.
 *
 * UNVERIFIED, the replica's readings where nothing is published:
 * - The formula's rounding: here the hold's whole frames at today's percent
 *   (`grabHoldFrames`, floor(90 + 1.7p)) × 11 / 6, rounded down.
 * - The carry keeps the grab's floor (`GRAB_MIN_FRAMES`, 19 frames: SmashWiki
 *   "Grab" says it of grab time); nothing is struggled during the lift itself.
 * - The jump is his full hop at once: the motions `shoulder_jump_squat` and
 *   `shoulder_landing` exist (rubendal Motions, below), but no frames are
 *   published for them, so there is no squat, no short hop and no landing lag.
 * - He turns at once, and only on the ground (the `shoulder_turn` motion's
 *   length is unpublished).
 * - A press with no direction throws forward, a diagonal throws up or down (as a
 *   hold reads its throws), and the grab button throws as the attack button does
 *   (SmashWiki names the attack button with a direction).
 * - In the air he drifts by his own air control (`kineticExec`'s WALK).
 * rubendal SSBU Data Viewer, patch 13.0.1
 * (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Donkey%20Kong/data.json),
 * Motions: `shoulder_wait`, `shoulder_walk_slow`/`_middle`/`_fast`, `shoulder_turn`,
 * `shoulder_jump_squat`, `shoulder_jump`, `shoulder_fall`, `shoulder_landing`.
 */

import { fx } from "../fixed";
import { kineticGroundJump } from "../kinetic";
import { fighterParams } from "../params";
import { grabHoldFrames, handOff, hasMove, presses, startAction, startMove } from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState, MoveSlot } from "../types";
import { releaseHeld, struggleInGrab } from "./grab";
import type { FighterStatus } from "./kind";

/** ×1.1 walk speed and acceleration while carrying (SmashWiki, above). */
export const CARGO_WALK = fx(1.1);

/**
 * The cargo throw for a stick held relative to the carrier's facing: up and down
 * before forward and back, as a hold reads its throws (`STATUS_CATCH_WAIT`), and
 * forward with the stick neutral (UNVERIFIED, above).
 */
export function cargoThrowSlot(x: number, y: number, facing: number): MoveSlot {
  if (y > 0) return "cargoUthrow";
  if (y < 0) return "cargoDthrow";
  if (x !== 0 && x !== facing) return "cargoBthrow";
  return "cargoFthrow";
}

/**
 * The end of the lift (`MoveDef.cargo`, Donkey Kong's forward throw; its script
 * raises SHOULDER_WAIT on frame 16): the fighter held rides on the thrower's
 * shoulders, and the thrower carries them from this frame, his first actionable
 * one (`handOff`). Their struggle timer becomes the carry's,
 * `((90 + 1.7p) · 11/6) − g`. False, changing nothing, when nobody is held any
 * more: the throw then ends as any other.
 */
export function liftCargo(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  const held = f.grabbing >= 0 ? ctx.fighters[f.grabbing] : undefined;
  if (held === undefined || held.grabbedBy !== f.port || held.action === "dead") return false;
  // p is the percent now, at the carry's start; g is the grab time passed, from
  // the grab's own length, which no damage since the catch changes.
  const spent = Math.max(0, held.combat.grabLength - held.grabTimer);
  held.grabTimer = Math.floor((grabHoldFrames(held.damage) * 11) / 6) - spent;
  startAction(held, "cargoHeld");
  handOff(f, "cargoCarry", intent, ctx);
  return true;
}

export const STATUS_CARGO_CARRY: FighterStatus = {
  kind: "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT",
  action: "cargoCarry",
  kineticType: "WALK",
  walkMul: CARGO_WALK,
  main(f, intent, ctx) {
    // The carry is over when the link is broken (a struggle out, a hit or a grab
    // on either end, a KO), or, as a backstop, when the fighter carried has left
    // the carry with it intact, as a hold ends (`STATUS_CATCH_WAIT`).
    const held = f.grabbing >= 0 ? ctx.fighters[f.grabbing] : undefined;
    if (held === undefined || held.grabbedBy !== f.port || held.action !== "cargoHeld") {
      releaseHeld(f, ctx.fighters);
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }
    // A throw, on the ground or in the air: the input buffer reaches the carry as
    // it does every status, so a press during the lift throws on its first frame.
    const p = presses(f, intent, ctx.frame);
    if (p.attack || p.grab) {
      const slot = cargoThrowSlot(intent.x, intent.y, f.facing);
      if (hasMove(ctx, slot)) {
        startMove(f, "throw", slot);
        startAction(held, "thrown");
        return;
      }
    }
    if (f.grounded && intent.x !== 0) f.facing = intent.x;
    // "Having only one jump" (SmashWiki "Donkey Kong (SSBU)"): from the ground.
    if (p.jump && f.grounded) {
      kineticGroundJump(f, fighterParams(ctx.def), true);
      f.shortHop = false;
      f.grounded = false;
      f.platform = -1;
      f.jumpsUsed = 1;
      f.fastFalling = false;
    }
  },
};

export const STATUS_CARGO_HELD: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY",
  action: "cargoHeld",
  kineticType: "NONE",
  main(f, intent, ctx) {
    // Let go of by anything but a struggle: a hit on the carrier, a grab on him,
    // his KO. Carried aloft, the fighter falls from where it rode.
    if (f.grabbedBy < 0) {
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }
    // The grab's own struggle (Plan 3, Task 14): the same mash rates, the same
    // release and its 60 frames of grab immunity.
    struggleInGrab(f, intent, ctx);
  },
};

export const CARGO_STATUSES: readonly FighterStatus[] = [STATUS_CARGO_CARRY, STATUS_CARGO_HELD];
