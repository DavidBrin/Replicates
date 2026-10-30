/**
 * What every status does at the edge of the ground it stands on (Plan 5, Task 12
 * fix round 2, ruling R-T12d): one table, read by `onLeftGround` (a fighter that
 * slid or was pushed off) and by the collision step (`cliffStop`), so no status
 * stays a ground status in the air.
 *
 * - `fall`, `tumbleFall`: a grounded-only status. The fighter becomes that on the
 *   frame it leaves the ground. SmashWiki "Edge slipping"
 *   (https://www.ssbwiki.com/Edge_slipping, revision 1789763): a fighter "knocked off
 *   a platform while they were still on their feet [...] facing forward [...] [is]
 *   free to perform any action immediately upon falling off the platform"; and
 *   SmashWiki "Teeter" (https://www.ssbwiki.com/Teeter, revision 1891490): "moving too quickly will
 *   simply cause the character to run off the edge".
 * - `lag`: a landing. It keeps its remaining frames in the air, then falls (its own
 *   end, and a landing during it keeps it). SmashWiki "Ledge-canceling"
 *   (https://www.ssbwiki.com/Ledge-canceling, revision 1990115): sliding off a
 *   ledge "during landing lag (which can be from a normal landing, an aerial
 *   landing, or from a freefall landing)" cancels it in Smash 64 and Melee,
 *   "although in later games it can only be performed with specific actions and
 *   moves [...], no longer being possible with any aerial or free-fall landing lag".
 * - `cliffStop`: the status stops at the edge and never slides off (`resolveCollision`'s
 *   `cliffStop`).
 * - `keep`: the status carries on as itself: it is airborne already, a move, a reel,
 *   held by someone, on a ledge, or has its own published rule (each row says).
 *
 * Not modelled (UNVERIFIED): the edge slip itself. The same page: a fighter that
 * "edge slips in the reverse direction they were looking [...] will enter their
 * edge slip animation, and be unable to perform any action for a certain amount of
 * frames" (Ultimate: 25 to 30 by fighter). Here it falls free to act, as one
 * facing forward does; the replica has no edge-slip status.
 */

import type { ActionState } from "./types";

export type GroundExit = "fall" | "tumbleFall" | "lag" | "cliffStop" | "keep";

/** Each status's edge rule (ruling R-T12d). A new action is a compile error here until it is given one. */
export const GROUND_EXIT: Readonly<Record<ActionState, GroundExit>> = {
  // Standing and moving on foot: "Teeter" and "Edge slipping" above.
  stand: "fall",
  walk: "fall",
  dashStart: "fall",
  run: "fall",
  runBrake: "fall",
  // UNVERIFIED: the run's turn is a run (no page names it).
  turnaround: "fall",
  // UNVERIFIED: the crouches and the crawl are on their feet too (Task 12, rulings
  // R-T12b and R-T12c; no page names them).
  crouchStart: "fall",
  crouch: "fall",
  crouchEnd: "fall",
  crawl: "fall",
  // SmashWiki "Ledge-canceling": the jumpsquat ledge cancel is Smash 64's and
  // Melee's only, so a jumpsquat that slides off still jumps (`onLeftGround`).
  jumpSquat: "keep",
  // Airborne already.
  jump: "keep",
  fall: "keep",
  // The landings: "Ledge-canceling" above. The special landing keeps its helpless
  // state first (`onLeftGround`; SmashWiki "Helpless"), and this only without one.
  land: "lag",
  landingLag: "lag",
  specialFall: "keep",
  specialLanding: "lag",
  // A move carries its own edge behaviour (ruling R-T12d: a grounded attack goes on
  // off an edge, and no attack is changed without a source).
  attack: "keep",
  special: "keep",
  // The catch statuses stop at the edge (Plan 3; `isCatchStatus`).
  grab: "cliffStop",
  grabHold: "cliffStop",
  pummel: "cliffStop",
  throw: "cliffStop",
  // SmashWiki "Shield" (https://www.ssbwiki.com/Shield, revision 2057379): Smash 4's
  // shields are "no longer being vulnerable to edge slipping", and "Ultimate shields
  // remain similar to Smash 4's". UNVERIFIED for the shield's raise and drop, read as
  // the shield's.
  shieldStart: "cliffStop",
  shield: "cliffStop",
  shieldRelease: "cliffStop",
  shieldStun: "cliffStop",
  // UNVERIFIED: a broken shield's stun is not ended by the fall; it plays out in the
  // air, as a landing's lag does.
  shieldBroken: "lag",
  // UNVERIFIED: no page names the dodges at an edge; they are on their feet.
  spotDodge: "fall",
  roll: "fall",
  airDodge: "keep",
  // The reels carry on (a grounded flinch ends in a fall in the air, `endStatus`).
  hitstun: "keep",
  tumble: "keep",
  tumbleFall: "keep",
  // Held: the captor places them.
  grabbed: "keep",
  thrown: "keep",
  // UNVERIFIED: lying down is not "on their feet"; one that slides off tumbles and
  // lies down again where it lands. Getting up and the techs are on their feet.
  downed: "tumbleFall",
  getUp: "fall",
  tech: "fall",
  techRoll: "fall",
  techWall: "keep",
  techCeiling: "keep",
  // The ledge statuses are placed by the ledge.
  ledgeHang: "keep",
  ledgeGetUp: "keep",
  ledgeAttack: "keep",
  ledgeRoll: "keep",
  ledgeJump: "keep",
  ledgeTrumped: "keep",
  // The carry and the mouthful have their own air forms (Plan 5, Tasks 8 and 9);
  // the carried, the swallowed and the spat are placed by their captor.
  cargoCarry: "keep",
  cargoHeld: "keep",
  inhaleHold: "keep",
  swallowed: "keep",
  spatStar: "keep",
  // UNVERIFIED: the footstooled's freeze plays out in the air, as a landing's lag
  // does, and ends in a fall (`STATUS_TREAD_DAMAGE`).
  footstooled: "lag",
  // Not on the stage.
  respawnPlatform: "keep",
  dead: "keep",
  entering: "keep",
};
