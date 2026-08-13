/**
 * Samus: what her moves paint on top of the figure.
 *
 * Almost every move she has comes out of the arm cannon, so almost every move
 * she has needs something painted — a fighter who thrusts a gun forward and
 * emits nothing is worse than one who punches, because the pose has promised
 * something the frame does not deliver. That is what was on screen before this
 * file: a Charge Shot with no plasma, no flash and no shot.
 *
 * ## Where an effect goes
 *
 * Every anchor below is taken from the move's **own hitbox or projectile
 * coordinates** in `fighters/samus.ts`, converted from world units by `u`.
 * Guessing an offset per move is how a muzzle flash ends up four units from the
 * muzzle and stays there for a year; reading it off the hitbox means the
 * graphic is where the damage is, by construction, and stays there if anyone
 * ever retunes the move.
 *
 * `dir` is `+1` facing right and `-1` left. Anything with a handedness is drawn
 * inside a `scale(dir, 1)` rather than by signing every coordinate — an arc
 * swept with `from`/`to` in screen space silently reverses when it is mirrored,
 * and that bug is invisible until someone plays as player two.
 */

import {
  NOTHING,
  circle,
  crescent,
  glow,
  polygon,
  type FxFn,
  type ProjectilePainter,
  type SpecialFxResult,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import { SMASH_CHARGE_MAX } from "@/engine/constants";
import type { MoveSlot } from "@/engine/types";

/* ---------------------------------------------------------------- palette -- */

/** Charge Shot plasma: cold, and the only cold thing she fires. */
const PLASMA = "#7FE0FF";
const PLASMA_PALE = "#BFF3FF";

/** Every other blast she makes is a "small, fiery blast" — orange, not cyan. */
const FIRE = "#FF8A2A";
const FIRE_PALE = "#FFD87A";
const HOT = "#FFF6D8";

/** Screw Attack discharge. */
const SCREW = "#FFF2A8";
const SCREW_COOL = "#8FE8FF";

const HIDE: SpecialFxResult = { hideFigure: true };

/* ---------------------------------------------------------------- helpers -- */

/**
 * A blast off the muzzle: hot core, a bloom, and a short cone along the
 * firing line. `k` runs 1 → 0 across the few frames it lives.
 */
function blast(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  k: number,
  hot: string,
  warm: string,
): void {
  if (k <= 0) return;
  // The bloom is kept tight. A wide one over a dark stage is mostly its own
  // dim outer half, which paints a grey smudge where a muzzle flash should be
  // — the first pass at this looked like soot.
  //
  // Both stops explicit. `glow` derives its middle stop from `inner` when it is
  // not given one, and `inner` here already carries an alpha — the case that
  // used to come back black and punch a hole in the flash.
  glow(ctx, x, y, r * 1.9, withAlpha(warm, 0.75 * k), withAlpha(warm, 0.3 * k));
  ctx.fillStyle = withAlpha(warm, k);
  circle(ctx, x, y, r * (0.55 + 0.45 * k));
  ctx.fillStyle = withAlpha(hot, k);
  circle(ctx, x, y, r * 0.62 * k);
  ctx.fillStyle = withAlpha("#FFFFFF", 0.9 * k);
  circle(ctx, x, y, r * 0.3 * k);
}

/**
 * The muzzle cone — the flat-sided flare a barrel throws forward.
 *
 * Drawn in the cannon's own frame so the caller only says where the muzzle is
 * and which way it points; `dir` mirroring is handled by the transform.
 */
function muzzleCone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: number,
  len: number,
  wide: number,
  k: number,
  colour: string,
): void {
  if (k <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.beginPath();
  ctx.moveTo(0, -wide * 0.35);
  ctx.lineTo(len, -wide);
  ctx.lineTo(len * 1.12, 0);
  ctx.lineTo(len, wide);
  ctx.lineTo(0, wide * 0.35);
  ctx.closePath();
  ctx.fillStyle = withAlpha(colour, 0.85 * k);
  ctx.fill();
  ctx.restore();
}

/**
 * The trail behind a kick.
 *
 * Her legs are short — thigh plus shin is barely a third of her height — so a
 * limb thrown out to full extension moves about fifteen pixels at match scale
 * and the eye does not catch it. Every kick she has therefore needs the arc
 * drawn: the `crescent` is not decoration on these moves, it is the only part
 * of them that is legible. Painted in a `scale(dir, 1)` frame, so `from`/`to`
 * are always "forward is +x" and never silently reverse when she turns round.
 */
function kickArc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: number,
  r: number,
  w: number,
  from: number,
  to: number,
  k: number,
  colour = "#FFE8C8",
): void {
  if (k <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.fillStyle = withAlpha(colour, 0.62 * k);
  crescent(ctx, 0, 0, r, w * k, from, to);
  ctx.fill();
  // The bright core is what makes it read as a swing rather than as a grey
  // smear: a single flat wedge at half alpha over a dark stage is the colour
  // of the stage, which is what the first pass at every one of these looked
  // like.
  ctx.fillStyle = withAlpha("#FFFFFF", 0.6 * k);
  crescent(ctx, 0, 0, r, w * 0.34 * k, from, to);
  ctx.fill();
  ctx.restore();
}

/**
 * Where a run of frames sits in its own life: 1 on `from`, 0 by `from + span`,
 * and **0 before it starts**.
 *
 * The last clause is the whole point. Clamping the ratio to 1 instead of
 * returning 0 makes every effect fire on frame 0 as well as on its real frame,
 * and the symptom — a muzzle flash on the first frame of the wind-up — reads as
 * a timing bug in the *animation* rather than in the helper.
 */
function decay(frame: number, from: number, span: number): number {
  if (frame < from) return 0;
  const k = 1 - (frame - from) / span;
  return k < 0 ? 0 : k;
}

/* ------------------------------------------------------------------- moves -- */

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Charge Shot.
   *
   * The plasma grows in the muzzle while it is held and flashes when it goes,
   * which is the whole read on the move: the *decision* a player makes against
   * Samus is whether that ball is worth respecting yet, and they can only make
   * it by looking at the ball. It scales with `f.charge` continuously rather
   * than in steps, so the answer to "how charged is she" is always legible and
   * never quantised.
   *
   * Anchored on the projectile's own spawn point (8.0, 7.0) pulled back to the
   * muzzle, so the ball is born exactly where it was hanging.
   */
  neutralB: ({ ctx, f, x, y, u, frame }) => {
    const mx = x + u * 7.2 * (f.facing >= 0 ? 1 : -1);
    const my = y - u * 7.0;
    const charge = Math.min(1, f.charge / SMASH_CHARGE_MAX);

    if (f.charge > 0) {
      // Radius runs 0.9 → 3.3 world units. The top of that is most of the way
      // to her own head height, which is the point: a full charge has to be
      // frightening from across the stage.
      const r = u * (0.9 + charge * 2.4);
      glow(
        ctx, mx, my, r * 2.3,
        withAlpha(PLASMA_PALE, 0.5 + 0.4 * charge),
        withAlpha(PLASMA, 0.28 + 0.2 * charge),
      );
      ctx.fillStyle = PLASMA;
      circle(ctx, mx, my, r);
      // Two rings of containment field, tighter as it fills.
      ctx.strokeStyle = withAlpha("#FFFFFF", 0.35 + 0.45 * charge);
      ctx.lineWidth = Math.max(1, u * 0.18);
      ctx.beginPath();
      ctx.ellipse(mx, my, r * 1.25, r * (0.4 - 0.22 * charge), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      circle(ctx, mx, my, r * (0.36 + 0.16 * charge));
      return NOTHING;
    }

    // The shot leaving. Frame 3 is the spawn; the flare covers it either side.
    const k = decay(frame, 2, 7);
    if (k > 0) {
      muzzleCone(ctx, mx, my, f.facing >= 0 ? 1 : -1, u * 5.5 * k, u * 2.4 * k, k, PLASMA_PALE);
      blast(ctx, mx, my, u * 2.2, k, "#FFFFFF", PLASMA);
    }
    return NOTHING;
  },

  /**
   * Forward smash: "quickly thrusts her Arm Cannon forward to fire a small,
   * fiery blast". The blast is the strong hitbox — 14% at the muzzle against
   * 12% at the arm — so it is painted at the muzzle hitbox's own centre and is
   * the biggest thing in the frame for the two frames it exists.
   */
  fsmash: ({ ctx, x, y, u, dir, frame }) => {
    const k = decay(frame, 9, 8);
    if (k <= 0) return NOTHING;
    const mx = x + u * 7.4 * dir;
    const my = y - u * 7.0;
    muzzleCone(ctx, mx, my, dir, u * 6.2 * k, u * 2.9 * k, k, FIRE_PALE);
    blast(ctx, x + u * 10.0 * dir, y - u * 7.0, u * 3.0, k, HOT, FIRE);
    return NOTHING;
  },

  /**
   * Up smash: five fiery blasts in an overhead arc.
   *
   * The five hitboxes land on frames 11, 15, 19, 23 and 27, so the five blasts
   * are placed on those frames along an arc from in front of her, over the top,
   * to behind — which is the sweep the pose is making underneath. Each one
   * fades over six frames, so two or three overlap at any instant and the
   * result reads as a burst rather than as a metronome.
   */
  usmash: ({ ctx, x, y, u, dir, frame }) => {
    const SHOTS = [11, 15, 19, 23, 27];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    SHOTS.forEach((f0, i) => {
      const k = decay(frame, f0, 7);
      if (k <= 0) return;
      // Front to back, because that is the way the arm underneath is sweeping.
      // Getting this backwards is invisible in a still and obvious in motion,
      // which is exactly the kind of error a contact sheet is for.
      const a = 0.55 - (i / (SHOTS.length - 1)) * 1.5 - Math.PI / 2;
      // Tight and centred: every hitbox on this move is at x = 0, y = 12–13.5,
      // so a wide arc would put the graphic where the damage is not.
      const rad = u * 4.6;
      const bx = Math.cos(a) * rad;
      const by = Math.sin(a) * rad - u * 9.4;
      const big = i === SHOTS.length - 1;
      blast(ctx, bx, by, u * (big ? 3.6 : 2.7), k, HOT, FIRE);
    });
    ctx.restore();
    return NOTHING;
  },

  /**
   * Down smash: the legsweep, front on frame 9 and behind on frame 17.
   *
   * A `crescent` each way rather than a blast — this is the one smash of hers
   * that is a limb and not a gun, and the tapered arc is the graphic the real
   * game puts behind a sweep. Drawn low, at the hitboxes' own y of 1.5, so it
   * sits on the floor where the move actually lives.
   */
  dsmash: ({ ctx, x, y, u, dir, frame }) => {
    const y0 = y - u * 1.5;
    // `kickArc` rather than a bare crescent: a flat wedge at half alpha over a
    // night stage is the colour of the stage, and both of these were reading as
    // a grey scuff on the floor. The bright core is the sweep.
    kickArc(ctx, x, y0, dir, u * 6.4, u * 2.4, -0.62, 0.5, decay(frame, 8, 7));
    kickArc(
      ctx, x, y0, dir, u * 6.4, u * 2.5,
      Math.PI - 0.5, Math.PI + 0.62, decay(frame, 16, 7),
    );
    return NOTHING;
  },

  /**
   * Down tilt: kneels and fires a small blast just off the floor.
   * Hitbox (7.0, 1.5), frames 6–8 — ankle height, which is the whole reason
   * the move is a low poke.
   */
  dtilt: ({ ctx, x, y, u, dir, frame }) => {
    const k = decay(frame, 5, 6);
    if (k <= 0) return NOTHING;
    muzzleCone(ctx, x + u * 4.4 * dir, y - u * 2.1, dir, u * 4.4 * k, u * 1.7 * k, k, FIRE_PALE);
    blast(ctx, x + u * 7.0 * dir, y - u * 1.5, u * 2.0, k, HOT, FIRE);
    return NOTHING;
  },

  /**
   * Forward air: five blasts down a slow arc, frames 6 to 31.
   *
   * The long weak middle (1.6% a hit, frames 12–25) is what makes this move
   * feel like a wall in the real game, and it is invisible unless something is
   * drawn on every one of those frames. Blasts are spaced along the same
   * downward arc the cannon is travelling.
   */
  fair: ({ ctx, x, y, u, dir, frame }) => {
    const SHOTS = [6, 12, 18, 24, 30];
    ctx.save();
    ctx.translate(x, y - u * 7.0);
    ctx.scale(dir, 1);
    SHOTS.forEach((f0, i) => {
      const k = decay(frame, f0 - 1, 8);
      if (k <= 0) return;
      // From 40° above the horizontal down to 40° below it.
      const a = -0.7 + (i / (SHOTS.length - 1)) * 1.4;
      const rad = u * 6.6;
      const big = i === SHOTS.length - 1;
      blast(ctx, Math.cos(a) * rad, Math.sin(a) * rad, u * (big ? 2.8 : 1.9), k, HOT, FIRE);
    });
    ctx.restore();
    return NOTHING;
  },

  /**
   * Down air: the cannon arcing down past her feet.
   *
   * The meteor is the *middle* of the move — frames 19–21 with weaker hits
   * either side — so the arc brightens into those three frames and drops away
   * after, which is the only warning an opponent gets that this particular
   * frame was the one that takes a stock.
   */
  dair: ({ ctx, x, y, u, dir, frame }) => {
    if (frame < 14 || frame > 30) return NOTHING;
    // 1 across the meteor window, tapering out to nothing at either end.
    const heat = frame < 19 ? (frame - 14) / 5 : frame <= 21 ? 1 : Math.max(0, 1 - (frame - 21) / 8);
    // Sweeping from out in front, down and under: the arm's own path.
    kickArc(ctx, x, y - u * 5.0, dir, u * 7.2, u * 2.7, -0.15, 1.5, heat, FIRE_PALE);
    if (frame >= 18 && frame <= 22) {
      blast(ctx, x + u * 1.0 * dir, y + u * 2.0, u * 3.0, decay(frame, 18, 5), HOT, FIRE);
    }
    return NOTHING;
  },

  /**
   * Neutral air: the spinning roundhouse.
   *
   * One trailing arc, not a blast — nothing is fired. It is here at all because
   * the hits run from frame 8 to frame 22 and a spinning kick with no trail is
   * a fighter rotating for no reason.
   */
  nair: ({ ctx, x, y, u, dir, frame }) => {
    if (frame < 6 || frame > 26) return NOTHING;
    // Full through the multihit, gone six frames after the last hit.
    const k = frame <= 21 ? 1 : Math.max(0.08, 1 - (frame - 21) / 6);
    // The arc **follows the leg**. The pose walks the kicking leg a whole
    // revolution round the hip between frames 7 and 21, 90° a key, so a fixed
    // wedge painted in front of her contradicts the drawing for two thirds of
    // the move — which is what was here, and what the contact sheet showed as
    // a grey tab hanging off her ankle. Same schedule, same direction: 0 is
    // straight forward and a quarter turn later both are underneath her.
    const lead = ((frame - 7) / 14) * Math.PI * 2;
    kickArc(ctx, x, y - u * 4.2, dir, u * 5.4, u * 2.5, lead - 1.5, lead, k);
    return NOTHING;
  },

  /**
   * Up air: the corkscrew drill.
   *
   * This move had **no effect at all**, and it is the one on her that least
   * survives without one: all three hitboxes are a 4-unit circle at (0, 13.5),
   * which is a body length above a pelvis her legs reach 4.1 units from. The
   * pose gets the boot up and clear of her own torso and that is the most this
   * skeleton can do — nothing she owns can be drawn where the damage is. So
   * the drill is painted there instead: three rings biting upward on the
   * multihit's cadence, narrowing as they climb, over a hot core. Cool rather
   * than fiery, because everything in the Screw Attack family is and because
   * her one warm effect is the cannon.
   */
  uair: ({ ctx, x, y, u, frame }) => {
    if (frame < 4 || frame > 20) return NOTHING;
    // Full through the multihit (5..17), one frame of lead-in, three of decay.
    const k = frame < 5 ? 0.5 : frame <= 17 ? 1 : Math.max(0.1, 1 - (frame - 17) / 3);
    const pulse = 0.7 + 0.3 * Math.cos((frame % 3) * 2.1);
    // Where the drill goes is a fight between three facts. The hitbox is a
    // 4-unit circle centred at 13.5, so it must live around there. Effects are
    // painted **under** the fighter, so anything inside her silhouette is not
    // drawn. And in a real match the player tag sits in the air just above her
    // head and is painted **over** everything — which is what killed the first
    // two passes: rings centred on 13.5 came out behind the tag, and a narrow
    // cone came out behind her own body.
    //
    // So it runs 6 → 16.5, still inside the hitbox, and it is **wider than she
    // is** at the base: 5.4 units against a 2.3-unit half-width hurtbox, so the
    // parts of it that survive both occluders are the two flanks.
    const base = y - u * 6.0;
    const apex = y - u * 16.5;
    const halfWidth = u * 5.4;

    // Both stops given explicitly. `glow`'s default derives its middle stop
    // from `inner`, and an `inner` that already carries an alpha is the case
    // that used to come back black.
    glow(
      ctx,
      x,
      y - u * 11.0,
      u * 8.0 * (0.82 + 0.18 * pulse),
      withAlpha(SCREW_COOL, 0.5 * k),
      withAlpha(SCREW_COOL, 0.18 * k),
    );

    // The vortex. It **widens** as it climbs, which is the opposite of the
    // first pass and is the only version that survives: at her shoulders it is
    // narrower than she is and hidden, and above her head — where the hitbox
    // is and where there is nothing else to draw over it — it is wider than
    // she is, so the two flanks of every band are in clear air.
    ctx.fillStyle = withAlpha(SCREW_COOL, 0.3 * k);
    ctx.beginPath();
    ctx.moveTo(x - u * 1.2, base);
    ctx.lineTo(x - halfWidth, apex);
    ctx.lineTo(x + halfWidth, apex);
    ctx.lineTo(x + u * 1.2, base);
    ctx.closePath();
    ctx.fill();

    // Four bands biting up it and repeating, each as wide as the vortex is
    // where it sits, so they look wrapped round it rather than laid over.
    for (let i = 0; i < 4; i++) {
      const p = (frame * 0.2 + i / 4) % 1;
      const by = base - (base - apex) * p;
      const w = u * 1.2 + (halfWidth - u * 1.2) * p;
      const h = u * 1.0 * Math.abs(Math.cos(Math.PI * (p * 2 + i * 0.3)));
      ctx.strokeStyle = withAlpha(SCREW_COOL, 0.95 * k * pulse);
      ctx.lineWidth = Math.max(2, u * 0.46);
      ctx.beginPath();
      ctx.ellipse(x, by, w, h + u * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = withAlpha("#FFFFFF", 0.9 * k * pulse);
      ctx.lineWidth = Math.max(1, u * 0.18);
      ctx.beginPath();
      ctx.ellipse(x, by, w, h + u * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    return NOTHING;
  },

  /**
   * Missile: the exhaust.
   *
   * The missile itself is a projectile and is drawn by its own painter; what
   * belongs to the *move* is the launch — the flash off the rail on frame 18
   * and the smoke that hangs at the muzzle afterwards. The smoke is the part
   * that makes the launch read at a distance, and it is the reason this is not
   * just Charge Shot in orange.
   */
  sideB: ({ ctx, x, y, u, dir, frame }) => {
    const mx = x + u * 7.0 * dir;
    const my = y - u * 6.5;
    const k = decay(frame, 17, 6);
    if (k > 0) {
      muzzleCone(ctx, mx, my, dir, u * 4.6 * k, u * 2.0 * k, k, FIRE_PALE);
      blast(ctx, mx, my, u * 1.8, k, HOT, FIRE);
    }
    // Smoke: four puffs drifting back and up, thinning out over twenty frames.
    const s = decay(frame, 18, 22);
    if (s > 0) {
      for (let i = 0; i < 4; i++) {
        const age = (1 - s) * 22 - i * 3;
        if (age < 0) continue;
        ctx.fillStyle = withAlpha("#C9C2BC", 0.3 * s * (1 - i * 0.18));
        circle(
          ctx,
          mx - dir * u * (0.5 + age * 0.16),
          my - u * age * 0.09,
          u * (0.8 + age * 0.1),
        );
      }
    }
    return NOTHING;
  },

  /**
   * Screw Attack: the discharge.
   *
   * Rings, not a glow. The move is "a high-speed somersault while discharging
   * energy" and the energy is what the opponent is actually reading — three
   * bands wrapped round her that travel up the body and repeat, which is the
   * cheapest honest way to draw a helix on a rotating figure. They pulse on the
   * multihit's four-frame cadence so the thing has a rhythm rather than a hum.
   */
  upB: ({ ctx, x, y, u, frame }) => {
    if (frame > 30) return NOTHING;
    const live = frame >= 3 && frame <= 26;
    if (!live && frame > 26) {
      // A last flare off the launcher hit, then nothing.
      const k = decay(frame, 26, 5);
      glow(ctx, x, y - u * 7, u * 9 * k, withAlpha(SCREW, 0.6 * k), withAlpha(SCREW, 0.24 * k));
      return NOTHING;
    }
    if (!live) return NOTHING;

    const cy = y - u * 7.0;
    const pulse = 0.72 + 0.28 * Math.cos((frame % 4) * 1.6);

    // The discharge is the move. It has to be brighter and wider than she is,
    // or a spinning fighter with a faint outline round her reads as a fighter
    // who has been knocked over.
    glow(ctx, x, cy, u * 10.5 * pulse, withAlpha(SCREW_COOL, 0.6), withAlpha(SCREW_COOL, 0.22));
    glow(ctx, x, cy, u * 6.4, withAlpha(SCREW, 0.5 * pulse), withAlpha(SCREW, 0.2 * pulse));

    // Five bands riding up the body and wrapping round again. The ellipse's
    // height collapsing to nothing and opening out again is what sells a helix
    // seen edge-on; the width bulging at mid-height is what makes it a helix
    // round a *body* rather than a stack of hoops.
    for (let i = 0; i < 5; i++) {
      const p = (frame * 0.15 + i / 5) % 1;
      const by = cy + u * 6.2 - u * 12.4 * p;
      const w = u * (4.6 - 1.9 * Math.abs(p - 0.5) * 2);
      const h = u * 1.5 * Math.abs(Math.cos(Math.PI * (p * 2 + i * 0.25)));
      // Gold outside, white core — the other way round and five bands of white
      // read as smoke, which is what the first pass looked like.
      ctx.strokeStyle = withAlpha(SCREW, 0.95 * pulse);
      ctx.lineWidth = Math.max(3, u * 0.72);
      ctx.beginPath();
      ctx.ellipse(x, by, w, h + u * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = withAlpha("#FFFFFF", 0.9 * pulse);
      ctx.lineWidth = Math.max(1, u * 0.26);
      ctx.beginPath();
      ctx.ellipse(x, by, w, h + u * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // A hot core at the axis, so the rings look like they are wrapped around
    // something rather than floating.
    ctx.fillStyle = withAlpha("#FFFFFF", 0.55 * pulse);
    ctx.beginPath();
    ctx.ellipse(x, cy, u * 1.2, u * 6.0, 0, 0, Math.PI * 2);
    ctx.fill();
    return NOTHING;
  },

  /**
   * Bomb: the Morph Ball.
   *
   * This is the one move on her that replaces the figure. A humanoid rig folded
   * up is not a sphere and cannot be made into one by folding it harder, so for
   * the frames she is a ball the fighter is hidden and a ball is drawn instead —
   * the same escape hatch Kirby's Stone uses, and for the same reason.
   *
   * The pose either side does the transition, so the hidden window is only the
   * part that is genuinely spherical: frames 5 to 28, with the bomb generated on
   * frame 11 in the middle of it.
   */
  downB: ({ ctx, x, y, u, dir, frame }) => {
    const BALL_IN = 5;
    const BALL_OUT = 28;
    if (frame < BALL_IN || frame > BALL_OUT) return NOTHING;

    const r = u * 3.0;
    const cy = y - r;
    // Rolls on its own clock, in the direction she faces.
    const roll = frame * 0.22 * dir;

    // A puff on each transition, so the change is an event and not a cut.
    const k =
      frame < BALL_IN + 4
        ? decay(frame, BALL_IN, 4)
        : frame > BALL_OUT - 4
          ? 1 - decay(frame, BALL_OUT - 4, 4)
          : 0;
    if (k > 0) glow(ctx, x, cy, u * 6.4, withAlpha("#FFE0B0", 0.55 * k), withAlpha("#FFE0B0", 0.22 * k));

    ctx.fillStyle = "#2A1405";
    circle(ctx, x, cy, r * 1.09);
    ctx.fillStyle = "#E8701A";
    circle(ctx, x, cy, r);

    // Segment lines: three bands rotating with the roll. A featureless disc
    // does not read as rolling, and rolling is half of what says Morph Ball.
    ctx.strokeStyle = "#2B3138";
    ctx.lineWidth = Math.max(1.5, u * 0.38);
    for (let i = 0; i < 3; i++) {
      const a = roll + (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.ellipse(x, cy, r * 0.94, r * 0.94 * Math.abs(Math.cos(a)), 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The glass dome. Small and set forward — at 60% of the radius it swallowed
    // the segment lines and the ball read as a green eye.
    ctx.fillStyle = "#1F5C3E";
    ctx.beginPath();
    ctx.arc(x + dir * r * 0.24, cy - r * 0.16, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3CE08C";
    ctx.beginPath();
    ctx.arc(x + dir * r * 0.28, cy - r * 0.2, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    return HIDE;
  },

  /**
   * Grapple Beam.
   *
   * The reason the grab is frame 15 and not frame 6 is that the beam has
   * fourteen world units to cross, and that is exactly the thing you cannot see
   * unless the beam is drawn. It extends over the startup, holds while the grab
   * hitbox is live on frames 15–22, and snaps back after — so the picture and
   * the frame data say the same thing.
   *
   * **This does not draw yet, and the reason is not here.** `drawMoveFx` bails
   * unless `f.action` is `special`, `attack` or `throw`; a grab's action is
   * `grab`, so the lookup never happens. That excludes exactly the two moves on
   * the roster whose entire graphic is an effect — this beam and Link's
   * hookshot — and it is a one-line widening of that guard in `specialFx.ts` to
   * fix. Kept and finished rather than deleted, because the alternative is a
   * tether character who reaches with an empty hand.
   */
  grab: ({ ctx, x, y, u, dir, frame }) => {
    const REACH = 14.0;
    // Out by frame 15, held to 22, home by 30.
    const ext =
      frame < 4
        ? 0
        : frame <= 15
          ? (frame - 4) / 11
          : frame <= 22
            ? 1
            : Math.max(0, 1 - (frame - 22) / 8);
    if (ext <= 0) return NOTHING;

    const y0 = y - u * 6.5;
    const x0 = x + u * 6.2 * dir;
    const tip = x + u * (6.2 + (REACH - 6.2) * ext) * dir;

    // The tether: a bright core over a dim halo, plus segment beads, which is
    // what stops a long straight line reading as a rendering artefact.
    ctx.strokeStyle = withAlpha(PLASMA, 0.35);
    ctx.lineWidth = Math.max(2, u * 0.7);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(tip, y0);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#EAFBFF", 0.95);
    ctx.lineWidth = Math.max(1, u * 0.24);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(tip, y0);
    ctx.stroke();

    const beads = 7;
    ctx.fillStyle = withAlpha(PLASMA_PALE, 0.9);
    for (let i = 1; i <= beads; i++) {
      const bx = x0 + (tip - x0) * (i / (beads + 1));
      circle(ctx, bx, y0, u * 0.3);
    }
    // The claw at the end.
    ctx.fillStyle = "#EAFBFF";
    polygon(ctx, tip, y0, u * 0.95, 3, dir > 0 ? 0 : Math.PI);
    ctx.fill();
    glow(ctx, tip, y0, u * 2.4, withAlpha(PLASMA, 0.55), withAlpha(PLASMA, 0.22));
    return NOTHING;
  },

  /**
   * Up throw: the point-blank shot.
   *
   * She hoists them and fires into them from touching distance, and the flash is
   * the entire difference between this and every other up throw on the roster.
   * Hitbox is on frame 16 at (0, 9.0).
   */
  uthrow: ({ ctx, x, y, u, frame }) => {
    const k = decay(frame, 15, 8);
    if (k <= 0) return NOTHING;
    blast(ctx, x, y - u * 9.0, u * 3.4, k, HOT, FIRE);
    ctx.fillStyle = withAlpha(FIRE_PALE, 0.7 * k);
    // A short column straight up: the beam going through them.
    ctx.fillRect(x - u * 0.9 * k, y - u * 13.5, u * 1.8 * k, u * 5.5);
    return NOTHING;
  },
};

/* ------------------------------------------------------------ projectiles -- */

/** Painters for this fighter's own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
  /**
   * The Charge Shot itself.
   *
   * `charge` arrives as the damage multiplier — 1 for a tap, up to 5.6 fully
   * charged — and the ball is sized off it, because the one thing a player must
   * be able to do is tell a 5% pip from a 28% kill move *while it is in the
   * air*. Uncharged it is barely bigger than the muzzle; charged it is most of
   * her own height, which is what makes the shield-or-jump decision readable.
   */
  chargeShot: ({ ctx, u, age, dir, charge }) => {
    // Floor of 1.35 world units even uncharged: the hitbox is 2.5, and a pip
    // smaller than a pixel of its own hurtbox is a projectile players lose.
    const r = u * (1.35 + 0.4 * (charge - 1));
    // A wake behind it, longer the bigger it is.
    ctx.fillStyle = withAlpha(PLASMA, 0.3);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.75);
    ctx.lineTo(-dir * r * (2.6 + charge * 0.7), 0);
    ctx.lineTo(0, r * 0.75);
    ctx.closePath();
    ctx.fill();

    glow(ctx, 0, 0, r * 2.7, withAlpha(PLASMA_PALE, 0.85), withAlpha(PLASMA, 0.34));
    ctx.fillStyle = PLASMA;
    circle(ctx, 0, 0, r);
    // The core pulses on its own clock — a perfectly steady ball reads as a
    // sprite, a flickering one reads as contained energy.
    ctx.fillStyle = "#FFFFFF";
    circle(ctx, 0, 0, r * (0.45 + 0.08 * Math.sin(age * 0.9)));
  },

  /**
   * The missile.
   *
   * Nosed along its heading — the context arrives unrotated, so the rotation is
   * this painter's business. Body, dark nose cone, one fin, and an exhaust that
   * flickers per frame: at twenty pixels the flicker is what identifies it as
   * powered rather than as a thrown rock.
   */
  missile: ({ ctx, u, age, heading, frame }) => {
    ctx.rotate(heading);
    const L = u * 2.6;
    const w = u * 0.78;

    // Exhaust first, so the body paints over its root.
    const flick = 0.72 + 0.28 * Math.sin(frame * 1.7);
    ctx.fillStyle = withAlpha(FIRE, 0.55);
    ctx.beginPath();
    ctx.moveTo(-L, -w * 0.85);
    ctx.lineTo(-L - u * 2.6 * flick, 0);
    ctx.lineTo(-L, w * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha(HOT, 0.9);
    ctx.beginPath();
    ctx.moveTo(-L, -w * 0.45);
    ctx.lineTo(-L - u * 1.3 * flick, 0);
    ctx.lineTo(-L, w * 0.45);
    ctx.closePath();
    ctx.fill();

    // Fins.
    ctx.fillStyle = "#8E9AA4";
    ctx.beginPath();
    ctx.moveTo(-L * 0.9, -w);
    ctx.lineTo(-L * 1.35, -w * 2.1);
    ctx.lineTo(-L * 0.5, -w);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-L * 0.9, w);
    ctx.lineTo(-L * 1.35, w * 2.1);
    ctx.lineTo(-L * 0.5, w);
    ctx.closePath();
    ctx.fill();

    // Body and nose.
    ctx.fillStyle = "#DCE2E8";
    ctx.beginPath();
    ctx.moveTo(-L, -w);
    ctx.lineTo(L * 0.45, -w);
    ctx.lineTo(L, 0);
    ctx.lineTo(L * 0.45, w);
    ctx.lineTo(-L, w);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#C41E3A";
    ctx.beginPath();
    ctx.moveTo(L * 0.45, -w);
    ctx.lineTo(L, 0);
    ctx.lineTo(L * 0.45, w);
    ctx.closePath();
    ctx.fill();
    // A band, which is the only thing giving it a sense of length in flight.
    ctx.fillStyle = "#2B3138";
    ctx.fillRect(-L * 0.35, -w, u * 0.22, w * 2);
    void age;
  },

  /**
   * The Morph Ball bomb.
   *
   * Not the shared cartoon bomb with a fuse: a small dark sphere with a hot
   * band, which is what the Morph Ball drops. It lives 83 frames and detonates
   * at the end of them, so the band's blink accelerates as it runs out —
   * the timer is a hitbox the opponent has to read, and a bomb that looks the
   * same at frame 5 and frame 80 is a hitbox they cannot.
   */
  bomb: ({ ctx, u, age }) => {
    const life = Math.min(1, age / 83);
    const r = u * 1.35;
    // 6 frames a blink at the start, under 2 at the end.
    const period = Math.max(2, 7 - life * 5.5);
    const hot = Math.cos((age / period) * Math.PI * 2) > 0 ? 1 : 0.25;

    ctx.fillStyle = "#1B2026";
    circle(ctx, 0, 0, r);
    ctx.fillStyle = withAlpha(FIRE_PALE, 0.35 + 0.55 * hot);
    ctx.fillRect(-r, -r * 0.26, r * 2, r * 0.52);
    ctx.fillStyle = withAlpha(HOT, 0.5 + 0.5 * hot);
    circle(ctx, 0, 0, r * 0.34);
    if (hot > 0.5) glow(ctx, 0, 0, r * 3.2, withAlpha(FIRE, 0.35 + 0.3 * life), withAlpha(FIRE, 0.16));
  },
};
