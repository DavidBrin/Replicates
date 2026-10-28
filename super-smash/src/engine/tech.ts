/**
 * Teching and bouncing (Plan 3, Task 12): what a tumbling fighter does on the
 * frame its body meets a floor, a wall or a ceiling.
 *
 * Tech input is a shield press (SmashWiki "Tech"): it opens an 11-frame window
 * and blocks another window for 40 frames. A surface met inside the window,
 * slowly enough (3 for a floor, 6 for a wall or ceiling — rubendal
 * SSBU-Calculator `js/knockback.js` `techable`), is teched. One met too fast,
 * or with no tech input, bounces the fighter off it if the launch is at least
 * 0.8 (floor) or 1 (wall, ceiling) — keeping 0.95 of the launch and 0.8 of the
 * hitstun. A slow tumbling landing with no tech is the missed tech: `onLanded`
 * lays the fighter down (DOWN_WAIT), as before.
 *
 * On the ground a *held* shield techs too: "the shield button can be held for
 * much longer than the 11 frame window and a tech can still be performed on
 * the ground" (SmashWiki "Tech", Ultimate). Holding is never a press, so it
 * does not spend the air dodge in hitstun cancel (Task 7). "Tumbling" here
 * includes SSBU's reeling, which is a kind of tumble (DAMAGE_FLY_ROLL): the
 * replica's `tumble` action stands for both.
 */

import {
  BOUNCE_FLOOR_MIN_SPEED,
  BOUNCE_HITSTUN_RATIO,
  BOUNCE_LAUNCH_RATIO,
  BOUNCE_SURFACE_MIN_SPEED,
  TECH_FLOOR_MAX_SPEED,
  TECH_LOCKOUT,
  TECH_ROLL_DISTANCE,
  TECH_ROLL_FRAMES,
  TECH_SURFACE_MAX_SPEED,
  TECH_WINDOW,
} from "./constants";
import { byRatio } from "./fixed";
import { kineticLaunch, kineticSet, kineticSetX } from "./kinetic";
import type { Intent } from "./states";
import { startAction } from "./states";
import type { FighterState } from "./types";

export type Surface = "floor" | "wall" | "ceiling";

/**
 * The launch as it was before collision touched it this frame — and the air
 * bookkeeping a landing would wipe, which a bounce (not a landing) gives back.
 */
export interface LaunchBefore {
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  readonly tumbling: boolean;
  readonly jumpsUsed: number;
  readonly airTime: number;
  readonly ledgeLockout: number;
}

export function launchBefore(f: FighterState): LaunchBefore {
  return {
    x: f.kinetic.damageX,
    y: f.kinetic.damageY,
    speed: f.launchSpeed,
    tumbling: f.action === "tumble",
    jumpsUsed: f.jumpsUsed,
    airTime: f.airTime,
    ledgeLockout: f.ledgeLockout,
  };
}

/**
 * Count the tech window and lockout down, and open a window on a shield press
 * outside the lockout. Runs every frame for every fighter, frozen or not, so a
 * press made during hitlag counts — and spends the lockout — like any other.
 */
export function updateTechInput(f: FighterState, intent: Intent): void {
  const c = f.combat;
  if (c.techWindow > 0) c.techWindow -= 1;
  if (c.techLockout > 0) c.techLockout -= 1;
  if (intent.shieldPressed && c.techLockout === 0) {
    c.techWindow = TECH_WINDOW;
    c.techLockout = TECH_LOCKOUT;
  }
}

/**
 * The fighter's tumbling body just met `surface`: tech, bounce, or neither
 * (null — the caller carries on with the landing or the stop). `intent.x`
 * picks a tech roll on the floor; `wallSide` is `CollisionOutcome.wall`.
 */
export function techOrBounce(
  f: FighterState,
  surface: Surface,
  before: LaunchBefore,
  intent: Intent,
  wallSide = 0,
): "tech" | "bounce" | null {
  if (!before.tumbling || f.hitstun <= 0) return null;
  const floor = surface === "floor";
  const techable = before.speed <= (floor ? TECH_FLOOR_MAX_SPEED : TECH_SURFACE_MAX_SPEED);
  const input = f.combat.techWindow > 0 || (floor && intent.shieldHeld);
  if (input && techable) {
    f.combat.techWindow = 0;
    f.hitstun = 0;
    f.balloon = false;
    kineticSet(f, 0, 0, "stop");
    if (floor) {
      // A teched floor is a landing: `resolveCollision` did its bookkeeping,
      // and this is the part of `onLanded` it leaves to the status change.
      f.kinetic.fallFrames = 0;
      f.shortHop = false;
      if (intent.x !== 0) {
        startAction(f, "techRoll");
        kineticSetX(f, intent.x * Math.trunc(TECH_ROLL_DISTANCE / TECH_ROLL_FRAMES), "stop");
      } else {
        startAction(f, "tech");
      }
    } else {
      startAction(f, surface === "wall" ? "techWall" : "techCeiling");
    }
    return "tech";
  }
  if (before.speed < (floor ? BOUNCE_FLOOR_MIN_SPEED : BOUNCE_SURFACE_MIN_SPEED)) return null;
  // Send the launch away from the surface — up off a floor, down off a ceiling,
  // back off a wall, whichever way its component pointed (rubendal
  // `js/knockback.js` bounces with `Math.abs`) — 5% slower; hitstun to 0.8 of
  // what is left.
  const ax = before.x < 0 ? -before.x : before.x;
  const ay = before.y < 0 ? -before.y : before.y;
  const x = surface === "wall" ? -wallSide * ax : before.x;
  const y = floor ? ay : surface === "ceiling" ? -ay : before.y;
  kineticLaunch(
    f,
    byRatio(x, BOUNCE_LAUNCH_RATIO),
    byRatio(y, BOUNCE_LAUNCH_RATIO),
    byRatio(before.speed, BOUNCE_LAUNCH_RATIO),
  );
  f.hitstun = byRatio(f.hitstun, BOUNCE_HITSTUN_RATIO);
  if (floor) {
    // Off the floor again without a jump or a landing: the fighter is still in
    // the air, so what `resolveCollision`'s landing wiped is not given back
    // (the ground jump stays spent, `onLeftGround`; SmashWiki "Double jump":
    // "double jumps are not given back to the player upon being put into
    // hitstun", https://www.ssbwiki.com/Double_jump).
    f.grounded = false;
    f.platform = -1;
    f.jumpsUsed = Math.max(before.jumpsUsed, 1);
    f.airTime = before.airTime;
    f.ledgeLockout = before.ledgeLockout;
  }
  return "bounce";
}
