/**
 * What makes a move look like *that fighter's* move.
 *
 * ## The problem this solves
 *
 * The pose library is shared on purpose — fifty clips across eight rigs rather
 * than four hundred hand-authored animations (see `poses/library.ts`). For
 * ordinary attacks that works, because a rig's proportions carry the identity:
 * Donkey Kong's forward smash is Mario's forward smash on much longer arms and
 * it reads as Donkey Kong's.
 *
 * It does not work for specials, and it fails in a specific way. There are four
 * special clips — `neutralB`, `sideB`, `upB`, `downB` — and thirty-two
 * specials, so Kirby's Stone and Samus's Charge Shot were the *same animation*:
 * a fighter crouching slightly. The move list was right, the frame data was
 * right, the mechanics were right, and every special in the game looked like
 * every other one. What a special needs is not a better pose but a **prop** —
 * the stone, the plasma, the hexagon — because that is what the eye actually
 * reads.
 *
 * ## Shape of this file
 *
 * A dispatcher, and nothing else. The effects themselves live in
 * `chars/<id>/fx.ts`, keyed by move slot, so that eight fighters can be worked
 * on at once without eight people editing one table.
 *
 * A slot with no entry paints nothing, which is correct: a move whose whole
 * graphic is its projectile — Link's arrow, Mario's fireball — is already drawn
 * by `drawProjectiles`, and a second glow on top would only muddy it.
 *
 * An effect may return `hideFigure`, which suppresses the fighter entirely for
 * that frame. Exactly one does: Kirby, who *is* the stone.
 *
 * ## Why every move and not only specials
 *
 * Because the distinction is ours, not the game's. Marth's tipper is a flash on
 * a forward smash; Link's sword swings leave a coloured arc; Falcon's knee
 * sparks. Restricting the table to `action === "special"` meant those could not
 * be expressed at all, and the restriction bought nothing — a slot with no
 * entry is already the cheap path.
 */

import type { FighterDef, FighterState } from "@/engine/types";
import type { Camera } from "./camera";
import { fxContextFor, struckWithFor, DREW_NOTHING, type MoveFxResult } from "./fxKit";
import { fxFor } from "./chars";

export type { SpecialFxResult, MoveFxResult, FxContext, FxFn } from "./fxKit";
export { MOVE_FX_KEYS } from "./chars";

/**
 * The actions during which a fighter is performing the move in `f.move`.
 *
 * Derived from `startMove` in `states.ts`, which is the only thing that sets
 * `f.move` — and which uses the *action* `grab` for a grab and `pummel` for a
 * pummel, not `attack`. The guard used to list `special`, `attack` and `throw`
 * only, so a grab's effect was never drawn in a match at all; it appeared in
 * the animation lab, which drives the pose directly, and nowhere else.
 *
 * That excluded exactly the two moves on the roster whose entire graphic *is*
 * an effect — Samus's Grapple Beam and Link's hookshot — so both were invisible
 * tethers. Two agents reported it independently.
 *
 * `grabHold` is absent on purpose: `startAction` nulls `f.move` on the way in,
 * so a fighter holding someone is no longer performing the grab that caught
 * them.
 */
const DRAWS_ITS_MOVE: Partial<Record<FighterState["action"], true>> = {
  attack: true,
  special: true,
  throw: true,
  grab: true,
  pummel: true,
};

/**
 * Paint whatever the fighter's current move paints.
 *
 * Under the figure by default; anything the effect handed to `over` comes back
 * in the result for the caller to run once the figure is down. Called for every
 * fighter every frame, and the lookup is a miss for almost all of them, which
 * is the cheap path.
 */
export function drawMoveFx(
  ctx: CanvasRenderingContext2D,
  def: FighterDef | null | undefined,
  f: FighterState,
  cam: Camera,
  height: number,
  screenX: number,
  screenY: number,
  /** Cosmetic state, for the effects that need to know a swing connected. */
  struck?: { lastHit: ({ hitboxId: number; frame: number } | null)[]; frame: number },
): MoveFxResult {
  if (f.move === null || !def) return DREW_NOTHING;
  if (!DRAWS_ITS_MOVE[f.action]) return DREW_NOTHING;
  const move = def.moves[f.move];
  if (!move) return DREW_NOTHING;

  const fn = fxFor(def.id, f.move);
  if (!fn) return DREW_NOTHING;

  const over: (() => void)[] = [];
  const result = fn(
    fxContextFor(
      ctx,
      def,
      f,
      cam,
      height,
      screenX,
      screenY,
      move.totalFrames,
      struck ? struckWithFor(struck.lastHit, f) : undefined,
      (paint) => over.push(paint),
    ),
  );
  // Not `result ?? DREW_NOTHING`: an effect that returns `{ hideFigure: true }`
  // returns a `SpecialFxResult`, which carries no queue, and taking it whole
  // would throw away every paint it had just deferred. Kirby's Stone is exactly
  // that shape, and it is the one effect that replaces the fighter — so the
  // case where the queue is the *only* thing on screen is the case that would
  // have lost it.
  return { hideFigure: result?.hideFigure ?? false, over };
}
