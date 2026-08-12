/**
 * What makes a special look like *that fighter's* special.
 *
 * ## The problem this solves
 *
 * The pose library is shared on purpose — forty poses across eight rigs rather
 * than three hundred and twenty hand-authored animations (see `poses.ts`). For
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
 * One entry per fighter per slot, keyed `"<id>.<slot>"`, each a function that
 * paints in screen space. Anything without an entry falls through to nothing
 * drawn, which is correct: a special whose whole graphic is its projectile —
 * Link's arrow, Mario's fireball — is already drawn by `drawProjectiles`, and
 * a second glow on top would only muddy it.
 *
 * An effect may return `hideFigure`, which suppresses the fighter entirely for
 * that frame. Exactly one does: Kirby, who *is* the stone.
 */

import { moveFrameOf } from "@/engine/hitbox";
import type { FighterDef, FighterState, MoveSlot } from "@/engine/types";
import { SMASH_CHARGE_MAX } from "@/engine/constants";
import type { Camera } from "./camera";
import { withAlpha } from "./characterArt";

export interface SpecialFxResult {
  /** Draw no fighter this frame — the effect has replaced them. */
  readonly hideFigure: boolean;
}

const NOTHING: SpecialFxResult = { hideFigure: false };

interface FxContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly f: FighterState;
  readonly def: FighterDef;
  readonly cam: Camera;
  /** Fighter height in world units. */
  readonly height: number;
  /** Feet, in screen space. */
  readonly x: number;
  readonly y: number;
  /** Pixels per world unit — everything below is sized in these. */
  readonly u: number;
  /** The move's own frame number, counted the way the frame data is. */
  readonly frame: number;
  readonly total: number;
  /** 0..1 through the move. */
  readonly t: number;
}

type FxFn = (c: FxContext) => SpecialFxResult | void;

/* --------------------------------------------------------------- helpers -- */

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  inner: string,
  outer = "rgba(0,0,0,0)",
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(0.6, outer === "rgba(0,0,0,0)" ? withAlpha(inner, 0.35) : outer);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  circle(ctx, x, y, r);
}

function polygon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  sides: number,
  rotation: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** The window a move declares as super armour, which is also its transformation. */
function armourWindow(def: FighterDef, slot: MoveSlot): readonly [number, number] | null {
  return def.moves[slot]?.superArmourFrames ?? null;
}

/* ------------------------------------------------------------- the table -- */

const EFFECTS: Readonly<Record<string, FxFn>> = {
  /**
   * Kirby, Stone. He *becomes* a rock, so the rock is drawn instead of him —
   * the one effect in the file that replaces the fighter rather than decorating
   * them. A grey Kirby with a slightly different pose would be indistinguishable
   * from a grey Kirby doing anything else.
   */
  "kirby.downB": ({ ctx, def, x, y, u, frame }) => {
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

  /**
   * Samus, Charge Shot. The plasma grows in the cannon while it is held and
   * flashes when it goes — which is the whole read on the move, since the
   * *decision* a player makes against Samus is whether that ball is worth
   * respecting yet.
   */
  "samus.neutralB": ({ ctx, f, x, y, u, frame }) => {
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

  /**
   * Fox, Reflector. A hexagon is the single most recognisable shape in his
   * whole moveset, and it is also the honest one: it is on screen for exactly
   * the frames the reflector is out.
   */
  "fox.downB": ({ ctx, f, x, y, u, frame, total }) => {
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

  /**
   * Marth, Counter. Nothing at all until the window, then a hard flash — a
   * counter that glowed for its whole duration would be telling the opponent
   * what the move is for.
   */
  "marth.downB": ({ ctx, x, y, u, frame }) => {
    if (frame < 5 || frame > 22) return NOTHING;
    const k = 1 - (frame - 5) / 17;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, x, y - u * 6, u * 9 * (0.6 + k * 0.6), withAlpha("#FFE9A8", k * 0.85));
    ctx.restore();
    return NOTHING;
  },

  /**
   * Donkey Kong, Giant Punch. The fist is what is charged, so the fist is what
   * glows, and it grows with the charge. The white ring on the armour frames is
   * the tell for "hitting him now will not stop this".
   */
  "donkeyKong.neutralB": ({ ctx, f, def, x, y, u, frame }) => {
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

  /**
   * Pikachu, Thunder. The bolt comes down from off the top of the screen, which
   * is the entire point of the move — the cloud is not where the danger is.
   */
  "pikachu.downB": ({ ctx, x, y, u, frame }) => {
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

  /**
   * Mario, F.L.U.D.D. A cone of water: it does no damage at all, and a graphic
   * that looked like an attack would be a lie about what the move does.
   */
  "mario.downB": ({ ctx, f, x, y, u, frame, total }) => {
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

  /**
   * Link, Hero's Bow. The draw is the tell — how long he holds it is how far
   * the arrow goes — so the bow is drawn taut and the string is pulled with the
   * charge.
   */
  "link.neutralB": ({ ctx, f, x, y, u, frame, total }) => {
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

/* ---------------------------------------------------------------- driver -- */

/**
 * Paint whatever this fighter's current special looks like.
 *
 * Called for every fighter every frame; the table lookup is a miss for almost
 * all of them, which is the cheap path.
 */
export function drawSpecialFx(
  ctx: CanvasRenderingContext2D,
  def: FighterDef | null | undefined,
  f: FighterState,
  cam: Camera,
  height: number,
  screenX: number,
  screenY: number,
): SpecialFxResult {
  if (f.action !== "special" || f.move === null || !def) return NOTHING;
  const move = def.moves[f.move];
  if (!move) return NOTHING;

  const fn = EFFECTS[`${def.id}.${f.move}`];
  if (!fn) return NOTHING;

  const frame = moveFrameOf(f.actionFrame);
  const result = fn({
    ctx,
    f,
    def,
    cam,
    height,
    x: screenX,
    y: screenY,
    u: cam.zoom,
    frame,
    total: move.totalFrames,
    t: Math.min(1, frame / Math.max(1, move.totalFrames)),
  });
  return result ?? NOTHING;
}

/**
 * Every `"<fighter>.<slot>"` this file paints.
 *
 * Exported so a test can check each key names a move that actually exists — a
 * typo here is silent, and the symptom is a special that quietly looks like
 * every other special, which is the exact bug this file was written to fix.
 */
export const SPECIAL_FX_KEYS = Object.keys(EFFECTS);
