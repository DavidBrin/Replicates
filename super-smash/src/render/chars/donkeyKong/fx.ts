/**
 * donkeyKong: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  armourWindow,
  glow,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import { SMASH_CHARGE_MAX } from "@/engine/constants";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Donkey Kong, Giant Punch. The fist is what is charged, so the fist is what
   * glows, and it grows with the charge. The white ring on the armour frames is
   * the tell for "hitting him now will not stop this".
   */
  neutralB: ({ ctx, f, def, x, y, u, frame }) => {
    const side = f.facing >= 0 ? 1 : -1;
    const fistX = x + u * 5.4 * side;
    const fistY = y - u * 8.2;
    const charge = Math.min(1, f.charge / SMASH_CHARGE_MAX);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, fistX, fistY, u * (2.6 + charge * 4), withAlpha("#FFD37A", 0.5 + charge * 0.5));

    const armour = armourWindow(def, "neutralB");
    if (armour && frame >= armour[0] && frame <= armour[1]) {
      ctx.strokeStyle = withAlpha("#FFFFFF", 0.75);
      ctx.lineWidth = Math.max(2, u * 0.5);
      ctx.beginPath();
      ctx.arc(x, y - u * 6, u * 7.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return NOTHING;
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
