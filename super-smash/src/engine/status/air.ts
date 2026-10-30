/**
 * Jump and landing statuses: JUMP_SQUAT, JUMP, FALL, LANDING,
 * LANDING_ATTACK_AIR (Plan 2, Task 11), and the helpless FALL_SPECIAL and its
 * LANDING_FALL_SPECIAL (Plan 5, Task 4b).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 */

import { JUMP_SQUAT_FRAMES } from "../constants";
import { kineticGroundJump, kineticSetY } from "../kinetic";
import { fighterParams } from "../params";
import { fastFallVelocity } from "../physics";
import { footstoolBounceHolds, tryFootstool } from "../footstool";
import { tryWallJump } from "../wallJump";
import {
  LANDING_ANIMATION_FRAMES,
  bufferPress,
  endStatus,
  handleActionable,
  landFromSpecialFall,
  peekBuffer,
  startAction,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

export const STATUS_JUMP_SQUAT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_JUMP_SQUAT",
  action: "jumpSquat",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame < JUMP_SQUAT_FRAMES) {
      // An attack pressed inside jumpsquat is Ultimate's short-hop aerial
      // macro: you cannot buffer a *full*-hop aerial, and an attack during
      // jumpsquat always produces a short hop. Buffering it directly rather
      // than through `bufferPress` because that would prefer a jump press on
      // the same frame, and it is the attack that decides the hop's height.
      if (intent.attackPressed) f.bufferedAction = { kind: "attack", frame: ctx.frame };
      return;
    }
    // Short hop vs. full hop is decided here and nowhere else: whether the
    // button is up on the frame jumpsquat ends — or whether an aerial is
    // already buffered, which forces the hop short whatever the jump key does.
    // Ultimate's universal 3-frame jumpsquat is what makes that a real
    // decision rather than a character-specific execution barrier.
    const short = !intent.jumpHeld || peekBuffer(f, ctx.frame) === "attack";
    kineticGroundJump(f, fighterParams(ctx.def), !short);
    // The 0.85× damage penalty rides on this flag for the whole airtime; see
    // `FighterState.shortHop` and SPEC §4.
    f.shortHop = short;
    f.grounded = false;
    f.platform = -1;
    f.jumpsUsed = 1;
    f.fastFalling = false;
    startAction(f, "jump");
  },
};

/** Shared by JUMP, FALL and DAMAGE_FALL: the airborne neutral state, rising or not. */
export function airMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (f.grounded) {
    startAction(f, "land");
    return;
  }
  // A footstool's bounce acts from its 8th frame (Plan 5, Task 11 fix round 1:
  // `footstoolBounceHolds`); until then a press waits, and the rise turns to a fall.
  if (footstoolBounceHolds(f, intent, ctx)) {
    if (f.vy <= 0 && f.action === "jump") startAction(f, "fall");
    return;
  }
  // A jump over somebody's head (Plan 5, Task 11: `footstool.ts`), which the game
  // tries before a wall jump, and after a special, an air dodge or an aerial
  // pressed with it (`airActionFirst`).
  if (tryFootstool(f, intent, ctx)) return;
  // A fresh press away from a wall just touched (Plan 5, Task 10: `wallJump.ts`),
  // after a footstool, and after a special, an air dodge or an aerial pressed with
  // it (`airActionFirst`; fix round 1, ruling R-T10e).
  if (tryWallJump(f, intent, ctx)) return;
  if (handleActionable(f, intent, ctx)) return;
  fastFallOnPress(f, intent, ctx);
  if (f.vy <= 0 && f.action === "jump") startAction(f, "fall");
}

/**
 * Fast fall is only available after the apex, which makes it a read on the
 * defender rather than a free way to shorten every jump.
 */
function fastFallOnPress(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (intent.downPressed && !f.fastFalling && f.vy <= 0 && f.hitstun === 0) {
    f.fastFalling = true;
    kineticSetY(f, fastFallVelocity(ctx.def.attributes));
  }
}

export const STATUS_JUMP: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_JUMP",
  action: "jump",
  kineticType: "FALL",
  main: airMain,
};

export const STATUS_FALL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_FALL",
  action: "fall",
  kineticType: "FALL",
  main: airMain,
};

export const STATUS_LANDING: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_LANDING",
  action: "land",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    // `charge` holds the light or heavy landing's length (see `onLanded`); a
    // landing that did not come through there plays the legacy four frames.
    if (f.actionFrame >= (f.charge > 0 ? f.charge : LANDING_ANIMATION_FRAMES)) endStatus(f, "stand", intent, ctx);
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_LANDING_ATTACK_AIR: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR",
  action: "landingLag",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    // `charge` carries the remaining lag; see `onLanded`.
    if (f.actionFrame >= f.charge) {
      f.charge = 0;
      endStatus(f, "stand", intent, ctx);
    } else bufferPress(f, intent, ctx.frame);
  },
};

/** Both helpless statuses forget their move however they are left (`CombatState.helplessMove`). */
function forgetHelplessMove(f: FighterState): void {
  f.combat.helplessMove = null;
}

/**
 * FALL_SPECIAL (Plan 5, Task 4b): helpless, after a move that ends so
 * (`MoveDef.helpless`, `startSpecialFall`). SmashWiki "Helpless"
 * (https://www.ssbwiki.com/Helpless): "unable to take any action, with the
 * exception of grabbing a ledge, maneuvering left/right, fastfalling ... until
 * they land on the ground or pass a blast line". So no press is read or
 * buffered here but the fast fall's. The rest is other phases': the drift is
 * `applyMovement`'s, at the move's own top speed (`HelplessDef.airSpeed`); the
 * ledge is `findLedgeGrab`'s, as any falling fighter's; the landing is
 * `onLanded`'s (`specialLanding`); and a hit's reel ends it, as the page says a
 * flinch does ("it also ends if characters flinch, allowing them to attack").
 */
export const STATUS_FALL_SPECIAL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_FALL_SPECIAL",
  action: "specialFall",
  kineticType: "FALL",
  main(f, intent, ctx) {
    // Never grounded here: touching the floor lands it (`onLanded`). A state
    // built so lands on its first frame.
    if (f.grounded) {
      landFromSpecialFall(f, ctx.def);
      return;
    }
    fastFallOnPress(f, intent, ctx);
  },
  end: forgetHelplessMove,
};

/**
 * LANDING_FALL_SPECIAL (Plan 5, Task 4b): the special landing, for the lag of
 * the move that left the fighter helpless (`landFromSpecialFall`), timed as an
 * aerial's landing lag is: `charge` carries it, and a press made during it
 * fires once it is over.
 */
export const STATUS_LANDING_FALL_SPECIAL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_LANDING_FALL_SPECIAL",
  action: "specialLanding",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= f.charge) {
      f.charge = 0;
      endStatus(f, "stand", intent, ctx);
    } else bufferPress(f, intent, ctx.frame);
  },
  end: forgetHelplessMove,
};

export const AIR_STATUSES: readonly FighterStatus[] = [
  STATUS_JUMP_SQUAT,
  STATUS_JUMP,
  STATUS_FALL,
  STATUS_LANDING,
  STATUS_LANDING_ATTACK_AIR,
  STATUS_FALL_SPECIAL,
  STATUS_LANDING_FALL_SPECIAL,
];
