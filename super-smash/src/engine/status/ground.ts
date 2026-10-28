/**
 * Grounded neutral statuses: WAIT, WALK, DASH, RUN, RUN_BRAKE, TURN_RUN,
 * SQUAT, SQUAT_WAIT, SQUAT_RV (Plan 2, Task 10).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim. WAIT,
 * WALK, DASH and RUN share one `main`, as they shared one case: the
 * walk/dash/run ladder is a single decision read from the same input.
 */

import { DASH_INTERRUPT_FRAME } from "../constants";
import {
  CROUCH_END_FRAMES,
  CROUCH_START_FRAMES,
  RUN_BRAKE_FRAMES,
  TURNAROUND_FRAMES,
  handleActionable,
  startAction,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

function groundMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (!f.grounded) {
    startAction(f, "fall");
    return;
  }
  if (handleActionable(f, intent, ctx)) return;
  if (intent.y < 0 && f.action === "stand") {
    startAction(f, "crouchStart");
    return;
  }
  if (intent.x === 0) {
    if (f.action === "run") startAction(f, "runBrake");
    else if (f.action !== "stand") startAction(f, "stand");
    return;
  }
  if (intent.x !== f.facing) {
    f.facing = intent.x;
    // Reversing out of a run costs a turnaround; reversing out of an initial
    // dash does not, and that asymmetry is exactly what dash-dancing is.
    if (f.action === "run") {
      startAction(f, "turnaround");
      return;
    }
    if (f.action === "dashStart") {
      startAction(f, "dashStart");
      return;
    }
    // From a standstill or a walk, though, a reversal is just a fresh
    // direction press and takes the same walk-then-dash path as any other,
    // below. Committing it to `dashStart` here instead would hand a
    // one-frame tap the full initial-dash burst — around 19 units of slide
    // for Mario, a quarter of Battlefield — and there would be no way at all
    // to make a small movement away from the way you happen to be facing.
  }
  if (f.action === "dashStart") {
    if (f.actionFrame >= DASH_INTERRUPT_FRAME) startAction(f, "run");
    return;
  }
  if (f.action === "run") return;
  /*
   * Held three frames or less is a walk; past that it becomes a dash.
   *
   * This reads oddly against SPEC §6 — if any sustained hold becomes a dash,
   * when does anybody walk? — and the answer is that they do not, and should
   * not. **A key is always a full deflection.** In Ultimate a fully deflected
   * stick dashes and then runs; walking requires a *partial* tilt, which is a
   * distinction a keyboard has no way to express at all (a gamepad's partial
   * tilt arrives as `Btn.Soft`, Plan 1, and clears `wantsDash`). So "hold =
   * dash" is the faithful translation of a held key, not a missing feature.
   *
   * What the window buys is the other half of the analog stick's range. The
   * brief step before the dash commits is what a tap produces, and a tap is
   * therefore the keyboard's micro-spacing tool.
   *
   * Do not "fix" this by inverting it.
   */
  if (intent.wantsDash) startAction(f, "dashStart");
  else if (f.action !== "walk") startAction(f, "walk");
}

export const STATUS_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_WAIT",
  action: "stand",
  kineticType: "GROUND_STOP",
  main: groundMain,
};

export const STATUS_WALK: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_WALK",
  action: "walk",
  kineticType: "WALK",
  main: groundMain,
};

export const STATUS_DASH: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DASH",
  action: "dashStart",
  kineticType: "DASH",
  main: groundMain,
};

export const STATUS_RUN: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_RUN",
  action: "run",
  kineticType: "RUN",
  main: groundMain,
};

export const STATUS_RUN_BRAKE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_RUN_BRAKE",
  action: "runBrake",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (handleActionable(f, intent, ctx)) return;
    if (f.actionFrame >= RUN_BRAKE_FRAMES) startAction(f, "stand");
  },
};

export const STATUS_TURN_RUN: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_TURN_RUN",
  action: "turnaround",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= TURNAROUND_FRAMES) startAction(f, "stand");
  },
};

export const STATUS_SQUAT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SQUAT",
  action: "crouchStart",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= CROUCH_START_FRAMES) startAction(f, "crouch");
  },
};

export const STATUS_SQUAT_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SQUAT_WAIT",
  action: "crouch",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (handleActionable(f, intent, ctx)) return;
    if (intent.y >= 0) startAction(f, "crouchEnd");
  },
};

export const STATUS_SQUAT_RV: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SQUAT_RV",
  action: "crouchEnd",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= CROUCH_END_FRAMES) startAction(f, "stand");
  },
};

export const GROUND_STATUSES: readonly FighterStatus[] = [
  STATUS_WAIT,
  STATUS_WALK,
  STATUS_DASH,
  STATUS_RUN,
  STATUS_RUN_BRAKE,
  STATUS_TURN_RUN,
  STATUS_SQUAT,
  STATUS_SQUAT_WAIT,
  STATUS_SQUAT_RV,
];
