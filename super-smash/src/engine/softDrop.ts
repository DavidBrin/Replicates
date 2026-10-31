/**
 * Which statuses fall through a soft platform from above with the stick held down
 * (Plan 5, Task 13b fix round 1, ruling R-T13b-d): one table, read by the collision
 * step (`step`'s `passThroughSoft`), the way `groundExit.ts` gives every status its
 * edge. SmashWiki "Platform" (https://www.ssbwiki.com/Platform), Soft platforms:
 *
 * - "Airborne characters may pass through a soft platform from above by holding
 *   down on the control stick as they approach it". The ability to do it "at any
 *   time (not just when a character is helpless)" is Melee's on (SmashWiki
 *   "Helpless", https://www.ssbwiki.com/Helpless).
 * - "Characters performing aerial attacks, including stall-then-fall maneuvers,
 *   cannot fall through soft platforms during the attack. Most special moves also
 *   follow this rule, with exceptions such as [...] the up special moves of Fox,
 *   Falco, and Wolf when used in the air, which will pass down through soft
 *   platforms when directed at a downward angle."
 * - "tumbling and reeling characters, who will fly upward through soft platforms,
 *   but will land in a lying position upon a soft platform if they contact it from
 *   above."
 *
 * - `drop`: holding down drops through.
 * - `byMove`: the move says (`MoveDef.softDropAimedDown`, `dropsThroughSoft`).
 * - `stay`: lands on it, Down held or not. A grounded status never meets a soft
 *   platform from above, and one placed by a captor or a ledge is placed.
 */

import { begunInAir } from "./upSpecial";
import type { Intent } from "./states";
import type { ActionState, FighterState, MoveDef } from "./types";

export type SoftDrop = "drop" | "byMove" | "stay";

/** Each status's soft-platform rule (ruling R-T13b-d). A new action is a compile error here until it is given one. */
export const SOFT_DROP: Readonly<Record<ActionState, SoftDrop>> = {
  // On the ground: a standing fighter's drop is the down press on a soft platform
  // (`dropThroughPlatform`, from the grounded statuses' own handler), not this.
  stand: "stay",
  walk: "stay",
  dashStart: "stay",
  run: "stay",
  runBrake: "stay",
  turnaround: "stay",
  crouchStart: "stay",
  crouch: "stay",
  crouchEnd: "stay",
  crawl: "stay",
  jumpSquat: "stay",
  // The page's "Airborne characters". A jump meets a soft platform from above only
  // coming down (going up it passes through, `resolveCollision`): the descending jump.
  jump: "drop",
  fall: "drop",
  land: "stay",
  landingLag: "stay",
  // SmashWiki "Helpless": "holding down to drop through them".
  specialFall: "drop",
  specialLanding: "stay",
  // The page: "Characters performing aerial attacks [...] cannot fall through".
  attack: "stay",
  // "Most special moves also follow this rule", with the page's exceptions by move.
  special: "byMove",
  grab: "stay",
  grabHold: "stay",
  pummel: "stay",
  throw: "stay",
  shieldStart: "stay",
  shield: "stay",
  shieldRelease: "stay",
  shieldStun: "stay",
  shieldBroken: "stay",
  spotDodge: "stay",
  roll: "stay",
  // UNVERIFIED: no source lets an air dodge through a soft platform; the page names
  // none, so it lands as the attacks do.
  airDodge: "stay",
  // The page's "tumbling and reeling characters [...] will land".
  hitstun: "stay",
  // UNVERIFIED: a rebound is a reel out of a lost clank (Plan 5, Task 13c fix round 1).
  rebound: "stay",
  tumble: "stay",
  // A tumble's fall, the tumble once its hitstun is over (`reelMain`), lands too, and
  // lies down or techs as on any floor (fix round 2, ruling R-T13b-g, amending
  // R-T13b-d): the page's "tumbling and reeling characters, who will fly upward
  // through soft platforms, but will land in a lying position upon a soft platform
  // if they contact it from above". SmashWiki "Tumbling"
  // (https://www.ssbwiki.com/Tumbling) lists no drop-through among the actions open
  // after hitstun.
  tumbleFall: "stay",
  // Held, thrown, lying down: placed by their captor, or on the ground.
  grabbed: "stay",
  thrown: "stay",
  downed: "stay",
  getUp: "stay",
  tech: "stay",
  techRoll: "stay",
  // UNVERIFIED: the wall and ceiling techs are their own short statuses; no page
  // names one at a soft platform.
  techWall: "stay",
  techCeiling: "stay",
  ledgeHang: "stay",
  ledgeGetUp: "stay",
  ledgeAttack: "stay",
  ledgeRoll: "stay",
  ledgeJump: "stay",
  ledgeTrumped: "stay",
  // UNVERIFIED: the carry and the mouthful (Plan 5, Tasks 8 and 9); no page names
  // either at a soft platform. The carried, the swallowed and the spat are placed.
  cargoCarry: "stay",
  cargoHeld: "stay",
  inhaleHold: "stay",
  swallowed: "stay",
  spatStar: "stay",
  // UNVERIFIED: the footstooled's freeze (Plan 5, Task 11).
  footstooled: "stay",
  // UNVERIFIED: the trapped in a Final Smash (Plan 5, Task 14) are held where the
  // trap caught them and meet no platform (`step` neither moves nor collides them).
  finalTrapped: "stay",
  respawnPlatform: "stay",
  dead: "stay",
  entering: "stay",
};

/**
 * Whether `f`, in the air, falls through soft platforms this frame: the stick held
 * down, in a status whose row allows it (`SOFT_DROP`). `move` is the move `f` is in
 * (a special's, for `byMove`): one with `softDropAimedDown` drops through when it
 * was begun in the air and its aim points down (`CombatState.aimY`; Fox's Fire Fox).
 */
export function dropsThroughSoft(
  f: Pick<FighterState, "grounded" | "action" | "airTime" | "actionFrame" | "combat">,
  move: MoveDef | undefined,
  intent: Pick<Intent, "y">,
): boolean {
  if (f.grounded || intent.y >= 0) return false;
  switch (SOFT_DROP[f.action]) {
    case "drop":
      return true;
    case "byMove":
      return move?.softDropAimedDown === true && begunInAir(f) && f.combat.aimY < 0;
    case "stay":
      return false;
  }
}
