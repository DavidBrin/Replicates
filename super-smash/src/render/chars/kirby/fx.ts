/**
 * kirby: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  armourWindow,
  polygon,
  type FxFn,
} from "../../fxKit";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Kirby, Stone. He *becomes* a rock, so the rock is drawn instead of him —
   * the one effect in the file that replaces the fighter rather than decorating
   * them. A grey Kirby with a slightly different pose would be indistinguishable
   * from a grey Kirby doing anything else.
   */
  downB: ({ ctx, def, x, y, u, frame }) => {
    const armour = armourWindow(def, "downB");
    if (!armour || frame < armour[0] || frame > armour[1]) return NOTHING;

    const r = u * 5.4;
    const cy = y - r * 0.92;
    // A lopsided hexagon, faceted rather than round, so it reads as cut rock.
    ctx.save();
    ctx.translate(x, cy);
    ctx.scale(1.08, 1);
    ctx.fillStyle = "#6E6A66";
    polygon(ctx, 0, 0, r, 6, 0.42);
    ctx.fill();
    ctx.fillStyle = "#8C8781";
    polygon(ctx, 0, -r * 0.16, r * 0.72, 6, 0.42);
    ctx.fill();
    ctx.fillStyle = "#4A4744";
    polygon(ctx, r * 0.22, r * 0.3, r * 0.3, 5, 1.1);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#2C2A28";
    ctx.lineWidth = Math.max(2, u * 0.4);
    ctx.save();
    ctx.translate(x, cy);
    ctx.scale(1.08, 1);
    polygon(ctx, 0, 0, r, 6, 0.42);
    ctx.stroke();
    ctx.restore();

    return { hideFigure: true };
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
