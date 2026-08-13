/**
 * marth: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 *
 * ## The tipper
 *
 * Everything Marth is rests on one fact: the point of Falchion does markedly
 * more than the rest of it, and in the real game that is *shown* — a distinct
 * flash and a different sound at the blade's end. `fighters/marth.ts` expresses
 * the mechanic without a flag: two hitboxes on the same frames, the tip placed
 * further out and given the **lower `id`**, because `bestHitbox` resolves
 * overlaps by lowest id. Nothing else in the file says "tipper".
 *
 * So the graphic uses the same rule the simulation does. `sweetspotOf` below
 * takes the live hitboxes on this frame, picks the lowest id — the one that
 * *would* win — and paints it only when some other live box sits closer to the
 * shoulder, i.e. only when there is genuinely a sweetspot to distinguish from a
 * sourspot. That makes the flash derived rather than authored: it cannot claim
 * a tipper on a move that has none, it moves if the frame data moves, and it
 * needs no per-move table.
 *
 * It falls out of that rule that the moves without a sweetspot paint nothing —
 * Dolphin Slash, whose two hitboxes never share a frame, and Counter, which has
 * one — and that Down Air flashes *below and behind* him on frame 11, because
 * on that one frame the lowest-id box is the meteor rather than the point. Both
 * are correct: they are what the engine would hit with.
 *
 * ## What this cannot do, and why
 *
 * It flashes on the frames the tip is **live**, not on the frames the tip
 * **connected**. An effect is handed the attacker's `FighterState` and the
 * move's definition and nothing else; `StepEvents.hits` — the only place a
 * resolved hit exists — carries damage, position, knockback and angle, but not
 * the `id` of the hitbox that won it. `f.hitlag > 0` during the window does say
 * that *something* connected (the attacker is frozen by `applyHit`), and that is
 * used below to bloom the flash, but "the tip specifically landed" is not
 * derivable here. See this fighter's report for the one-field change that would
 * make it so.
 */

import { toFloat } from "@/engine/fixed";
import type { Hitbox, MoveSlot } from "@/engine/types";
import {
  NOTHING,
  crescent,
  glow,
  type FxContext,
  type FxFn,
  type ProjectilePainter,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";

/** Frames the flash lingers after its hitbox has gone. */
const TIP_TAIL = 4;

/** The colour of the point. Cyan-white, and nothing else on him is this colour. */
const TIP_HOT = "#F2FDFF";
const TIP_COOL = "#5FD8FF";

/**
 * The hitbox that would win an overlap on this frame, if there is a sweetspot
 * to be had.
 *
 * Mirrors `bestHitbox` in `engine/hitbox.ts` — lowest id wins — and then asks
 * one further question the engine does not have to: is there another live box
 * *closer in*? Without that, every single-hitbox move would flash as though its
 * whole blade were a sweetspot, which is exactly the lie this graphic exists to
 * avoid telling.
 *
 * "Closer in" is measured from the shoulder rather than along x, because Up
 * Smash's tip is high rather than far — x = 1.5, y = 17 — and a horizontal test
 * would pick the scooping hitbox at his ankles instead.
 */
function sweetspotOf(boxes: readonly Hitbox[], shoulder: number): Hitbox | null {
  let best: Hitbox | null = null;
  for (const hb of boxes) {
    if (hb.grabbing) continue;
    if (best === null || hb.id < best.id) best = hb;
  }
  if (best === null) return null;
  const reach = (hb: Hitbox) => Math.hypot(toFloat(hb.x), toFloat(hb.y) - shoulder);
  const far = reach(best);
  const hasCloser = boxes.some((hb) => !hb.grabbing && hb.id !== best.id && reach(hb) < far - 0.5);
  return hasCloser ? best : null;
}

/** Live hitboxes on `frame`, counted the way the frame data is. */
function liveOn(boxes: readonly Hitbox[], frame: number): Hitbox[] {
  return boxes.filter((hb) => frame >= hb.startFrame && frame <= hb.endFrame);
}

/**
 * The window `frame` is inside, or has just left, for a given sweetspot.
 *
 * Returned as a strength 0..1 so the flash is full while the hitbox is live and
 * fades over the tail — the same contract the swing arc uses, and for the same
 * reason: the graphic has to answer "can this still hit me?" honestly.
 */
function strengthFor(hb: Hitbox, frame: number): number {
  if (frame < hb.startFrame) return 0;
  if (frame <= hb.endFrame) return 1;
  const over = frame - hb.endFrame;
  return over > TIP_TAIL ? 0 : 1 - over / TIP_TAIL;
}

/**
 * Paint the point of the blade.
 *
 * A four-point star rather than a blob: the long axis lies along the line from
 * the shoulder through the hitbox, which is the blade, so the flash reads as
 * *the end of the sword* and not as a light bulb hovering nearby. The cross
 * spike is a third of the length, which is what stops it reading as a lens
 * flare pasted on top.
 */
function paintTip(c: FxContext, hb: Hitbox, k: number): void {
  const { ctx, u, dir, x, y, height } = c;
  const px = x + dir * toFloat(hb.x) * u;
  const py = y - toFloat(hb.y) * u;
  const sx = x;
  // 0.68 rather than `swing.ts`'s 0.55. That pivot is a compromise across eight
  // rigs; this one only has to serve Marth, whose shoulder sits at 9.6 of the
  // 14.1 rig units between his feet and his crown. Getting it wrong does not
  // move the flash — it tilts the star off the line of the blade, which is the
  // one thing that makes it read as a sword's point rather than a firefly.
  const sy = y - height * 0.68 * u;
  const angle = Math.atan2(py - sy, px - sx);

  // Whether the swing connected, and with *what*.
  //
  // `struckWith` is the id of the box the simulation resolved the overlap to,
  // which is the tipper mechanic itself rather than a proxy for it. Before it
  // existed the only honest signal was `f.hitlag > 0` — the attacker freezes on
  // any connection — so the flash bloomed identically whether Marth had landed
  // the point or the handle, which is the one distinction the graphic exists to
  // draw. `hitlag` is kept as the fallback for a caller that did not supply the
  // cosmetic state (the animation lab does not), where a dimmer bloom on every
  // hit is better than none.
  const connected = c.struckWith ?? null;
  const tipped = connected !== null ? connected === hb.id : c.f.hitlag > 0;
  const bloom = tipped ? 1.45 : 1;
  const s = k * bloom;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  glow(ctx, px, py, u * 2.6 * s, withAlpha(TIP_COOL, 0.5 * k));

  ctx.translate(px, py);
  ctx.rotate(angle);
  const long = u * 3.6 * s;
  const back = u * 1.5 * s;
  const cross = u * 1.15 * s;
  const waist = u * 0.34 * s;

  ctx.beginPath();
  ctx.moveTo(long, 0);
  ctx.lineTo(0, -waist);
  ctx.lineTo(-back, 0);
  ctx.lineTo(0, waist);
  ctx.closePath();
  ctx.fillStyle = withAlpha(TIP_HOT, 0.9 * k);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, -cross);
  ctx.lineTo(waist * 0.8, 0);
  ctx.lineTo(0, cross);
  ctx.lineTo(-waist * 0.8, 0);
  ctx.closePath();
  ctx.fillStyle = withAlpha(TIP_COOL, 0.85 * k);
  ctx.fill();

  ctx.restore();
}

/**
 * The tipper flash, for any move that has a sweetspot.
 *
 * One function on every slot rather than a hand-written effect per move: the
 * geometry all comes from the move's own hitboxes, so a per-move version would
 * be fourteen copies of the same six lines with fourteen chances to mistype a
 * coordinate.
 */
const tipper: FxFn = (c) => {
  const move = c.f.move ? c.def.moves[c.f.move] : undefined;
  if (!move) return NOTHING;
  const shoulder = c.height * 0.55;
  // Every window, not only the live one: Down Smash's back hit and Neutral Air's
  // second swing are separate sweetspots fifteen frames apart, and a flash that
  // only knew about the first would say the blade was cold for the second.
  for (const hb of move.hitboxes) {
    const k = strengthFor(hb, c.frame);
    if (k <= 0) continue;
    // Re-derive the winner from the frame this box *started* on, so a box still
    // in its tail is judged against the company it actually kept.
    const at = Math.min(c.frame, hb.endFrame);
    if (sweetspotOf(liveOn(move.hitboxes, at), shoulder) !== hb) continue;
    paintTip(c, hb, k);
  }
  return NOTHING;
};

/**
 * Shield Breaker's charge.
 *
 * The move's whole point is shield damage, and the thing a player has to read is
 * *how long it has been held* — 25 shield damage at frame 19, 50 at frame 79.
 * So the graphic grows with the charge instead of pulsing on its own clock, and
 * it lives on the blade rather than round the body.
 */
const shieldBreakerCharge: FxFn = (c) => {
  const { ctx, u, dir, x, y, frame, f } = c;
  if (f.charge <= 0 && frame > 18) return NOTHING;
  const held = Math.min(1, (f.charge > 0 ? f.charge : frame) / 60);
  const k = 0.25 + held * 0.75;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Along the blade, which at the charge pose is chambered back at the ribs
  // with the point levelled at the opponent — so the light runs *forward* from
  // roughly the guard to roughly the tip, at the hitboxes' own height. It sat
  // behind him while the clip was still the shared one, and read as two grey
  // smudges floating off his back.
  for (let i = 0; i < 5; i++) {
    const along = i / 4;
    glow(
      ctx,
      x + dir * u * (1.0 + along * 8.6),
      y - u * (7.9 - along * 0.5),
      u * (0.6 + k * 0.85),
      withAlpha("#9FE6FF", 0.14 + k * 0.28),
    );
  }
  ctx.restore();
  return NOTHING;
};

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  jab1: tipper,
  jab2: tipper,
  ftilt: tipper,
  utilt: tipper,
  dtilt: tipper,
  dashAttack: tipper,
  fsmash: tipper,
  usmash: tipper,
  dsmash: tipper,
  nair: tipper,
  fair: tipper,
  bair: tipper,
  uair: tipper,
  dair: tipper,
  sideB: tipper,

  neutralB: (c) => {
    shieldBreakerCharge(c);
    return tipper(c) ?? NOTHING;
  },

  /**
   * Marth, Counter. Three beats, and none of them is a lamp on his chest.
   *
   * The instinct in the old version of this comment is right and is kept: a
   * counter that glowed for its whole duration would be telling the opponent
   * what the move is for. But a radial glow is not what a sword does. So the
   * bright thing is *brief* and it is **on the blade** — the wedge the point cut
   * on its way into the guard — and what lasts the window is a dim gold edge
   * light, faint enough to be a hint rather than an announcement.
   *
   *   frames 4-8    the flash. The stance forms on frame 4, which is the clip's
   *                 strike key, so this is the gleam of the blade arriving.
   *   frames 6-27   the documented counter window: a five-degree sliver at the
   *                 blade's own radius, literally the edge lit. Held, not faded.
   *   frames 33-42  the counter-slash. No hitbox lives there, so `swing.ts`
   *                 draws nothing of its own and this is the whole graphic of
   *                 the cut; the trailing edge lags the leading one by two
   *                 frames so it reads as a moving blade.
   *
   * Steel-white for the two cuts, matching `EFFECT_COLOURS.slash` in `swing.ts`
   * so the engine's own arc reinforces rather than clashes; gold for the held
   * ward, off his trim.
   */
  downB: ({ ctx, x, y, u, dir, frame }) => {
    if (frame < 4 || (frame > 27 && frame < 33) || frame > 42) return NOTHING;

    // Rig units to world units — `scale` in `rig.ts`. The pose library is
    // authored in rig units and `u` is pixels per *world* unit, so every length
    // below is a measurement taken off the clip's own keys.
    const s = u * 1.16;
    const px = (rx: number) => x + dir * rx * s;
    const py = (ry: number) => y - ry * s;

    // Canvas angle of a rig-space bone angle (degrees, 0 = up, clockwise
    // positive facing right). Facing is a multiply on the forward component,
    // which is the same rule `resolve` mirrors the rig under — never a branch.
    // Every angle asked for lies in 100°..228°, which maps into the lower
    // half-plane in both facings, so the wedge never straddles ±π and min/max
    // is enough to pick the short way round.
    const ang = (a: number) => {
      const r = (a * Math.PI) / 180;
      return Math.atan2(-Math.cos(r), dir * Math.sin(r));
    };
    const band = (cx: number, cy: number, r: number, w: number, a: number, b: number, fill: string) => {
      crescent(ctx, cx, cy, r * s, w * s, Math.min(a, b), Math.max(a, b));
      ctx.fillStyle = fill;
      ctx.fill();
    };

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    if (frame <= 8) {
      const k = 1 - (frame - 4) / 5;
      const a = k * k;
      const cx = px(-0.86);
      const cy = py(8.95);
      const from = ang(205);
      const to = ang(138);
      band(cx, cy, 7.2, 5.4 * (0.55 + 0.45 * k), from, to, withAlpha("#FFFFFF", 0.72 * a));
      band(cx, cy, 7.6, 1.9, from, to, withAlpha("#BFE9FF", 0.62 * a));
      // The point, not the body: this is the bit that says "sword".
      glow(ctx, px(5.6), py(1.65), 1.9 * s * (0.6 + 0.7 * k), withAlpha("#FFFFFF", 0.85 * a));
    }

    if (frame >= 6 && frame <= 27) {
      const hold = Math.min(1, (frame - 5) / 3, (28 - frame) / 4);
      const pulse = 0.74 + 0.26 * Math.cos((frame - 6) * 0.42);
      const c = ang(138);
      band(px(-0.86), py(8.95), 7.2, 5.4, c - 0.05, c + 0.05, withAlpha("#FFE9A8", 0.3 * hold * pulse));
      glow(ctx, px(3.81), py(3.58), 2.4 * s, withAlpha("#FFE9A8", 0.13 * hold * pulse));
    }

    if (frame >= 33) {
      const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
      const lead = clamp((frame - 32.5) / 4.5);
      const trail = clamp((frame - 34.5) / 4.5);
      const fade = Math.min(1, (43 - frame) / 5);
      const cx = px(-1.1 + 2.0 * lead);
      const cy = py(9.0);
      const a1 = ang(228 - 128 * lead);
      const a2 = ang(228 - 128 * trail);
      band(cx, cy, 7.6, 5.8, a1, a2, withAlpha("#FFFFFF", 0.55 * fade));
      band(cx, cy, 9.1, 2.2, a1, a2, withAlpha("#7FE9FF", 0.5 * fade));
    }

    ctx.restore();
    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
