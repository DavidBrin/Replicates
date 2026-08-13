/**
 * marth: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  glow,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Marth, Counter. Nothing at all until the window, then a hard flash — a
   * counter that glowed for its whole duration would be telling the opponent
   * what the move is for.
   */
  downB: ({ ctx, x, y, u, frame }) => {
    if (frame < 5 || frame > 22) return NOTHING;
    const k = 1 - (frame - 5) / 17;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, x, y - u * 6, u * 9 * (0.6 + k * 0.6), withAlpha("#FFE9A8", k * 0.85));
    ctx.restore();
    return NOTHING;
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
