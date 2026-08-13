/**
 * samus: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  circle,
  glow,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import { SMASH_CHARGE_MAX } from "@/engine/constants";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Samus, Charge Shot. The plasma grows in the cannon while it is held and
   * flashes when it goes — which is the whole read on the move, since the
   * *decision* a player makes against Samus is whether that ball is worth
   * respecting yet.
   */
  neutralB: ({ ctx, f, x, y, u, frame }) => {
    const charge = Math.min(1, f.charge / SMASH_CHARGE_MAX);
    const cannonX = x + u * 6.2 * (f.facing >= 0 ? 1 : -1);
    const cannonY = y - u * 7.4;

    if (f.charge > 0) {
      const r = u * (1.1 + charge * 2.6);
      glow(ctx, cannonX, cannonY, r * 2.1, "#BFF3FF");
      ctx.fillStyle = "#7FE0FF";
      circle(ctx, cannonX, cannonY, r);
      ctx.fillStyle = "#FFFFFF";
      circle(ctx, cannonX, cannonY, r * 0.5);
      return NOTHING;
    }

    // The muzzle flash, for the few frames either side of the shot leaving.
    if (frame >= 2 && frame <= 8) {
      const k = 1 - (frame - 2) / 6;
      glow(ctx, cannonX, cannonY, u * 6 * k, withAlpha("#CFF6FF", k));
    }
    return NOTHING;
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
