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
import { toFloat } from "@/engine/fixed";
import type { MoveSlot } from "@/engine/types";

/* ---------------------------------------------------------------- palette -- */

/** Charge Shot plasma: cold, and the only cold thing she fires. */
const PLASMA = "#7FE0FF";
const PLASMA_PALE = "#BFF3FF";
/** Inside the plasma. The ball is not a flat cyan disc — it is a violet bloom
 *  behind a hard cyan rim, and the two-tone is most of what makes it read as
 *  contained energy rather than as a bubble. */
const VIOLET = "#A855F0";

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
  neutralB: ({ ctx, f, x, y, u, dir, frame }) => {
    const my = y - u * 7.0;
    const charge = Math.min(1, f.charge / SMASH_CHARGE_MAX);

    /**
     * Still holding it, as opposed to having just fired it.
     *
     * `f.charge` is **not** cleared when the shot leaves — `startAction` clears
     * it, which does not happen until the move ends — so `f.charge > 0` on its
     * own kept the ball hanging at the muzzle for the whole forty-one frames of
     * recovery, after the plasma had already crossed the stage and hit someone.
     * A capture of it shows her holding a fully charged shot while the shot she
     * fired is exploding on an opponent.
     *
     * The charge pins `actionFrame` to 1 and `frame` is `actionFrame + 1`, so
     * "she is still charging" is exactly `frame <= 2`, and the plasma leaves on
     * frame 3.
     */
    if (f.charge > 0 && frame <= 2) {
      /**
       * Radius runs 1.0 → 4.4 world units, so a full charge is **nine units
       * across against a twelve-unit fighter** — three quarters of her own
       * height. That is not exaggeration: measured off the game's own hurtbox
       * renders, the full-charge hitbox is 0.43× her height and the *drawn*
       * sphere is about twice the hitbox again. The previous 3.3 was half this,
       * which made a full charge look like a slightly bigger tap, and the one
       * decision a player has to make against Samus is exactly that
       * distinction.
       */
      const r = u * (1.0 + charge * 3.4);
      // Stood off the muzzle by its own radius rather than centred on it. The
      // cannon prop is four rig units across, so a ball centred on the bore has
      // its whole inboard half behind the barrel — painted under the fighter,
      // that half is simply not drawn, and a full charge came out looking like
      // a half one.
      const mx = x + dir * (u * 6.8 + r * 0.55);

      glow(
        ctx, mx, my, r * 2.1,
        withAlpha(PLASMA_PALE, 0.5 + 0.4 * charge),
        withAlpha(PLASMA, 0.28 + 0.2 * charge),
      );

      // The corona: jagged rays out past the ring, growing as it fills. Angles
      // are keyed off the global frame so it crackles rather than rotates.
      const spikes = 12;
      ctx.fillStyle = withAlpha(PLASMA, 0.45 + 0.25 * charge);
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2 + frame * 0.05;
        // Deterministic jitter — a sine of the index is enough to stop twelve
        // identical spikes reading as a cog.
        const len = r * (1.18 + 0.34 * charge * Math.abs(Math.sin(i * 2.4 + frame * 0.3)));
        const w = 0.09;
        ctx.beginPath();
        ctx.moveTo(mx + Math.cos(a - w) * r * 0.9, my + Math.sin(a - w) * r * 0.9);
        ctx.lineTo(mx + Math.cos(a) * len, my + Math.sin(a) * len);
        ctx.lineTo(mx + Math.cos(a + w) * r * 0.9, my + Math.sin(a + w) * r * 0.9);
        ctx.closePath();
        ctx.fill();
      }

      // Needles drawn *inward*, from a few diameters out. This is the most
      // distinctive particle on the move and the one that says the ball is
      // being fed rather than merely sitting there.
      ctx.strokeStyle = withAlpha(PLASMA_PALE, 0.55 + 0.3 * charge);
      ctx.lineWidth = Math.max(1, u * 0.12);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.257 + frame * 0.21;
        const far = r * (2.6 + ((i * 7 + frame) % 11) * 0.16);
        const near = far - r * 1.1;
        ctx.beginPath();
        ctx.moveTo(mx + Math.cos(a) * far, my + Math.sin(a) * far);
        ctx.lineTo(mx + Math.cos(a) * near, my + Math.sin(a) * near);
        ctx.stroke();
      }

      // The sphere itself: violet body, crisp cyan rim, white core. The violet
      // is the one warm-ish colour she is allowed and it is not a licence —
      // the charging ball really is magenta inside a hard cyan outline, and a
      // flat cyan disc was the thing that made it read as a bubble.
      ctx.fillStyle = withAlpha(VIOLET, 0.92);
      circle(ctx, mx, my, r);
      ctx.strokeStyle = withAlpha(PLASMA, 0.95);
      ctx.lineWidth = Math.max(2, u * 0.28);
      ctx.beginPath();
      ctx.arc(mx, my, r * 0.97, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      circle(ctx, mx, my, r * (0.3 + 0.16 * charge));
      return NOTHING;
    }

    // The shot leaving. Frame 3 is the spawn; the flare covers it either side.
    const mx = x + u * 7.2 * dir;
    const k = decay(frame, 2, 7);
    if (k > 0) {
      muzzleCone(ctx, mx, my, dir, u * 5.5 * k, u * 2.4 * k, k, PLASMA_PALE);
      blast(ctx, mx, my, u * 2.6, k, "#FFFFFF", PLASMA);
    }
    // The steam plume. She is physically shoved backwards by her own shot and a
    // wall of white vents out behind her as it goes — wider and taller than she
    // is, and the reason a Charge Shot reads as heavy from across the stage.
    // It outlives the flash by a long way, which is what separates it from the
    // muzzle bloom rather than doubling it.
    const s = decay(frame, 3, 20);
    if (s > 0) {
      for (let i = 0; i < 6; i++) {
        const age = (1 - s) * 20 - i * 2.2;
        if (age < 0) continue;
        ctx.fillStyle = withAlpha("#E8F4FF", 0.26 * s * (1 - i * 0.11));
        circle(
          ctx,
          mx - dir * u * (1.2 + age * 0.42),
          my - u * (age * 0.1 - 1.2),
          u * (1.3 + age * 0.22),
        );
      }
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
    // The muzzle hitbox is live on frames 10 and 11 and nothing else. A decay
    // starting at 9 is brightest a frame *before* the attack exists and is
    // already fading through both active frames — measured off a contact sheet,
    // the blast is twice the area on frame 8 that it is on frame 10, so the
    // flash that reads "danger" fires before the danger and the hit lands
    // during the fade. Full across 10 and 11, then gone.
    const k = frame < 9 ? 0 : frame === 9 ? 0.5 : frame <= 11 ? 1 : Math.max(0, 1 - (frame - 11) / 7);
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
  dair: ({ ctx, x, y, u, dir, frame, over }) => {
    if (frame < 14 || frame > 30) return NOTHING;
    // 1 across the meteor window, tapering out to nothing at either end.
    const heat = frame < 19 ? (frame - 14) / 5 : frame <= 21 ? 1 : Math.max(0, 1 - (frame - 21) / 8);
    // The arc is swept about a pivot at her shoulder, so its inner half lies
    // *inside* her — painted under the figure, the only part of the sweep that
    // survived was the outer rim hanging in the air beside her, which reads as
    // a scuff on the background rather than as her own arm coming down. A swing
    // trail belongs in front of the body that made it: that is what every
    // fighting game does with a weapon trail, and what `over` is for.
    // Swept about her **shoulder** at the radius the muzzle actually travels,
    // rather than about a point in mid-air at a radius that reached the hitbox:
    // the old arc was a fat band hanging in clear air a body-width in front of
    // her, touching neither the cannon that made it nor the fighter it came
    // off. The engine's own swoosh already draws the reach; what belongs to
    // Samus is the warm trail of a gun coming over the top, so this one is
    // tighter and hotter and rides the path the muzzle took.
    //
    // It stops **short of the barrel** and inboard of it — 0.3 radians and 4.3
    // units against the muzzle's 0.9 radians at 5.5. Painting an effect over the fighter is what `over` is for and it
    // cuts both ways: swept all the way to the muzzle, the trail covered the
    // one thing the move is about, and the meteor frame came back as a fighter
    // with a gold band where her gun should be. A trail belongs behind the
    // leading edge, never on it.
    over(() => {
      ctx.save();
      kickArc(ctx, x, y - u * 8.6, dir, u * 5.4, u * 1.5, -1.15, 0.42, heat, FIRE);
      ctx.restore();
    });
    // The meteor spark stays *under* her — it is a point of impact below her
    // feet, not part of the swing, and painting it over the boots would put a
    // flare on top of the fighter rather than beneath her.
    /**
     * The meteor spark, and the frame it peaks on.
     *
     * It used to be `decay(frame, 18, 5)`, which is brightest on frame 18 and
     * two-fifths gone by 21 — so the biggest, whitest thing in the move fired
     * *before* the meteor window and faded through it. A critic counting hot
     * pixels off a contact sheet read frame 17 as the spike; the meteor is 19
     * to 21, and it is the entire reason anyone presses this button. Held flat
     * across all three, then dropped.
     */
    const meteor = frame < 19 ? 0 : frame <= 21 ? 1 : Math.max(0, 1 - (frame - 21) / 4);
    if (meteor > 0) {
      // Two and a half units under her boots, which is where the hitbox is.
      // At three units of radius the old one had its top edge a unit *above*
      // her feet and read as a flash on her own boot.
      blast(ctx, x + u * 1.0 * dir, y + u * 2.4, u * 2.5, meteor, HOT, FIRE);
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
  uair: ({ ctx, x, y, u, frame, over }) => {
    if (frame < 4 || frame > 20) return NOTHING;
    // Full through the multihit (5..17), one frame of lead-in, three of decay.
    const k = frame < 5 ? 0.5 : frame <= 17 ? 1 : Math.max(0.1, 1 - (frame - 17) / 3);
    const pulse = 0.7 + 0.3 * Math.cos((frame % 3) * 2.1);

    /**
     * Where the drill goes, and why this is the third answer.
     *
     * The hitbox is a 4-unit circle centred at (0, 13.5), so the graphic has to
     * live around there. Two other facts used to decide the shape and one of
     * them has stopped being true.
     *
     * Effects were painted **under** the fighter, so anything inside her
     * silhouette was simply not drawn — which is why the last pass built a cone
     * that *widened* as it climbed, 5.4 units across at the top against a
     * 2.3-unit half-width hurtbox, so that the only parts of it anyone ever saw
     * were the two flanks poking out past her shoulders. A contact sheet of it
     * is a pale wisp hooked round the outside of an orange lozenge: the drill's
     * whole centre, which is the part that says *drill*, was behind her.
     *
     * `over` is what fixes it, and this is the case it was added for. Painted
     * in front, the cone can be the shape a drill actually is — **widest at the
     * base and narrowing to a point** — wrapped round her body from the knees
     * up and coming to a tip in the middle of the hitbox. That also solves the
     * fact that has *not* changed: the port tag sits in the air above her head
     * and is painted over everything, so the part of the graphic up there is
     * now a 1-unit point rather than a 10-unit-wide band competing with it.
     */
    /**
     * High enough that the damage and the drawing are in the same place.
     *
     * The first version over the fighter ran from her knees to just over her
     * head, which put the cone's widest, brightest part at her *boots* — and a
     * reader shown that picture says the move hits underneath her. The hitbox
     * is a four-unit circle at (0, 13.5) on a 12.2-unit fighter, so it is
     * entirely above her shoulders; the cone runs 8 → 16.5 to sit in it, and
     * the widest band lands at her chest instead of her feet.
     */
    const base = y - u * 8.0;
    const apex = y - u * 16.5;
    const baseHalf = u * 2.9;
    const tipHalf = u * 0.45;
    /**
     * A beat on each of the five hits.
     *
     * The multihit lands on frames 5, 7, 10, 13 and 16 and every one of those
     * frames looked exactly like the one before it — the bands slide, nothing
     * ticks. A player being held in a multihit needs to be able to count the
     * hits, because counting them is how they know when to DI out of it.
     */
    const HITS = [5, 7, 10, 13, 16];
    const beat = 1 + 0.55 * Math.max(0, ...HITS.map((h) => decay(frame, h, 3)));

    // Behind her: a bloom, so the body is lit from inside the drill rather than
    // merely having one drawn on top of it. Both stops given explicitly —
    // `glow`'s default derives its middle stop from `inner`, and an `inner`
    // that already carries an alpha is the case that used to come back black.
    glow(
      ctx,
      x,
      y - u * 11.0,
      u * 7.0 * (0.82 + 0.18 * pulse),
      withAlpha(SCREW_COOL, 0.5 * k),
      withAlpha(SCREW_COOL, 0.18 * k),
    );

    over(() => {
      // The callback runs with whatever canvas state the renderer left, so it
      // owns its own save/restore rather than inheriting one.
      ctx.save();

      // The vortex body, kept faint — she is inside this, and a solid cone
      // painted over a fighter is a fighter who has been deleted. What makes it
      // read as a cone rather than as a haze is its two **edges**: a translucent
      // fill has no silhouette, and the silhouette is the drill.
      ctx.fillStyle = withAlpha(SCREW_COOL, 0.16 * k);
      ctx.beginPath();
      ctx.moveTo(x - baseHalf, base);
      ctx.lineTo(x - tipHalf, apex);
      ctx.lineTo(x + tipHalf, apex);
      ctx.lineTo(x + baseHalf, base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = withAlpha("#FFFFFF", 0.55 * k * pulse);
      ctx.lineWidth = Math.max(1, u * 0.2);
      ctx.beginPath();
      ctx.moveTo(x - baseHalf, base);
      ctx.lineTo(x - tipHalf, apex);
      ctx.moveTo(x + baseHalf, base);
      ctx.lineTo(x + tipHalf, apex);
      ctx.stroke();

      // Five bands biting up it and repeating, each as wide as the cone is
      // where it sits, so they read as wrapped round it rather than laid over.
      // The ellipse height collapsing and opening is the near and far side of
      // one helix seen edge-on.
      for (let i = 0; i < 4; i++) {
        const raw = (frame * 0.2 + i / 4) % 1;
        // Bunched toward the tip, the way a drill's flutes are: evenly spaced
        // rings up a cone read as a stack of hoops, and a stack of hoops is
        // what the last pass looked like.
        const p = raw * raw * 0.55 + raw * 0.45;
        const by = base - (base - apex) * p;
        const w = baseHalf + (tipHalf - baseHalf) * p;
        const h = u * 0.7 * Math.abs(Math.cos(Math.PI * (p * 2 + i * 0.3)));
        ctx.strokeStyle = withAlpha(SCREW_COOL, Math.min(1, 0.95 * k * pulse * beat));
        ctx.lineWidth = Math.max(2, u * 0.4 * beat);
        ctx.beginPath();
        ctx.ellipse(x, by, w, h + u * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = withAlpha("#FFFFFF", 0.9 * k * pulse);
        ctx.lineWidth = Math.max(1, u * 0.18);
        ctx.beginPath();
        ctx.ellipse(x, by, w, h + u * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // The point. A drill is a drill because it comes to one, and this is the
      // only part of the graphic sitting in the middle of the hitbox.
      ctx.fillStyle = withAlpha("#FFFFFF", Math.min(1, 0.85 * k * pulse * beat));
      ctx.beginPath();
      ctx.moveTo(x - tipHalf * 1.6 * beat, apex + u * 1.6);
      ctx.lineTo(x, apex - u * 0.9 * beat);
      ctx.lineTo(x + tipHalf * 1.6 * beat, apex + u * 1.6);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    });
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
      // Wider than she is at every height rather than only at the waist: a
      // helix that is narrower than the fighter for most of its run reads as a
      // stack of wavy lines beside her — a stink line, not a discharge.
      const w = u * (6.2 - 1.9 * Math.abs(p - 0.5) * 2);
      const h = u * 1.5 * Math.abs(Math.cos(Math.PI * (p * 2 + i * 0.25)));
      // Gold outside, white core — the other way round and five bands of white
      // read as smoke, which is what the first pass looked like.
      ctx.strokeStyle = withAlpha(SCREW, 0.95 * pulse);
      ctx.lineWidth = Math.max(3, u * 0.9);
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

    // 2.2 units, so the ball is 4.4 across against a 12.2-unit fighter —
    // 0.36 of her height, which is what it measures in the game. It was 3.0,
    // half again as big, and a Morph Ball the size of her chest reads as a
    // beach ball rather than as a woman folded up.
    const r = u * 2.2;
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
    if (k > 0) glow(ctx, x, cy, u * 5.4, withAlpha("#FFE0B0", 0.55 * k), withAlpha("#FFE0B0", 0.22 * k));

    ctx.fillStyle = "#2A1405";
    circle(ctx, x, cy, r * 1.09);
    ctx.fillStyle = "#E8901A";
    circle(ctx, x, cy, r);

    /**
     * Three lobes meeting at a light in the centre.
     *
     * The ball was a disc with three latitude rings round it and a green dome
     * set off to one side — which reads as a helmet lying on the floor, and at
     * match scale the dome read as an eye. The real one is a glassy amber
     * sphere with a **three-lobed radial structure** inside it, salmon petals
     * meeting at a small bright green-yellow lamp at the exact centre. Radial,
     * not banded: that is the difference between a ball and a planet.
     */
    ctx.fillStyle = "#D9542A";
    for (let i = 0; i < 3; i++) {
      const a = roll + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.arc(x, cy, r * 0.9, a - 0.42, a + 0.42);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#2A1405";
    circle(ctx, x, cy, r * 0.3);
    ctx.fillStyle = "#C8F76A";
    circle(ctx, x, cy, r * 0.2);

    /**
     * The chrome hoop.
     *
     * The single most identifying thing about the Morph Ball in motion, and the
     * thing the old version had nothing of: a thin bright ring, slightly larger
     * than the ball and clearly separate from it, **tilted and spinning**, its
     * projected ellipse changing every frame. The ball body barely turns; the
     * hoop does all the rotational work, and without it a static sphere sitting
     * on the floor has no way to say it is alive.
     */
    ctx.strokeStyle = "#F2F6FA";
    ctx.lineWidth = Math.max(1.5, u * 0.22);
    ctx.beginPath();
    ctx.ellipse(x, cy, r * 1.16, r * 1.16 * Math.abs(Math.cos(roll)), -0.35 * dir, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#9FD8FF", 0.7);
    ctx.lineWidth = Math.max(1, u * 0.1);
    ctx.beginPath();
    ctx.ellipse(x, cy, r * 1.16, r * 1.16 * Math.abs(Math.cos(roll)), -0.35 * dir, 0, Math.PI * 2);
    ctx.stroke();
    return HIDE;
  },

  /**
   * Grapple Beam.
   *
   * One of the two moves on the roster whose **entire graphic is the effect**.
   * The reason the grab is frame 15 and not frame 6 is that the beam has
   * fourteen world units to cross, and that is exactly the thing nobody can see
   * unless the beam is drawn.
   *
   * ## Read at match scale, not at lab scale
   *
   * The first version of this was geometrically right and invisible: a 0.24-unit
   * core inside a 0.7-unit halo is three pixels and eight pixels at the zoom a
   * match is actually played at, which over a night stage is a dotted line — a
   * laser sight, not a tether. SmashWiki calls it "a bright blue energy beam",
   * and *bright* and *beam* are both load-bearing. It is now a 1.2-unit shaft
   * with a 0.45-unit white core and beads a rig unit across, which is about a
   * third of the thickness of her own forearm — thin for a limb, unmissable for
   * a line.
   *
   * ## Where it goes comes from the move
   *
   * Reach, extension frame and hold window are read off the grab's own hitbox
   * rather than written here. That matters because there are **two** of these:
   * a standing grab that reaches 14 units and is live on frames 15–22, and a
   * dash grab that reaches 15 and is live on 17–24, sharing this one painter.
   * Hard-coding the standing numbers put the dash grab's tether on its way home
   * two frames before the move stopped grabbing.
   */
  grab: ({ ctx, def, f, x, y, u, dir, frame }) => {
    const move = def.moves[f.move ?? "grab"] ?? def.moves.grab;
    const box = move?.hitboxes[0];
    // The claw goes on the **leading edge** of the grab box, not its centre:
    // the box has a radius and anything the far side of it is caught, so
    // stopping the graphic at the centre draws a tether shorter than the move.
    const reach = box ? toFloat(box.x) + toFloat(box.radius) * 0.55 : 14.0;
    const out = box ? box.startFrame : 15;
    const held = box ? box.endFrame : 22;
    // The muzzle the beam leaves from. 6.2 left a gap of clear background
    // between the bore and the first bead, and on the early frames the claw and
    // its halo floated in mid-air attached to nothing — which reads as her
    // having fired a small blue ball, i.e. as her neutral special.
    const MUZZLE = 7.1;
    const y0 = y - u * (box ? toFloat(box.y) : 6.5);
    // Out by the frame the grab becomes live, held for as long as it is, home
    // eight frames later.
    const ext =
      frame < 4
        ? 0
        : frame <= out
          ? (frame - 4) / (out - 4)
          : frame <= held
            ? 1
            : Math.max(0, 1 - (frame - held) / 8);
    if (ext <= 0) return NOTHING;

    const x0 = x + u * MUZZLE * dir;
    const tip = x + u * (MUZZLE + (reach - MUZZLE) * ext) * dir;

    // A wide dim halo, a shaft, then a white core: three passes, because a
    // single stroke of any width is a drawn line and three concentric ones are
    // something glowing.
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(PLASMA, 0.28);
    ctx.lineWidth = Math.max(6, u * 2.0);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(tip, y0);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(PLASMA, 0.85);
    ctx.lineWidth = Math.max(3, u * 1.2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(tip, y0);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#EAFBFF", 0.95);
    ctx.lineWidth = Math.max(2, u * 0.45);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(tip, y0);
    ctx.stroke();

    // Segment beads, spaced by distance rather than by count, so the beam has
    // the same texture half-extended as fully extended instead of the beads
    // sliding along it as it grows.
    const span = Math.abs(tip - x0) / u;
    const beads = Math.max(2, Math.round(span / 1.7));
    ctx.fillStyle = withAlpha(PLASMA_PALE, 0.95);
    for (let i = 1; i <= beads; i++) {
      const bx = x0 + (tip - x0) * (i / (beads + 1));
      circle(ctx, bx, y0, u * 0.5);
    }

    /**
     * The grapnel, and the one frame that says it caught.
     *
     * The prongs are **open while it travels and shut once it can grab**. Every
     * frame of this move looked identical — extended by frame 12, flat through
     * to 22, nothing marking the frame the hitbox goes live — so a whiff and a
     * catch were the same picture. Closing the claw on the frame the grab
     * starts, with a flash on that frame alone, is the contact tell the move
     * did not have.
     */
    const live = frame >= out ? 1 : 0;
    const snap = decay(frame, out, 4);
    ctx.save();
    ctx.translate(tip, y0);
    ctx.scale(dir, 1);
    ctx.fillStyle = "#EAFBFF";
    polygon(ctx, 0, 0, u * 0.85, 6, 0);
    ctx.fill();
    ctx.strokeStyle = "#EAFBFF";
    ctx.lineWidth = Math.max(2, u * 0.36);
    ctx.lineCap = "round";
    // 1 wide open, 0 shut.
    const gape = 1 - live * 0.78;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-u * 0.2, side * u * 0.35);
      ctx.quadraticCurveTo(u * 1.1, side * u * 1.5 * gape, u * 1.9, side * u * 0.75 * gape);
      ctx.stroke();
    }
    ctx.restore();
    // Tight, so the tip does not read as a small charged shot on the frames it
    // is still travelling; and a hard flash on the frames it can catch.
    glow(ctx, tip, y0, u * (1.8 + 2.6 * snap), withAlpha(PLASMA_PALE, 0.45 + 0.45 * snap), withAlpha(PLASMA, 0.2));
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
    // Floor of 1.4 world units even uncharged: the hitbox is 2.5, and a pip
    // smaller than a pixel of its own hurtbox is a projectile players lose. The
    // top end matches the ball she was holding — a shot that shrinks the
    // instant it leaves the barrel is the tell that the two were drawn by
    // different hands.
    const r = u * (1.4 + 0.62 * (charge - 1));
    // A comet tail, longer the bigger it is.
    ctx.fillStyle = withAlpha(PLASMA, 0.3);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.75);
    ctx.lineTo(-dir * r * (2.6 + charge * 0.7), 0);
    ctx.lineTo(0, r * 0.75);
    ctx.closePath();
    ctx.fill();

    glow(ctx, 0, 0, r * 2.7, withAlpha(PLASMA_PALE, 0.85), withAlpha(PLASMA, 0.34));
    // Same construction as the ball at the muzzle: violet body, hard cyan rim,
    // white core.
    ctx.fillStyle = VIOLET;
    circle(ctx, 0, 0, r);
    ctx.strokeStyle = PLASMA;
    ctx.lineWidth = Math.max(2, u * 0.26);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2);
    ctx.stroke();
    // The core pulses on its own clock — a perfectly steady ball reads as a
    // sprite, a flickering one reads as contained energy.
    ctx.fillStyle = "#FFFFFF";
    circle(ctx, 0, 0, r * (0.4 + 0.08 * Math.sin(age * 0.9)));
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
    // 1.25 units, so it is a bit over half the Morph Ball's diameter and about
    // a fifth of her height — the proportion it has in the game, and the one
    // that keeps it distinguishable from the ball that laid it.
    const r = u * 1.25;
    // 6 frames a blink at the start, under 2 at the end.
    const period = Math.max(2, 7 - life * 5.5);
    const hot = Math.cos((age / period) * Math.PI * 2) > 0 ? 1 : 0.25;

    // Dark crimson shell with a metallic rim. It was near-black with a hot
    // band across the middle, which is a cartoon bomb seen edge-on; the real
    // one is a small dark-red mine.
    ctx.fillStyle = "#7A1220";
    circle(ctx, 0, 0, r);
    ctx.strokeStyle = "#8E9AA4";
    ctx.lineWidth = Math.max(1, u * 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.93, 0, Math.PI * 2);
    ctx.stroke();

    // Four spokes in a cross, quartering the shell. This is the shape that
    // identifies it at twenty pixels — a plain dark disc with a light in it is
    // every projectile on the roster.
    ctx.strokeStyle = "#2A0A12";
    ctx.lineWidth = Math.max(1.5, u * 0.24);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.28, Math.sin(a) * r * 0.28);
      ctx.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
      ctx.stroke();
    }

    // The lens, which is also the timer.
    ctx.fillStyle = withAlpha("#FFC8E0", 0.45 + 0.55 * hot);
    circle(ctx, 0, 0, r * 0.42);
    ctx.fillStyle = withAlpha(HOT, 0.5 + 0.5 * hot);
    circle(ctx, 0, 0, r * 0.24);
    if (hot > 0.5) glow(ctx, 0, 0, r * 3.2, withAlpha(FIRE, 0.35 + 0.3 * life), withAlpha(FIRE, 0.16));
  },
};
