/**
 * pikachu: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 *
 * ## Why this file is mostly a kit
 *
 * Pikachu is the one fighter whose moves are not really *poses*. His limbs are
 * stubs an eighth the size of his head; a wound-up elbow is four pixels nobody
 * sees. What the player actually reads on nearly every one of his attacks is
 * the **electricity** — an orb, a ring of current, a fan of arcs, a bolt out of
 * the sky — and in the real game that graphic is bigger than he is. So the bulk
 * of the work here is a small vocabulary of electric primitives, and each move
 * is a few lines that arrange them.
 *
 * Everything is stroked three times — a wide dim halo, a saturated middle, a
 * thin white centre — which is the difference between a line that reads as
 * lightning and one that reads as a scribble, and everything composites
 * additively so overlapping arcs blow out to white the way they do on screen.
 */

import {
  NOTHING,
  circle,
  crescent,
  glow,
  type FxContext,
  type FxFn,
  type ProjectilePainter,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import type { MoveSlot } from "@/engine/types";

/* ==================================================== the electric kit === */

/** The four colours every electric shape here is built out of. */
export const ELECTRIC = {
  /** The wide, dim outer halo. */
  halo: "#FFB020",
  /** The saturated middle — the colour a player would actually name. */
  body: "#FFE24A",
  /** The white-hot centre line. */
  core: "#FFFFFF",
  /** A soft fill, for glows and the inside of an orb. */
  hot: "#FFF6B0",
} as const;

export interface ArcOpts {
  /** Sideways wobble, pixels. Default 18% of the span. */
  readonly jag?: number;
  /** Polyline segments. More is finer and busier. Default 6. */
  readonly segs?: number;
  /** Width of the white core, pixels. The halo is three times this. Default 2. */
  readonly width?: number;
  /** 0..1. Default 1. */
  readonly alpha?: number;
  /**
   * 1 fades the wobble to nothing at both ends, so the arc meets its endpoints
   * exactly — right when it is joining two things. 0 keeps it jagged the whole
   * way, which is what a free bolt looks like.
   */
  readonly taper?: number;
}

/**
 * Deterministic pseudo-noise in `[-1, 1]`.
 *
 * Never `Math.random`. Two peers render the same frame from the same state and
 * a bolt that forks differently on each screen is the most visible possible
 * disagreement, so every jag is a pure function of a seed the caller derives
 * from the frame.
 */
function noise(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Build a jagged polyline path between two points. Does not stroke it. */
function jaggedPath(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  jag: number,
  seed: number,
  segs: number,
  taper: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i <= segs; i++) {
    const p = i / segs;
    const env = 1 - taper + taper * Math.sin(p * Math.PI);
    const amp = env * jag * noise(seed + i * 7.3);
    ctx.lineTo(x0 + dx * p + nx * amp, y0 + dy * p + ny * amp);
  }
}

/**
 * Stroke the current path as lightning: halo, body, white core.
 *
 * The three widths are deliberately far apart and the white one is thin. Under
 * `lighter` every overlap sums, so a white core at full alpha and half the body
 * width turns a dense burst into a white blob — which is what the first pass of
 * the forward smash looked like: bright, unmistakably *something*, and not
 * yellow. Pikachu's electricity is yellow with a white filament in it, so the
 * saturated middle carries the weight and the white is a highlight.
 */
function strokeGlow(ctx: CanvasRenderingContext2D, width: number, alpha: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = withAlpha(ELECTRIC.halo, 0.26 * alpha);
  ctx.lineWidth = width * 3.4;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(ELECTRIC.body, 0.9 * alpha);
  ctx.lineWidth = width * 1.9;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(ELECTRIC.core, 0.7 * alpha);
  ctx.lineWidth = Math.max(0.8, width * 0.4);
  ctx.stroke();
}

/**
 * Wrap electric painting: saves the context, switches to additive blending,
 * restores. Everything in the kit assumes it is being called inside one of
 * these, and calling them outside is not wrong — only flatter.
 */
export function electric(ctx: CanvasRenderingContext2D, paint: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  paint();
  ctx.restore();
}

/** One crackling arc between two points. */
export function arc(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  seed: number,
  o: ArcOpts = {},
): void {
  const span = Math.hypot(x1 - x0, y1 - y0);
  jaggedPath(ctx, x0, y0, x1, y1, o.jag ?? span * 0.18, seed, o.segs ?? 6, o.taper ?? 1);
  strokeGlow(ctx, o.width ?? 2, o.alpha ?? 1);
}

/** `n` arcs radiating out of a point to about radius `r`. */
export function arcBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  n: number,
  seed: number,
  o: ArcOpts & { readonly turn?: number } = {},
): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (o.turn ?? 0) + noise(seed + i * 2.1) * 0.28;
    const reach = r * (0.62 + 0.38 * Math.abs(noise(seed + i * 3.7)));
    arc(
      ctx,
      x + Math.cos(a) * r * 0.14,
      y + Math.sin(a) * r * 0.14,
      x + Math.cos(a) * reach,
      y + Math.sin(a) * reach,
      seed + i * 11.3,
      { taper: 0.35, ...o },
    );
  }
}

/** A closed jagged ring of current — a band wrapped round the body. */
export function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
  o: ArcOpts & { readonly jagK?: number } = {},
): void {
  const segs = o.segs ?? 16;
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const rr = r * (1 + (o.jagK ?? 0.17) * noise(seed + i * 5.7));
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  strokeGlow(ctx, o.width ?? 2, o.alpha ?? 1);
}

/**
 * A ball of electricity: soft glow, yellow body, white core, surface arcs.
 *
 * The arcs are kept short — barely a quarter of the radius outside the ball —
 * because the whole point of this shape is that it is a *ball*. Thrown out to
 * nearly twice the radius they stopped being a surface and became a spray, and
 * the forward smash read as a burst of lightning rather than as the orb the
 * move is named for.
 */
export function orb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
  o: { readonly arcs?: number; readonly alpha?: number } = {},
): void {
  const a = o.alpha ?? 1;
  glow(ctx, x, y, r * 2.1, withAlpha(ELECTRIC.body, 0.42 * a));
  ctx.fillStyle = withAlpha(ELECTRIC.body, 0.95 * a);
  circle(ctx, x, y, r * 0.86);
  ctx.fillStyle = withAlpha(ELECTRIC.hot, 0.9 * a);
  circle(ctx, x, y, r * 0.58);
  ctx.fillStyle = withAlpha(ELECTRIC.core, 0.85 * a);
  circle(ctx, x, y, r * 0.3);
  arcBurst(ctx, x, y, r * 1.22, o.arcs ?? 5, seed, {
    width: Math.max(1, r * 0.13),
    jag: r * 0.3,
    alpha: a * 0.9,
  });
}

/**
 * The eight-pointed flash the game stamps on the point of contact.
 *
 * Filled rather than stroked: at the size a hit spark is actually drawn, a
 * stroked star is a smudge and a filled one is a star.
 */
export function spark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  turn = 0,
): void {
  glow(ctx, x, y, r * 1.6, withAlpha(ELECTRIC.hot, 0.55));
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = turn + (i / 12) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.28;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = withAlpha(ELECTRIC.body, 0.95);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = turn + (i / 12) * Math.PI * 2;
    const rr = (i % 2 === 0 ? r : r * 0.28) * 0.5;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = ELECTRIC.core;
  ctx.fill();
}

/** A lightning bolt between two points, with `o.forks` branches off it. */
export function boltTo(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  seed: number,
  o: ArcOpts & { readonly forks?: number } = {},
): void {
  const opts: ArcOpts = { segs: 10, taper: 0.25, ...o };
  arc(ctx, x0, y0, x1, y1, seed, opts);
  const forks = o.forks ?? 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 0; i < forks; i++) {
    const p = 0.25 + 0.5 * ((i + 0.5) / forks);
    const bx = x0 + dx * p;
    const by = y0 + dy * p;
    const side = noise(seed + i * 17.9) >= 0 ? 1 : -1;
    const reach = len * (0.16 + 0.14 * Math.abs(noise(seed + i * 4.3)));
    arc(
      ctx,
      bx,
      by,
      bx + (-dy / len) * side * reach + (dx / len) * reach * 0.5,
      by + (dx / len) * side * reach + (dy / len) * reach * 0.5,
      seed + i * 23.1,
      { ...opts, width: (opts.width ?? 2) * 0.6, taper: 0.4 },
    );
  }
}

/** A tapered afterimage streak — what a body leaves behind when it teleports. */
export function streak(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  alpha = 0.7,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(x0 + dx * 0.4 + nx, y0 + dy * 0.4 + ny, x1, y1);
  ctx.quadraticCurveTo(x0 + dx * 0.4 - nx, y0 + dy * 0.4 - ny, x0, y0);
  ctx.closePath();
  // `hot` is so close to white that under `lighter` a trail painted in it reads
  // as a grey smear rather than as Pikachu's electricity. The saturated middle
  // is the colour of the character.
  ctx.fillStyle = withAlpha(ELECTRIC.body, alpha);
  ctx.fill();
  ctx.fillStyle = withAlpha(ELECTRIC.core, alpha * 0.45);
  ctx.fill();
}

/**
 * Where Pikachu's parts sit, as a fraction of his height above his feet.
 *
 * He is nearly all head, so these are nothing like a humanoid's: his eyes are
 * at two thirds of his total height and his belly is at four tenths.
 */
export const AT = {
  foot: 0.05,
  tail: 0.4,
  belly: 0.44,
  cheek: 0.6,
  head: 0.68,
  crown: 0.9,
  ear: 1.02,
} as const;

/** Screen y, `k` of his height above his feet. */
export function up(c: FxContext, k: number): number {
  return c.y - c.height * c.u * k;
}

/** Screen x, `k` of his height forward of his feet. Negative is behind him. */
export function fwd(c: FxContext, k: number): number {
  return c.x + c.dir * c.height * c.u * k;
}

/**
 * Two crackles at the cheek pouches. `k` is 0..1 intensity.
 *
 * Sized generously — a third of his height rather than a sixth. The pouches are
 * a red disc about four pixels across at match scale, and a spark drawn to the
 * scale of the pouch is invisible; in the real game the discharge is wider than
 * his head. The first pass here used 0.16 and did not read at all.
 */
export function cheekSparks(c: FxContext, seed: number, k: number): void {
  if (k <= 0) return;
  const r = c.height * c.u * 0.32 * k;
  arcBurst(c.ctx, fwd(c, 0.15), up(c, AT.cheek), r, 5, seed, {
    width: Math.max(1.2, r * 0.14),
    alpha: k,
  });
  arcBurst(c.ctx, fwd(c, -0.16), up(c, AT.cheek), r * 0.78, 4, seed + 9.5, {
    width: Math.max(1, r * 0.12),
    alpha: k * 0.75,
  });
}

/** A soft charge glow behind the whole body. `k` is 0..1. */
export function bodyGlow(c: FxContext, k: number): void {
  if (k <= 0) return;
  glow(
    c.ctx,
    c.x,
    up(c, 0.5),
    c.height * c.u * (0.75 + 0.35 * k),
    withAlpha(ELECTRIC.hot, 0.42 * k),
  );
}

/**
 * The sweep a charged tail leaves behind it.
 *
 * Five of Pikachu's attacks are tail swipes and the tail is a prop hung off the
 * hip, so it cannot be swung on its own — the body rotation carries it, and
 * *this* is the part the player actually tracks. Angles are screen-space
 * radians with `0` forward and negative upward, mirrored by facing here so a
 * caller never writes a sign.
 */
export function tailArc(
  c: FxContext,
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  seed: number,
  o: { readonly width?: number; readonly alpha?: number } = {},
): void {
  const ctx = c.ctx;
  const f = c.dir >= 0 ? from : Math.PI - from;
  const t = c.dir >= 0 ? to : Math.PI - to;
  const a = o.alpha ?? 1;
  const w = o.width ?? r * 0.4;
  crescent(ctx, cx, cy, r, w, Math.min(f, t), Math.max(f, t));
  ctx.fillStyle = withAlpha(ELECTRIC.body, 0.5 * a);
  ctx.fill();
  crescent(ctx, cx, cy, r, w * 0.42, Math.min(f, t), Math.max(f, t));
  ctx.fillStyle = withAlpha(ELECTRIC.hot, 0.5 * a);
  ctx.fill();
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a0 = f + (t - f) * (i / n);
    const a1 = f + (t - f) * ((i + 1) / n);
    arc(
      ctx,
      cx + Math.cos(a0) * r,
      cy + Math.sin(a0) * r,
      cx + Math.cos(a1) * r,
      cy + Math.sin(a1) * r,
      seed + i * 7.7,
      { width: Math.max(1.6, r * 0.1), jag: r * 0.16, alpha: a, taper: 0.5 },
    );
  }
}

/** Ramp to 1 across `rise` frames from `at`, then decay to 0 by `end`. */
function pulse(frame: number, at: number, rise: number, end: number): number {
  if (frame < at || frame > end) return 0;
  const up_ = Math.min(1, (frame - at + 1) / rise);
  const down = Math.min(1, (end - frame) / Math.max(1, (end - at) * 0.6));
  return Math.max(0, Math.min(up_, down));
}

/* ========================================================== the moves === */

/**
 * The headbutt spark.
 *
 * His jab is a single looping headbutt, live on frames 2-3, and `jab1` and
 * `rapidJab` are the same move in two slots — so they are the same graphic.
 */
const headbuttSpark: FxFn = (c) => {
  const k = pulse(c.frame, 2, 1, 7);
  if (k <= 0) return NOTHING;
  electric(c.ctx, () => {
    spark(c.ctx, c.x + c.dir * 3.4 * c.u, c.y - 3.2 * c.u, c.u * 2.4 * k, c.frame * 0.6);
    arcBurst(c.ctx, c.x + c.dir * 3.0 * c.u, c.y - 3.2 * c.u, c.u * 3.4 * k, 4, c.frame, {
      width: Math.max(1, c.u * 0.22),
      alpha: k,
    });
  });
  return NOTHING;
};

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  jab1: headbuttSpark,
  rapidJab: headbuttSpark,

  /**
   * Double-Footed Kick. The kick is electrified, so the current runs down the
   * legs and discharges off the feet — which is also the only part of him out
   * there far enough for the discharge to be seen clear of his own outline.
   */
  ftilt: (c) => {
    const k = pulse(c.frame, 5, 2, 13);
    if (k <= 0) return NOTHING;
    const fx0 = c.x + c.dir * 4.4 * c.u;
    const fy = c.y - 2.6 * c.u;
    electric(c.ctx, () => {
      arcBurst(c.ctx, fx0, fy, c.u * 3.6 * k, 6, c.frame * 1.7, {
        width: Math.max(1.2, c.u * 0.24),
        alpha: k,
      });
      arc(c.ctx, c.x, c.y - 3.2 * c.u, fx0, fy, c.frame * 2.3, {
        width: Math.max(1, c.u * 0.28),
        alpha: k * 0.9,
      });
      if (c.frame <= 8) spark(c.ctx, fx0 + c.dir * c.u, fy, c.u * 2.2 * k, c.frame);
    });
    return NOTHING;
  },

  /**
   * Tail Attack: the swipe starts behind him and finishes overhead in front.
   * The crescent is the tail's path, and it leads the body slightly because a
   * whipped tail is ahead of the animal it is attached to.
   */
  utilt: (c) => {
    const k = pulse(c.frame, 6, 2, 16);
    if (k <= 0) return NOTHING;
    const s = Math.min(1, Math.max(0, (c.frame - 5) / 8));
    const from = 2.9 + 2.5 * s;
    electric(c.ctx, () => {
      tailArc(c, c.x, up(c, 0.5), c.height * c.u * 0.82, from, from - 1.5, c.frame * 3.3, {
        alpha: k,
      });
      cheekSparks(c, c.frame * 1.9, k * 0.5);
    });
    return NOTHING;
  },

  /**
   * Tail Sweep. Along the floor rather than over the top, which is why the real
   * move has such absurd horizontal reach for a fighter this small.
   */
  dtilt: (c) => {
    const k = pulse(c.frame, 6, 2, 12);
    if (k <= 0) return NOTHING;
    const s = Math.min(1, Math.max(0, (c.frame - 6) / 4));
    electric(c.ctx, () => {
      tailArc(
        c,
        c.x - c.dir * 0.8 * c.u,
        c.y - 1.5 * c.u,
        c.u * 6.2,
        -0.5 + 0.55 * s,
        0.34 + 0.55 * s,
        c.frame * 2.9,
        { width: c.u * 2.0, alpha: k },
      );
      arcBurst(c.ctx, c.x + c.dir * (2.6 + 3.0 * s) * c.u, c.y - 0.8 * c.u, c.u * 3.4 * k, 5, c.frame, {
        width: Math.max(1.2, c.u * 0.26),
        alpha: k,
      });
    });
    return NOTHING;
  },

  /**
   * Running Headbutt. No electric effect in the real move — it is a physical
   * ram — so what is painted is speed: an afterimage behind him and the dust of
   * the impact, and the discharge only on the clean early hit.
   */
  dashAttack: (c) => {
    if (c.frame < 3 || c.frame > 14) return NOTHING;
    const k = pulse(c.frame, 5, 2, 13);
    electric(c.ctx, () => {
      for (let i = 1; i <= 3; i++) {
        streak(
          c.ctx,
          c.x - c.dir * c.u * (1.2 + i * 2.2),
          up(c, 0.5),
          c.x - c.dir * c.u * 0.4,
          up(c, 0.52),
          c.u * (1.6 - i * 0.3),
          0.16 * (4 - i) * Math.min(1, (c.frame - 2) / 3),
        );
      }
      if (k > 0) {
        spark(c.ctx, c.x + c.dir * 3.6 * c.u, c.y - 3.0 * c.u, c.u * 2.6 * k, c.frame * 0.8);
        arcBurst(c.ctx, c.x + c.dir * 3.2 * c.u, c.y - 3.0 * c.u, c.u * 3.2 * k, 5, c.frame * 1.3, {
          width: Math.max(1, c.u * 0.22),
          alpha: k * 0.8,
        });
      }
    });
    return NOTHING;
  },

  /**
   * Thundershock — the forward smash, and the move whose whole graphic is the
   * graphic. "Rears its head back before leaning forward and releasing a large
   * orb of electricity in front of it, leaving a trail of electricity."
   *
   * The three hitboxes are the three parts of it: the orb's centre at frames
   * 17-19 (18%), the early edge at 15-16, and the long trailing tail at 20-29.
   * The orb's own hitbox is radius 3.4 at (5.4, 3.4), which is a ball nearly as
   * big as Pikachu, so it is drawn at that size — an orb the player can see is
   * as wide as he is tall is the reason the move is respected.
   */
  fsmash: (c) => {
    const { ctx, x, y, u, dir, frame } = c;
    // The charge. `poseTimeFor` parks the body partway up its wind-up while the
    // button is held, and this is what sits behind it.
    if (c.f.charge > 0) {
      const k = Math.min(1, c.f.charge / 60);
      electric(ctx, () => {
        bodyGlow(c, 0.4 + 0.6 * k);
        cheekSparks(c, frame * 2.1, 0.5 + 0.5 * k);
        ring(ctx, x, up(c, 0.5), c.height * u * (0.5 + 0.12 * Math.sin(frame * 0.4)), frame, {
          width: Math.max(1, u * 0.22),
          alpha: 0.5 + 0.4 * k,
        });
      });
      return NOTHING;
    }
    if (frame < 9) return NOTHING;
    // Gathering at the cheeks, then thrown.
    if (frame < 15) {
      const k = (frame - 8) / 7;
      electric(ctx, () => {
        cheekSparks(c, frame * 2.1, k);
        orb(ctx, x + dir * 1.6 * u, y - 3.4 * u, u * 2.2 * k, frame * 1.7, { arcs: 4, alpha: k });
      });
      return NOTHING;
    }
    if (frame > 31) return NOTHING;
    // Live: the ball sits where its hitbox is and the trail runs back to him.
    const life = (frame - 15) / 16;
    const fade = frame <= 19 ? 1 : Math.max(0, 1 - (frame - 19) / 12);
    const cx = x + dir * (4.2 + 1.6 * life) * u;
    const cy = y - 3.4 * u;
    electric(ctx, () => {
      streak(ctx, x + dir * 0.8 * u, y - 3.3 * u, cx, cy, u * 1.8 * fade, 0.5 * fade);
      orb(ctx, cx, cy, u * 3.4 * (0.82 + 0.18 * life), frame * 1.9, { arcs: 6, alpha: fade });
      arcBurst(ctx, cx, cy, u * 4.6 * fade, 4, frame * 2.7, {
        width: Math.max(1, u * 0.2),
        alpha: fade * 0.55,
      });
    });
    return NOTHING;
  },

  /**
   * Tail Somersault. The mirror of the up tilt: it starts in *front* and goes up
   * and over to behind, which is the direction the crescent sweeps.
   */
  usmash: (c) => {
    if (c.f.charge > 0) {
      const k = Math.min(1, c.f.charge / 60);
      electric(c.ctx, () => {
        bodyGlow(c, 0.35 + 0.5 * k);
        tailArc(c, c.x, up(c, 0.5), c.height * c.u * 0.78, 0.5, -0.1, c.frame * 2.2, {
          alpha: 0.4 + 0.5 * k,
        });
      });
      return NOTHING;
    }
    const k = pulse(c.frame, 9, 2, 22);
    if (k <= 0) return NOTHING;
    const s = Math.min(1, Math.max(0, (c.frame - 8) / 9));
    const from = 0.25 - 3.5 * s;
    electric(c.ctx, () => {
      tailArc(c, c.x, up(c, 0.52), c.height * c.u * 0.86, from, from + 1.4, c.frame * 3.1, {
        alpha: k,
      });
    });
    return NOTHING;
  },

  /**
   * Electric Flower — five two-percent hits three frames apart at ankle height
   * and a finisher on 23, thrown off a tail spinning round him like a pinwheel.
   * The ring is the pinwheel's plane; the spark on each hit frame is what makes
   * five hits look like five hits rather than like one long blur.
   */
  dsmash: (c) => {
    if (c.f.charge > 0) {
      const k = Math.min(1, c.f.charge / 60);
      electric(c.ctx, () => {
        bodyGlow(c, 0.3 + 0.5 * k);
        ring(c.ctx, c.x, c.y - 1.4 * c.u, c.height * c.u * (0.34 + 0.06 * k), c.frame, {
          width: Math.max(1, c.u * 0.24),
          alpha: 0.5 + 0.4 * k,
        });
      });
      return NOTHING;
    }
    if (c.frame < 6 || c.frame > 34) return NOTHING;
    const spin = c.frame * 0.62;
    const live = c.frame <= 24 ? 1 : Math.max(0, 1 - (c.frame - 24) / 10);
    electric(c.ctx, () => {
      const r = c.u * 6.4 * (0.9 + 0.1 * Math.sin(c.frame * 0.9));
      // The plane the tail sweeps, flattened: the sweep is horizontal and the
      // hitboxes sit at y = 1.0, an ankle off the floor. This ellipse is the
      // whole move — the body cannot show a spin about a vertical axis, so if
      // this is not clearly wider than he is, nothing about the attack reads.
      c.ctx.save();
      c.ctx.translate(c.x, c.y - 1.2 * c.u);
      c.ctx.scale(1, 0.36);
      ring(c.ctx, 0, 0, r, c.frame, { width: Math.max(2, c.u * 0.44), alpha: 0.9 * live });
      ring(c.ctx, 0, 0, r * 0.62, c.frame * 1.7, {
        width: Math.max(1.4, c.u * 0.28),
        alpha: 0.55 * live,
      });
      c.ctx.restore();
      for (const s of [1, -1]) {
        const a = spin + (s < 0 ? Math.PI : 0);
        tailArc(
          c,
          c.x,
          c.y - 1.2 * c.u,
          r * 0.92,
          a - 0.45,
          a + 0.45,
          c.frame * 2.6 + s,
          { width: c.u * 1.6, alpha: 0.95 * live },
        );
      }
      for (const hit of [8, 11, 14, 17, 20]) {
        const k = pulse(c.frame, hit, 1, hit + 2);
        if (k > 0) spark(c.ctx, c.x + c.dir * 3.4 * c.u, c.y - 1.0 * c.u, c.u * 2.2 * k, c.frame);
      }
      const fin = pulse(c.frame, 23, 1, 28);
      if (fin > 0) {
        spark(c.ctx, c.x + c.dir * 3.6 * c.u, c.y - 1.0 * c.u, c.u * 3.4 * fin, c.frame * 0.7);
        ring(c.ctx, c.x, c.y - 1.4 * c.u, c.u * (4 + 5 * (1 - fin)), c.frame, {
          width: Math.max(1.4, c.u * 0.34 * fin),
          alpha: fin,
        });
      }
    });
    return NOTHING;
  },

  /**
   * Pikachu Shock. He does not swing anything — he "poses while charging itself
   * with electricity", four hits on frames 3, 9, 15 and 21 — so the move *is*
   * this graphic: a body wrapped in current, throwing a ring off itself on each
   * discharge.
   */
  nair: (c) => {
    if (c.frame < 2 || c.frame > 30) return NOTHING;
    const live = c.frame <= 23 ? 1 : Math.max(0, 1 - (c.frame - 23) / 7);
    electric(c.ctx, () => {
      bodyGlow(c, 0.5 * live);
      const r = c.height * c.u * 0.5;
      ring(c.ctx, c.x, up(c, 0.5), r, c.frame * 1.3, {
        width: Math.max(1.2, c.u * 0.26),
        alpha: 0.9 * live,
      });
      arcBurst(c.ctx, c.x, up(c, 0.5), r * 1.5, 7, c.frame * 2.1, {
        width: Math.max(1, c.u * 0.22),
        alpha: 0.75 * live,
      });
      // Each of the four hits throws a ring clear of him.
      for (const hit of [3, 9, 15, 21]) {
        const k = pulse(c.frame, hit, 1, hit + 5);
        if (k <= 0) continue;
        ring(c.ctx, c.x, up(c, 0.5), r * (1 + 1.4 * (1 - k)), c.frame + hit, {
          width: Math.max(1, c.u * 0.3 * k),
          alpha: k,
          jagK: 0.1,
        });
      }
    });
    return NOTHING;
  },

  /**
   * Electric Drill. Six hits out of a head spun forward like a bit, so the
   * current wraps the head rather than the body and the arcs lean the way he is
   * turning.
   */
  fair: (c) => {
    const k = pulse(c.frame, 10, 2, 30);
    if (k <= 0) return NOTHING;
    const hx = c.x + c.dir * 2.4 * c.u;
    const hy = c.y - 3.4 * c.u;
    electric(c.ctx, () => {
      for (let i = 0; i < 3; i++) {
        const a = c.frame * 0.9 + (i / 3) * Math.PI * 2;
        c.ctx.save();
        c.ctx.translate(hx, hy);
        c.ctx.scale(0.55, 1);
        ring(c.ctx, 0, 0, c.u * 3.2, c.frame + i * 13, {
          width: Math.max(1, c.u * 0.24),
          alpha: k * (0.4 + 0.35 * Math.abs(Math.sin(a))),
          jagK: 0.22,
        });
        c.ctx.restore();
      }
      arcBurst(c.ctx, hx, hy, c.u * 4.2, 5, c.frame * 2.3, {
        width: Math.max(1, c.u * 0.24),
        alpha: k * 0.8,
        turn: c.frame * 0.4,
      });
      const fin = pulse(c.frame, 27, 1, 31);
      if (fin > 0) spark(c.ctx, hx + c.dir * c.u, hy, c.u * 3.2 * fin, c.frame);
    });
    return NOTHING;
  },

  /**
   * Glider. He spins about a *vertical* axis, which a side-on camera cannot
   * show as rotation — so the graphic is the plane he is spinning in, drawn as
   * flat rings, and that is the whole reason this effect exists.
   */
  bair: (c) => {
    const k = pulse(c.frame, 3, 2, 30);
    if (k <= 0) return NOTHING;
    const live = c.frame <= 26 ? 1 : Math.max(0, 1 - (c.frame - 26) / 5);
    electric(c.ctx, () => {
      c.ctx.save();
      c.ctx.translate(c.x, up(c, 0.5));
      c.ctx.scale(1, 0.34);
      for (let i = 0; i < 2; i++) {
        ring(c.ctx, 0, 0, c.u * (4.2 + i * 1.6), c.frame * 1.7 + i * 31, {
          width: Math.max(1.2, c.u * 0.3),
          alpha: (i === 0 ? 0.85 : 0.45) * live,
        });
      }
      c.ctx.restore();
      for (const hit of [4, 8, 12, 16, 20]) {
        const p = pulse(c.frame, hit, 1, hit + 3);
        if (p > 0) spark(c.ctx, c.x - c.dir * 3.4 * c.u, c.y - 3.2 * c.u, c.u * 1.9 * p, c.frame);
      }
      const fin = pulse(c.frame, 24, 1, 29);
      if (fin > 0) spark(c.ctx, c.x - c.dir * 3.8 * c.u, c.y - 3.2 * c.u, c.u * 3.2 * fin, c.frame);
    });
    return NOTHING;
  },

  /** Tail Chop: the up tilt's arc thrown in the air, and gone in four frames. */
  uair: (c) => {
    const k = pulse(c.frame, 3, 1, 12);
    if (k <= 0) return NOTHING;
    const s = Math.min(1, Math.max(0, (c.frame - 3) / 5));
    const from = 2.9 + 2.4 * s;
    electric(c.ctx, () => {
      tailArc(c, c.x, up(c, 0.55), c.height * c.u * 0.8, from, from - 1.3, c.frame * 3.7, {
        alpha: k,
      });
    });
    return NOTHING;
  },

  /**
   * Electric Screw. He points down and screws his head into them, so the
   * current is a column *below* his feet — which is exactly where the hitbox is,
   * at y = -1.4.
   */
  dair: (c) => {
    const k = pulse(c.frame, 13, 2, 30);
    if (k <= 0) return NOTHING;
    electric(c.ctx, () => {
      const cy = c.y + 1.4 * c.u;
      for (let i = 0; i < 3; i++) {
        c.ctx.save();
        c.ctx.translate(c.x, cy - i * 1.6 * c.u);
        c.ctx.scale(1, 0.3);
        ring(c.ctx, 0, 0, c.u * (3.4 - i * 0.5), c.frame * 1.9 + i * 17, {
          width: Math.max(1, c.u * 0.26),
          alpha: k * (0.9 - i * 0.22),
        });
        c.ctx.restore();
      }
      arcBurst(c.ctx, c.x, cy, c.u * 3.6, 5, c.frame * 2.5, {
        width: Math.max(1, c.u * 0.24),
        alpha: k * 0.85,
        turn: c.frame * 0.5,
      });
      const clean = pulse(c.frame, 14, 1, 18);
      if (clean > 0) spark(c.ctx, c.x, cy, c.u * 3.4 * clean, c.frame * 0.5);
    });
    return NOTHING;
  },

  /**
   * Thunder Jolt. The projectile is the move and it is painted by
   * `projectiles.thunderJolt`; all this does is the cheeks charging and the
   * flash of the ball leaving him on frame 19, which is the spawn frame the
   * move declares.
   */
  neutralB: (c) => {
    if (c.frame > 26) return NOTHING;
    electric(c.ctx, () => {
      if (c.frame < 19) {
        const k = Math.min(1, c.frame / 12);
        cheekSparks(c, c.frame * 2.3, k);
        if (c.frame > 9) {
          const g = (c.frame - 9) / 10;
          orb(
            c.ctx,
            c.x + c.dir * 2.0 * c.u,
            c.y - 3.0 * c.u,
            c.u * 2.6 * g,
            c.frame * 1.7,
            { arcs: 5, alpha: g },
          );
        }
        return;
      }
      const k = Math.max(0, 1 - (c.frame - 19) / 8);
      spark(c.ctx, c.x + c.dir * 3.8 * c.u, c.y - 2.8 * c.u, c.u * 4.0 * k, c.frame);
      arcBurst(c.ctx, c.x + c.dir * 3.0 * c.u, c.y - 2.8 * c.u, c.u * 5.0 * k, 5, c.frame * 2.2, {
        width: Math.max(1.2, c.u * 0.26),
        alpha: k,
      });
      cheekSparks(c, c.frame * 2.3, k * 0.7);
    });
    return NOTHING;
  },

  /**
   * Skull Bash. Not an electric attack — the damage is a headbutt — but the
   * charge is visibly building something, so the current gathers on him while
   * he compresses and then becomes speed once he launches on frame 18.
   */
  sideB: (c) => {
    if (c.frame > 54) return NOTHING;
    electric(c.ctx, () => {
      if (c.frame < 18) {
        const k = Math.min(1, c.frame / 16);
        bodyGlow(c, 0.3 + 0.6 * k);
        ring(c.ctx, c.x, up(c, 0.48), c.height * c.u * (0.6 - 0.18 * k), c.frame, {
          width: Math.max(1, c.u * 0.24),
          alpha: 0.4 + 0.5 * k,
        });
        cheekSparks(c, c.frame * 2.7, k * 0.7);
        return;
      }
      const live = c.frame <= 40 ? 1 : Math.max(0, 1 - (c.frame - 40) / 14);
      for (let i = 1; i <= 4; i++) {
        streak(
          c.ctx,
          c.x - c.dir * c.u * (1.0 + i * 2.4),
          up(c, 0.5),
          c.x - c.dir * c.u * 0.3,
          up(c, 0.5),
          c.u * (1.9 - i * 0.3),
          0.14 * (5 - i) * live,
        );
      }
      glow(
        c.ctx,
        c.x + c.dir * 2.6 * c.u,
        c.y - 3.2 * c.u,
        c.u * 4.6 * live,
        withAlpha(ELECTRIC.hot, 0.5 * live),
      );
      arcBurst(c.ctx, c.x + c.dir * 2.6 * c.u, c.y - 3.2 * c.u, c.u * 3.6, 4, c.frame * 2.9, {
        width: Math.max(1, c.u * 0.22),
        alpha: 0.7 * live,
      });
    });
    return NOTHING;
  },

  /**
   * Quick Attack. Two zips, on the frames the move's own `momentum` entries
   * name (8 and 20), each leaving the trail the real move is drawn as. The
   * fighter is barely visible during either — the trail is the move.
   */
  upB: (c) => {
    if (c.frame > 40) return NOTHING;
    electric(c.ctx, () => {
      // Zip one, upward.
      const a = pulse(c.frame, 8, 1, 20);
      if (a > 0) {
        const tail = c.y + c.u * 11 * (1 - a * 0.35);
        streak(c.ctx, c.x, tail, c.x, up(c, 0.6), c.u * 2.6, 0.75 * a);
        arc(c.ctx, c.x, tail, c.x, up(c, 0.6), c.frame * 3.9, {
          width: Math.max(1.4, c.u * 0.34),
          jag: c.u * 1.1,
          alpha: a,
          taper: 0.4,
        });
        arcBurst(c.ctx, c.x, up(c, 0.5), c.u * 6.0 * a, 6, c.frame * 2.2, {
          width: Math.max(1.2, c.u * 0.3),
          alpha: a * 0.95,
        });
      }
      // Zip two, forward and away.
      const b = pulse(c.frame, 20, 1, 36);
      if (b > 0) {
        const bx = c.x - c.dir * c.u * 13 * (1 - b * 0.3);
        const by = up(c, 0.5) + c.u * 4.4 * (1 - b * 0.3);
        streak(c.ctx, bx, by, c.x + c.dir * c.u * 0.4, up(c, 0.5), c.u * 2.8, 0.75 * b);
        arc(c.ctx, bx, by, c.x + c.dir * c.u * 0.4, up(c, 0.5), c.frame * 4.3, {
          width: Math.max(1.4, c.u * 0.34),
          jag: c.u * 1.2,
          alpha: b,
          taper: 0.4,
        });
        arcBurst(c.ctx, c.x, up(c, 0.5), c.u * 6.4 * b, 7, c.frame * 2.6, {
          width: Math.max(1.2, c.u * 0.32),
          alpha: b * 0.95,
        });
      }
      if (c.frame < 8) cheekSparks(c, c.frame * 3.1, c.frame / 8);
    });
    return NOTHING;
  },

  /**
   * Thunder. Three pieces, and the frame data says exactly where each is: the
   * bolt's leading edge is a meteor at y = 16 on frames 13-15, the body of the
   * bolt is a column at y = 11 from 16 to the end, and the 15% discharge is a
   * blast of radius 5.5 centred on y = 3 — on him — for frames 16-17 only, which
   * is the hit the whole move exists for.
   *
   * The cloud comes out on frame 2, long before any of it, and is the tell the
   * opponent gets: SmashWiki notes the long gap between the projectile
   * appearing and the bolt arriving is what makes Thunder punishable.
   */
  downB: (c) => {
    const { ctx, x, y, u, frame } = c;
    if (frame > 64) return NOTHING;
    const top = y - u * 120;

    electric(ctx, () => {
      // The cloud: a clump of overlapping discs about eleven units up, gathering
      // from frame 2 and crackling inside until the bolt drops out of it.
      if (frame >= 2) {
        const g = Math.min(1, (frame - 1) / 8) * (frame > 40 ? Math.max(0, 1 - (frame - 40) / 16) : 1);
        const cy = y - 13 * u;
        ctx.fillStyle = withAlpha("#3A3550", 0.85 * g);
        for (const [ox, oy, r] of [
          [-3.4, 0.4, 2.5],
          [-1.0, -0.9, 3.1],
          [1.8, -0.2, 2.7],
          [3.6, 0.7, 2.0],
        ] as const) {
          circle(ctx, x + ox * u, cy + oy * u, r * u * g);
        }
        arcBurst(ctx, x, cy, u * 4 * g, 4, frame * 1.7, {
          width: Math.max(1, u * 0.2),
          alpha: 0.55 * g,
        });
      }

      // The bolt. Its leading edge is live at y = 16 on frame 13 and it has
      // reached him by 16, so the descent is drawn across exactly those frames —
      // and then it is *gone*. The first pass had no upper bound on this branch
      // and left a full-brightness bolt from the top of the screen to his head
      // for the remaining seventy frames of the move, which read as the attack
      // never ending.
      if (frame >= 12 && frame <= 22) {
        const drop = Math.min(1, (frame - 12) / 4);
        const fade = frame <= 17 ? 1 : Math.max(0, 1 - (frame - 17) / 5);
        const bottom = y - u * (16 - 13 * drop);
        boltTo(ctx, x, top, x, bottom, frame * 3.1, {
          width: Math.max(2.5, u * 0.62 * (0.4 + 0.6 * fade)),
          jag: u * 2.2,
          forks: 2,
          taper: 0.12,
          alpha: fade,
        });
        glow(ctx, x, bottom, u * 6, withAlpha(ELECTRIC.core, 0.8 * fade));
      }

      // The discharge, on 16-17: a white flash, a shockwave ring at the hitbox's
      // own radius of 5.5, and arcs thrown clear of him.
      const blast = pulse(frame, 16, 1, 26);
      if (blast > 0) {
        const cy = y - 3 * u;
        glow(ctx, x, cy, u * 5.5 * (1 + 1.6 * (1 - blast)), withAlpha(ELECTRIC.core, 0.9 * blast));
        ring(ctx, x, cy, u * 5.5 * (0.5 + 1.5 * (1 - blast)), frame, {
          width: Math.max(2, u * 0.5 * blast),
          alpha: blast,
        });
        arcBurst(ctx, x, cy, u * 9 * (0.6 + 0.5 * (1 - blast)), 9, frame * 2.3, {
          width: Math.max(1.4, u * 0.34),
          alpha: blast,
        });
        spark(ctx, x, cy, u * 4.5 * blast, frame * 0.4);
      }

      // The column lingers: hitbox 1 is live to the end of the move, and a bolt
      // that vanishes the frame it lands does not explain why.
      if (frame >= 18 && frame <= 60) {
        const fade = Math.max(0, 1 - (frame - 18) / 42);
        boltTo(ctx, x, y - u * 20, x, y - u * 3, frame * 4.7, {
          width: Math.max(1.2, u * 0.34 * fade),
          jag: u * 1.6,
          forks: 1,
          alpha: fade,
          taper: 0.15,
        });
      }
    });
    return NOTHING;
  },

  /** Grab Electric Shock: a headbutt with the current on, one frame long. */
  pummel: (c) => {
    const k = pulse(c.frame, 1, 1, 6);
    if (k <= 0) return NOTHING;
    electric(c.ctx, () => {
      spark(c.ctx, c.x + c.dir * 2.4 * c.u, c.y - 4.0 * c.u, c.u * 2.6 * k, c.frame);
      cheekSparks(c, c.frame * 2.5, k);
    });
    return NOTHING;
  },

  /**
   * Electric Throw: he lays them across his tail and shocks them, five hits of
   * two percent. The current is on the tail, which is behind and below him.
   */
  fthrow: (c) => {
    if (c.frame < 14 || c.frame > 38) return NOTHING;
    const live = c.frame <= 33 ? 1 : Math.max(0, 1 - (c.frame - 33) / 5);
    electric(c.ctx, () => {
      arcBurst(c.ctx, c.x + c.dir * 2.4 * c.u, c.y - 3.2 * c.u, c.u * 4.2, 6, c.frame * 2.2, {
        width: Math.max(1, c.u * 0.24),
        alpha: 0.8 * live,
        turn: c.frame * 0.3,
      });
      for (const hit of [22, 24, 26, 28, 30]) {
        const k = pulse(c.frame, hit, 1, hit + 2);
        if (k > 0) spark(c.ctx, c.x + c.dir * 3.0 * c.u, c.y - 3.0 * c.u, c.u * 2.2 * k, c.frame);
      }
    });
    return NOTHING;
  },

  /** Heading: the throw finishes off the top of his skull on frame 16. */
  uthrow: (c) => {
    const k = pulse(c.frame, 16, 1, 24);
    if (k <= 0) return NOTHING;
    electric(c.ctx, () => {
      spark(c.ctx, c.x, c.y - 6.0 * c.u, c.u * 3.0 * k, c.frame * 0.6);
      arcBurst(c.ctx, c.x, c.y - 5.6 * c.u, c.u * 4.4 * k, 5, c.frame * 2.1, {
        width: Math.max(1, c.u * 0.24),
        alpha: k,
      });
    });
    return NOTHING;
  },

  /** Hip Press: all of his weight, straight down, on frame 29. */
  dthrow: (c) => {
    const k = pulse(c.frame, 29, 1, 38);
    if (k <= 0) return NOTHING;
    electric(c.ctx, () => {
      spark(c.ctx, c.x + c.dir * 2.0 * c.u, c.y - 1.0 * c.u, c.u * 2.8 * k, c.frame * 0.5);
      c.ctx.save();
      c.ctx.translate(c.x + c.dir * 1.4 * c.u, c.y - 0.8 * c.u);
      c.ctx.scale(1, 0.34);
      ring(c.ctx, 0, 0, c.u * (3 + 5 * (1 - k)), c.frame, {
        width: Math.max(1.2, c.u * 0.3 * k),
        alpha: k,
      });
      c.ctx.restore();
    });
    return NOTHING;
  },

  /** Submission: the tomoe nage lands on frame 26, behind him. */
  bthrow: (c) => {
    const k = pulse(c.frame, 26, 1, 34);
    if (k <= 0) return NOTHING;
    electric(c.ctx, () => {
      spark(c.ctx, c.x - c.dir * 3.0 * c.u, c.y - 3.0 * c.u, c.u * 2.8 * k, c.frame * 0.7);
      arcBurst(c.ctx, c.x - c.dir * 3.0 * c.u, c.y - 3.0 * c.u, c.u * 4.0 * k, 5, c.frame * 1.9, {
        width: Math.max(1, c.u * 0.24),
        alpha: k,
      });
    });
    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
  /**
   * The Thunder Jolt.
   *
   * "Shoots a ball of electricity … when it hits the stage or a platform, it
   * sticks to it, looping across it until its lifespan is over" — so it is a
   * ball, not a bolt, and it is on the floor for most of its ninety-five frame
   * life. What sells it is that the ball is never the same shape twice: the
   * surface arcs are reseeded every frame off the projectile's own age, so it
   * boils rather than glides, and a short tail of arcs is dragged behind it in
   * the direction of travel.
   *
   * The context arrives translated to the projectile and not rotated, which is
   * right for a ball — it does not tumble, it crackles.
   */
  thunderJolt: ({ ctx, u, age, dir, heading }) => {
    const born = Math.min(1, (age + 1) / 3);
    // It weakens over its life — 6% fresh, 4% from frame 86 — and the graphic
    // should say so before the damage number does.
    const wear = age < 60 ? 1 : Math.max(0.45, 1 - (age - 60) / 70);
    const r = u * 2.1 * born * (0.9 + 0.1 * Math.sin(age * 0.8)) * wear;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // The wake, opposite the heading.
    const bx = -Math.cos(heading) * r * 2.4;
    const by = -Math.sin(heading) * r * 2.4;
    streak(ctx, bx, by, 0, 0, r * 0.7, 0.4 * wear);
    for (let i = 0; i < 3; i++) {
      arc(ctx, bx * (0.4 + i * 0.3), by * (0.4 + i * 0.3), 0, 0, age * 5.3 + i * 9.1, {
        width: Math.max(1, r * 0.16),
        jag: r * 0.5,
        alpha: 0.5 * wear,
      });
    }
    orb(ctx, 0, 0, r, age * 7.1, { arcs: 6 });
    // A pair of longer arcs whipping off the ball, which is what stops a small
    // bright disc from reading as a bullet.
    for (let i = 0; i < 2; i++) {
      const a = age * 0.9 + i * Math.PI + (dir < 0 ? Math.PI : 0);
      arc(ctx, 0, 0, Math.cos(a) * r * 3.1, Math.sin(a) * r * 3.1, age * 3.7 + i * 21, {
        width: Math.max(1, r * 0.14),
        jag: r * 0.8,
        alpha: 0.75 * wear,
        taper: 0.3,
      });
    }
    ctx.restore();
  },
};
