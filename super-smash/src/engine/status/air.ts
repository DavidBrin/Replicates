/**
 * Jump and landing statuses: JUMP_SQUAT, JUMP, FALL, LANDING,
 * LANDING_ATTACK_AIR (Plan 2, Task 11).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 */

import { JUMP_SQUAT_FRAMES } from "../constants";
import { kineticGroundJump, kineticSetY } from "../kinetic";
import { fighterParams } from "../params";
import { fastFallVelocity } from "../physics";
import {
  LANDING_ANIMATION_FRAMES,
  bufferPress,
  handleActionable,
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

/** Shared by JUMP and FALL: the airborne neutral state, rising or not. */
function airMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (f.grounded) {
    startAction(f, "land");
    return;
  }
  if (handleActionable(f, intent, ctx)) return;
  // Fast fall is only available after the apex, which makes it a read on the
  // defender rather than a free way to shorten every jump.
  if (intent.downPressed && !f.fastFalling && f.vy <= 0 && f.hitstun === 0) {
    f.fastFalling = true;
    kineticSetY(f, fastFallVelocity(ctx.def.attributes));
  }
  if (f.vy <= 0 && f.action === "jump") startAction(f, "fall");
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
    if (f.actionFrame >= (f.charge > 0 ? f.charge : LANDING_ANIMATION_FRAMES)) startAction(f, "stand");
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
      startAction(f, "stand");
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const AIR_STATUSES: readonly FighterStatus[] = [
  STATUS_JUMP_SQUAT,
  STATUS_JUMP,
  STATUS_FALL,
  STATUS_LANDING,
  STATUS_LANDING_ATTACK_AIR,
];
