/**
 * The kit a fighter's move effects are painted with.
 *
 * Split out of `specialFx.ts` for the same reason `rigKit.ts` was split out of
 * `characterArt.ts`: the effects themselves now live one file per fighter, and
 * a shared vocabulary they can all import is what stops that from turning into
 * a shared file they all edit.
 *
 * ## The frame
 *
 * Everything here paints in **screen space**, in pixels, with the fighter's
 * feet at `(x, y)` and `u` pixels to the world unit. That is deliberately not
 * the pose layer's frame: an effect is a graphic laid over the fighter, not a
 * part of them, and a plasma beam that scaled and rotated with the arm it came
 * out of would be wrong in both.
 */

import { moveFrameOf } from "@/engine/hitbox";
import type { FighterDef, FighterState, MoveSlot } from "@/engine/types";
import type { Camera } from "./camera";
import { withAlpha } from "./rigKit";

export interface SpecialFxResult {
  /** Draw no fighter this frame — the effect has replaced them. */
  readonly hideFigure: boolean;
}

export const NOTHING: SpecialFxResult = { hideFigure: false };

export interface FxContext {
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
  /**
   * Which way the fighter faces: `+1` right, `-1` left.
   *
   * Every effect needs it and every effect used to re-derive it from
   * `f.facing`, which is a `1 | -1` on the state but reads as a number. Named
   * here so a forward-pointing graphic is `dir * something` and never a
   * conditional.
   */
  readonly dir: number;
  /**
   * Which of this move's hitboxes has connected so far this swing.
   *
   * Three states, and the difference between the last two matters:
   * a **number** is the box that won; **null** is "the simulation is watching
   * and nothing has connected"; **undefined** is "nobody supplied the cosmetic
   * state at all" — which is the animation lab, drawing a pose with no match
   * behind it. Collapsing null into undefined made a sourspot that hit a shield
   * bloom as a tipper, because a shield hit freezes the attacker without
   * producing a hit event, so the `hitlag` fallback fired on a swing the
   * simulation had already reported as not connecting.
   *
   * The id of the box that won, resolved by the simulation (`bestHitbox`
   * settles an overlap by lowest id, which is the sweetspot mechanic itself).
   * Scoped to the *current* action, so a swing that has not connected reads
   * `null` even if the previous one did.
   *
   * Geometry can tell an effect where a sweetspot is. Only this can tell it
   * whether the sweetspot is what landed — the difference between a tipper
   * flash on the right hits and one on every hit.
   */
  readonly struckWith?: number | null;
}

export type FxFn = (c: FxContext) => SpecialFxResult | void;

/* --------------------------------------------------------------- helpers -- */

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A radial falloff from `inner` at the centre to nothing at `r`.
 *
 * The mid stop defaults to `inner` at a third of its opacity, which needs
 * `withAlpha` to handle a colour that already carries an alpha — `inner` very
 * often does, because an effect fading over its own lifetime writes
 * `glow(..., withAlpha("#FFD9A0", 0.45 * fade))`. It used to come back black;
 * see `hexToRgb`.
 *
 * `undefined` rather than a sentinel string for `outer`, so that "the caller
 * did not choose" is a distinct thing from "the caller chose transparent
 * black" — a caller who deliberately wanted a hard falloff was getting the
 * derived mid stop instead.
 */
export function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  inner: string,
  outer?: string,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(0.6, outer ?? withAlpha(inner, 0.35));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  circle(ctx, x, y, r);
}

export function polygon(
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

/**
 * A tapered crescent — the shape a blade leaves behind it.
 *
 * This is the graphic the real game puts on nearly every strong attack, and
 * the reason a swing there reads as a swing at a glance: the arc is wider than
 * the weapon, brightest at its middle, and gone within a few frames. Centred on
 * `(x, y)`, sweeping from `from` to `to` in radians, `r` out and `w` thick at
 * its widest.
 */
export function crescent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  w: number,
  from: number,
  to: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r + w / 2, from, to);
  ctx.arc(x, y, Math.max(0, r - w / 2), to, from, true);
  ctx.closePath();
}

/** The window a move declares as super armour, which is also its transformation. */
export function armourWindow(
  def: FighterDef,
  slot: MoveSlot,
): readonly [number, number] | null {
  return def.moves[slot]?.superArmourFrames ?? null;
}

/** Build the context an effect is called with. Shared by the renderer and the lab. */
export function fxContextFor(
  ctx: CanvasRenderingContext2D,
  def: FighterDef,
  f: FighterState,
  cam: Camera,
  height: number,
  screenX: number,
  screenY: number,
  totalFrames: number,
  struckWith: number | null | undefined = undefined,
): FxContext {
  const frame = moveFrameOf(f.actionFrame);
  return {
    ctx,
    f,
    def,
    cam,
    height,
    x: screenX,
    y: screenY,
    u: cam.zoom,
    frame,
    total: totalFrames,
    t: Math.min(1, frame / Math.max(1, totalFrames)),
    dir: f.facing >= 0 ? 1 : -1,
    struckWith,
  };
}

/**
 * The box this fighter's current swing has landed with, if it has landed.
 *
 * Scoped by comparing against the frame the action started — `frame` less
 * `actionFrame` — so a hit from the previous swing cannot bloom this one.
 */
export function struckWithFor(
  lastHit: ({ hitboxId: number; frame: number } | null)[],
  f: Pick<FighterState, "port" | "actionFrame">,
  frame: number,
): number | null {
  const hit = lastHit[f.port];
  if (!hit) return null;
  return hit.frame >= frame - f.actionFrame ? hit.hitboxId : null;
}

/* ---------------------------------------------------------- projectiles -- */

/**
 * How a fighter paints their own projectile.
 *
 * Called with the context already translated to the projectile's position and
 * *not* rotated — a fireball tumbles, an arrow points where it is going, and a
 * bomb does neither, so the rotation is the painter's business.
 */
export type ProjectilePainter = (c: ProjectileContext) => void;

export interface ProjectileContext {
  readonly ctx: CanvasRenderingContext2D;
  /** Pixels per world unit. */
  readonly u: number;
  /** Frames since the projectile was created. */
  readonly age: number;
  /** `+1` travelling right, `-1` left. */
  readonly dir: number;
  /** Heading in screen space, radians. */
  readonly heading: number;
  /** Charge multiplier, 1 for an uncharged shot. */
  readonly charge: number;
  /** True once a returning projectile has turned round. */
  readonly returning: boolean;
  /** The global frame, for anything that should flicker on its own clock. */
  readonly frame: number;
}
