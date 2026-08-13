/**
 * mario: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  type FxFn,
} from "../../fxKit";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Mario, F.L.U.D.D. A cone of water: it does no damage at all, and a graphic
   * that looked like an attack would be a lie about what the move does.
   */
  downB: ({ ctx, f, x, y, u, frame, total }) => {
    if (frame < total * 0.45) return NOTHING;
    const side = f.facing >= 0 ? 1 : -1;
    const originX = x + u * 3 * side;
    const originY = y - u * 5.4;
    const reach = u * 22;

    ctx.save();
    ctx.globalAlpha = 0.55;
    const g = ctx.createLinearGradient(originX, originY, originX + reach * side, originY);
    g.addColorStop(0, "#CFEBFF");
    g.addColorStop(1, "rgba(160,210,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(originX, originY - u * 0.8);
    ctx.lineTo(originX + reach * side, originY - u * 4.5);
    ctx.lineTo(originX + reach * side, originY + u * 4.5);
    ctx.lineTo(originX, originY + u * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return NOTHING;
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
