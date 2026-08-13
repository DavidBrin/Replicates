/**
 * fox: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  polygon,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Fox, Reflector. A hexagon is the single most recognisable shape in his
   * whole moveset, and it is also the honest one: it is on screen for exactly
   * the frames the reflector is out.
   */
  downB: ({ ctx, f, x, y, u, frame, total }) => {
    if (frame > total - 6) return NOTHING;
    const side = f.facing >= 0 ? 1 : -1;
    const cx = x + u * 3.4 * side;
    const cy = y - u * 6.2;
    const r = u * 4.4;
    const spin = frame * 0.24;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = withAlpha("#4FA8FF", 0.3);
    polygon(ctx, cx, cy, r, 6, spin);
    ctx.fill();
    ctx.strokeStyle = "#BFE4FF";
    ctx.lineWidth = Math.max(1.5, u * 0.35);
    polygon(ctx, cx, cy, r, 6, spin);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#7FD0FF", 0.7);
    polygon(ctx, cx, cy, r * 0.62, 6, -spin);
    ctx.stroke();
    ctx.restore();
    return NOTHING;
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
