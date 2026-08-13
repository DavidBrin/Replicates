/**
 * Link: what his moves paint on top of the figure, and how his three
 * projectiles are drawn.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right for
 * every one of his sword moves: the engine already derives a swing arc from the
 * move's own hitboxes, and a second glow laid over it only muddies the one
 * graphic that is guaranteed to agree with where the move actually reaches.
 *
 * Only the four specials are here, because only they carry something the rig
 * cannot: a bow, a boomerang, a Sheikah rune. Two things constrain all of them.
 *
 * **An effect never sees the skeleton.** It gets the fighter's feet, the zoom
 * and the move's frame, so a graphic that belongs in a hand has to be put there
 * by arithmetic — the shoulder is at 8.58 rig units (root 4.28 + hip 1.1 +
 * torso 3.2) and the arm is 4.5 long, both times Link's rig scale of 1.06. The
 * constants below are that sum, and they are only honest because the poses in
 * `poses.ts` hold the arm still through the frames the graphic is drawn in.
 *
 * **Effects are painted under the fighter.** Anything inside his outline is not
 * drawn at all. That is why the boomerang is wound up above his head rather
 * than behind his shoulder: the first two capture rounds put it behind the cap,
 * and two thirds of the move had nothing visible in it.
 */

import {
  NOTHING,
  circle,
  crescent,
  glow,
  polygon,
  type FxFn,
  type ProjectilePainter,
} from "../../fxKit";
import type { MoveSlot } from "@/engine/types";

/**
 * Where the bow hand is, in `u` (pixels per world unit), measured from the
 * fighter's feet.
 *
 * An effect gets the feet and the zoom and nothing else — no skeleton — so a
 * graphic that belongs in a hand has to be placed by arithmetic. The shoulder
 * sits at 8.58 rig units (root 4.28 + hip 1.1 + torso 3.2) and the arm is 4.5
 * long, all multiplied by Link's rig scale of 1.06. The pose holds that arm
 * level and forward from t = 0.2 to the loose, which is exactly the window the
 * bow is drawn in, so one constant is honest for the whole of it.
 */
const HAND_X = 4.8;
const HAND_Y = 9.1;

/** The boomerang's outline, in its own frame, one unit ≈ its half-span. */
function boomerangPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(-0.15 * s, -0.95 * s);
  ctx.quadraticCurveTo(0.42 * s, -0.5 * s, 0.36 * s, 0.28 * s);
  ctx.quadraticCurveTo(0.34 * s, 0.9 * s, 0.9 * s, 1.0 * s);
  ctx.quadraticCurveTo(0.2 * s, 1.28 * s, -0.18 * s, 0.62 * s);
  ctx.quadraticCurveTo(-0.5 * s, -0.1 * s, -0.62 * s, -0.86 * s);
  ctx.closePath();
}

/**
 * Spin Attack's active window, frames 7 to 39 of 76, and the tail its ring
 * fades over. Quoted from `fighters/link.ts` rather than guessed: a graphic
 * that outlives the hitbox is a graphic that lies about whether you can still
 * be hit.
 */
const FIRST = 7;
const LAST = 39;
const TAIL = 6;

/** Sheikah cyan. The one colour on Link that is not from the tunic. */
const RUNE = "#5FE6E0";

/** The bomb's own shape, a rounded cube with a rune band. Radius `r`. */
function bombBody(ctx: CanvasRenderingContext2D, r: number, lit: number): void {
  ctx.fillStyle = "#161C22";
  circle(ctx, 0, 0, r);
  ctx.strokeStyle = `rgba(95,230,224,${0.5 + lit * 0.5})`;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.66, 0);
  ctx.lineTo(r * 0.66, 0);
  ctx.stroke();
  ctx.fillStyle = `rgba(160,245,240,${0.55 + lit * 0.45})`;
  circle(ctx, 0, 0, r * 0.2);
}

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  neutralB: ({ ctx, x, y, u, dir, frame, total }) => {
    // Gone the moment the arrow is away: frame 16 of 44.
    const loose = total * 0.364;
    if (frame > loose + 3) return NOTHING;

    const cx = x + u * HAND_X * dir;
    const cy = y - u * HAND_Y;
    const r = u * 3.4;
    const pull = Math.min(1, frame / Math.max(1, loose));
    const fired = frame > loose;

    ctx.save();
    ctx.lineCap = "round";

    // The limbs: a shallow arc opening away from the shot, drawn in two strokes
    // so the grip stays fat and the tips taper the way a recurve does.
    ctx.strokeStyle = "#8C6A2E";
    ctx.lineWidth = Math.max(2.2, u * 0.5);
    ctx.beginPath();
    ctx.arc(cx - u * 0.5 * dir, cy, r, -1.15, 1.15);
    ctx.stroke();
    ctx.strokeStyle = "#C8A05A";
    ctx.lineWidth = Math.max(1.2, u * 0.26);
    ctx.beginPath();
    ctx.arc(cx - u * 0.5 * dir, cy, r, -1.15, 1.15);
    ctx.stroke();

    // The string, nocked back with the draw and snapped flat once it is loosed.
    const tipX = cx - u * 0.5 * dir + Math.cos(1.15) * r;
    const tipY = Math.sin(1.15) * r;
    const nock = fired ? -u * 0.2 : -u * (0.3 + pull * 2.6);
    ctx.strokeStyle = "#EFE9DA";
    ctx.lineWidth = Math.max(1, u * 0.16);
    ctx.beginPath();
    ctx.moveTo(cx + (tipX - cx) * dir, cy - tipY);
    ctx.lineTo(cx + nock * dir, cy);
    ctx.lineTo(cx + (tipX - cx) * dir, cy + tipY);
    ctx.stroke();

    if (!fired) {
      // The arrow on the string, sliding forward as the draw comes back — the
      // shaft is the only part of the whole graphic that tells you which way the
      // shot is going before it goes.
      ctx.strokeStyle = "#D8C9A8";
      ctx.lineWidth = Math.max(1.4, u * 0.28);
      ctx.beginPath();
      ctx.moveTo(cx + nock * dir, cy);
      ctx.lineTo(cx + u * 2.4 * dir, cy);
      ctx.stroke();
      ctx.fillStyle = "#E4EAF2";
      ctx.beginPath();
      ctx.moveTo(cx + u * 3.1 * dir, cy);
      ctx.lineTo(cx + u * 2.2 * dir, cy - u * 0.38);
      ctx.lineTo(cx + u * 2.2 * dir, cy + u * 0.38);
      ctx.closePath();
      ctx.fill();

      // Full draw is worth saying out loud: the charge is the whole move.
      if (pull > 0.92) glow(ctx, cx + nock * dir, cy, u * 1.5, "rgba(255,240,190,0.75)");
    }
    ctx.restore();
    return NOTHING;
  },

  sideB: ({ ctx, x, y, u, dir, frame, total }) => {
    // In the hand until it is thrown on frame 27 of 45; after that the projectile
    // system owns it and a second one painted here would be a second boomerang.
    const release = total * 0.6;
    if (frame > release) return NOTHING;

    const k = Math.min(1, frame / Math.max(1, release));
    const swing = k * k * k;
    // Above the head through the wind-up, then down and forward through the
    // release. Effects paint *under* the fighter, so anything held inside his
    // outline is not drawn at all — the first two rounds of this wound up behind
    // his shoulder and were invisible until the throw was nearly over.
    const hx = (2.4 + swing * 5.8) * u * dir;
    const hy = -(13.6 - swing * 5.0) * u;

    ctx.save();
    ctx.translate(x + hx, y + hy);
    ctx.rotate((0.6 - swing * 2.4) * dir);
    ctx.scale(dir, 1);
    boomerangPath(ctx, u * 1.9);
    ctx.fillStyle = "#C9B27A";
    ctx.fill();
    ctx.strokeStyle = "#6B4A24";
    ctx.lineWidth = Math.max(1, u * 0.16);
    ctx.stroke();
    ctx.restore();
    return NOTHING;
  },

  /**
   * Spin Attack's ring.
   *
   * The engine already derives a swing arc from the move's hitboxes, and that
   * arc is a *sector* — right for a chop, wrong for the one move on the roster
   * whose hitbox goes all the way round. This adds what only this move has: a
   * closed band at blade height, sweeping, with a bright leading edge where the
   * blade actually is, so the ring reads as a rotation rather than as a halo.
   */
  upB: ({ ctx, x, y, u, dir, frame }) => {
    if (frame < FIRST || frame > LAST + TAIL) return NOTHING;

    const fade = frame <= LAST ? 1 : 1 - (frame - LAST) / TAIL;
    const cy = y - u * 7.4;
    const r = u * 6.2;
    const spin = frame * 0.62 * dir;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    ctx.globalAlpha = 0.28 * fade;
    ctx.fillStyle = "#7FE9FF";
    crescent(ctx, x, cy, r * 0.86, u * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Two leading edges half a turn apart: the blade, and where it was.
    for (const lead of [0, Math.PI]) {
      ctx.globalAlpha = (lead === 0 ? 0.85 : 0.4) * fade;
      ctx.fillStyle = "#FFFFFF";
      crescent(ctx, x, cy, r * 0.86, u * 2.4, spin + lead - 0.5, spin + lead);
      ctx.fill();
    }

    ctx.globalAlpha = fade;
    glow(ctx, x + Math.cos(spin) * r, cy + Math.sin(spin) * r * 0.22, u * 1.5, "rgba(255,255,255,0.9)");
    ctx.restore();
    return NOTHING;
  },

  downB: ({ ctx, x, y, u, dir, frame, total }) => {
    const spawn = total * 0.436;
    if (frame > spawn + 7) return NOTHING;

    // The off hand, traced the way the pose moves it: tucked at the hip, out to
    // the front by the time the rune fires. An effect never sees the skeleton, so
    // the arithmetic is the only way to keep a graphic in a hand.
    const k = Math.min(1, frame / Math.max(1, spawn));
    const hx = (1.2 + k * 4.2) * u * dir;
    const hy = -(6.6 + k * 1.6) * u;
    const cx = x + hx;
    const cy = y + hy;

    ctx.save();
    // The rune assembling: a hexagon that tightens and brightens as the slate
    // works, which is the whole of what the wind-up has to say.
    const build = Math.min(1, k * 1.9);
    ctx.globalAlpha = 0.3 + build * 0.6;
    ctx.strokeStyle = RUNE;
    ctx.lineWidth = Math.max(1.4, u * 0.26);
    polygon(ctx, cx, cy, u * (4.0 - build * 2.2), 6, frame * 0.06 * dir);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (frame >= spawn) {
      glow(ctx, cx, cy, u * 3.4, "rgba(95,230,224,0.65)");
      // Only for the two frames it takes to materialise. From then on the real
      // bomb is a projectile with its own painter, and a second one drawn here
      // would be a second bomb.
      if (frame <= spawn + 2) {
        ctx.save();
        ctx.translate(cx, cy);
        bombBody(ctx, u * 1.6, 1);
        ctx.restore();
      }
    } else if (build > 0.55) {
      glow(ctx, cx, cy, u * 2.2 * build, "rgba(95,230,224,0.45)");
    }
    ctx.restore();
    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
  /**
   * The arrow. Translated to the projectile but not rotated, so it noses over
   * as gravity takes it — which for an arrow is the whole tell that the shot is
   * running out of steam.
   */
  arrow: ({ ctx, u, heading, charge, age }) => {
    const k = Math.min(1.6, charge);
    ctx.save();
    ctx.rotate(heading);

    // A short streak behind it, longer on a charged shot.
    const trail = u * (1.4 + k * 1.2);
    const g = ctx.createLinearGradient(-trail, 0, 0, 0);
    g.addColorStop(0, "rgba(255,236,180,0)");
    g.addColorStop(1, `rgba(255,236,180,${Math.min(0.55, 0.18 + age * 0.02)})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1.5, u * 0.5 * k);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-trail, 0);
    ctx.lineTo(-u * 0.8, 0);
    ctx.stroke();

    ctx.strokeStyle = "#C8A870";
    ctx.lineWidth = Math.max(1.4, u * 0.3 * k);
    ctx.beginPath();
    ctx.moveTo(-u * 1.5 * k, 0);
    ctx.lineTo(u * 0.9 * k, 0);
    ctx.stroke();

    ctx.fillStyle = "#EFF3F8";
    ctx.beginPath();
    ctx.moveTo(u * 1.7 * k, 0);
    ctx.lineTo(u * 0.7 * k, -u * 0.42 * k);
    ctx.lineTo(u * 0.7 * k, u * 0.42 * k);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#D6462F";
    ctx.beginPath();
    ctx.moveTo(-u * 1.6 * k, 0);
    ctx.lineTo(-u * 0.7 * k, -u * 0.44 * k);
    ctx.lineTo(-u * 0.55 * k, 0);
    ctx.lineTo(-u * 0.7 * k, u * 0.44 * k);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  /**
   * The boomerang in flight. It arrives untranslated and unrotated, so the spin
   * is applied here — and it spins the other way on the way home, which is the
   * cheapest possible way of saying "this is coming back at you".
   */
  boomerang: ({ ctx, u, age, dir, returning }) => {
    const spin = age * 0.42 * (returning ? -1 : 1) * dir;
    const s = u * 1.6;

    // A blurred echo a few degrees behind, so it reads as spinning rather than
    // as a shape that happens to be at a different angle each frame.
    ctx.save();
    ctx.rotate(spin - 0.5 * (returning ? -1 : 1) * dir);
    boomerangPath(ctx, s);
    ctx.fillStyle = "rgba(201,178,122,0.28)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.rotate(spin);
    boomerangPath(ctx, s);
    ctx.fillStyle = returning ? "#D8C48C" : "#C9B27A";
    ctx.fill();
    ctx.strokeStyle = "#6B4A24";
    ctx.lineWidth = Math.max(1, u * 0.16);
    ctx.stroke();
    ctx.restore();
  },

  /**
   * The Remote Bomb, sitting where it was put. It neither tumbles nor noses
   * over — it is an object waiting for an input, and the only thing it does on
   * its own is start flashing near the end of its thirty seconds, which is the
   * warning the engine's `lifetime` implies and nothing else draws.
   */
  remoteBomb: ({ ctx, u, age, frame }) => {
    const r = u * 1.25;
    // 1800-frame life, flashing over the last 45.
    const dying = age > 1755;
    const lit = dying ? (frame % 6 < 3 ? 1 : 0.15) : 0.55 + Math.sin(age * 0.12) * 0.25;
    glow(ctx, 0, 0, r * (dying ? 3.2 : 2.2), `rgba(95,230,224,${0.2 + lit * 0.3})`);
    bombBody(ctx, r, lit);
  },
};
