/**
 * Teching and bouncing (Plan 3, Task 12): what a tumbling fighter does on the
 * frame its body meets a floor, a wall or a ceiling.
 *
 * Tech input is a shield press (SmashWiki "Tech"): it opens an 11-frame window
 * and blocks another window for 40 frames. In hitstun (SSBU's DAMAGE_FLY, the
 * replica's `tumble`), a surface met inside the window, slowly enough (3 for a
 * floor, 6 for a wall or ceiling — rubendal SSBU-Calculator `js/knockback.js`
 * `techable`), is teched. One met too fast, or with no tech input, bounces the
 * fighter off it if the launch is at least 0.8 (floor) or 1 (wall, ceiling) —
 * keeping 0.9 of the launch off a floor and 0.95 off a wall or ceiling, and 0.8
 * of the hitstun. A floor met slower than 0.8 with no tech is the missed tech:
 * `onLanded` lays the fighter down (DOWN_WAIT).
 *
 * After the hitstun (`tumbleFall`, DAMAGE_FALL) only the floor matters: a tech
 * input techs it, and otherwise `onLanded` lays the fighter down at any speed.
 * It never bounces, and a wall or ceiling is a plain stop (SmashWiki "Tech":
 * "the character must be in hitstun" for those). An air dodge begun out of a
 * tumble techs a surface it meets in its first 15 frames, with no other input
 * (SmashWiki "Lucario (SSBU)/Techs").
 *
 * On the ground a *held* shield techs too: "the shield button can be held for
 * much longer than the 11 frame window and a tech can still be performed on
 * the ground" (SmashWiki "Tech", Ultimate). Holding is never a press, so it
 * does not spend the air dodge in hitstun cancel (Task 7). "Tumbling" here
 * includes SSBU's reeling, which is a kind of tumble (DAMAGE_FLY_ROLL): the
 * replica's `tumble` action stands for both.
 */

import {
  AIR_DODGE_TECH_FRAMES,
  BOUNCE_FLOOR_LAUNCH_RATIO,
  BOUNCE_FLOOR_MIN_SPEED,
  BOUNCE_HITSTUN_RATIO,
  BOUNCE_SURFACE_LAUNCH_RATIO,
  BOUNCE_SURFACE_MIN_SPEED,
  TECH_FLOOR_MAX_SPEED,
  TECH_LOCKOUT,
  TECH_ROLL_DISTANCE,
  TECH_ROLL_FRAMES,
  TECH_SURFACE_MAX_SPEED,
  TECH_WINDOW,
} from "./constants";
import { byRatio } from "./fixed";
import { kineticReflect, kineticSet, kineticSetX } from "./kinetic";
import type { Intent } from "./states";
import { startAction } from "./states";
import type { FighterState } from "./types";

export type Surface = "floor" | "wall" | "ceiling";

/**
 * The launch as it was before collision touched it this frame — the air
 * bookkeeping a landing would wipe, which a bounce (not a landing) gives back
 * — and which tumble the fighter is in.
 */
export interface LaunchBefore {
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  /** GRAVITY's speed, kept through a wall or ceiling bounce. */
  readonly gravity: number;
  /** In `tumble`: hitstun may be left (`techOrBounce` checks). */
  readonly tumbling: boolean;
  /** In `tumbleFall`: the hitstun is over. */
  readonly tumbleFall: boolean;
  /** In the first 15 frames (0-14) of an air dodge that began out of a tumble. */
  readonly dodgeTech: boolean;
  readonly jumpsUsed: number;
  readonly airTime: number;
  readonly ledgeLockout: number;
}

export function launchBefore(f: FighterState): LaunchBefore {
  return {
    x: f.kinetic.damageX,
    y: f.kinetic.damageY,
    speed: f.launchSpeed,
    gravity: f.kinetic.gravityY,
    tumbling: f.action === "tumble",
    tumbleFall: f.action === "tumbleFall",
    dodgeTech: f.action === "airDodge" && f.combat.tumbleDodge && f.actionFrame < AIR_DODGE_TECH_FRAMES,
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
  const reeling = before.tumbling && f.hitstun > 0;
  if (!reeling && !before.tumbleFall && !before.dodgeTech) return null;
  const floor = surface === "floor";
  // After the hitstun a wall or ceiling is a plain stop: nothing to tech
  // (SmashWiki "Tech": the character "must be in hitstun"), nothing to bounce.
  if (before.tumbleFall && !floor) return null;
  // The air dodge is the tech input, and its own launch is nothing (it sets it to 0).
  const techable = before.dodgeTech || before.speed <= (floor ? TECH_FLOOR_MAX_SPEED : TECH_SURFACE_MAX_SPEED);
  const input = before.dodgeTech || f.combat.techWindow > 0 || (floor && intent.shieldHeld);
  if (input && techable) {
    f.combat.techWindow = 0;
    // The press was the tech: it must not wait in the buffer to become an air
    // dodge or a shield on the first actionable frame (a wall tech's is 6).
    // UNVERIFIED: that the game spends it; one press making one action is the
    // reading, as `presses` spends a buffered press when it fires.
    if (f.bufferedAction !== null && f.bufferedAction.kind === "shield") f.bufferedAction = null;
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
  // Only a fighter still in hitstun bounces: DAMAGE_FALL has no reflect check.
  if (!reeling) return null;
  if (before.speed < (floor ? BOUNCE_FLOOR_MIN_SPEED : BOUNCE_SURFACE_MIN_SPEED)) return null;
  // Send the launch away from the surface — up off a floor, down off a ceiling,
  // back off a wall, whichever way its component pointed (rubendal
  // `js/knockback.js` bounces with `Math.abs`) — 0.9 of it off a floor, 0.95
  // off a wall or ceiling; hitstun to 0.8 of what is left. A floor bounce
  // resets gravity, the others keep theirs (`kineticReflect`).
  const ratio = floor ? BOUNCE_FLOOR_LAUNCH_RATIO : BOUNCE_SURFACE_LAUNCH_RATIO;
  const ax = before.x < 0 ? -before.x : before.x;
  const ay = before.y < 0 ? -before.y : before.y;
  const x = surface === "wall" ? -wallSide * ax : before.x;
  const y = floor ? ay : surface === "ceiling" ? -ay : before.y;
  kineticReflect(f, byRatio(x, ratio), byRatio(y, ratio), byRatio(before.speed, ratio), floor ? 0 : before.gravity);
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
