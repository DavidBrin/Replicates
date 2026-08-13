/**
 * link: what their moves paint on top of the figure.
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
   * Link, Hero's Bow. The draw is the tell — how long he holds it is how far
   * the arrow goes — so the bow is drawn taut and the string is pulled with the
   * charge.
   */
  neutralB: ({ ctx, f, x, y, u, frame, total }) => {
    if (frame > total * 0.7) return NOTHING;
    const side = f.facing >= 0 ? 1 : -1;
    const cx = x + u * 3.6 * side;
    const cy = y - u * 7;
    const r = u * 4.2;
    const pull = Math.min(1, frame / Math.max(1, total * 0.45));

    ctx.save();
    ctx.strokeStyle = "#C8A05A";
    ctx.lineWidth = Math.max(2, u * 0.45);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI * 0.42 * side + (side > 0 ? 0 : Math.PI), Math.PI * 0.42 * side + (side > 0 ? 0 : Math.PI));
    ctx.stroke();

    ctx.strokeStyle = "#E8E4D8";
    ctx.lineWidth = Math.max(1, u * 0.18);
    const nock = cx - u * (1 + pull * 2.4) * side;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(-Math.PI * 0.42) * r * side, cy + Math.sin(-Math.PI * 0.42) * r);
    ctx.lineTo(nock, cy);
    ctx.lineTo(cx + Math.cos(Math.PI * 0.42) * r * side, cy + Math.sin(Math.PI * 0.42) * r);
    ctx.stroke();
    ctx.restore();
    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
