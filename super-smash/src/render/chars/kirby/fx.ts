/**
 * kirby: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 *
 * ## Why Kirby leans on this file harder than anyone
 *
 * Because three of his four specials are *objects he is holding* and the rig
 * has none of them. There is no hammer bone, no blade bone and — the one that
 * matters most — no mouth. Inhale is his signature move and the entire read is
 * a mouth wider than his face, which no arrangement of sixteen capsules can
 * produce. So the pose gets him into the right shape and everything that makes
 * the shape *legible as that move* is drawn here.
 *
 * ## Which side of him each of these is painted on
 *
 * Effects paint **under** the figure by default, and for most of this file that
 * is right — a flame tail streaming behind him, a shockwave running away along
 * the floor, the wind being pulled toward his mouth. It is wrong for anything
 * he is *holding* or anything that is part of *him*, and this fighter has more
 * of those than anyone:
 *
 * | Move | Under | `over` |
 * |---|---|---|
 * | Inhale | the wind | the maw, and the eyes squeezed above it |
 * | Hammer Flip | the hammer while it is cocked behind his shoulder | the hammer through the swing, so the shaft reads as gripped |
 * | Final Cutter | the fall streak | the blade, on the rise and on the drop |
 * | Burning | the flame tail | the licks riding over his outline, and the white nose |
 * | Neutral air | — | the spin sweep, which crosses his own body |
 * | Stone | the rock | the transformation puff and the landing dust |
 *
 * Round one had none of that — `over` did not exist yet — and the captures show
 * what the default costs a fighter with no props: a mouth that reads as a hole
 * behind his shoulder, a hammer floating beside him with no handle, a Cutter
 * blade entirely inside the ball, and a fire he is standing in front of.
 *
 * `over` still lands **under the port tag**, which hangs directly over every
 * fighter's crown. That is not something to fight; it is a reason to compose
 * forward of the crown, which is why Final Cutter's whole swing is biased in
 * front of him rather than straight up.
 */

import {
  NOTHING,
  armourWindow,
  circle,
  crescent,
  glow,
  type FxFn,
} from "../../fxKit";
import { resolvePalette, withAlpha } from "../../rigKit";
import type { FighterDef, MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

/* ------------------------------------------------------------- geometry -- */

/**
 * Kirby's centre in screen space, and his on-screen radius.
 *
 * Every effect here is positioned against the ball rather than against the
 * feet, because on this rig the ball *is* the fighter: `headRadius` 4.45 at rig
 * scale 0.78 centred 5.28 rig units up. Deriving it once stops eight effects
 * from each hard-coding a slightly different guess at where his middle is.
 */
function ball(x: number, y: number, u: number): { cx: number; cy: number; r: number } {
  return { cx: x, cy: y - 5.28 * 0.78 * u, r: 4.45 * 0.78 * u };
}

/** 0 at `from`, 1 at `to`, clamped. */
function ramp(v: number, from: number, to: number): number {
  if (to === from) return v >= to ? 1 : 0;
  const t = (v - from) / (to - from);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * A tapered sweep centred on the ball, measured from straight up and positive
 * toward the fighter's front.
 *
 * Used **only** by Final Cutter, where the arc belongs to the blade being drawn
 * beside it. Every ordinary kick deliberately has no arc here: `render/swing.ts`
 * already derives one from the move's own hitboxes, so an authored arc would be
 * a second source of truth about reach, and the two drift apart within a week.
 * The same reasoning is why Link's file paints nothing for his sword moves.
 */
function sweep(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  dir: number,
  a0: number,
  a1: number,
  alpha: number,
  colour = "#FFF0F6",
): void {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(dir, 1);
  // `crescent` works in canvas angles (0 = +x, clockwise in a y-down frame),
  // and the poses are authored from straight up, so rotate by a quarter turn.
  const c0 = a0 - Math.PI / 2;
  const c1 = a1 - Math.PI / 2;
  ctx.fillStyle = withAlpha(colour, alpha);
  crescent(ctx, 0, 0, r * 1.16, r * 0.42, Math.min(c0, c1), Math.max(c0, c1));
  ctx.fill();
  ctx.restore();
}

const DEG = Math.PI / 180;

/**
 * Two arm nubs closing round a handle.
 *
 * The rig grew real arms this round and it bought **nothing** on the two moves
 * that most needed them, because a move effect is painted after the whole
 * figure: the hammer's shaft and the Cutter's grip both drew straight over the
 * hand that was supposed to be holding them, so the prop still read as orbiting
 * him. `over` is the wrong tool — it is what put the shaft in front in the
 * first place — and there is no way to paint *between* two passes of the figure
 * from here.
 *
 * So the hands are painted again, on top of the handle, in the fighter's own
 * colours. Two circles and a rim, at the two ends of the grip. It is the last
 * thing drawn, so the nub wraps the shaft, which is the whole read: a thing
 * held rather than a thing passing through him.
 *
 * The colour comes from `resolvePalette`, not from a literal — Yellow Kirby's
 * hands are yellow, and a pink nub on a yellow fighter is worse than no nub.
 */
function gripHands(
  ctx: CanvasRenderingContext2D,
  def: FighterDef,
  costume: number,
  u: number,
  at: readonly (readonly [number, number])[],
  radius: number,
): void {
  const palette = resolvePalette(def, costume);
  for (const [hx, hy] of at) {
    // Colour first, then the path. The rim of the nub is the figure's own
    // outline colour, so the two discs are read back in a test by the fill in
    // force when each arc was issued — set it afterwards and every shape is
    // labelled with the *previous* one.
    ctx.fillStyle = palette.outline;
    ctx.beginPath();
    ctx.arc(hx, hy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.primary;
    ctx.beginPath();
    ctx.arc(hx, hy, radius * 0.74, 0, Math.PI * 2);
    ctx.fill();
  }
  void u;
}

/* ------------------------------------------------------------- the moves -- */

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Inhale.
   *
   * The mouth is the move — SmashWiki's phrase is that he "creates a vortex of
   * wind in front of him", and the picture everybody has is a maw wider than
   * the rest of him with two eyes squeezed up above it. Suction is live on
   * frames 10–44, so the maw is open and *held* across thirty-five frames
   * rather than flashed.
   *
   * ## Why this is drawn `over` and the round-one version was not
   *
   * Round one drew the maw under the figure, which is the default, and pushed
   * it a whole radius in front of his centre so that its leading half cleared
   * the ball. What that produces is not a mouth: it is a black disc peeping out
   * from *behind* Kirby's shoulder, and the capture shows exactly that — he
   * appears to be standing in front of a hole rather than to have opened one.
   * A mouth is a hole **in** a face, so it has to be painted on top of the
   * face.
   *
   * The cost of painting it on top is that it covers the rig's eyes, which are
   * a prop on the head bone and cannot be moved from here. That turns out to be
   * the right answer anyway, because it is what the real animation does: the
   * mouth takes the whole face and the eyes ride up to the crown. So they are
   * repainted above it, travelling from where the rig draws them to the top of
   * the ball as the mouth opens. During the six frames of opening the rig's own
   * eyes are still partly visible under a growing maw and the painted pair are
   * fading in above — which reads as the eyes being pushed up, and is the one
   * thing that makes the whole face deforming legible.
   *
   * **The throat must not be maroon.** The first version used `#5A1030`, within
   * a few points of the rig's `outline` (`#5A2038`), and the rim is an
   * *inflated copy of the whole figure painted in that colour* — so the part of
   * the mouth that cleared the ball was drawn immediately alongside a band of
   * its own colour and vanished into it. Near-black throat, bright lip, and the
   * two-tone edge survives either background.
   */
  neutralB: ({ ctx, x, y, u, dir, frame, over }) => {
    const open = Math.min(ramp(frame, 4, 12), 1 - ramp(frame, 45, 52));
    if (open <= 0.01) return NOTHING;
    const { cx, cy, r } = ball(x, y, u);

    // Where the mouth is, in ball radii forward of and below his centre. The
    // wind aims at it and the maw is drawn about it, so it is named once.
    const MOUTH_X = 0.48;
    const MOUTH_Y = 0.18;

    /*
     * The wind, drawn under so the mouth sits over it.
     *
     * ## Why this is a funnel and not a fan of arcs
     *
     * Round one drew six concentric arcs standing off in front of him. A critic
     * given the capture read them as **speed lines** — the standard grammar for
     * "this character is moving fast that way" — which is the precise opposite
     * of what the move does, and once seen it cannot be unseen: detached
     * hairlines with a gap of clear air between them and the lips say *emitted*,
     * not *drawn in*.
     *
     * Three things fix it, and all three are about the same idea — a suction has
     * to be one volume with a mouth at the narrow end.
     *
     * 1. **A translucent cone anchored at the lips**, widening outward. It is
     *    the wall of the vortex, so the arcs are inside something rather than
     *    floating in front of nothing.
     * 2. **Streaks, not arcs.** Each mote is drawn as a line *along its own path
     *    toward the mouth*, longest when it is furthest out and going fastest.
     *    A radial streak points at the thing pulling it; a tangential arc does
     *    not point anywhere.
     * 3. **They visibly close.** `phase` runs 1 → 0 with the frame and the
     *    distance runs with it, so a player watching two consecutive frames sees
     *    the same mote nearer the mouth. A cycle that only fades cannot say
     *    which direction anything is going.
     */
    const mx = cx + dir * r * MOUTH_X;
    const my = cy + r * MOUTH_Y;
    const CONE = 0.62;
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(dir, 1);
    // Tilted onto the mouth's own axis. The maw is rotated 7° nose-down and a
    // cone left on the horizontal reads as originating somewhere behind his
    // head rather than at his lips.
    ctx.rotate(-7 * DEG);
    // The wall of the vortex: a wedge from the lips out to three and a half
    // radii, brightest at the mouth.
    const wall = ctx.createLinearGradient(0, 0, r * 3.6, 0);
    wall.addColorStop(0, withAlpha("#EAF4FF", 0.3 * open));
    wall.addColorStop(1, withAlpha("#EAF4FF", 0));
    ctx.fillStyle = wall;
    ctx.beginPath();
    ctx.moveTo(r * 0.55, 0);
    ctx.lineTo(Math.cos(-CONE) * r * 3.6, Math.sin(-CONE) * r * 3.6);
    ctx.arc(0, 0, r * 3.6, -CONE, CONE);
    ctx.closePath();
    ctx.fill();

    for (let i = 0; i < 9; i++) {
      // 1 at the outside, 0 at the lips, and falling every frame — so the same
      // mote is nearer the mouth on the next drawing.
      const phase = 1 - ((((frame * 0.062 + i * 0.111) % 1) + 1) % 1);
      const d = phase * r * 3.3 + r * 0.75;
      // Inside the cone, always. `CONE` is the wall; anything outside it is not
      // being sucked in, it is weather — and a streak that lands below the
      // stage floor reads as rain over the whole screen rather than as wind
      // into a mouth.
      const at = Math.max(-CONE * 0.86, Math.min(CONE * 0.86, ((i % 3) - 1) * 0.4 + Math.sin(i * 2.7) * 0.12));
      const a = open * (0.35 + 0.65 * (1 - phase)) * 0.9;
      // The streak runs *along the pull*, from where the mote is toward the
      // mouth, and is longer the further out it is — but its far end stops at
      // the mouth of the cone rather than running on past it.
      const len = Math.min(r * (0.35 + phase * 0.95), r * 3.55 - d);
      ctx.strokeStyle = withAlpha("#F2F9FF", a);
      ctx.lineWidth = Math.max(1.6, u * 0.34 * (1 - phase * 0.35));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(Math.cos(at) * (d + len), Math.sin(at) * (d + len) * 1.06);
      ctx.lineTo(Math.cos(at) * d, Math.sin(at) * d);
      ctx.stroke();
      ctx.fillStyle = withAlpha("#FFFFFF", a);
      circle(ctx, Math.cos(at) * d, Math.sin(at) * d, Math.max(1.2, u * 0.24 * (1 - phase * 0.4)));
    }
    ctx.restore();

    over(() => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(dir, 1);

      /*
       * The maw. At full open it is 2.24 radii across against a ball two radii
       * wide, centred four tenths of a radius forward and a fifth down — which
       * covers both eyes, both blushes and the whole lower face, and hangs a
       * quarter of a radius past his front and his chin. Bigger than his face,
       * which is the joke.
       */
      const mw = r * (0.40 + 0.72 * open);
      const mh = r * (0.32 + 0.54 * open);
      ctx.translate(r * MOUTH_X, r * MOUTH_Y);
      ctx.rotate(-7 * DEG);
      // The lip: his own skin stretched round the opening, a shade lighter than
      // the body so it separates from it, and thicker at the top where the
      // cheek is being pulled.
      ctx.fillStyle = "#FFC2D6";
      ctx.beginPath();
      ctx.ellipse(0, -mh * 0.04, mw * 1.13, mh * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1E0714";
      ctx.beginPath();
      ctx.ellipse(0, 0, mw, mh, 0, 0, Math.PI * 2);
      ctx.fill();
      // The tongue, low and to the back of the throat.
      ctx.fillStyle = "#D8536F";
      ctx.beginPath();
      ctx.ellipse(-mw * 0.06, mh * 0.56, mw * 0.58, mh * 0.31, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      /*
       * The eyes, riding up out of the way of it.
       *
       * `k` runs with `open`, so at the start they are exactly where the rig
       * draws them — near eye 0.41 radii forward and 0.16 up, half-height 0.38
       * — and by the time the mouth is wide they are squeezed against the
       * crown. The far eye is the smaller of the two, as it is on the rig.
       */
      const k = open;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(dir, 1);
      ctx.globalAlpha = Math.min(1, open * 2.2);
      for (const [x0, y0, rx0, ry0, x1, y1, rx1, ry1] of [
        [0.41, -0.16, 0.14, 0.38, 0.36, -0.6, 0.16, 0.31],
        [0.01, -0.16, 0.11, 0.32, -0.03, -0.57, 0.13, 0.26],
      ] as const) {
        const ex = r * (x0 + (x1 - x0) * k);
        const ey = r * (y0 + (y1 - y0) * k);
        const rx = r * (rx0 + (rx1 - rx0) * k);
        const ry = r * (ry0 + (ry1 - ry0) * k);
        ctx.fillStyle = "#241C46";
        ctx.beginPath();
        ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#4C7FD6";
        ctx.beginPath();
        ctx.ellipse(ex, ey + ry * 0.52, rx * 0.66, ry * 0.27, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.ellipse(ex + rx * 0.12, ey - ry * 0.34, rx * 0.42, ry * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    return NOTHING;
  },

  /**
   * Hammer Flip.
   *
   * A two-handed overhead swing with a mallet head about as wide as he is —
   * the size is half the joke and most of the silhouette.
   *
   * ## The two things that were wrong
   *
   * **It was on screen before he drew it.** The graphic ran from frame 0, so
   * the first fourteen frames of the move were a hammer hanging in the air
   * beside a Kirby who had not yet raised his arms, swinging *backwards* while
   * he stood still. An effect keyed off `frame` has to be gated on the frame
   * the pose produces it, and the pose produces it at the cocked key: `strike`
   * is 0.34 with `firstActive` at action frame 25, so that key lands on action
   * frame 15, and the span into it is eased `in` — cubic, so the arms have
   * covered an eighth of their travel at the halfway point and only visibly
   * move from about action frame 9. He pulls it out over 9–15 and it grows into
   * his hands rather than cutting in.
   *
   * **It was small.** The head is now 1.76 ball-radii across against a ball
   * 2 radii wide, and the whole mallet reaches 3.3 radii from his centre — half
   * again his own height, which is the proportion the move is remembered for.
   *
   * The head is driven along its arc by `frame` rather than by `t` so it is at
   * the bottom of the swing on frames 26–27, where the frame data puts the
   * hitbox, and it holds there for both of them: a hammer already lifting on
   * the second active frame has no weight, and weight is the whole move.
   *
   * Fire only when charged: SmashWiki is explicit that an uncharged Hammer Flip
   * has no flame effect, and painting one anyway would be claiming a 35% swing
   * on a 19% one.
   */
  sideB: ({ ctx, f, def, x, y, u, dir, frame, over }) => {
    // Nothing before he reaches for it, nothing after he has put it away.
    const drawn = ramp(frame, 9, 15);
    const kept = 1 - ramp(frame, 40, 45);
    if (drawn <= 0.01 || kept <= 0.01) return NOTHING;

    const { cx, cy, r } = ball(x, y, u);
    // Straight up is 0 and the front is positive: hauled out overhead at −25°,
    // cocked back over the shoulder at −75° by frame 15, through the bottom of
    // the swing at +85° on frames 26–27 — level with his middle and a body's
    // width in front, which is where the hitbox is — then carried on down.
    const swing = ramp(frame, 15, 26);
    const settle = ramp(frame, 27, 44);
    const angle = (-25 - 50 * drawn + 160 * swing + 30 * settle) * DEG;
    const charged = f.charge > 0;

    // It comes out of nowhere — so it comes out *growing*, which is the only
    // honest way to introduce a prop the rig does not have a bone for.
    const size = 0.55 + 0.45 * drawn;
    const grip = r * 0.42 * size;
    const shaft = r * 1.6 * size;
    // The head is 2.2 ball-radii along its own long axis against a ball two
    // radii wide — a slab of timber bigger than the fighter swinging it, which
    // is half the joke and most of the silhouette. At round one's 1.84 it read,
    // to a critic given the capture, as a signboard being carried.
    const headLen = r * 1.5 * size;
    const headWide = r * 1.1 * size;

    const paint = (): void => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, drawn * 1.8) * kept;
      ctx.translate(cx, cy);
      ctx.scale(dir, 1);
      // Pivot at his hands, not at the middle of his face. The swing turns
      // about wherever this frame is centred, and centred on the ball the shaft
      // ran straight across both eyes on the contact frame. A quarter of a
      // radius down and a little forward is where the two arm nubs are, and it
      // is the difference between a hammer he is holding and a hammer skewering
      // him.
      ctx.translate(r * 0.08, r * 0.26);
      ctx.rotate(angle);

      // The arc it has just come through. The local frame has the hammer along
      // −y and the swing turns it clockwise, so the ground it has covered is
      // the −x side: canvas angles behind −π/2, not in front of it. Drawn on
      // the wrong side it reads as a swoosh the hammer is about to catch up
      // with.
      //
      // It is a *trail*, so it is narrower than the head that made it. The
      // round-one version was 1.5 head-widths thick across 79° of arc, which at
      // match scale is a pale grey wedge the size of the fighter — it read as a
      // cloud he was swinging through rather than as speed.
      if (frame >= 18 && frame <= 34) {
        const a = 0.5 * ramp(frame, 18, 22) * (1 - ramp(frame, 27, 34));
        ctx.fillStyle = withAlpha(charged ? "#FFD25A" : "#FFFFFF", a);
        crescent(ctx, 0, 0, shaft + headLen * 0.55, headWide * 0.8, -2.86, -1.72);
        ctx.fill();
        ctx.fillStyle = withAlpha(charged ? "#FFF0C0" : "#FFFFFF", a * 0.7);
        crescent(ctx, 0, 0, shaft + headLen * 0.1, headWide * 0.3, -2.7, -1.78);
        ctx.fill();
      }

      // Handle: a shaft with a darker grip at the bottom, so the hand end reads
      // as a hand end rather than as the shaft stopping.
      ctx.strokeStyle = "#8A5A28";
      ctx.lineWidth = Math.max(2.4, u * 0.82);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -grip * 0.2);
      ctx.lineTo(0, -(grip + shaft));
      ctx.stroke();
      ctx.strokeStyle = "#B7813F";
      ctx.lineWidth = Math.max(1.4, u * 0.46);
      ctx.beginPath();
      ctx.moveTo(0, -grip * 0.9);
      ctx.lineTo(0, -(grip + shaft));
      ctx.stroke();

      // Both nubs closing on the handle, painted over it. See `gripHands`.
      gripHands(ctx, def, f.costume, u, [[0, -grip * 0.28], [0, -grip * 1.15]], r * 0.3 * size);

      // Head: a squared wooden block with a darker band round its middle and a
      // lit top face. Blocky rather than barrel-shaped — the mallet in the
      // Hammer ability is a slab of timber, and a rounded one reads as a toy.
      const hy = -(grip + shaft + headLen * 0.5);
      ctx.fillStyle = "#E8DCC0";
      ctx.beginPath();
      ctx.roundRect(-headWide, hy - headLen * 0.5, headWide * 2, headLen, headWide * 0.22);
      ctx.fill();
      // The lit face along the striking edge, and the band round the middle.
      ctx.fillStyle = "#FFF6E0";
      ctx.beginPath();
      ctx.roundRect(-headWide * 0.94, hy - headLen * 0.44, headWide * 0.5, headLen * 0.88, headWide * 0.16);
      ctx.fill();
      ctx.fillStyle = "#B99253";
      ctx.beginPath();
      ctx.roundRect(-headWide * 0.26, hy - headLen * 0.5, headWide * 0.52, headLen, headWide * 0.09);
      ctx.fill();
      // Banded end caps. Without them the block is a plain rounded rectangle
      // with a stripe down it, which is a signpost.
      for (const s2 of [-1, 1]) {
        ctx.fillStyle = "#8A5A28";
        ctx.beginPath();
        ctx.roundRect(s2 * headWide - (s2 > 0 ? headWide * 0.2 : 0), hy - headLen * 0.5, headWide * 0.2, headLen, headWide * 0.08);
        ctx.fill();
      }
      ctx.strokeStyle = "#6B4A22";
      ctx.lineWidth = Math.max(1.6, u * 0.4);
      ctx.beginPath();
      ctx.roundRect(-headWide, hy - headLen * 0.5, headWide * 2, headLen, headWide * 0.22);
      ctx.stroke();

      /*
       * The blow landing.
       *
       * The hitbox is live on 26 and 27 and round one painted nothing on either
       * of them — a nineteen-percent swing that arrives in silence, which a
       * critic given the capture called out as the swing "evaporating". The
       * flash is at the *striking face*, not at the middle of the head.
       */
      if (frame >= 26 && frame <= 30) {
        const k = ramp(frame, 26, 30);
        // The **leading** face. The swing turns clockwise in this frame and the
        // shaft lies along −y, so the head's travel is toward +x — the first
        // version flashed the trailing face, in the empty air the head had just
        // left. The swoosh is on the −x side for exactly the same reason.
        const face = headWide * 0.85;
        // An opaque core with a ring round it, not a fan of thin even spokes:
        // evenly spaced hairlines are the *sparkle* idiom — "item acquired" —
        // and a nineteen-percent mallet blow is a thud.
        glow(ctx, face, hy, headWide * (1.7 + k * 1.5), withAlpha(charged ? "#FFD25A" : "#FFF0C8", 0.85 * (1 - k)));
        ctx.fillStyle = withAlpha("#FFFFFF", 0.95 * (1 - k * 1.6));
        ctx.beginPath();
        ctx.ellipse(face, hy, headWide * (0.85 - k * 0.3), headWide * (0.6 - k * 0.2), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = withAlpha(charged ? "#FFD25A" : "#FFFFFF", 0.7 * (1 - k));
        ctx.lineWidth = Math.max(2, headWide * 0.22 * (1 - k));
        ctx.beginPath();
        ctx.ellipse(face, hy, headWide * (0.9 + k * 1.5), headWide * (0.7 + k * 1.2), 0, 0, Math.PI * 2);
        ctx.stroke();
        // Three chips thrown off it, at uneven angles so it is debris rather
        // than a starburst.
        ctx.fillStyle = withAlpha("#FFF6E0", 0.8 * (1 - k));
        for (const a of [-0.9, 0.15, 1.25]) {
          const d = headWide * (1.1 + k * 1.9);
          circle(ctx, face + Math.cos(a) * d, hy + Math.sin(a) * d, headWide * 0.16 * (1 - k * 0.6));
        }
      }

      if (charged) {
        for (let i = 0; i < 3; i++) {
          const w = 0.7 + 0.3 * Math.sin((frame + i * 7) * 0.6);
          glow(ctx, (i - 1) * headWide * 0.7, hy - headLen * 0.4, headWide * 1.1 * w, "#FFB020");
        }
        glow(ctx, 0, hy, headWide * 1.7, withAlpha("#FF5A10", 0.5));
      }
      ctx.restore();
    };

    /*
     * Which side of Kirby the hammer is painted on.
     *
     * An effect paints under the figure, and under is wrong for a thing he is
     * *holding*: the shaft disappeared into the ball and only the head cleared
     * it, so the mallet read as floating beside him rather than as gripped. But
     * over is wrong for the wind-up, where the hammer is genuinely behind his
     * shoulder.
     *
     * So it swaps at the top of the swing. `angle` is measured from straight up
     * and the crossover is −8°, which is the frame the hammer is directly
     * overhead and entirely outside his outline — so the layer change happens
     * on a frame where there is nothing to occlude and no pop to see. This is a
     * decision about the *swing phase*, not about `dir`; the graphic is
     * mirrored by `scale(dir, 1)` as everything here is.
     */
    if (angle < -8 * DEG) paint();
    else over(paint);
    return NOTHING;
  },

  /**
   * Final Cutter — three beats, three graphics, each keyed off `frame` so the
   * windows line up with the frame data rather than with the clip:
   *
   * - **rise**, hitbox on 23–26: the blade and a slash arc going up.
   * - **fall**, hitbox on 41–49: the blade held under him, trailing.
   * - **landing**, hitbox on 50–51: the shockwave — SmashWiki's "blue wave
   *   projectile" — running forward along the ground.
   *
   * The blade is a silver scimitar rather than the boomerang cutter of the
   * Kirby games, which is the Smash-only design and the one people picture.
   */
  upB: ({ ctx, f, def, x, y, u, dir, frame, over }) => {
    const { cx, cy, r } = ball(x, y, u);

    /**
     * The Cutter blade: a broad silver scimitar, spine out and belly back.
     *
     * Round one's blade was 0.7 radii across at its widest and drawn *under*
     * the figure with its base half a radius above his centre, which put two
     * thirds of it inside the ball — and the third that cleared went straight
     * behind the port tag, which sits directly over every fighter's crown. The
     * capture showed a two-pixel white sliver. So it is drawn `over`, it is
     * twice as broad, and the whole swing is biased *forward* of his centre so
     * it clears the tag rather than fighting it: the same fix Link's boomerang
     * needed, made authorially rather than by arguing with the HUD.
     */
    const drawBlade = (bx: number, by: number, angle: number, len: number, alpha: number) => {
      // Chunky and deep-bellied, about one ball-diameter of blade, with a
      // *short* point rather than a needle. Long, thin and shallow reads as a
      // pirate cutlass; blunting it all the way to a rounded cap reads as a
      // feather, which is what the first attempt at this correction produced.
      const w = r * 0.52;
      ctx.save();
      ctx.translate(bx, by);
      ctx.scale(dir, 1);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha;
      // The grip, below the guard, so the blade has a hand end.
      ctx.fillStyle = "#6B5230";
      ctx.beginPath();
      ctx.roundRect(-w * 0.32, -r * 0.04, w * 0.64, r * 0.62, w * 0.3);
      ctx.fill();
      ctx.fillStyle = "#C9CFD8";
      ctx.beginPath();
      ctx.roundRect(-w * 0.95, -r * 0.16, w * 1.9, r * 0.22, r * 0.06);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.1);
      ctx.quadraticCurveTo(w * 1.42, -len * 0.44, w * 0.46, -len * 0.97);
      ctx.quadraticCurveTo(w * 0.16, -len * 1.0, -w * 0.02, -len * 0.9);
      ctx.quadraticCurveTo(-w * 0.22, -len * 0.5, -w * 0.72, -r * 0.1);
      ctx.closePath();
      ctx.fillStyle = "#EDF3FA";
      ctx.fill();
      ctx.strokeStyle = "#8794A8";
      ctx.lineWidth = Math.max(1.5, u * 0.26);
      ctx.stroke();
      // The fuller, catching the light down the spine.
      ctx.beginPath();
      ctx.moveTo(w * 0.18, -r * 0.24);
      ctx.quadraticCurveTo(w * 0.92, -len * 0.46, w * 0.3, -len * 0.84);
      ctx.quadraticCurveTo(w * 0.52, -len * 0.46, w * 0.04, -r * 0.24);
      ctx.closePath();
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      // Both nubs closing on the grip, over it. See `gripHands`.
      gripHands(ctx, def, f.costume, u, [[0, r * 0.12], [0, r * 0.44]], w * 0.5);
      ctx.restore();
    };

    /*
     * 1. The rise, hitbox on 23–26.
     *
     * The blade starts low in front of him at 72° off vertical and is thrown up
     * to 20° by the contact frames — an upward slash of just over fifty
     * degrees, which is what a rising cutter is. Ending forward of vertical
     * rather than on it is deliberate: straight up is where the port tag is.
     */
    if (frame >= 16 && frame <= 34) {
      const a = 1 - ramp(frame, 27, 34);
      const k = ramp(frame, 16, 23);
      sweep(ctx, cx, cy, r * 1.3, dir, -30 * DEG, 62 * DEG, 0.5 * a, "#DCEBFF");
      over(() => {
        sweep(ctx, cx, cy, r * 1.3, dir, -30 * DEG, 62 * DEG, 0.3 * a, "#F2F8FF");
        drawBlade(
          cx + dir * r * (0.8 + 0.1 * k),
          cy + r * (0.52 - 0.48 * k),
          (72 - 52 * k) * DEG,
          r * 2.0,
          a,
        );
      });
    }

    /*
     * 2. The fall: blade held under him and pointing down, which is where the
     * meteor hitbox is, plus a thin trail above to say he is dropping.
     *
     * The trail was `0.4 × 1.6` radii at 0.3 alpha, and against a night sky
     * that is not a hint of speed — it is a second, larger, grey blade standing
     * over his head, which is what eighteen frames of the contact sheet showed.
     * A motion streak has to be narrower than the thing that made it.
     */
    if (frame >= 33 && frame <= 50) {
      const a = 1 - ramp(frame, 47, 50) * 0.5;
      ctx.fillStyle = withAlpha("#CFE0FF", 0.13 * a);
      ctx.beginPath();
      ctx.ellipse(cx, cy - r * 1.9, r * 0.22, r * 1.25, 0, 0, Math.PI * 2);
      ctx.fill();
      over(() => drawBlade(cx + dir * r * 0.62, cy + r * 0.42, 168 * DEG, r * 1.85, a));
    }

    /*
     * 3. The shockwave: SmashWiki's "blue wave projectile", running forward
     * along the ground for about the length of a Falco Phantasm.
     *
     * Round one drew it as two nested isosceles triangles, which is a caret,
     * not a wave. A wave has a leading face that leans the way it is going and
     * a trailing skirt that does not — so it is a curve, and the same curve
     * repeated half a radius behind it at a third of the alpha reads as the
     * ground still settling.
     */
    if (frame >= 49 && frame <= 60) {
      const travel = ramp(frame, 49, 59);
      const wx = cx + dir * (r * 0.8 + travel * r * 4.6);
      const a = 1 - travel * 0.75;
      ctx.save();
      ctx.translate(wx, y);
      ctx.scale(dir, 1);
      glow(ctx, 0, -r * 0.55, r * 1.5, withAlpha("#7FD0FF", 0.75 * a));
      const crest = (h: number, alpha: number, colour: string) => {
        ctx.fillStyle = withAlpha(colour, alpha);
        ctx.beginPath();
        ctx.moveTo(-r * 0.85, 0);
        ctx.quadraticCurveTo(-r * 0.2, -h * 0.55, r * 0.42, -h);
        ctx.quadraticCurveTo(r * 0.08, -h * 0.42, r * 0.5, 0);
        ctx.closePath();
        ctx.fill();
      };
      ctx.save();
      ctx.translate(-r * 0.7, 0);
      crest(r * 1.0, 0.3 * a, "#7FD0FF");
      ctx.restore();
      crest(r * 1.45, 0.95 * a, "#DFF3FF");
      ctx.save();
      ctx.scale(0.62, 0.66);
      crest(r * 1.45, 0.95 * a, "#3FA9F5");
      ctx.restore();
      // The dust the wave lifts as it goes.
      for (const s of [-1, 1]) {
        ctx.fillStyle = withAlpha("#CFE0FF", 0.3 * a);
        circle(ctx, -r * (0.9 + s * 0.45), -r * 0.16, r * (0.24 + travel * 0.3));
      }
      ctx.restore();

      /*
       * Where he landed, which round one left empty. The wave runs away down
       * the stage and nothing marked the spot it came from — the blade hit the
       * floor in silence. A flash and two puffs at his own feet is what says
       * the wave was *struck out of the ground* rather than thrown.
       */
      const land = 1 - ramp(frame, 49, 55);
      if (land > 0.01) {
        glow(ctx, cx, y, r * 1.9 * (1.4 - land * 0.5), withAlpha("#DFF3FF", 0.7 * land));
        for (const s of [-1, 1]) {
          ctx.fillStyle = withAlpha("#E8F2FF", 0.45 * land);
          circle(ctx, cx + s * r * (0.5 + (1 - land) * 1.1), y - r * 0.14 - (1 - land) * r * 0.2, r * (0.28 + (1 - land) * 0.3));
        }
      }
    }
    return NOTHING;
  },

  /**
   * Kirby, Stone. He *becomes* a rock, so the rock is drawn instead of him —
   * the one effect in the file that replaces the fighter rather than decorating
   * them, and therefore the one where the whole picture is what this function
   * paints. There is no silhouette underneath to carry it.
   *
   * ## Why the round-one rock did not read as a rock
   *
   * It was `polygon(…, 6, 0.42)` — a **regular hexagon**, twice, with a
   * pentagon on top. Three concentric regular polygons about one centre is a
   * nut, a bolt head, a hex icon; the capture reads as a grey UI badge sitting
   * in the air. Two things make a rock instead:
   *
   * 1. **An irregular outline.** Real rock has no repeated angle and no axis of
   *    symmetry. The profile below is hand-listed rather than generated, with a
   *    notch on the left shoulder and two summits of different heights, because
   *    every procedure that generates one generates a regular one.
   * 2. **A flat base on the floor.** The hexagon stood on a *vertex*, half a
   *    radius clear of the stage, which is why it read as floating. A boulder
   *    is heavy and heavy things sit down; the profile's base is at `y`
   *    exactly, and the whole shape is measured up from there.
   *
   * The transformation flash, the landing dust and the shards are painted
   * `over`. With the figure hidden there is nothing to occlude the rock, but
   * dust *behind* a boulder is a cloud in the distance and dust in front of it
   * is an impact — and the impact is an eighteen-percent hitbox that otherwise
   * arrives in silence.
   */
  downB: ({ ctx, def, x, y, u, frame, over }) => {
    const armour = armourWindow(def, "downB");
    if (!armour || frame < armour[0] || frame > armour[1]) return NOTHING;

    // Eleven units across against his 6.9-unit ball, standing 7.2 against his
    // 6.6 — half again his width and barely taller, which is the proportion
    // that reads as *heavy*. A rock as tall as it is wide, on a narrow base, is
    // an asteroid.
    const w = u * 5.5;
    const h = u * 7.2;

    // Three frames each way, not seven. A burst that outlasts the change hides
    // the thing it is announcing: at seven frames the rock washed to near-white
    // on both ends of the move and a critic could not see what he turned into.
    const born = 1 - ramp(frame, armour[0], armour[0] + 3);
    const dies = ramp(frame, armour[1] - 3, armour[1]);
    const flash = Math.max(born, dies);
    // It arrives at size — a rock that grows is a balloon — but the first two
    // frames are squat and wide, which is the change landing.
    const pop = 1 - ramp(frame, armour[0], armour[0] + 3);

    /** The outline, anticlockwise from the bottom-left. `y` runs up from the floor. */
    const PROFILE: readonly (readonly [number, number])[] = [
      [-1.0, 0.03],
      [-0.9, 0.36],
      [-0.97, 0.54],
      [-0.62, 0.78],
      [-0.3, 0.7],
      [0.0, 0.92],
      [0.33, 0.78],
      [0.68, 0.8],
      [0.97, 0.42],
      [0.86, 0.13],
      [0.98, 0.0],
    ];

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + pop * 0.16, 1 - pop * 0.14);
    const path = (pts: readonly (readonly [number, number])[]) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * w, -pts[0][1] * h);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, -pts[i][1] * h);
      ctx.closePath();
    };

    ctx.fillStyle = "#6E6A66";
    path(PROFILE);
    ctx.fill();
    // The lit plane: everything above and left of the long diagonal off the
    // summit. One plane, not a concentric ring — a rock is cut, not layered.
    ctx.fillStyle = "#A79F96";
    path([
      [-0.9, 0.36],
      [-0.97, 0.54],
      [-0.62, 0.78],
      [-0.3, 0.7],
      [0.0, 0.92],
      [-0.12, 0.48],
      [-0.56, 0.26],
    ]);
    ctx.fill();
    // The shaded plane under the right shoulder.
    ctx.fillStyle = "#454340";
    path([
      [0.97, 0.42],
      [0.86, 0.13],
      [0.98, 0.0],
      [0.3, 0.03],
      [0.38, 0.3],
    ]);
    ctx.fill();
    // Two cracks. They are the only thing at rock scale that says the surface
    // is stone rather than clay.
    ctx.strokeStyle = "#3E3B38";
    ctx.lineWidth = Math.max(1.5, u * 0.24);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-0.12 * w, -0.48 * h);
    ctx.lineTo(0.14 * w, -0.32 * h);
    ctx.lineTo(0.05 * w, -0.09 * h);
    ctx.moveTo(-0.56 * w, -0.26 * h);
    ctx.lineTo(-0.7 * w, -0.1 * h);
    ctx.stroke();

    ctx.strokeStyle = "#2C2A28";
    ctx.lineWidth = Math.max(2, u * 0.4);
    ctx.lineJoin = "round";
    path(PROFILE);
    ctx.stroke();
    ctx.restore();

    over(() => {
      ctx.save();
      /*
       * The change, and the change wearing off.
       *
       * Not an expanding *ring*: a clean ellipse outline round a fighter is the
       * shield bubble, and the first version of this read as one — Kirby
       * appeared to put a barrier up rather than to turn to rock. A puff is a
       * ring of separate blobs at uneven radii, which is what dust is.
       */
      if (flash > 0.01) {
        // A ring of puffs round the *outside* of the silhouette, so the rock
        // stays visible through its own transformation.
        const spread = 1.25 + (1 - flash) * 0.7;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + 0.4;
          const wob = 0.8 + 0.34 * Math.sin(i * 2.3);
          ctx.fillStyle = withAlpha(i % 3 === 0 ? "#FFFFFF" : "#D8D2C9", 0.7 * flash);
          circle(
            ctx,
            x + Math.cos(a) * w * spread * wob,
            y - h * 0.46 + Math.sin(a) * h * spread * 0.62 * wob,
            w * 0.26 * flash * wob,
          );
        }
        glow(ctx, x, y - h * 0.5, w * 1.5 * (0.6 + flash * 0.5), withAlpha("#FFFFFF", 0.42 * flash));
      }
      // The impact, once the drop has had time to land: dust rolling outward
      // along the floor and four chips thrown clear of it.
      if (frame > armour[0] + 16 && frame < armour[0] + 30) {
        const k = ramp(frame, armour[0] + 16, armour[0] + 30);
        // The flash of contact, on the two frames either side of it.
        if (k < 0.2) {
          glow(ctx, x, y, w * 2.4 * (0.5 + k * 3), withAlpha("#FFFFFF", 0.7 * (1 - k * 5)));
        }
        for (const s of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = withAlpha("#D5CCC1", 0.7 * (1 - k) * (1 - i * 0.18));
            circle(
              ctx,
              x + s * w * (0.72 + i * 0.34 + k * 1.5),
              y - h * 0.03 - i * h * 0.05 - k * h * 0.13,
              w * (0.26 + i * 0.06 + k * 0.34),
            );
          }
          ctx.fillStyle = withAlpha("#5C5854", 0.85 * (1 - k));
          circle(ctx, x + s * w * (1.0 + k * 2.4), y - h * (0.1 + k * 0.55 - k * k * 0.55), u * 0.55 * (1 - k * 0.5));
          // The crack it leaves in the stage, spreading out from the base.
          ctx.strokeStyle = withAlpha("#3E3B38", 0.5 * (1 - k));
          ctx.lineWidth = Math.max(1.5, u * 0.3 * (1 - k));
          ctx.beginPath();
          ctx.moveTo(x + s * w * 0.35, y);
          ctx.lineTo(x + s * w * (0.85 + k * 0.9), y - u * 0.22);
          ctx.lineTo(x + s * w * (1.35 + k * 1.6), y);
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    return { hideFigure: true };
  },

  /**
   * Burning. The def gives the dash attack a `fire` effect on all three of its
   * hitboxes and calls it Burning, and the move is Kirby turning himself into a
   * comet — so the flame is not decoration, it is the move. It runs frames
   * 9–34 and weakens as it goes, exactly like the damage.
   *
   * ## Fire is a shape, not a blur, and it has to be *around* him
   *
   * Round one drew five `glow`s in a line behind him. A glow is a radial
   * gradient, so five of them side by side at half alpha is a soft orange
   * smear — the capture reads as a distant explosion he happens to be standing
   * in front of, not as a fighter who is on fire. Two changes:
   *
   * - **Tongues, not lobes.** The tail is one drawn shape with a point on it,
   *   flickering on its own clock. An edge is what makes fire read as fire, and
   *   a gradient has none.
   * - **Half of it is painted `over`.** Something you are *inside of* is the
   *   case `over` exists for. The core and the tail go under, and a lick of
   *   flame up the leading edge and over the crown goes in front — so the ball
   *   is wrapped by the fire instead of parked in front of it.
   */
  dashAttack: ({ ctx, x, y, u, dir, frame, over }) => {
    if (frame < 6 || frame > 38) return NOTHING;
    const { cx, cy, r } = ball(x, y, u);
    const life = 1 - ramp(frame, 26, 38);
    const grow = ramp(frame, 6, 11);
    const heat = life * grow;
    if (heat <= 0.01) return NOTHING;

    /**
     * One tongue of flame, pointing backwards from the comet's nose.
     *
     * Every control point carries its own phase off `frame`, which is the whole
     * difference between fire and a UI arrow. The first version wobbled one
     * number and used it on both sides of the shape, so the three tongues were
     * *the same triangle at three scales* on every frame — and a critic given
     * the capture called it a rocket thruster, which is exactly what a fixed
     * symmetric taper is.
     */
    const tongue = (reach: number, spread: number, seed: number, colour: string, alpha: number) => {
      const w = (i: number, rate = 0.62) => Math.sin((frame + seed + i * 9) * rate);
      ctx.fillStyle = withAlpha(colour, alpha);
      ctx.beginPath();
      ctx.moveTo(r * 0.85, 0);
      ctx.quadraticCurveTo(
        -r * reach * (0.3 + 0.1 * w(1)),
        -r * spread * (1 + 0.3 * w(2)),
        -r * reach * (1 + 0.16 * w(3)),
        -r * spread * (0.22 + 0.3 * w(4)),
      );
      ctx.quadraticCurveTo(-r * reach * (0.3 + 0.12 * w(5)), r * spread * 0.15, r * 0.2, r * spread * (0.5 + 0.22 * w(6)));
      ctx.quadraticCurveTo(
        -r * reach * (0.25 + 0.12 * w(7)),
        r * spread * (0.8 + 0.3 * w(8)),
        -r * reach * (0.72 + 0.18 * w(9)),
        r * spread * (0.1 + 0.24 * w(10)),
      );
      ctx.quadraticCurveTo(-r * reach * 0.2, -r * spread * 0.1, r * 0.85, 0);
      ctx.closePath();
      ctx.fill();
    };

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(dir, 1);
    glow(ctx, -r * 0.4, 0, r * 2.4, withAlpha("#FF5A18", 0.36 * heat));
    // The body of the fireball, wrapped round him rather than trailing from
    // him. Burning is Kirby *inside* a comet, and a tail on its own is a jet.
    for (let i = 0; i < 3; i++) {
      const f = Math.sin((frame + i * 13) * 0.5);
      ctx.fillStyle = withAlpha(["#FF4E10", "#FF9A18", "#FFD24A"][i], (0.5 - i * 0.06) * heat);
      ctx.beginPath();
      ctx.ellipse(
        -r * (0.1 + i * 0.06),
        0,
        r * (1.5 - i * 0.28) * (1 + 0.06 * f),
        r * (1.32 - i * 0.26) * (1 - 0.06 * f),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    tongue(3.6, 1.2, 0, "#FF4E10", 0.8 * heat);
    tongue(2.7, 0.9, 17, "#FF9A18", 0.85 * heat);
    tongue(1.8, 0.6, 41, "#FFE070", 0.85 * heat);
    ctx.restore();

    over(() => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(dir, 1);
      // The wash of the fire he is inside. Without it his face stays a calm,
      // crisply lit pink through the whole burn and he reads as standing in
      // front of the flame rather than in it.
      ctx.fillStyle = withAlpha("#FF7A18", 0.3 * heat);
      ctx.beginPath();
      ctx.ellipse(-r * 0.06, 0, r * 1.02, r * 1.02, 0, 0, Math.PI * 2);
      ctx.fill();
      // The nose of the comet: white-hot, in front of him and slightly high,
      // where the leading hitbox is.
      glow(ctx, r * 0.78, -r * 0.06, r * 1.3, withAlpha("#FFFFFF", 0.72 * heat));
      /*
       * Two licks riding over the outline, one across the crown and one under
       * the chin, so the fire closes around the ball instead of ending at it.
       *
       * They are wedges with a point on the leading end and a blunt tail, laid
       * on the ball at nine tenths of a radius. The first version drew them as
       * two-control-point lenses that collapsed to a pale line across his
       * cheek — which at match scale read as a scar, not a flame.
       */
      for (const s of [-1, 1]) {
        const f = Math.sin((frame + (s > 0 ? 5 : 17)) * 0.55);
        const lift = s * r * (0.8 + 0.06 * f);
        ctx.fillStyle = withAlpha(s > 0 ? "#FFB020" : "#FF6A14", 0.5 * heat);
        ctx.beginPath();
        ctx.moveTo(r * (1.02 + 0.1 * f), lift * 0.66);
        ctx.quadraticCurveTo(r * 0.2, lift * 1.36, -r * 1.3, lift * 1.05);
        ctx.quadraticCurveTo(-r * 0.5, lift * 0.62, r * 0.1, lift * 0.56);
        ctx.quadraticCurveTo(r * 0.7, lift * 0.48, r * (1.02 + 0.1 * f), lift * 0.66);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
    return NOTHING;
  },

  /**
   * Down air — the corkscrew.
   *
   * The pose pins the boots downward and flicks the body, because an in-plane
   * `spin` turns a drill into a tumble. What is missing from that is the
   * *screw*, so it is drawn: a helix of rings under him, phase-shifted by frame
   * so the whole column appears to rotate. Five hits on odd frames from 18 to
   * 31 and a meteor finisher on 34.
   */
  dair: ({ ctx, x, y, u, dir, frame }) => {
    if (frame < 14 || frame > 40) return NOTHING;
    const { cx, cy, r } = ball(x, y, u);
    const a = ramp(frame, 14, 18) * (1 - ramp(frame, 34, 40));
    if (a <= 0.01) return NOTHING;
    // The column starts *below* the ball, not inside it. Effects paint under
    // the figure, so a ring centred less than a radius down is drawn and then
    // covered — the first version put four of its six rings behind him and the
    // corkscrew was a faint smudge at his ankles.
    //
    // **It also has to taper.** Six rings of near-equal width one under the
    // other is a spring, which is what the capture showed — a white slinky
    // hanging off his boots. A drill is a cone: each ring is narrower than the
    // one above it and the whole thing ends in a point, and the point is where
    // the meteor hitbox is.
    const envelope = 1.32;
    ctx.fillStyle = withAlpha("#FFD6E6", 0.14 * a);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.95, cy + r * 0.95);
    ctx.lineTo(cx + r * 0.95, cy + r * 0.95);
    ctx.lineTo(cx + r * 0.1, cy + r * (0.95 + envelope * 1.6));
    ctx.lineTo(cx - r * 0.1, cy + r * (0.95 + envelope * 1.6));
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const k = i / 5;
      const phase = frame * 0.62 + i * 1.15;
      const w = Math.cos(phase);
      ctx.strokeStyle = withAlpha("#FFF2F8", 0.75 * a * (1 - k * 0.3));
      ctx.lineWidth = Math.max(1.5, u * 0.44 * (1 - k * 0.35));
      ctx.beginPath();
      ctx.ellipse(
        cx + dir * w * r * 0.13 * (1 - k),
        cy + r * (0.98 + k * envelope * 1.5),
        r * (0.95 - k * 0.78) * (0.6 + 0.4 * Math.abs(w)),
        r * 0.15 * (1 - k * 0.4),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    // The bit itself, at the bottom of the cone.
    ctx.fillStyle = withAlpha("#FFFFFF", 0.8 * a);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.17, cy + r * (0.95 + envelope * 1.4));
    ctx.lineTo(cx + r * 0.17, cy + r * (0.95 + envelope * 1.4));
    ctx.lineTo(cx, cy + r * (0.95 + envelope * 1.85));
    ctx.closePath();
    ctx.fill();
    // The finisher's meteor punch.
    if (frame >= 33 && frame <= 37) {
      glow(ctx, cx, cy + r * 1.5, r * 1.4 * (1 - ramp(frame, 33, 37)), withAlpha("#FFFFFF", 0.7));
    }
    return NOTHING;
  },

  /**
   * Neutral air — the spin.
   *
   * SmashWiki calls it "a cartwheel": one hitbox around the whole of him, live
   * for twenty-five frames, and the animation is Kirby turning with his arms
   * and legs thrown out. `poses.ts` fakes the turn by swapping which side's
   * limbs are in front on `hold` cuts, which is the only turn this renderer can
   * express — but a swap is a *pose* change, and on a fighter whose limbs are
   * four small bumps on a circle it is a very quiet one. The capture is a ball
   * wobbling.
   *
   * So the rotation gets a graphic. Two pale crescents on opposite sides of the
   * outline, walking round it four times across the active window: whichever
   * frame you stop on, something is sweeping, and the pair being opposite is
   * what says *turning* rather than *swinging*.
   *
   * They hug the outline at 1.06–1.24 radii deliberately. `render/swing.ts`
   * already derives an arc from the move's own hitboxes and an authored arc
   * that reached further would be a second, drifting claim about range — this
   * one claims nothing about reach, only about rotation, so it stays inside the
   * hurtbox it is drawn on.
   */
  nair: ({ ctx, x, y, u, dir, frame, over }) => {
    const a = ramp(frame, 6, 9) * (1 - ramp(frame, 28, 36));
    if (a <= 0.01) return NOTHING;
    const { cx, cy, r } = ball(x, y, u);
    const turn = frame * 0.42 * dir;
    over(() => {
      ctx.save();
      ctx.translate(cx, cy);
      for (const s of [0, Math.PI]) {
        ctx.fillStyle = withAlpha("#FFE4F0", 0.42 * a);
        crescent(ctx, 0, 0, r * 1.14, r * 0.3, turn + s - 1.25, turn + s + 0.34);
        ctx.fill();
        ctx.fillStyle = withAlpha("#FFFFFF", 0.85 * a);
        crescent(ctx, 0, 0, r * 1.14, r * 0.11, turn + s - 0.5, turn + s + 0.32);
        ctx.fill();
        ctx.fillStyle = withAlpha("#FFFFFF", 0.9 * a);
        circle(ctx, Math.cos(turn + s + 0.32) * r * 1.14, Math.sin(turn + s + 0.32) * r * 1.14, u * 0.3);
      }
      ctx.restore();
    });
    return NOTHING;
  },

  /**
   * Down throw — ten stomps at a literal 270 degrees. Each landing kicks up a
   * ring of dust; without it a thirty-four-frame stomping window is silent.
   */
  dthrow: ({ ctx, x, y, u, frame }) => {
    if (frame < 9 || frame > 43) return NOTHING;
    const beat = frame % 7;
    if (beat > 3) return NOTHING;
    const k = beat / 3;
    const r = 4.45 * 0.78 * u;
    for (const s of [-1, 1]) {
      ctx.fillStyle = withAlpha("#C8BFB6", 0.45 * (1 - k));
      circle(ctx, x + s * r * (0.5 + k * 1.1), y - r * 0.12, r * (0.2 + k * 0.22));
    }
    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
