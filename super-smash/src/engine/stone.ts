/**
 * A transformation a move holds: Kirby's Stone (Plan 5, Task 13 fix round 2,
 * ruling R-T13j; `MoveDef.stone`, `StoneDef`).
 *
 * SmashWiki "Kirby (SSBU)/Down special"
 * (https://www.ssbwiki.com/Kirby_(SSBU)/Down_special, revision 2041256):
 * - "The stone transformation (and subsequent protection) lasts a minimum of 18
 *   frames and a maximum of 150 frames, depending on when the special move button
 *   is pressed again"; "Period before the move can be canceled 18 frames";
 *   "Maximum stone duration 150 frames";
 * - its timings, "for the minimum stone duration": in the air, "Stone protection
 *   29-46", "Interruptible (from cancel) 78 (32)"; on the ground, "Stone
 *   protection 11-28", "Interruptible (from cancel) 60 (32)". So the stone's
 *   18th frame is the one a press of the button ends it on, and the move goes on
 *   from the frame after its window, 32 frames before it is interruptible;
 * - "Stone HP 25", "If the move's HP is fully depleted, Kirby is knocked out of
 *   it and takes 0.5× damage from the attack that caused it to break", "Hitlag
 *   multiplier for blocked attacks 1.2"; the overview: "invincible to attacks up
 *   to 25% damage in total, but he can still be grabbed".
 *
 * The frames are the move's own: the stone's window for where the fighter is (the
 * air's or the ground's) is its first 18 frames, and the move holds on its last
 * until the stone ends. `CombatState.stoneFrames` counts the stone's frames, and
 * is the stone's `maxFrames` once it has ended; `stoneTaken` the damage it took;
 * `stoneEndedAir` whether it ended in the air (fix round 3, R-T13m).
 */

import { actionFrameOf, moveFrameOf } from "./hitbox";
import type { Intent } from "./states";
import type { CombatState } from "./combat";
import type { FighterDef, FighterState, StoneDef } from "./types";

/**
 * The stone's window as the stone has it (Plan 6, Task 36): one that ended in the air
 * keeps the air's window wherever it is, the landing step's frame 46 included
 * (`stoneOf`); otherwise the window for where the fighter is (`stoneWindow`).
 */
export function stoneWindowOf(f: Pick<FighterState, "grounded"> & { readonly combat: Pick<CombatState, "stoneEndedAir"> }, stone: StoneDef): readonly [number, number] {
  return f.combat.stoneEndedAir ? stone.air : stoneWindow(f, stone);
}

/** The stone's window for where the fighter is: the air's or the ground's. */
export function stoneWindow(f: Pick<FighterState, "grounded">, stone: StoneDef): readonly [number, number] {
  return f.grounded ? stone.ground : stone.air;
}

/**
 * One frame of a move that holds a stone, run by the special status after the
 * frame has stepped on. Stepping past the window's last frame while the stone
 * lasts, it holds there; a frame inside the window is a stone frame, counted; and
 * the stone's last frame is its `maxFrames`th, or the one the special button is
 * pressed again on once it has lasted `minFrames` (ending it there: the move goes
 * on past the window from the next frame).
 */
export function stoneMain(f: FighterState, intent: Pick<Intent, "specialPressed">, stone: StoneDef): void {
  const [from, to] = stoneWindow(f, stone);
  const c = f.combat;
  if (moveFrameOf(f.actionFrame) === to + 1 && c.stoneFrames > 0 && c.stoneFrames < stone.maxFrames) {
    f.actionFrame = actionFrameOf(to);
  }
  const frame = moveFrameOf(f.actionFrame);
  if (frame < from || frame > to || c.stoneFrames >= stone.maxFrames) return;
  c.stoneFrames += 1;
  if (c.stoneFrames >= stone.maxFrames || (c.stoneFrames >= stone.minFrames && intent.specialPressed)) {
    // Its last frame: the window's last, so the move goes on past it next; ended in
    // the air, on the air's length wherever it lands (R-T13m, `moveEndFrame`).
    f.actionFrame = actionFrameOf(to);
    c.stoneFrames = stone.maxFrames;
    c.stoneEndedAir = !f.grounded;
  }
}

/**
 * The stone a fighter is this frame, or null: in a special whose move holds one,
 * on a frame of its window for where the fighter is, once formed (a landing
 * carries a stone that has formed into the ground's window, `onLanded`), and not
 * broken.
 */
export function stoneOf(f: Pick<FighterState, "action" | "move" | "actionFrame" | "grounded" | "combat">, def: FighterDef): StoneDef | null {
  if (f.action !== "special" || f.move === null) return null;
  const stone = def.moves[f.move]?.stone;
  if (stone === undefined || f.combat.stoneFrames <= 0 || f.combat.stoneTaken >= stone.hp) return null;
  // A stone that ended in the air is the air's window's wherever it is: on the step
  // it lands, its frame 46 is the air's "Stone protection 29-46" still (the Task 13
  // tail, the re-review's N6; UNVERIFIED: no published timeline times that landing).
  const [from, to] = stoneWindowOf(f, stone);
  const frame = moveFrameOf(f.actionFrame);
  return frame >= from && frame <= to ? stone : null;
}
