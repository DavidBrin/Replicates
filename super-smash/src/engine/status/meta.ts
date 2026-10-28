/**
 * Meta statuses: ENTRY, DEAD, REBIRTH (Plan 2, Task 6).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 * REBIRTH's entry grant moved from DEAD's `main` into REBIRTH's `pre`, where
 * the game keeps status set-up.
 */

import { RESPAWN_INVINCIBILITY_MAX, RESPAWN_PLATFORM_FRAMES } from "../constants";
import { kineticClear } from "../kinetic";
import { DEAD_FRAMES, ENTRY_FRAMES, respawnInvincibilityFrames, startAction } from "../states";
import type { FighterStatus } from "./kind";

export const STATUS_ENTRY: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ENTRY",
  action: "entering",
  kineticType: "FALL",
  main(f) {
    if (f.actionFrame >= ENTRY_FRAMES) startAction(f, f.grounded ? "stand" : "fall");
  },
};

export const STATUS_DEAD: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DEAD",
  action: "dead",
  kineticType: "NONE",
  main(f, _intent, ctx) {
    // Out of stocks is a terminal state: no respawn, and the match-end check
    // in `step` reads it rather than a separate "eliminated" flag.
    if (f.stocks <= 0) return;
    if (f.actionFrame >= DEAD_FRAMES) {
      const spawns = ctx.stage.spawns;
      const spawn = spawns[f.port % spawns.length];
      f.x = spawn.x;
      f.y = spawn.y;
      kineticClear(f);
      f.grounded = false;
      f.platform = -1;
      f.jumpsUsed = 0;
      f.airDodged = false;
      f.shortHop = false;
      f.ledgeRegrabs = 0;
      startAction(f, "respawnPlatform");
    }
  },
};

export const STATUS_REBIRTH: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_REBIRTH",
  action: "respawnPlatform",
  kineticType: "NONE",
  pre(f) {
    // Covers the transition frame; the platform then holds it up itself and
    // the departure grant replaces it on the way out.
    f.invincible = RESPAWN_INVINCIBILITY_MAX;
  },
  main(f, intent) {
    const leaving =
      f.actionFrame >= RESPAWN_PLATFORM_FRAMES ||
      intent.jumpPressed ||
      intent.attackPressed ||
      intent.x !== 0 ||
      intent.y !== 0;
    if (leaving) {
      // The grant is decided on the way *out*, from how long the fighter
      // stayed: a player who drops straight back in is protected while they
      // re-enter, and one who waits out the platform's 300 frames gets 60.
      f.invincible = respawnInvincibilityFrames(f.actionFrame);
      startAction(f, "fall");
      return;
    }
    // Held up a frame at a time (as the dodge windows are) rather than
    // counted down from one, because the platform outlasts any grant.
    f.invincible = Math.max(f.invincible, 1);
  },
};

export const META_STATUSES: readonly FighterStatus[] = [STATUS_ENTRY, STATUS_DEAD, STATUS_REBIRTH];
