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
 * Effects paint **under** the figure, which decides a lot of the composition
 * below: the hammer swings out past his outline where it can be seen, the
 * Inhale mouth is drawn large enough that its front half clears the ball, and
 * the Stone replaces him outright.
 */

import {
  NOTHING,
  armourWindow,
  circle,
  crescent,
  glow,
  polygon,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import type { MoveSlot } from "@/engine/types";
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

/* ------------------------------------------------------------- the moves -- */

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Inhale.
   *
   * The mouth is the move. It opens to most of his body width, and because
   * effects draw under the figure it has to be big enough that its front half
   * clears the ball — a mouth the size of a mouth would be entirely hidden
   * behind him. Suction is live on frames 10–44, so the maw is open and *held*
   * across thirty-five frames rather than flashed.
   *
   * The wind is four arcs pulled in from in front on a four-frame cycle. They
   * are the only thing that says which way the pull goes, which for a move that
   * does no damage is the whole of the feedback.
   */
  neutralB: ({ ctx, x, y, u, dir, frame }) => {
    const open = Math.min(ramp(frame, 4, 12), 1 - ramp(frame, 45, 52));
    if (open <= 0.01) return NOTHING;
    const { cx, cy, r } = ball(x, y, u);

    // The wind, drawn first so the mouth sits over it: nested arcs closing on
    // the mouth, plus motes riding them in. Whiter and heavier than a hint —
    // this is the only feedback a move that deals no damage has.
    for (let i = 0; i < 5; i++) {
      const phase = (((frame * 0.075 + i * 0.2) % 1) + 1) % 1;
      const d = (1 - phase) * r * 3.6 + r * 1.15;
      const spread = (0.45 + phase * 1.0) * 0.62;
      const mid = -0.04 + (i - 2) * 0.3;
      const a = open * (1 - phase * 0.4) * 0.85;
      ctx.save();
      ctx.translate(cx, cy - r * 0.15);
      ctx.scale(dir, 1);
      ctx.strokeStyle = withAlpha("#EAF4FF", a);
      ctx.lineWidth = Math.max(1.6, u * 0.5 * (1 - phase * 0.4));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, d, mid - spread * 0.5, mid + spread * 0.5);
      ctx.stroke();
      ctx.fillStyle = withAlpha("#FFFFFF", a * 0.9);
      circle(ctx, Math.cos(mid) * d, Math.sin(mid) * d, Math.max(1.2, u * 0.28));
      ctx.restore();
    }

    /*
     * The maw.
     *
     * Three things had to be true before this read at all.
     *
     * It has to be *large*: an effect draws under the figure, so only what
     * clears the outline is seen, and a mouth the size of a mouth is entirely
     * behind him. At 1.26 ball-radii across, centred a radius in front of his
     * middle, a little over half of it clears — which is the half a player
     * sees, and it is bigger than his face, which is the joke.
     *
     * **It must not be maroon.** The first version used `#5A1030`, within a few
     * points of the rig's `outline` (`#5A2038`), and the rim is an *inflated
     * copy of the whole figure painted in that colour* — so the part of the
     * mouth that did clear the ball was drawn immediately alongside a band of
     * its own colour and vanished into it. This is the general trap on this
     * renderer and it is not confined to props: anything an effect paints near
     * the silhouette is judged against the rim, not against the sky. Near-black
     * throat, bright lip, and the two-tone edge survives either background.
     *
     * And it sits *below the eyes*, not level with them — the rig's eyes are on
     * the upper half of the ball, and a maw centred on them turns him into a
     * face with a hole through it rather than a mouth opening downwards.
     */
    const mw = r * (0.92 + 0.34 * open);
    const mh = r * (0.84 + 0.36 * open);
    const mx = cx + dir * r * 1.02;
    const my = cy + r * 0.24;
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(dir, 1);
    ctx.rotate(-8 * DEG);
    ctx.fillStyle = "#FFC2D6";
    ctx.beginPath();
    ctx.ellipse(0, 0, mw * 1.14, mh * 1.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1E0714";
    ctx.beginPath();
    ctx.ellipse(0, 0, mw, mh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#D8536F";
    ctx.beginPath();
    ctx.ellipse(mw * 0.12, mh * 0.55, mw * 0.56, mh * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

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
  sideB: ({ ctx, f, x, y, u, dir, frame }) => {
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
    const shaft = r * 1.65 * size;
    const headLen = r * 1.25 * size;
    const headWide = r * 0.88 * size;

    ctx.save();
    ctx.globalAlpha = Math.min(1, drawn * 1.8) * kept;
    ctx.translate(cx, cy);
    ctx.scale(dir, 1);
    ctx.rotate(angle);

    // The arc it has just come through. The local frame has the hammer along
    // −y and the swing turns it clockwise, so the ground it has covered is the
    // −x side: canvas angles behind −π/2, not in front of it. Drawn on the
    // wrong side it reads as a swoosh the hammer is about to catch up with.
    if (frame >= 18 && frame <= 34) {
      const a = 0.45 * ramp(frame, 18, 22) * (1 - ramp(frame, 27, 34));
      ctx.fillStyle = withAlpha(charged ? "#FFD25A" : "#FFFFFF", a);
      crescent(ctx, 0, 0, shaft + headLen * 0.5, headWide * 1.5, -3.02, -1.64);
      ctx.fill();
    }

    // Handle.
    ctx.strokeStyle = "#B7813F";
    ctx.lineWidth = Math.max(2, u * 0.7);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -grip);
    ctx.lineTo(0, -(grip + shaft));
    ctx.stroke();

    // Head: a barrel with a darker band and two flat faces.
    const hy = -(grip + shaft + headLen * 0.5);
    ctx.fillStyle = "#E8DCC0";
    ctx.beginPath();
    ctx.roundRect(-headWide, hy - headLen * 0.5, headWide * 2, headLen, headWide * 0.36);
    ctx.fill();
    ctx.fillStyle = "#C2A878";
    ctx.beginPath();
    ctx.roundRect(-headWide * 0.28, hy - headLen * 0.5, headWide * 0.56, headLen, headWide * 0.16);
    ctx.fill();
    ctx.strokeStyle = "#6B4A22";
    ctx.lineWidth = Math.max(1.5, u * 0.36);
    ctx.beginPath();
    ctx.roundRect(-headWide, hy - headLen * 0.5, headWide * 2, headLen, headWide * 0.36);
    ctx.stroke();

    if (charged) {
      for (let i = 0; i < 3; i++) {
        const w = 0.7 + 0.3 * Math.sin((frame + i * 7) * 0.6);
        glow(ctx, (i - 1) * headWide * 0.7, hy - headLen * 0.4, headWide * 1.1 * w, "#FFB020");
      }
      glow(ctx, 0, hy, headWide * 1.7, withAlpha("#FF5A10", 0.5));
    }
    ctx.restore();
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
  upB: ({ ctx, x, y, u, dir, frame }) => {
    const { cx, cy, r } = ball(x, y, u);

    const drawBlade = (bx: number, by: number, angle: number, alpha: number) => {
      ctx.save();
      ctx.translate(bx, by);
      ctx.scale(dir, 1);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha;
      // A curved, tapering blade: spine out, belly back.
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(r * 0.5, -r * 0.9, r * 0.16, -r * 2.05);
      ctx.quadraticCurveTo(r * 0.02, -r * 1.0, -r * 0.2, 0);
      ctx.closePath();
      ctx.fillStyle = "#E8EEF6";
      ctx.fill();
      ctx.strokeStyle = "#8794A8";
      ctx.lineWidth = Math.max(1.5, u * 0.28);
      ctx.stroke();
      ctx.fillStyle = "#6B5230";
      ctx.beginPath();
      ctx.roundRect(-r * 0.2, -r * 0.06, r * 0.42, r * 0.5, r * 0.1);
      ctx.fill();
      ctx.restore();
    };

    // 1. The rise.
    if (frame >= 16 && frame <= 34) {
      const a = 1 - ramp(frame, 27, 34);
      sweep(ctx, cx, cy, r * 1.25, dir, -70 * DEG, 40 * DEG, 0.66 * a, "#DCEBFF");
      drawBlade(cx + dir * r * 0.3, cy - r * 0.5, -14 * DEG, a);
    }

    // 2. The fall: blade under him, a thin trail above to say he is dropping.
    //
    // The trail was `0.4 × 1.6` radii at 0.3 alpha, and against a night sky
    // that is not a hint of speed — it is a second, larger, grey blade standing
    // over his head, which is what eighteen frames of the contact sheet showed.
    // A motion streak has to be narrower than the thing that made it.
    if (frame >= 33 && frame <= 50) {
      const a = 1 - ramp(frame, 47, 50) * 0.5;
      drawBlade(cx + dir * r * 0.22, cy + r * 0.35, 176 * DEG, a);
      ctx.fillStyle = withAlpha("#CFE0FF", 0.13 * a);
      ctx.beginPath();
      ctx.ellipse(cx, cy - r * 1.9, r * 0.22, r * 1.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. The shockwave: a blue blade of ground, running away from him.
    if (frame >= 49 && frame <= 60) {
      const travel = ramp(frame, 49, 59);
      const wx = cx + dir * (r * 0.8 + travel * r * 4.6);
      const a = 1 - travel * 0.75;
      ctx.save();
      ctx.translate(wx, y);
      ctx.scale(dir, 1);
      glow(ctx, 0, -r * 0.45, r * 1.15, withAlpha("#7FD0FF", 0.8 * a));
      ctx.fillStyle = withAlpha("#DFF3FF", 0.95 * a);
      polygon(ctx, 0, 0, 1, 3, 0);
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, 0);
      ctx.lineTo(0, -r * 1.5);
      ctx.lineTo(r * 0.55, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = withAlpha("#3FA9F5", 0.9 * a);
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, 0);
      ctx.lineTo(0, -r * 1.05);
      ctx.lineTo(r * 0.28, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    return NOTHING;
  },

  /**
   * Kirby, Stone. He *becomes* a rock, so the rock is drawn instead of him —
   * the one effect in the file that replaces the fighter rather than decorating
   * them. A grey Kirby with a slightly different pose would be indistinguishable
   * from a grey Kirby doing anything else.
   *
   * The transformation flash and the landing dust are the two additions: the
   * armour window opens on frame 10 and the drop lands mid-window, and without
   * a puff at the bottom an eighteen-percent hitbox arrives silently.
   */
  downB: ({ ctx, def, x, y, u, frame }) => {
    const armour = armourWindow(def, "downB");
    if (!armour || frame < armour[0] || frame > armour[1]) return NOTHING;

    const r = u * 5.4;
    const cy = y - r * 0.92;

    // The puff of the change, and again as it wears off.
    const born = 1 - ramp(frame, armour[0], armour[0] + 5);
    const dies = ramp(frame, armour[1] - 5, armour[1]);
    const flash = Math.max(born, dies);
    if (flash > 0.01) glow(ctx, x, cy, r * 2.1 * (0.7 + flash * 0.6), withAlpha("#FFFFFF", 0.75 * flash));

    // The impact, once the drop has had time to land.
    if (frame > armour[0] + 16 && frame < armour[0] + 30) {
      const k = ramp(frame, armour[0] + 16, armour[0] + 30);
      for (const s of [-1, 1]) {
        ctx.fillStyle = withAlpha("#9C948A", 0.5 * (1 - k));
        circle(ctx, x + s * r * (0.9 + k * 1.5), y - r * 0.18 * (1 - k), r * (0.34 + k * 0.3));
      }
    }

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
   * Burning. The def gives the dash attack a `fire` effect on all three of its
   * hitboxes and calls it Burning, and the move is Kirby turning himself into a
   * comet — so the flame is not decoration, it is the move. It runs frames
   * 9–34 and weakens as it goes, exactly like the damage.
   */
  dashAttack: ({ ctx, x, y, u, dir, frame }) => {
    if (frame < 6 || frame > 38) return NOTHING;
    const { cx, cy, r } = ball(x, y, u);
    const life = 1 - ramp(frame, 26, 38);
    const grow = ramp(frame, 6, 11);
    const heat = life * grow;
    if (heat <= 0.01) return NOTHING;

    // The tail, four lobes trailing behind him and shrinking.
    for (let i = 4; i >= 1; i--) {
      const k = i / 4;
      const flick = 1 + 0.16 * Math.sin((frame + i * 5) * 0.7);
      glow(
        ctx,
        cx - dir * r * (0.5 + k * 1.9) * flick,
        cy + r * 0.1 * Math.sin((frame + i * 3) * 0.5),
        r * (1.25 - k * 0.55) * flick,
        withAlpha(i > 2 ? "#FF5A18" : "#FFB020", 0.5 * heat),
      );
    }
    glow(ctx, cx, cy, r * 1.5, withAlpha("#FFE070", 0.6 * heat));
    glow(ctx, cx + dir * r * 0.35, cy, r * 1.05, withAlpha("#FFFFFF", 0.45 * heat));
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
    for (let i = 0; i < 6; i++) {
      const k = i / 5;
      const phase = frame * 0.55 + i * 1.05;
      const w = Math.cos(phase);
      ctx.strokeStyle = withAlpha("#FFF2F8", 0.7 * a * (1 - k * 0.45));
      ctx.lineWidth = Math.max(1.5, u * 0.42);
      ctx.beginPath();
      ctx.ellipse(
        cx + dir * w * r * 0.18,
        cy + r * (1.0 + k * 1.45),
        r * (0.9 - k * 0.4) * (0.55 + 0.45 * Math.abs(w)),
        r * 0.18,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    // The finisher's meteor punch.
    if (frame >= 33 && frame <= 37) {
      glow(ctx, cx, cy + r * 1.5, r * 1.4 * (1 - ramp(frame, 33, 37)), withAlpha("#FFFFFF", 0.7));
    }
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
