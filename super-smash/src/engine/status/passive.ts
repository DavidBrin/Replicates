/**
 * Tech statuses (Plan 3, Task 12): PASSIVE (tech in place), PASSIVE_FB (tech
 * roll), PASSIVE_WALL, PASSIVE_CEIL — skyline-smash `lua_const.rs` names.
 *
 * A fighter enters one from `techOrBounce` (`tech.ts`) on the frame its
 * tumbling body meets a surface with a tech input live. The intangible frames
 * come from `dodgeWindow` (`states.ts`), like a roll's; velocity changes go
 * through the KineticModule only.
 */

import {
  TECH_CEILING_FRAMES,
  TECH_FRAMES,
  TECH_ROLL_FRAMES,
  TECH_WALL_FRAMES,
  TECH_WALL_INTERRUPT,
} from "../constants";
import { kineticSetX } from "../kinetic";
import { bufferPress, handleActionable, startAction } from "../states";
import type { FighterStatus } from "./kind";

export const STATUS_PASSIVE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_PASSIVE",
  action: "tech",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= TECH_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_PASSIVE_FB: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_PASSIVE_FB",
  action: "techRoll",
  kineticType: "MOTION",
  main(f, intent, ctx) {
    if (f.actionFrame >= TECH_ROLL_FRAMES) {
      kineticSetX(f, 0, "stop");
      startAction(f, "stand");
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_PASSIVE_WALL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_PASSIVE_WALL",
  action: "techWall",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= TECH_WALL_FRAMES) {
      startAction(f, "fall");
      return;
    }
    if (f.actionFrame >= TECH_WALL_INTERRUPT && handleActionable(f, intent, ctx)) return;
    bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_PASSIVE_CEIL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_PASSIVE_CEIL",
  action: "techCeiling",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= TECH_CEILING_FRAMES) startAction(f, "fall");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const PASSIVE_STATUSES: readonly FighterStatus[] = [
  STATUS_PASSIVE,
  STATUS_PASSIVE_FB,
  STATUS_PASSIVE_WALL,
  STATUS_PASSIVE_CEIL,
];
