/**
 * pikachu: what their moves paint on top of the figure.
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
   * Pikachu, Thunder. The bolt comes down from off the top of the screen, which
   * is the entire point of the move — the cloud is not where the danger is.
   */
  downB: ({ ctx, x, y, u, frame }) => {
    if (frame < 10 || frame > 46) return NOTHING;
    const k = Math.min(1, (frame - 10) / 6);
    const jag = u * 1.5;
    const top = y - u * 90;
    const bottom = y - u * 6 * (1 - k) - u * 2;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#FFF6B0";
    ctx.lineWidth = Math.max(3, u * 1.1);
    ctx.beginPath();
    ctx.moveTo(x, top);
    // Deterministic zig-zag: derived from the frame so it flickers, but never
    // from `Math.random`, which would make two peers' screens disagree.
    for (let i = 1; i <= 9; i++) {
      const p = i / 9;
      const wobble = Math.sin(i * 2.7 + frame * 0.9) * jag;
      ctx.lineTo(x + wobble, top + (bottom - top) * p);
    }
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#FFFFFF", 0.9);
    ctx.lineWidth = Math.max(1, u * 0.4);
    ctx.stroke();
    glow(ctx, x, bottom, u * 7, withAlpha("#FFF3A0", 0.7));
    ctx.restore();
    return NOTHING;
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
