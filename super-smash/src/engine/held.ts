/**
 * Fighters held up on another's shoulders (Plan 5, Task 8): Donkey Kong's cargo.
 *
 * A held fighter has no movement of its own: `step` skips every captive in its
 * physics and collision phases, and puts it where its captor holds it once the
 * captor has moved (phase 5b). A captive in a hold stands in front of its captor
 * (`holdAtCaptor`, `simulate.ts`); one carried rides on top of the carrier, here.
 */

import { kineticSet } from "./kinetic";
import type { FighterState, GameState, MoveSlot } from "./types";

/** The throws Donkey Kong throws from the carry: their fighter rides until it is released. */
const CARGO_THROWS: ReadonlySet<MoveSlot> = new Set(["cargoFthrow", "cargoBthrow", "cargoUthrow", "cargoDthrow"]);

/** Riding on someone's shoulders: carried in Donkey Kong's cargo. */
export function isHeldAloft(f: Pick<FighterState, "action">): boolean {
  return f.action === "cargoHeld";
}

/**
 * Is `f`, held by `captor`, up on the captor's shoulders? Carried (`isHeldAloft`),
 * or thrown from the carry and not yet released: a cargo throw launches its
 * fighter from where it rides (UNVERIFIED: SSBU attaches it to the thrower's
 * `throw` joint, whose path through each throw is unpublished; here it stays at
 * the top of the carrier until the release).
 */
export function ridesCaptor(f: Pick<FighterState, "action">, captor: Pick<FighterState, "action" | "move">): boolean {
  if (isHeldAloft(f)) return true;
  return f.action === "thrown" && captor.action === "throw" && captor.move !== null && CARGO_THROWS.has(captor.move);
}

/**
 * Put every fighter riding its captor (`ridesCaptor`) on top of it: at the
 * captor's x, `topOf(captor)` above its feet, facing the way it faces, off the
 * ground, still. `topOf` is the captor's standing body's height (its baked
 * ECB's top, or the legacy `attributes.height`: `simulate.ts`). UNVERIFIED: SSBU
 * carries the fighter at a joint of Donkey Kong's (the `throw` bone), which the
 * replica does not place; it stands on his head instead. Like a hold
 * (`holdAtCaptor`), it is placed and not flying, so it gains no airtime.
 *
 * Lifted off the ground, it has spent its ground jump, as a fighter that leaves
 * the ground any way but a jump has (`onLeftGround`; SmashWiki "Double jump",
 * https://www.ssbwiki.com/Double_jump: "Most characters can only jump once while
 * airborne"); the midair jumps being grabbed gave back stay. UNVERIFIED for the
 * carry: no source says what a fighter freed from it has left.
 */
export function pinHeldFighters(s: GameState, topOf: (captor: FighterState) => number): void {
  for (const f of s.fighters) {
    if (f.action === "dead" || f.grabbedBy < 0) continue;
    const captor = s.fighters[f.grabbedBy];
    if (captor === undefined || captor.grabbing !== f.port || !ridesCaptor(f, captor)) continue;
    f.x = captor.x;
    f.y = captor.y + topOf(captor);
    f.facing = captor.facing;
    f.grounded = false;
    f.platform = -1;
    f.ledge = null;
    f.airTime = 0;
    f.jumpsUsed = Math.max(f.jumpsUsed, 1);
    kineticSet(f, 0, 0);
  }
}
