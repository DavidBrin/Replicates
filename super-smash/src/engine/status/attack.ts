/**
 * Attack and catch statuses: ATTACK, SPECIAL, CATCH, CATCH_WAIT,
 * CATCH_ATTACK, THROW, CAPTURE_WAIT, THROWN (Plan 2, Task 8).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim. The
 * one-swing-one-hit record (`hitThisMove`) is now reset in the `pre` of every
 * status that swings, which is where the game resets its AttackModule; it was
 * reset by `startMove`, the only way into these statuses, on the same frame.
 * `startMove` still resets it too, so a test fixture that skips the registry
 * behaves the same.
 *
 * `pre` runs before `startMove` sets `f.move` and `f.charge`, so nothing here
 * may read them on entry. `clearHitRecord` does not.
 */

import { SMASH_CHARGE_MAX } from "../constants";
import { chargeHoldFrame, clearHitRecord } from "../hitbox";
import {
  GRAB_HOLD_FRAMES,
  PUMMEL_FRAMES,
  THROW_FRAMES,
  bufferPress,
  hasMove,
  presses,
  releaseGrab,
  startAction,
  startMove,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState, MoveSlot } from "../types";
import type { FighterStatus } from "./kind";

/** ATTACK and SPECIAL run the same body: the move in `f.move` decides everything. */
function attackMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
  if (move === undefined) {
    startAction(f, f.grounded ? "stand" : "fall");
    return;
  }
  // Charging a smash holds the animation on the frame before its earliest
  // hitbox goes live (`chargeHoldFrame`), so nothing can be hit while it charges.
  if (move.chargeable && f.charge < SMASH_CHARGE_MAX && intent.attackHeld) {
    const holdFrame = chargeHoldFrame(move);
    if (f.actionFrame >= holdFrame) {
      f.actionFrame = holdFrame;
      f.charge += 1;
      return;
    }
  }
  if (move.followUp !== undefined && intent.attackPressed && f.actionFrame >= 3 && hasMove(ctx, move.followUp)) {
    startMove(f, "attack", move.followUp);
    return;
  }
  if (f.actionFrame >= move.totalFrames) {
    startAction(f, f.grounded ? "stand" : "fall");
    return;
  }
  bufferPress(f, intent, ctx.frame);
}

export const STATUS_ATTACK: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ATTACK",
  action: "attack",
  kineticType: "FALL",
  pre: clearHitRecord,
  main: attackMain,
};

export const STATUS_SPECIAL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SPECIAL",
  action: "special",
  kineticType: "FALL",
  pre: clearHitRecord,
  main: attackMain,
};

export const STATUS_CATCH: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CATCH",
  action: "grab",
  kineticType: "FALL",
  pre: clearHitRecord,
  main(f, intent, ctx) {
    if (f.grabbing >= 0) {
      startAction(f, "grabHold");
      f.grabTimer = GRAB_HOLD_FRAMES;
      return;
    }
    const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
    if (f.actionFrame >= (move?.totalFrames ?? 30)) {
      startAction(f, f.grounded ? "stand" : "fall");
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_CATCH_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CATCH_WAIT",
  action: "grabHold",
  kineticType: "FALL",
  main(f, intent, ctx) {
    if (f.grabbing < 0) {
      releaseGrab(f, ctx.fighters);
      startAction(f, "stand");
      return;
    }
    f.grabTimer -= 1;
    if (f.grabTimer <= 0) {
      releaseGrab(f, ctx.fighters);
      startAction(f, "stand");
      return;
    }
    const p = presses(f, intent, ctx.frame);
    if (p.attack && hasMove(ctx, "pummel")) {
      startMove(f, "pummel", "pummel");
      return;
    }
    const throwSlot: MoveSlot | null =
      intent.y > 0
        ? "uthrow"
        : intent.y < 0
          ? "dthrow"
          : intent.x === f.facing
            ? "fthrow"
            : intent.x === -f.facing
              ? "bthrow"
              : null;
    if (throwSlot !== null && hasMove(ctx, throwSlot)) {
      startMove(f, "throw", throwSlot);
      // The victim is being carried now, not held. `thrown` and `grabbed`
      // are different animations for a reason — one is a fighter struggling
      // against a grip, the other is a fighter already committed to a
      // trajectory — and until now nothing ever entered `thrown`, so the
      // second of them could not happen.
      const carried = f.grabbing >= 0 ? ctx.fighters[f.grabbing] : undefined;
      if (carried !== undefined && carried.grabbedBy === f.port) {
        startAction(carried, "thrown");
      }
    }
  },
};

export const STATUS_CATCH_ATTACK: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CATCH_ATTACK",
  action: "pummel",
  kineticType: "FALL",
  pre: clearHitRecord,
  main(f) {
    if (f.actionFrame >= PUMMEL_FRAMES) startAction(f, "grabHold");
  },
};

export const STATUS_THROW: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_THROW",
  action: "throw",
  kineticType: "FALL",
  pre: clearHitRecord,
  main(f, _intent, ctx) {
    const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
    if (f.actionFrame >= (move?.totalFrames ?? THROW_FRAMES)) {
      // A throw normally releases through its own hitbox connecting, but a
      // throw whose hitbox never lands (an unauthored one, or one whose
      // victim was taken away mid-animation) would otherwise end with the
      // link still tying two fighters together. The animation finishing is
      // the backstop: nobody is held once the throw is over.
      releaseGrab(f, ctx.fighters);
      startAction(f, f.grounded ? "stand" : "fall");
    }
  },
};

export const STATUS_CAPTURE_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CAPTURE_WAIT",
  action: "grabbed",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.grabbedBy < 0) startAction(f, f.grounded ? "stand" : "fall");
  },
};

export const STATUS_THROWN: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_THROWN",
  action: "thrown",
  kineticType: "GROUND_STOP",
  main(f) {
    // Still in the thrower's hands: the release is the throw's hitbox
    // connecting, which `applyHit` turns into hitstun or tumble. Leaving on
    // `hitstun <= 0` alone would end the carry on its first frame.
    if (f.grabbedBy >= 0) return;
    if (f.hitstun <= 0) startAction(f, f.grounded ? "stand" : "fall");
  },
};

export const ATTACK_STATUSES: readonly FighterStatus[] = [
  STATUS_ATTACK,
  STATUS_SPECIAL,
  STATUS_CATCH,
  STATUS_CATCH_WAIT,
  STATUS_CATCH_ATTACK,
  STATUS_THROW,
  STATUS_CAPTURE_WAIT,
  STATUS_THROWN,
];
