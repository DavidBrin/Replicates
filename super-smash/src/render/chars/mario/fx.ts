/**
 * mario: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 *
 * Two things about the frame numbers, because both are silent when wrong.
 * `frame` here is `moveFrameOf(actionFrame)`, i.e. `actionFrame + 1`, which is
 * the number the frame data quotes — so a hitbox listed as live on 15–17 is
 * live when `frame` is 15 to 17 and no arithmetic is needed. And nothing below
 * calls `Math.random()`: the renderer can be asked to draw the same simulation
 * frame twice, and an effect that reshuffles itself between the two flickers.
 */

import {
  NOTHING,
  circle,
  crescent,
  glow,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

/**
 * A lobed blob, for fire.
 *
 * A circle reads as a ball and a ball does not read as flame at any size. What
 * does is an outline whose radius varies around the turn on two
 * incommensurable sinusoids, re-evaluated every frame so the tongues crawl.
 * The amplitude is modulated round the circle rather than constant: evenly
 * spaced lobes read unmistakably as a Super Star.
 */
function flame(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  phase: number,
  stretch = 1,
): void {
  const N = 40;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const tongue = Math.max(0, Math.sin(a * 5 + phase));
    const amp = 0.26 * (0.45 + 0.55 * Math.cos(a * 2 + phase * 0.4));
    const w = r * (1 + amp * tongue ** 1.5 + 0.05 * Math.sin(a * 3 - phase));
    const px = cx + Math.cos(a) * w * stretch;
    const py = cy + Math.sin(a) * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Forward smash, the fire palm.
   *
   * The 17.8% half of this move is a radius-5 fire hitbox centred 8.6 units in
   * front of him at chest height; the 14.7% half is his forearm — the *close*
   * hit is the weak one. So the graphic goes where the fire hitbox actually is
   * at the size it actually is. Matching them is what makes a move honest to
   * fight, and mismatching them is the single commonest reason a replicate
   * feels wrong to someone who plays the original.
   *
   * Before it, an ember gathering in the cocked palm — behind his hip, which
   * is where the hand is during the wind-up, not out in front where it ends
   * up. A charge with no tell is a charge nobody has to respect.
   */
  fsmash: ({ ctx, x, y, u, dir, frame }) => {
    ctx.save();
    if (frame < 15) {
      const k = Math.min(1, frame / 14);
      const px = x - u * 3.0 * dir;
      const py = y - u * 6.5;
      glow(ctx, px, py, u * (0.9 + 2.0 * k), withAlpha("#FF9A1F", 0.2 + 0.34 * k));
      ctx.fillStyle = withAlpha("#FFE49A", 0.55 * k);
      circle(ctx, px, py, u * 0.55 * k);
      ctx.restore();
      return NOTHING;
    }

    const age = frame - 15;
    if (age > 9) {
      ctx.restore();
      return NOTHING;
    }
    // Blooms over two frames, holds for the three live ones, then decays.
    const grow = Math.min(1, (age + 1) / 2.5);
    const fade = age <= 3 ? 1 : 1 - (age - 3) / 7;
    const cx = x + u * 7.6 * dir;
    const cy = y - u * 6.9;
    const r = u * 4.4 * grow;
    const phase = frame * 0.9;

    ctx.globalAlpha = fade;
    // The throat of the blast, back along the arm, so it reads as coming *from*
    // him rather than as a fireball someone parked in front of him.
    const throat = ctx.createLinearGradient(x + u * 2.2 * dir, y - u * 6.7, cx, cy);
    throat.addColorStop(0, withAlpha("#FFF3C4", 0.9));
    throat.addColorStop(1, withAlpha("#FF6A18", 0.15));
    ctx.fillStyle = throat;
    ctx.beginPath();
    ctx.moveTo(x + u * 2.2 * dir, y - u * 6.3);
    ctx.lineTo(cx, cy + r * 0.55);
    ctx.lineTo(cx, cy - r * 0.55);
    ctx.lineTo(x + u * 2.2 * dir, y - u * 7.1);
    ctx.closePath();
    ctx.fill();

    glow(ctx, cx, cy, r * 1.7, withAlpha("#FF6A18", 0.5));
    ctx.fillStyle = withAlpha("#E5352B", 0.88);
    flame(ctx, cx, cy, r, phase, 1.12);
    ctx.fillStyle = withAlpha("#FF9A1F", 0.95);
    flame(ctx, cx, cy, r * 0.7, phase * 1.4 + 2, 1.12);
    ctx.fillStyle = "#FFF3C4";
    flame(ctx, cx, cy, r * 0.32, phase * 1.9 + 4, 1.18);
    ctx.restore();
    return NOTHING;
  },

  /**
   * Down smash, the breakdance sweep.
   *
   * Dust rather than energy: this is a leg on a floor. Front pass on frames
   * 5–6 and back pass on 14, matching the two hitboxes, each fading inside
   * five frames so the two reads stay separate — a single arc spanning both
   * would say one long sweep, which is the opposite of what the move does.
   */
  dsmash: ({ ctx, x, y, u, dir, frame }) => {
    const pass = (start: number, side: number) => {
      const age = frame - start;
      if (age < 0 || age > 5) return;
      const fade = (1 - age / 5) * 0.55;
      const spread = 0.5 + age * 0.22;
      ctx.save();
      ctx.fillStyle = withAlpha("#D9CFC0", fade);
      const cx = x;
      const cy = y - u * 1.5;
      const mid = side > 0 ? 0 : Math.PI;
      crescent(ctx, cx, cy, u * (3.4 + age * 0.5), u * 1.5, mid - spread, mid + spread);
      ctx.fill();
      ctx.restore();
    };
    pass(5, dir);
    pass(14, -dir);
    return NOTHING;
  },

  /**
   * Neutral special, Fireball: the heat left in the glove.
   *
   * Three frames, and only from the frame the ball exists. The real move has
   * no telegraph, and anything painted before frame 17 would lie about how
   * safe it is to challenge.
   */
  neutralB: ({ ctx, x, y, u, dir, frame }) => {
    const since = frame - 17;
    if (since < 0 || since > 2) return NOTHING;
    const px = x + dir * u * 4.4;
    const py = y - u * 6.1;
    ctx.save();
    ctx.globalAlpha = 1 - since / 3;
    glow(ctx, px, py, u * (0.85 + since * 0.24), "rgba(255,236,176,0.75)", "rgba(255,132,32,0.3)");
    ctx.restore();
    return NOTHING;
  },

  /**
   * Side special, Cape.
   *
   * The cape is the move. Mario is not wearing one when he is standing, so it
   * exists nowhere on the rig and there is no prop that could carry it — the
   * only place it can come from is here, and without it the animation is a man
   * waving at nothing.
   *
   * It sweeps from behind him, over the top, to held out in front: eight
   * frames of travel arriving on frame 12, which is the frame the hitbox and
   * the reflector go live, then a few frames of it hanging and folding away.
   * Red outside, yellow lining showing on the inner face as it turns over.
   */
  sideB: ({ ctx, x, y, u, dir, frame }) => {
    if (frame < 4 || frame > 26) return NOTHING;
    // Eight frames of travel arriving on 12, then it hangs and folds away.
    // Eased so it is slow behind him and fast through the front, which is what
    // a flourish does and what puts the fabric where the hitbox is on 12.
    const travel = Math.min(1, Math.max(0, (frame - 5) / 9));
    const p = 1 - (1 - travel) ** 2;
    const a = ((150 - 190 * p) * Math.PI) / 180;
    const fold = frame <= 16 ? 1 : Math.max(0, 1 - (frame - 16) / 10);

    // The anchor travels with the hand, from the shoulder out to full reach.
    // Anchoring it at the shoulder throughout was the first version and it is
    // invisible: the sweep finishes *in front of his chest*, effects paint
    // under the fighter, and the cape's red is within a few percent of the
    // shirt's — so the whole graphic vanished on exactly the three frames the
    // hitbox is live. Hung off the hand it is always clear of the body.
    const ax = x + u * dir * (-0.7 + 5.4 * p);
    const ay = y - u * (7.3 - 0.9 * p);
    // Gathered at the start and flung out straight by the end, so the biggest
    // shape lands on frames 12–14 — the ones the hitbox and the reflector are
    // actually live for, rather than four frames before them.
    const R = u * (4.2 + 3.0 * travel) * (0.62 + 0.38 * fold);
    const spread = (86 * Math.PI) / 180;

    const fan = (rad: number, from: number, to: number, ripple: number) => {
      const N = 12;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const ang = a + from + (to - from) * k;
        // A bulged outer edge with a slow ripple travelling along it: a sector
        // with a straight edge reads as a slice of pizza, not as cloth.
        const rr = rad * (0.66 + 0.34 * Math.sin(Math.PI * k)) * (1 + ripple * Math.sin(k * 5.5 + frame * 0.7));
        ctx.lineTo(ax + Math.cos(ang) * rr * dir, ay - Math.sin(ang) * rr);
      }
      ctx.closePath();
    };

    ctx.save();
    ctx.globalAlpha = 0.96 * fold;
    // A deeper red than the shirt (#E52521) on purpose. Where the two overlap
    // the cape has to still be a separate object, and two reds four percent
    // apart are one shape.
    ctx.fillStyle = "#B31C14";
    fan(R, 0, spread, 0.075);
    ctx.fill();
    // The lining, along the leading half — what you see of the inside of a
    // cape as it turns over, and the only part of this graphic that is not
    // some shade of the colour he is already wearing.
    ctx.fillStyle = "#F2C230";
    fan(R * 0.66, spread * 0.06, spread * 0.5, 0.05);
    ctx.fill();
    ctx.restore();
    return NOTHING;
  },

  /**
   * Up special, Super Jump Punch: the coins.
   *
   * The single most recognisable thing about the move, and the pose cannot say
   * it. Eight of them, staggered off their own index so they do not leave in a
   * rank, thrown up and out and pulled back down — and drawn as ellipses whose
   * width oscillates, because a coin that does not turn edge-on is a disc and
   * a disc is not a coin.
   */
  upB: ({ ctx, x, y, u, dir, frame }) => {
    if (frame < 3 || frame > 34) return NOTHING;
    ctx.save();
    for (let i = 0; i < 9; i++) {
      const born = 3 + (i % 5) * 2;
      const age = frame - born;
      if (age < 0 || age > 14) continue;
      const life = Math.min(1, (14 - age) / 6);
      const side = i % 2 === 0 ? 1 : -1;
      // Thrown out from the fist rather than from the chest, and kept close:
      // coins that scatter to the edge of the screen read as debris.
      const spread = 0.3 + 0.16 * (i % 3);
      const rise = 0.5 + 0.12 * ((i * 5) % 3);
      const px = x + dir * u * side * spread * age * 0.62;
      const py = y - u * (8.4 + rise * age - 0.042 * age * age);
      const turn = Math.abs(Math.cos(age * 0.5 + i * 1.3));

      ctx.globalAlpha = life;
      ctx.fillStyle = "#B07A00";
      ctx.beginPath();
      ctx.ellipse(px, py, u * (0.16 + 0.66 * turn), u * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFE45C";
      ctx.beginPath();
      ctx.ellipse(px, py, u * (0.08 + 0.44 * turn), u * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return NOTHING;
  },

  /**
   * Down special, F.L.U.D.D.
   *
   * Two graphics, and the pack is the more important one: the water is only
   * legible for the last third of the move, whereas the pump on his back is
   * what tells you which special he threw out from the first frame. Effects
   * are painted *under* the fighter, which suits a backpack exactly — it wants
   * to be behind him — so the tank sits past his back and the nozzle clears
   * his shoulder rather than hiding behind it.
   *
   * The stream is deliberately weak. F.L.U.D.D. deals **no damage at all**;
   * it pushes. A graphic that looked like a beam attack would be a lie about
   * what the move does, and a player who learns to respect it will lose stocks
   * to that lie.
   */
  downB: ({ ctx, x, y, u, dir, frame, total }) => {
    ctx.save();
    const appear = Math.min(1, frame / 5);
    const leave = Math.min(1, (total - frame) / 6);
    ctx.globalAlpha = Math.min(appear, leave);

    // The tank, behind the shoulders.
    const tx = x - u * 2.7 * dir;
    const ty = y - u * 7.4;
    const tw = u * 1.5;
    const th = u * 2.1;
    ctx.fillStyle = "#2A1810";
    ctx.beginPath();
    ctx.roundRect(tx - tw - u * 0.16, ty - th - u * 0.16, (tw + u * 0.16) * 2, (th + u * 0.16) * 2, u * 0.8);
    ctx.fill();
    ctx.fillStyle = "#E4ECF2";
    ctx.beginPath();
    ctx.roundRect(tx - tw, ty - th, tw * 2, th * 2, u * 0.7);
    ctx.fill();
    ctx.fillStyle = "#3B7BD9";
    ctx.beginPath();
    ctx.roundRect(tx - tw, ty - th * 0.25, tw * 2, th * 0.5, u * 0.2);
    ctx.fill();
    ctx.fillStyle = "#8FB6E8";
    circle(ctx, tx + u * 0.2 * dir, ty - th * 0.55, u * 0.42);

    // The nozzle, up over the shoulder and pointing forward. It has to clear
    // the head, not sit behind it: effects paint *under* the fighter, so a
    // nozzle at shoulder height is a nozzle nobody ever sees.
    ctx.save();
    ctx.translate(x - u * 3.1 * dir, y - u * 9.5);
    ctx.scale(dir, 1);
    ctx.fillStyle = "#2A1810";
    ctx.beginPath();
    ctx.roundRect(-u * 0.5, -u * 0.72, u * 3.4, u * 1.44, u * 0.5);
    ctx.fill();
    ctx.fillStyle = "#E4ECF2";
    ctx.beginPath();
    ctx.roundRect(-u * 0.34, -u * 0.56, u * 3.1, u * 1.12, u * 0.4);
    ctx.fill();
    ctx.fillStyle = "#FFCC00";
    ctx.beginPath();
    ctx.roundRect(u * 2.2, -u * 0.44, u * 0.7, u * 0.88, u * 0.2);
    ctx.fill();
    ctx.restore();

    // The stream, from the nozzle Mario is holding out in front.
    const fire = frame - Math.round(total * 0.52);
    if (fire < 0) {
      ctx.restore();
      return NOTHING;
    }
    const ox = x + u * 3.4 * dir;
    const oy = y - u * 5.9;
    const reach = u * 20 * Math.min(1, (fire + 1) / 5);

    ctx.globalAlpha = 0.62 * Math.min(1, leave);
    const g = ctx.createLinearGradient(ox, oy, ox + reach * dir, oy);
    g.addColorStop(0, "#F2FAFF");
    g.addColorStop(0.35, withAlpha("#7CC2FF", 0.75));
    g.addColorStop(1, "rgba(96,178,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ox, oy - u * 1.3);
    ctx.lineTo(ox + reach * dir, oy - u * 4.6);
    ctx.lineTo(ox + reach * dir, oy + u * 4.6);
    ctx.lineTo(ox, oy + u * 1.3);
    ctx.closePath();
    ctx.fill();

    // Streaks inside it, on their own phase, so the cone reads as water
    // travelling rather than as a translucent triangle.
    ctx.strokeStyle = withAlpha("#FFFFFF", 0.45);
    ctx.lineWidth = Math.max(1, u * 0.16);
    for (let i = 0; i < 5; i++) {
      const s = ((fire * 0.16 + i * 0.2) % 1);
      const lead = s * reach;
      const spread = u * 3.4 * s;
      const off = ((i % 3) - 1) * spread * 0.6;
      ctx.beginPath();
      ctx.moveTo(ox + lead * dir, oy + off);
      ctx.lineTo(ox + (lead + reach * 0.14) * dir, oy + off * 1.2);
      ctx.stroke();
    }
    // Spatter at the nozzle.
    ctx.fillStyle = withAlpha("#EAF6FF", 0.5);
    for (let i = 0; i < 3; i++) {
      const a = (fire * 0.4 + i * 2.1) % 6.283;
      circle(ctx, ox + Math.cos(a) * u * 0.9, oy + Math.sin(a) * u * 0.9, u * 0.3);
    }
    ctx.restore();
    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
  /**
   * The Fireball.
   *
   * It bounces, so it *rolls*: the rotation is on the projectile's own age and
   * has nothing to do with its heading, which is why the context arrives
   * unrotated. Everything that has an orientation — the trail, the ash — is
   * drawn before the rotate and stays in world space; only the ball turns.
   *
   * The lobes are unevenly weighted round the circle on purpose. Five evenly
   * spaced ones read unmistakably as a Super Star.
   */
  fireball: ({ ctx, u, age, dir, frame }) => {
    // Sized against its own hitbox, which is radius 2.6 world units. Drawn at
    // 1.5 it was visibly smaller than the thing it hits with, which is the
    // wrong way round for a projectile — a player should never be caught by a
    // fireball that looked like it went past.
    const r = u * 1.9;
    const puff = frame * 0.5;

    ctx.save();

    // Ash and smoke, trailing behind and rising.
    for (let i = 1; i <= 2; i++) {
      glow(
        ctx,
        -dir * r * (1.9 + i * 0.85),
        -r * (0.5 + i * 0.4) + r * 0.12 * Math.sin(puff + i * 1.7),
        r * (0.44 + i * 0.16),
        `rgba(66, 42, 30, ${(0.3 - i * 0.09).toFixed(2)})`,
        `rgba(74, 50, 38, ${(0.16 - i * 0.05).toFixed(2)})`,
      );
    }

    // The heat it throws. Before the trail, or it washes the flame out.
    glow(ctx, -dir * r * 0.1, 0, r * 1.75, "rgba(255,168,60,0.5)", "rgba(255,84,18,0.2)");

    for (let i = 0; i < 3; i++) {
      const lift = (i - 1) * 0.42;
      const len = r * (0.85 + 0.38 * Math.sin(puff + i * 2.1));
      const g = ctx.createLinearGradient(
        -dir * r * 0.85,
        0,
        -dir * (r * 0.85 + len),
        lift * r - len * 0.5,
      );
      g.addColorStop(0, "rgba(255,230,148,0.82)");
      g.addColorStop(0.4, "rgba(250,128,28,0.5)");
      g.addColorStop(1, "rgba(200,44,14,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-dir * r * 0.3, lift * r - r * 0.3);
      ctx.quadraticCurveTo(
        -dir * (r * 0.8 + len * 0.55),
        lift * r - r * 0.36 - len * 0.3,
        -dir * (r * 0.85 + len),
        lift * r - len * 0.5,
      );
      ctx.quadraticCurveTo(
        -dir * (r * 0.8 + len * 0.45),
        lift * r + r * 0.24,
        -dir * r * 0.3,
        lift * r + r * 0.3,
      );
      ctx.closePath();
      ctx.fill();
    }

    ctx.rotate(age * 0.3 * dir);

    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const tongue = Math.max(0, Math.sin(5 * a + puff * 0.3));
      const amp = 0.22 * (0.45 + 0.55 * Math.cos(2 * a + 1.3));
      const w = r * (1 + amp * tongue ** 1.5);
      const px = Math.cos(a) * w;
      const py = Math.sin(a) * w;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const body = ctx.createRadialGradient(-r * 0.24, -r * 0.26, r * 0.04, 0, 0, r * 1.16);
    body.addColorStop(0, "#FFF4D2");
    body.addColorStop(0.28, "#FFC42E");
    body.addColorStop(0.66, "#F26212");
    body.addColorStop(1, "#C9280C");
    ctx.fillStyle = body;
    ctx.fill();
    ctx.clip();

    // A lit side and a shaded side orbiting inside the outline. Without them a
    // spinning fireball and a still one are the same picture.
    const hot = ctx.createRadialGradient(-r * 0.36, -r * 0.36, 0, -r * 0.36, -r * 0.36, r * 0.72);
    hot.addColorStop(0, "rgba(255,255,244,1)");
    hot.addColorStop(0.42, "rgba(255,222,124,0.6)");
    hot.addColorStop(1, "rgba(255,160,50,0)");
    ctx.fillStyle = hot;
    circle(ctx, -r * 0.36, -r * 0.36, r * 0.72);

    const cool = ctx.createRadialGradient(r * 0.5, r * 0.48, 0, r * 0.5, r * 0.48, r * 0.95);
    cool.addColorStop(0, "rgba(146,24,8,0.62)");
    cool.addColorStop(1, "rgba(176,44,12,0)");
    ctx.fillStyle = cool;
    circle(ctx, r * 0.5, r * 0.48, r * 0.95);

    ctx.restore();
  },
};
