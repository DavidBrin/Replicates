/**
 * Wall jumps and wall tech jumps (Plan 5, Task 10).
 *
 * SmashWiki "Wall jump" (https://www.ssbwiki.com/Wall_jump, revision 2065734 of
 * 2026-10-25): "It is performed by touching a wall and then pressing the control
 * stick or d-pad in the direction opposite to the wall." Of this roster its
 * Ultimate list has Mario, Samus, Fox and Pikachu (`FighterAttributes.canWallJump`),
 * and "each one performed without touching the ground has its initial velocity
 * reduced to 0.96×, which stacks" (`WALL_JUMP_DECAY`, `CombatState.wallJumps`).
 * Its Ultimate height ranking gives each wall jumper's height (Pikachu 34.29,
 * Mario 29.263, Samus 28.35, Fox 22.05: `FighterAttributes.wallJumpHeight`), so
 * the jump launches at the speed that rises that high under the fighter's own
 * gravity (`jumpLaunchSpeed`, as an air jump does).
 *
 * The same page: "all characters can wall tech jump: by inputting a jump during a
 * wall tech, a wall jump is performed"; SmashWiki "Tech"
 * (https://www.ssbwiki.com/Tech): "If a jump input is active when a wall tech is
 * performed (such as holding up or pressing a jump button), then the teching
 * character will wall jump ... Every character can wall tech jump". It is taken
 * out of the wall tech (Plan 3's `techWall`), and a fighter with no published wall
 * jump height rises its air jump's height, UNVERIFIED. "This intangibility would
 * later be removed in Ultimate" (SmashWiki "Wall jump"), so it has none.
 *
 * UNVERIFIED, all unpublished: the window after a touch in which a press away
 * still kicks off (`WALL_JUMP_WINDOW`), the wall tech's frames in which a jump is
 * a wall tech jump (`WALL_TECH_JUMP_FRAMES`), and the speed away from the wall:
 * the fighter's air speed, 0.96× per repeat like the rise.
 */

import { ONE, fx, mul } from "./fixed";
import { jumpLaunchSpeed, kineticJump, kineticSetX } from "./kinetic";
import { fighterParams } from "./params";
import { peekBuffer, startAction } from "./states";
import type { Intent, StateContext } from "./states";
import type { FighterState } from "./types";

/** Frames after touching a wall that a fresh press away still wall-jumps. UNVERIFIED. */
export const WALL_JUMP_WINDOW = 3;
/** SmashWiki "Wall jump": each further wall jump before landing launches at 0.96×. */
export const WALL_JUMP_DECAY = fx(0.96);
/** The wall tech's first frames, in which a jump input makes it a wall tech jump. UNVERIFIED. */
export const WALL_TECH_JUMP_FRAMES = 5;
/**
 * A wall touch is forgotten once neither jump could use it: past the wall jump's
 * window, and past the wall tech jump's frames, which count from the touch the
 * tech was made on (the tech holds still, so it touches nothing more).
 */
const WALL_CONTACT_MEMORY = Math.max(WALL_JUMP_WINDOW, WALL_TECH_JUMP_FRAMES);

/** The collision said a wall stopped `f` on `side` (1 right, −1 left) this frame (phase 5). */
export function noteWallContact(f: FighterState, side: number): void {
  if (side === 0) return;
  f.combat.wallSide = side;
  f.combat.wallFrames = 0;
}

/** Forget the wall last touched: a hit, a grab or a KO ends what it was touched in. */
export function forgetWallContact(f: FighterState): void {
  f.combat.wallSide = 0;
  f.combat.wallFrames = 0;
}

/**
 * Phase 3, every frame, frozen or not: a touch ages, and is forgotten once
 * nothing could use it. On the ground there is no wall to jump from, and the run
 * of wall jumps starts again (SmashWiki: "without touching the ground"), whatever
 * put the fighter there: a landing, a floor tech, being held over the floor.
 */
export function ageWallContact(f: FighterState): void {
  if (f.grounded) {
    forgetWallContact(f);
    f.combat.wallJumps = 0;
    return;
  }
  if (f.combat.wallSide === 0) return;
  f.combat.wallFrames += 1;
  if (f.combat.wallFrames > WALL_CONTACT_MEMORY) forgetWallContact(f);
}

/** Launch away from the wall: its wall jump height up, its air speed away, ×0.96 per repeat. */
function launchOffWall(f: FighterState, ctx: StateContext, away: number): void {
  const p = fighterParams(ctx.def);
  let scale = ONE;
  for (let i = 0; i < f.combat.wallJumps; i++) scale = mul(scale, WALL_JUMP_DECAY);
  const height = ctx.def.attributes.wallJumpHeight ?? p.jump_aerial_y;
  kineticJump(f, mul(jumpLaunchSpeed(p.air_accel_y, height), scale));
  kineticSetX(f, away * mul(p.air_speed_x_stable, scale));
  f.facing = away;
  f.fastFalling = false;
  // A new jump, not the hop that got the fighter here: the short-hop penalty ends
  // with it, as with an air jump (`airJump`). UNVERIFIED: no source says it of a
  // wall jump.
  f.shortHop = false;
  f.combat.wallJumps += 1;
  forgetWallContact(f);
  startAction(f, "jump");
}

/**
 * From the fall's main (`airMain`: JUMP, FALL and DAMAGE_FALL): a fresh press
 * away from a wall touched in the last `WALL_JUMP_WINDOW` frames. Returns true if
 * it jumped. Not from special fall, whose main reads no press but the fast fall's
 * (SmashWiki "Helpless", https://www.ssbwiki.com/Helpless: "unable to take any
 * action, with the exception of grabbing a ledge, maneuvering left/right,
 * fastfalling, or climbing a ladder").
 */
export function tryWallJump(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (!ctx.def.attributes.canWallJump || f.grounded) return false;
  const side = f.combat.wallSide;
  if (side === 0 || f.combat.wallFrames > WALL_JUMP_WINDOW) return false;
  if (f.framesSinceDirPress !== 0 || intent.x !== -side) return false;
  launchOffWall(f, ctx, -side);
  return true;
}

/**
 * From a wall tech (`techWall`), for any fighter: a jump input, pressed or held
 * (SmashWiki "Tech": "such as holding up or pressing a jump button"), in its first
 * `WALL_TECH_JUMP_FRAMES` frames. Returns true if it jumped.
 */
export function tryWallTechJump(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (f.actionFrame > WALL_TECH_JUMP_FRAMES || f.combat.wallSide === 0) return false;
  if (!intent.jumpPressed && !intent.jumpHeld) return false;
  // One press, one jump: a jump pressed in the tumble and held into the tech is
  // this jump, and must not fire again from the buffer as an air jump.
  if (peekBuffer(f, ctx.frame) === "jump") f.bufferedAction = null;
  launchOffWall(f, ctx, -f.combat.wallSide);
  // The tech's intangibility ends with it (SmashWiki "Wall jump": the wall tech
  // jump's "intangibility would later be removed in Ultimate"). Nothing else
  // grants any here: the fighter came to the wall tumbling from a hit.
  f.intangible = 0;
  return true;
}
