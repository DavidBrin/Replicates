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

import { SMASH_CHARGE_MAX, SMASH_FULL_CHARGE_HOLD } from "../constants";
import { smashHoldFrame } from "../acmd/run";
import { actionFrameOf, clearHitRecord, moveFrameOf } from "../hitbox";
import { landPendingCopyLoss } from "../inhale";
import { endDash, inDash, nextFinalPhase, refreshFinalJumps } from "../final";
import { specialChargeMain } from "../specialCharge";
import { stoneMain } from "../stone";
import { upSpecialStick } from "../upSpecial";
import { reflectorMain, specialStallExec } from "../reflect";
import { liftCargo } from "./cargo";
import { releaseHeld, struggleInGrab } from "./grab";
import {
  PUMMEL_FRAMES,
  THROW_FRAMES,
  bufferPress,
  endsHelpless,
  handOff,
  handleActionable,
  hasMove,
  moveEndFrame,
  presses,
  startAction,
  startMove,
  startSpecialFall,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState, MoveDef, MoveSlot } from "../types";
import type { FighterStatus } from "./kind";

/** ATTACK and SPECIAL run the same body: the move in `f.move` decides everything. */
function attackMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
  if (move === undefined) {
    startAction(f, f.grounded ? "stand" : "fall");
    return;
  }
  // A reflector loops and turns (Plan 5, `reflect.ts`).
  if (f.action === "special" && move.reflector !== undefined && reflectorMain(f, intent, ctx, move.reflector)) return;
  // A charging special reads B, never the attack button (Plan 5).
  if (f.action === "special" && move.specialCharge !== undefined && specialChargeMain(f, intent, ctx, move.specialCharge)) {
    return;
  }
  // A special that loops while B is held (Plan 5, Task 9 fix round 1: Kirby's Inhale).
  if (f.action === "special" && move.holdLoop !== undefined) holdLoopMain(f, intent, move.holdLoop);
  // A special that holds a stone (Plan 5, Task 13 fix round 2, R-T13j: Kirby's Stone).
  if (f.action === "special" && move.stone !== undefined) stoneMain(f, intent, move.stone);
  // An up special's stick: its turn and its aims (Plan 5, Task 13b: `upSpecial.ts`),
  // and a descent that holds its frame until it lands (`MoveDef.descentHold`).
  if (f.action === "special") {
    if (move.turn !== undefined || move.aim !== undefined) upSpecialStick(f, move, intent);
    if (move.descentHold !== undefined && !f.grounded && moveFrameOf(f.actionFrame) > move.descentHold) {
      f.actionFrame = actionFrameOf(move.descentHold);
    }
  }
  // Charging a smash holds the animation on its hold frame (`smashHoldFrame`): the
  // move's published one where it has one (`MoveDef.smashHold`, the first frame of
  // SmashWiki's "Charges between", ruling R-T13i), else the frame before its script
  // raises START_SMASH_HOLD (R-T13e), else the frame before its earliest hitbox goes
  // live (ruling P5-R15), so nothing can be hit while it charges.
  // Whether it charges is decided on the hold frame: it charges if and only if
  // Attack is held there (the Task 13 tail, ruling R-T13n), then while it stays
  // held, up to the full hold; a release closes it, and once let go Attack does not
  // touch the move again (fix round 3, ruling R-T13l; `CombatState.smashLetGo`).
  // SmashWiki "Smash attack" (https://www.ssbwiki.com/Smash_attack, revision
  // 2062630): "they can be charged by holding the buttons down"; "the move's
  // script calling for a command on a certain frame to determine whether the
  // attack will be charged or not" (UNVERIFIED for Ultimate: that sentence is in
  // the page's Smash 4 section, and its Ultimate section does not restate it).
  // The full hold is 60 frames of charge and `SMASH_FULL_CHARGE_HOLD` more at full
  // power (R-T13o; `chargeMultiplier` stops at 60), then it goes on its own.
  // UNVERIFIED: that the step reaching the hold frame is the first of the published
  // 60 ("up to 60 frames"; UltimateFrameData's "Charge hold is frame X" says no more).
  // Counted so, a full charge holds the frame 59 steps longer than a tap.
  if (f.action === "attack" && move.chargeable) {
    const holdFrame = smashHoldFrame(ctx.def, f);
    if (f.actionFrame >= holdFrame && !intent.attackHeld) f.combat.smashLetGo = true;
    if (!f.combat.smashLetGo && f.charge < SMASH_CHARGE_MAX + SMASH_FULL_CHARGE_HOLD && f.actionFrame >= holdFrame) {
      f.actionFrame = holdFrame;
      f.charge += 1;
      return;
    }
  }
  if (move.followUp !== undefined && intent.attackPressed && f.actionFrame >= 3 && hasMove(ctx, move.followUp)) {
    startMove(f, "attack", move.followUp);
    return;
  }
  // A dash that a second special press stops (`MoveDef.dashEnd`; Plan 5, Task 15 fix
  // round 1, ruling R-T15f): SmashWiki "Marth (SSBU)" (https://www.ssbwiki.com/Marth_(SSBU)),
  // "Pressing the special button again will cause him to stop mid-dash".
  if (f.action === "special" && move.dashEnd?.special === true && intent.specialPressed && inDash(f, move)) endDash(f, move);
  // A Final Smash part with a `nextAt` goes on to its next part from that frame once
  // it has trapped anybody (Plan 5, Task 15: `final.ts`); a whiff plays it all.
  if (move.final?.nextAt !== undefined && moveFrameOf(f.actionFrame) >= move.final.nextAt && nextFinalPhase(f, ctx, move.final.next) !== null) {
    return;
  }
  // `totalFrames` is UFD's "Total frames" T: the move's frames 1..T, and the
  // fighter acts on frame T + 1, this one (`handOff`). A stored full charge
  // ends on its own published frame (`moveEndFrame`, Plan 5).
  if (f.actionFrame >= moveEndFrame(f, move)) {
    // A Final Smash goes on to its next part if it has trapped anybody (Plan 5,
    // Task 14: `final.ts`); the part entered counts this frame as its frame 1.
    if (move.final !== undefined && nextFinalPhase(f, ctx, move.final.next) !== null) return;
    // A Final Smash that ends in the air gives back its user's midair jumps (Task 16
    // fix round 1, ruling R-T16b: `refreshFinalJumps`).
    if (move.final !== undefined) refreshFinalJumps(f);
    // In the air a move with a longer aerial animation plays on to its end
    // unless the fighter acts (`MoveDef.airTotalFrames`, Plan 5: Mario's Cape,
    // SmashWiki "Mario (SSBU)": "forcing the player to have to interrupt the
    // move with an aerial or special"). UNVERIFIED: that an air dodge or a jump
    // interrupts it too, as at any other interruptible frame (`handleActionable`).
    if (!f.grounded && move.airTotalFrames !== undefined && f.actionFrame < move.airTotalFrames) {
      handleActionable(f, intent, ctx);
      return;
    }
    // A move that ends helpless leaves its fighter in special fall when it ends
    // in the air (Plan 5, Task 4b; `MoveDef.helpless`).
    const slot = f.move;
    if (slot !== null && endsHelpless(f, move)) {
      startSpecialFall(f, slot);
      return;
    }
    handOff(f, f.grounded ? "stand" : "fall", intent, ctx);
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

/**
 * One frame of a move's held loop (`MoveDef.holdLoop`). Its first time round is
 * the move's own frames, `from`..`to`, held or not; then, while B is held as it
 * steps past `to`, it goes back to `from`, and B let go on a later time round
 * sends it straight on to `to + 1`. `charge` counts the extra times round (the
 * move has no charge of its own), so the two are told apart.
 *
 * Kirby's Inhale (SmashWiki "Inhale (Kirby)", https://www.ssbwiki.com/Inhale_(Kirby):
 * "Kirby will not stop inhaling until the button is released"; SmashWiki "Kirby
 * (SSBU)/Neutral special", https://www.ssbwiki.com/Kirby_(SSBU)/Neutral_special:
 * "Loop 11-44", "Minimum inhale duration 34 frames", "Interruptible (from release)
 * 64 (20)", "After one full loop, the move can be ended by releasing the special
 * move button at any point"): the loop's 34 frames always play, and Kirby acts 20
 * frames after B comes up past them. UNVERIFIED: that a held loop repeats frames
 * 35-44. Nothing publishes the frames a held loop repeats (the page's "Loop
 * points 10-11, 34-35" reads as the start handing to the loop, and the 34-frame
 * loop, 11-44, wrapping); 35-44 keeps the
 * published live boxes, the catch throughout and a pull every 10 frames (its
 * "rehit rate: 10"), where repeating 11-44 would pull at 10, 10, 10 and 4. No
 * maximum hold is published.
 */
function holdLoopMain(f: FighterState, intent: Intent, loop: NonNullable<MoveDef["holdLoop"]>): void {
  const frame = moveFrameOf(f.actionFrame);
  if (frame === loop.to + 1) {
    if (intent.specialHeld) {
      f.actionFrame = actionFrameOf(loop.from);
      f.charge += 1;
    } else f.charge = 0;
    return;
  }
  if (f.charge > 0 && !intent.specialHeld && frame >= loop.from && frame <= loop.to) {
    f.actionFrame = actionFrameOf(loop.to + 1);
    f.charge = 0;
  }
}

/**
 * A special's per-move bookkeeping (Plan 5): nothing of one special rides into
 * the next status. A counter that catches something starts its counterattack
 * through here too (`triggerCounter`), and sets the counterattack's damage after.
 */
function clearSpecialMove(f: FighterState): void {
  f.combat.stalling = false;
  f.combat.reflectHold = 0;
  f.combat.counterDamage = 0;
  f.combat.stoneFrames = 0;
  f.combat.stoneTaken = 0;
  f.combat.stoneEndedAir = false;
  f.combat.aimX = 0;
  f.combat.aimY = 0;
  f.combat.turned = false;
}

export const STATUS_SPECIAL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SPECIAL",
  action: "special",
  kineticType: "FALL",
  pre(f) {
    clearHitRecord(f);
    // Plan 5: a special's per-move bookkeeping starts clean.
    clearSpecialMove(f);
  },
  main: attackMain,
  exec(f, _intent, ctx, gravityBefore) {
    const stall = f.move === null ? undefined : ctx.def.moves[f.move]?.stall;
    if (stall !== undefined) specialStallExec(f, ctx, stall, gravityBefore);
  },
  // ...and ends clean, however the special ends: its own end, a hit, a grab, a
  // ledge, a landing or a KO. A Copy Ability lost during the copied special goes
  // now, with the move (Plan 5, Task 9 fix round 1, ruling R-T9d).
  end(f) {
    clearSpecialMove(f);
    landPendingCopyLoss(f);
  },
};

export const STATUS_CATCH: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CATCH",
  action: "grab",
  kineticType: "FALL",
  pre: clearHitRecord,
  main(f, intent, ctx) {
    if (f.grabbing >= 0) {
      // The escape timer is the victim's, set when the grab connected (Plan 3, Task 14).
      startAction(f, "grabHold");
      return;
    }
    const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
    if (f.actionFrame >= (move?.totalFrames ?? 30)) {
      handOff(f, f.grounded ? "stand" : "fall", intent, ctx);
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_CATCH_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CATCH_WAIT",
  action: "grabHold",
  kineticType: "FALL",
  main(f, intent, ctx) {
    // The hold is over when the link is broken, or, as a backstop, when the
    // victim has left `grabbed` with it intact. The escape timer is the victim's
    // and only runs in `grabbed`, so with no one counting a hold nobody throws
    // would never end; the captor's own timer used to be that guarantee (Task
    // 14). Nothing should leave a held fighter's status now that it is held at
    // its captor, but a hold must not depend on that.
    if (f.grabbing < 0 || ctx.fighters[f.grabbing]?.action !== "grabbed") {
      releaseHeld(f, ctx.fighters);
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
  main(f, intent, ctx) {
    // A press on any frame of the pummel, the last included, is kept for the hold it
    // hands off to (a second pummel, a throw), as in every other status: the input
    // buffer is for every action (Plan 3 final wave, part 4).
    //
    // It lasts its move, as an attack does: a pummel run from its script ends on
    // the script's first actionable frame − 1, 5 to 7 frames on this roster
    // (rubendal `CancelFrame` 6 to 8; ruling P5-R10), after its freeze.
    const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
    if (f.actionFrame >= (move?.totalFrames ?? PUMMEL_FRAMES)) handOff(f, "grabHold", intent, ctx);
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_THROW: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_THROW",
  action: "throw",
  kineticType: "FALL",
  pre: clearHitRecord,
  main(f, intent, ctx) {
    const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
    if (f.actionFrame >= (move?.totalFrames ?? THROW_FRAMES)) {
      // Donkey Kong's forward throw ends with the fighter on his shoulders, if he
      // still holds them (Plan 5, Task 8: `liftCargo`).
      if (move?.cargo === true && liftCargo(f, intent, ctx)) return;
      // A throw normally releases through its `ATK_HIT_ABS` (`resolveThrows`),
      // but a throw that lands none (an unauthored one, or one whose victim
      // was taken away mid-animation) would otherwise end with the link still
      // tying two fighters together. The animation finishing is the backstop:
      // nobody is held once the throw is over.
      releaseHeld(f, ctx.fighters);
      handOff(f, f.grounded ? "stand" : "fall", intent, ctx);
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_CAPTURE_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CAPTURE_WAIT",
  action: "grabbed",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.grabbedBy < 0) {
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }
    struggleInGrab(f, intent, ctx);
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
