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
 *   An air dodge's landing lag, the waveland, is the exception (fix round 3, ruling
 *   R-T12f): it stops at the edge (`CombatState.landingCliffStop`, `stopsAtEdge`).
 *   SmashWiki "Wavedash" (https://www.ssbwiki.com/Wavedash, revision 2063890):
 *   "wavedashes cannot slide off edges in Ultimate".
 * - `cliffStop`: the status stops at the edge and never slides off (`resolveCollision`'s
 *   `cliffStop`): its movement halts there and the status plays on.
 * - `stopUnlessPushed`: a grounded attack (fix round 3, ruling R-T12g). Its own movement
 *   stops at the edge, as `cliffStop`; a push toward the edge on the DAMAGE energy (a
 *   windbox's, `kineticPush`; a knockback slide) carries it off, and leaving the
 *   ground cancels it into a fall, the ledge cancel (`onLeftGround`).
 * - `keep`: the status carries on as itself: it is airborne already, a special, a reel,
 *   held by someone, on a ledge, or has its own published rule (each row says).
 *
 * Not modelled (UNVERIFIED): the edge slip itself. The same page: a fighter that
 * "edge slips in the reverse direction they were looking [...] will enter their
 * edge slip animation, and be unable to perform any action for a certain amount of
 * frames" (Ultimate: 24 to 30 by fighter, 25 or 26 for the eight here). Here it
 * falls free to act, as one facing forward does; the replica has no edge-slip
 * status.
 */

import type { ActionState, FighterState } from "./types";

export type GroundExit = "fall" | "tumbleFall" | "lag" | "cliffStop" | "stopUnlessPushed" | "keep";

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
  // A grounded attack stops at the edge against its own movement (ruling R-T12g).
  // SmashWiki "Dash attack" (https://www.ssbwiki.com/Dash_attack, revision 2049916):
  // "Kirby's dash attack in Melee is the only one in the series that can carry the
  // user off platforms"; WuBor's reimplementation gives every jab, tilt, smash and
  // dash attack a cliff stop (supporting only). Pushed off, it is cancelled: SmashWiki
  // "Ledge-canceling", "Windbox ledge cancel": "a windbox to push the fighter off a
  // ledge during their attack, with nearly all grounded attacks [...] being
  // cancelable in this way". Not told apart (UNVERIFIED, carried): the attacker's own
  // shield pushback (the page's "Shield pushback ledge cancel") rides the same energy
  // as its own movement, so it stops at the edge too. An aerial is airborne already
  // and never meets the stop. A special keeps its own movement, by move (ruling R-T12d).
  attack: "stopUnlessPushed",
  special: "keep",
  // The catch statuses stop at the edge (Plan 3; `isCatchStatus`).
  grab: "cliffStop",
  grabHold: "cliffStop",
  pummel: "cliffStop",
  throw: "cliffStop",
  // SmashWiki "Shield" (https://www.ssbwiki.com/Shield, revision 2057379): shield
  // pushback "can even push the shielder off an edge and cause edge slipping, except
  // in Smash 4 and Ultimate". UNVERIFIED for the shield's raise and drop, read as the
  // shield's.
  shieldStart: "cliffStop",
  shield: "cliffStop",
  shieldRelease: "cliffStop",
  shieldStun: "cliffStop",
  // The same page, "Shield breaking": "the character can get pushed off and continue
  // falling until they reach the bottom blast line": the stun plays on in the air. (Its
  // launch, knockdown and stun are one status here.)
  shieldBroken: "lag",
  // SmashWiki "Roll" (https://www.ssbwiki.com/Roll, revision 2047810): "characters cannot
  // roll off edges; should they roll towards an edge, the character's movement will
  // instantly halt at the edge while the remainder of the animation continues" (ruling
  // R-T12e). UNVERIFIED for the spot dodge, which SmashWiki calls stationary (so only a
  // slide brings it to an edge): read as the rolls'; WuBor's reimplementation gives the
  // ESCAPE status a cliff stop (supporting only).
  spotDodge: "cliffStop",
  roll: "cliffStop",
  airDodge: "keep",
  // The reels carry on (a grounded flinch ends in a fall in the air, `endStatus`).
  hitstun: "keep",
  // UNVERIFIED (Plan 5, Task 13c fix round 1): a rebound pushed off the edge plays its
  // remaining frames out in the air and then falls, as a landing's lag does; no page
  // names a rebound at an edge.
  rebound: "lag",
  tumble: "keep",
  tumbleFall: "keep",
  // Held: the captor places them.
  grabbed: "keep",
  thrown: "keep",
  // UNVERIFIED: lying down is not "on their feet"; one that slides off tumbles and
  // lies down again where it lands, and like any tumble after the hitstun it is free
  // to act at once (`airMain`; SmashWiki "Tumbling": "After hitstun ends, tumbling
  // characters can carry out most normal airborne actions"). Getting up and the
  // standing tech are on their feet.
  downed: "tumbleFall",
  getUp: "fall",
  tech: "fall",
  // SmashWiki "Tech" (https://www.ssbwiki.com/Tech, revision 2028146), the rolling tech:
  // "Rolling against an edge will halt the roll's sideways movement" (ruling R-T12e).
  techRoll: "cliffStop",
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
  // Trapped in a Final Smash (Plan 5, Task 14): held where the trap caught it, it
  // never meets an edge (`step` neither moves nor collides it). UNVERIFIED: no page
  // names the trapped at an edge; were it ever pushed off, it would stay trapped.
  finalTrapped: "keep",
  // Not on the stage.
  respawnPlatform: "keep",
  dead: "keep",
  entering: "keep",
};

/**
 * Whether `f` stops at the edge of the platform it stands on this frame: the
 * collision step's `cliffStop`. `outward` is the side of the platform's centre the
 * fighter is on (+1 right, −1 left).
 *
 * A `cliffStop` row always does; a waveland's landing lag does (ruling R-T12f); a
 * grounded attack does unless a push toward that edge rides its DAMAGE energy
 * (ruling R-T12g), which carries it off to be cancelled (`onLeftGround`).
 */
export function stopsAtEdge(f: Pick<FighterState, "action" | "kinetic" | "combat">, outward: number): boolean {
  const exit = GROUND_EXIT[f.action];
  if (exit === "cliffStop") return true;
  if (exit === "lag") return f.action === "landingLag" && f.combat.landingCliffStop;
  if (exit === "stopUnlessPushed") return f.kinetic.damageX * outward <= 0;
  return false;
}
