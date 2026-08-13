/**
 * donkeyKong: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  armourWindow,
  crescent,
  glow,
  polygon,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import { SMASH_CHARGE_MAX } from "@/engine/constants";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

/* ------------------------------------------------ neutral air, the turn -- */

/**
 * Where the neutral air's ring goes, in world units off his feet, and how fast
 * it turns.
 *
 * These are the pose's numbers duplicated: `FxContext` hands an effect the feet
 * and the scale and nothing else, so there is no way to ask where a fist
 * actually ended up. Change the arm angles in `nair` without changing these and
 * the ring drifts off the fists silently. `SWEEP_HALF_TURN` is the pose's
 * cadence rather than the frame data's — the near fist is forward on the strike
 * key and traded round by move frame 21.
 *
 * Round two laid the body over into the prone attitude the frames actually
 * show, which drops the shoulder line: `SWEEP_Y` comes down with it. And the
 * pose now holds the clean window flat and spends the turn across the weak
 * tail, so `SWEEP_HALF_TURN` follows the keys it is drawn against — bar at
 * action frame 12, edge at 16, bar traded at 20, which is a half turn every
 * eight frames.
 */
const SWEEP_Y = 7.4;
const SWEEP_R = 10.4;
/** How open the ellipse is. 0 would be exactly edge-on, and invisible. */
const SWEEP_FLAT = 0.3;
const SWEEP_HALF_TURN = 8;
const SWEEP_HOT = "#FFF4DC";
const SWEEP_COOL = "#E39A3A";

/**
 * An arc of the flat ring, as a polyline.
 *
 * Not `ctx.ellipse`, and not a `scale()` around `crescent`: an anisotropic
 * transform scales the line width with it, so the front and back of the ring —
 * where the stroke runs vertically — come out razor thin while the sides stay
 * fat, and the ring reads as a lens rather than as a circle.
 */
function sweepArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
): void {
  const steps = Math.max(6, Math.round((Math.abs(to - from) / (Math.PI * 2)) * 48));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const px = cx + Math.cos(a) * rx;
    const py = cy + Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Donkey Kong, Giant Punch. The fist is what is charged, so the fist is what
   * glows, and it grows with the charge. The white ring on the armour frames is
   * the tell for "hitting him now will not stop this".
   */
  neutralB: ({ ctx, f, def, x, y, u, dir, frame, height, over }) => {
    const charge = Math.min(1, f.charge / SMASH_CHARGE_MAX);
    const full = charge > 0.985;
    // The wind-up is a circle centred on the shoulder — measured at 0.6 of his
    // height in radius, which is the arm — and the fist runs round it up the
    // *front*, over the crown and away behind him. One revolution every eleven
    // frames, which is the 110-frame charge divided by its ten wind-ups.
    const sx = x + u * 0.6 * dir;
    const sy = y - u * height * 0.58;
    const r = u * height * 0.6;
    const spin = (frame / 11) * Math.PI * 2;
    // `-dir` on the x term is what makes it go up the front rather than up the
    // back, and it keeps doing so when he turns round.
    const at = (a: number) => [sx - Math.sin(a) * r * dir, sy - Math.cos(a) * r] as const;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // The swipe ribbons: two or three concentric arcs at once, because the
    // trail outlives one revolution.
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(sx, sy, r * (1 - i * 0.09), 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha("#FFFFFF", (0.1 - i * 0.028) * (0.35 + charge * 0.65));
      ctx.lineWidth = Math.max(1, u * (0.5 - i * 0.13));
      ctx.stroke();
    }

    const [fistX, fistY] = at(spin);
    glow(
      ctx,
      fistX,
      fistY,
      u * (1.8 + charge * 3.4),
      withAlpha("#FFD37A", 0.45 + charge * 0.55),
      withAlpha("#B06A10", 0.12),
    );
    // Electricity, not fire: "trails of electricity appear on his arm and fist
    // during the charge up and the punch". Zig-zags rather than a halo, and
    // spawned every fifth frame rather than every frame, which is the cadence
    // they actually flicker at.
    if (charge > 0.05 && frame % 5 < 2) {
      ctx.strokeStyle = withAlpha("#FFFFFF", 0.5 + charge * 0.4);
      ctx.lineWidth = Math.max(1, u * 0.22);
      for (let k = 0; k < 3; k++) {
        const a = spin + 2.1 + k * 2.1;
        ctx.beginPath();
        ctx.moveTo(fistX, fistY);
        for (let j = 1; j <= 3; j++) {
          const d = u * (0.9 + charge * 1.5) * j;
          ctx.lineTo(
            fistX + Math.cos(a + j * 0.9) * d,
            fistY + Math.sin(a + j * 0.9) * d * 0.9,
          );
        }
        ctx.stroke();
      }
    }

    const armour = armourWindow(def, "neutralB");
    if (armour && frame >= armour[0] && frame <= armour[1]) {
      ctx.strokeStyle = withAlpha("#FFFFFF", 0.75);
      ctx.lineWidth = Math.max(2, u * 0.5);
      ctx.beginPath();
      ctx.arc(x, y - u * 6, u * 7.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // **The full-charge tell is smoke off the top of his head**, and it has
    // been the tell since Melee — not a glow, not a flashing fist. Painted
    // `over` because it rises out of the crown and anything drawn under the
    // figure is hidden by the skull it is supposed to be coming out of.
    if (full) {
      over(() => {
        ctx.save();
        for (let k = 0; k < 3; k++) {
          const age = ((frame + k * 9) % 27) / 27;
          const puff = u * (0.9 + age * 2.1);
          glow(
            ctx,
            x + u * (0.4 + age * 1.1) * dir,
            y - u * height * (0.98 + age * 0.34),
            puff,
            withAlpha("#FFFFFF", 0.5 * (1 - age)),
            withAlpha("#C8CEDA", 0.08 * (1 - age)),
          );
        }
        ctx.restore();
      });
    }
    return NOTHING;
  },


  /**
   * Donkey Kong, Spinning Kong. The pose turns him; this is the air he moves.
   *
   * The pose draws the turn by pumping `scaleX` — full width square-on, a
   * sliver edge-on, twice a revolution — which is the only way a side-on rig
   * can express a rotation about the vertical axis. That alone is ambiguous:
   * a body narrowing and widening could as easily be squashing.
   *
   * The disc is what disambiguates it. His hands sweep the *same* circle
   * whatever the body is doing, so the swept path stays wide while the ape
   * inside it narrows to nothing and back. A constant-width ring around a
   * pulsing body reads as rotation and nothing else. Painted under the figure,
   * which is what makes it a path rather than a hoop drawn on him.
   */
  upB: ({ ctx, x, y, u, dir, frame, height }) => {
    // The launcher is frame 19, the trapping loop 25-58, the finisher 62.
    const FIRST = 19;
    const LAST = 62;
    if (frame < FIRST || frame > LAST + 12) return NOTHING;
    const fade =
      Math.min(1, (frame - FIRST + 1) / 4) * Math.min(1, Math.max(0, 1 - (frame - LAST) / 12));

    const cx = x;
    const cy = y - u * height * 0.55;
    const rx = u * height * 0.62;
    const ry = u * height * 0.1;

    // One half turn every ~7.2 frames, the cadence the seven hits arrive at.
    // The leading hand alternates ends, so the bright end swaps with it — and
    // multiplying by `dir` rather than branching keeps it correct facing left.
    const half = (frame - FIRST) / 7.2;
    const lead = half - Math.floor(half) < 0.5 ? 1 : -1;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (1 - i * 0.06), ry * (1 - i * 0.22), 0, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha("#FFE7BE", (0.3 - i * 0.08) * fade);
      ctx.lineWidth = Math.max(1, u * (0.5 - i * 0.12));
      ctx.stroke();
    }
    // The knuckle at the near end of the sweep, where the hitbox actually is.
    glow(
      ctx,
      cx + rx * lead * dir,
      cy,
      u * 2.2,
      withAlpha("#FFF3D2", 0.55 * fade),
      withAlpha("#FFB13C", 0.16 * fade),
    );
    ctx.restore();
    return NOTHING;
  },


  /**
   * Donkey Kong, Hand Slap. The pose puts his palms on the floor; this is what
   * the floor does about it.
   *
   * SmashWiki calls it "earth-shaking vibrations", and the shape that reads as
   * that in two dimensions is a ring travelling *along the ground* — drawn as a
   * flattened ellipse, which is a circle on the floor plane seen from the side.
   * It stops at eight world units because that is where the hitbox stops, and a
   * graphic that ran to the edge of the screen would be lying about the move's
   * range. Earth-toned rather than energy-coloured: he is hitting the ground,
   * not casting anything.
   *
   * `glow`'s `outer` is passed explicitly. Left to default it re-parses its own
   * `"rgba(0,0,0,0)"` through `hexToRgb`, which cannot read it and returns
   * black — harmless under `lighter`, a dark halo anywhere else.
   */
  downB: ({ ctx, x, y, u, dir, frame }) => {
    const FIRST = 12;
    const LIFE = 15;
    const age = frame - FIRST;
    if (age < 0 || age > LIFE) return NOTHING;
    const grow = Math.min(1, (age + 1) / 7);
    const reach = u * 8 * grow;
    const fade = Math.max(0, 1 - age / LIFE);

    ctx.save();
    // The ring, twice, the inner one lagging — one arc is a line, two are a
    // wave leaving somewhere.
    for (let i = 0; i < 2; i++) {
      const r = reach * (1 - i * 0.32);
      if (r <= 0) continue;
      ctx.beginPath();
      ctx.ellipse(x, y, r, u * (0.85 + i * 0.45), 0, Math.PI, Math.PI * 2);
      ctx.strokeStyle = withAlpha("#E8CFA6", (0.9 - i * 0.3) * fade);
      ctx.lineWidth = Math.max(2, u * 0.6);
      ctx.stroke();
    }
    // Dust thrown up where each palm landed. `dir` multiplies rather than
    // branching, and the pair maps onto itself when he turns round.
    for (const side of [1, -1] as const) {
      glow(
        ctx,
        x + reach * 0.8 * side * dir,
        y - u * 0.7,
        u * (2.4 + age * 0.24),
        withAlpha("#F2DEBB", 0.7 * fade),
        withAlpha("#8A6B45", 0.1 * fade),
      );
    }
    ctx.restore();
    return NOTHING;
  },

  /**
   * Forward smash — the dive, and what it lands on.
   *
   * Two graphics, and the second is the one that matters. The **arc** is the
   * pair of arms coming over the top: a tapered crescent about the shoulder,
   * swept from up-and-behind round to down-and-in-front, which is 150° of hand
   * travel in the two frames either side of contact and reads as a teleport
   * without a smear.
   *
   * The **landing** is on the floor and not in the air, because the pose now
   * finishes with both fists 4.4 rig units up — 30% of his height — a body's
   * length out in front of him. A spark hung at the hitbox centre (world y 8)
   * would sit a metre above the hands that made it. Earth-toned, like Hand Slap
   * and Headbutt, because all three are DK hitting the ground.
   */
  fsmash: ({ ctx, x, y, u, dir, frame, over }) => {
    const FIRST = 22;
    const LIFE = 13;
    const age = frame - FIRST;
    if (age < -3 || age > LIFE) return NOTHING;
    const gx = x + u * 10 * dir;

    if (age <= 2) {
      const swing = Math.min(1, (age + 4) / 6);
      const fade = age <= 0 ? swing : Math.max(0, 1 - age / 3);
      // In front of the figure: this is the arms' own path and they are the
      // frontmost thing on him. Under the body it was eclipsed by the barrel
      // for the whole of the useful part of the sweep.
      over(() => {
        ctx.save();
        ctx.translate(x + u * 0.6 * dir, y - u * 9.2);
        ctx.scale(dir, 1);
        ctx.globalCompositeOperation = "lighter";
        const lead = -1.3 + swing * 2.5; // up and behind, round to below and in front
        for (let i = 0; i < 3; i++) {
          crescent(ctx, 0, 0, u * (9.6 - i * 0.6), u * (1.9 - i * 0.45), lead - 1.15 + i * 0.3, lead);
          ctx.fillStyle = withAlpha(i === 2 ? "#FFF6E2" : "#E7B778", (0.12 + i * 0.14) * fade);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    if (age >= 0) {
      ctx.save();
      const fade = Math.max(0, 1 - age / LIFE);
      const spread = u * (3.0 + age * 1.15);
      ctx.strokeStyle = withAlpha("#F0DCB6", 0.9 * fade);
      ctx.lineWidth = Math.max(2, u * 0.7);
      ctx.beginPath();
      ctx.ellipse(gx, y, spread, u * 1.35, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      for (const s of [1, -1] as const) {
        const lift = Math.max(0, 1 - age / 8);
        ctx.fillStyle = withAlpha("#C9A97B", 0.85 * fade);
        polygon(ctx, gx + spread * 0.72 * s * dir, y - u * 4.0 * lift * (1 - lift * 0.4),
          u * (1.2 - age * 0.04), 3, age * 0.35 * s);
        ctx.fill();
      }
      glow(ctx, gx, y - u * 0.8, u * (3.6 + age * 0.7),
        withAlpha("#F2DEBB", 0.65 * fade), withAlpha("#8A6B45", 0.12 * fade));
      ctx.restore();
    }
    return NOTHING;
  },

  /**
   * Up smash — the clap, which happens above his crown and therefore has to be
   * painted `over` or his own head eclipses it.
   *
   * The hitbox is at `x: 0, y: 16` — dead centre, above the skull — so the
   * graphic is a pair of arcs closing onto that point before contact and a
   * flat, wide starburst on it after. Wide rather than round: the thing being
   * sold is two palms meeting, so the burst spreads sideways along the line the
   * hands closed on.
   */
  usmash: ({ ctx, x, y, u, frame, over }) => {
    const FIRST = 14;
    const LIFE = 11;
    const age = frame - FIRST;
    if (age < -4 || age > LIFE) return NOTHING;
    const cy = y - u * 16;

    over(() => {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      if (age < 0) {
        // Closing. Two arcs sweeping in from either side, brightest just
        // before they meet.
        const close = 1 + age / 4; // 0 at four frames out, 1 at contact
        for (const s of [1, -1] as const) {
          crescent(ctx, x, cy, u * (7.5 - close * 2.5), u * 1.1,
            s > 0 ? -0.5 : Math.PI - 0.5, s > 0 ? 0.9 : Math.PI + 0.9);
          ctx.fillStyle = withAlpha("#FFF2D4", 0.16 + close * 0.3);
          ctx.fill();
        }
      } else {
        const fade = Math.max(0, 1 - age / LIFE);
        const grow = Math.min(1, (age + 1) / 4);
        glow(ctx, x, cy, u * (3.4 + grow * 4.5),
          withAlpha("#FFFFFF", 0.85 * fade), withAlpha("#FFC85A", 0.2 * fade));
        // Six spokes, flattened along the horizontal, so the burst reads as
        // two hands meeting rather than as an explosion.
        ctx.strokeStyle = withAlpha("#FFF6DE", 0.8 * fade);
        ctx.lineWidth = Math.max(1, u * 0.5 * fade);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.26;
          const len = u * (5.5 + grow * 6);
          ctx.beginPath();
          ctx.moveTo(x, cy);
          ctx.lineTo(x + Math.cos(a) * len, cy + Math.sin(a) * len * 0.5);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
    return NOTHING;
  },

  /**
   * Down smash — the ground pound, one graphic per fist, both on the same
   * frames.
   *
   * `fighters/donkeyKong.ts` staggers the two hitboxes (front on 11-12, back on
   * 13-14) because that is the shape our simplified table has, but the move is
   * symmetric — the game fires four mirrored boxes on 11-12 — and the *pose*
   * now brings both fists down together. So the effect does too, and the
   * stagger survives only as the front burst being a couple of frames older
   * and therefore wider than the back one, which is exactly the asymmetry the
   * real ground hitboxes have.
   */
  dsmash: ({ ctx, x, y, u, dir, frame }) => {
    const FIRST = 11;
    const LIFE = 16;
    const age = frame - FIRST;
    if (age < 0 || age > LIFE) return NOTHING;

    ctx.save();
    for (const [s, lead] of [
      [1, 0],
      [-1, 2],
    ] as const) {
      const a = age - lead;
      if (a < 0) continue;
      const fade = Math.max(0, 1 - a / LIFE);
      const reach = u * (2.2 + a * 0.85);
      const cx = x + u * (s > 0 ? 6.5 : -5.5) * dir;
      for (let i = 0; i < 2; i++) {
        const r = reach * (1 - i * 0.35);
        if (r <= 0) continue;
        ctx.beginPath();
        ctx.ellipse(cx, y, r, u * (0.8 + i * 0.4), 0, Math.PI, Math.PI * 2);
        ctx.strokeStyle = withAlpha("#E8CFA6", (0.9 - i * 0.32) * fade);
        ctx.lineWidth = Math.max(2, u * 0.6);
        ctx.stroke();
      }
      glow(ctx, cx, y - u * 0.7, u * (2.4 + a * 0.3),
        withAlpha("#F2DEBB", 0.6 * fade), withAlpha("#8A6B45", 0.1 * fade));
    }
    ctx.restore();
    return NOTHING;
  },

  /**
   * Dash attack — the Roll Attack's dust.
   *
   * The pose turns him and the engine carries him; this is the ground saying
   * something happened to it. A rolling four-hundred-pound ape leaves a trail
   * behind him and not a puff under him, so the puffs are seeded *back* along
   * his path by their own age, which is what makes the graphic read as travel
   * rather than as a fighter standing in a cloud.
   */
  dashAttack: ({ ctx, x, y, u, dir, frame }) => {
    const FIRST = 9;
    const LAST = 24;
    if (frame < FIRST || frame > LAST + 6) return NOTHING;
    const out = Math.max(0, 1 - (frame - LAST) / 6);
    ctx.save();
    for (let k = 0; k < 5; k++) {
      const age = ((frame - FIRST + k * 3) % 15) / 15;
      const fade = (1 - age) * out;
      if (fade <= 0.02) continue;
      glow(
        ctx,
        x - u * (1.5 + age * 9) * dir,
        y - u * (0.5 + age * 2.2),
        u * (1.1 + age * 2.6),
        withAlpha("#EEDCBB", 0.5 * fade),
        withAlpha("#8A6B45", 0.09 * fade),
      );
    }
    ctx.restore();
    return NOTHING;
  },

  /**
   * Down air — the stomp, and the one thing on this rig that cannot draw
   * itself.
   *
   * His legs are 3.19 rig units inside a pelvis capsule 2.0 in radius, so
   * almost none of the stamp ever leaves the silhouette: what a player sees is
   * two pale soles moving a few pixels. The move is a **meteor** — angle 270,
   * sweetspot `(1, -2)`, which is *below his own feet* — and none of that is
   * legible from the drawing. So the graphic carries it: a hard flat shockwave
   * under the soles and a short downward spike through it, both painted below
   * the figure where the feet already are.
   */
  dair: ({ ctx, x, y, u, dir, frame }) => {
    const FIRST = 14;
    const LIFE = 12;
    const age = frame - FIRST;
    if (age < -3 || age > LIFE) return NOTHING;
    const cy = y - u * 1.0;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (age < 0) {
      // The wind-up: a gathering glow under the soles for the three frames the
      // legs are still folded, so the stamp arrives on something.
      glow(ctx, x + u * 0.8 * dir, cy, u * (1.2 - age * 0.6),
        withAlpha("#DCE8FF", 0.16 * (age + 4) / 3));
      ctx.restore();
      return NOTHING;
    }
    const fade = Math.max(0, 1 - age / LIFE);
    const grow = Math.min(1, (age + 1) / 4);
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.ellipse(x + u * 0.8 * dir, cy, u * (2.4 + grow * 6) * (1 - i * 0.3),
        u * (0.7 + i * 0.5), 0, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(i === 0 ? "#FFFFFF" : "#9FC4FF", (0.8 - i * 0.35) * fade);
      ctx.lineWidth = Math.max(2, u * (0.6 - i * 0.2));
      ctx.stroke();
    }
    // The spike itself: a wedge driven straight down, because angle 270 is the
    // whole point of the move and nothing in the pose says it.
    ctx.beginPath();
    ctx.moveTo(x + u * (0.8 - 1.6) * dir, cy);
    ctx.lineTo(x + u * (0.8 + 1.6) * dir, cy);
    ctx.lineTo(x + u * 0.8 * dir, cy + u * (2.4 + grow * 3.4));
    ctx.closePath();
    ctx.fillStyle = withAlpha("#EAF2FF", 0.55 * fade);
    ctx.fill();
    ctx.restore();
    return NOTHING;
  },

  /**
   * Donkey Kong, neutral air — the plane of the turn.
   *
   * The pose can say his arms are out and that his barrel has gone edge-on.
   * What a side-on rig cannot say at all is *which axis he is turning about*,
   * and this is the graphic that says it: the circle his fists actually travel,
   * drawn as the ellipse a horizontal circle makes seen along its own plane.
   * Two bright heads half a turn apart, because both arms clothesline.
   *
   * The windows are read off the move rather than typed in twice. Painted under
   * the figure, so his barrel eclipses the near arc and his head the far one,
   * which is the depth cue that stops it reading as a hoop stuck on top of him.
   */
  nair: ({ ctx, def, x, y, u, frame, dir }) => {
    const move = def.moves.nair;
    if (!move || move.hitboxes.length === 0) return NOTHING;
    const clean = move.hitboxes.reduce((a, b) => (b.damage > a.damage ? b : a));
    const first = Math.min(...move.hitboxes.map((h) => h.startFrame));
    const last = Math.max(...move.hitboxes.map((h) => h.endFrame));
    // Three frames of lead-in, so the ring is already spinning up behind the
    // coil rather than appearing from nothing on the contact frame.
    const LEAD = 3;
    if (frame < first - LEAD || frame > last) return NOTHING;

    const fade =
      frame < first
        ? 0.4 * (1 - (first - frame) / (LEAD + 1))
        : frame <= clean.endFrame
          ? 1
          : Math.max(0, 1 - (0.72 * (frame - clean.endFrame)) / (last - clean.endFrame));
    if (fade <= 0.01) return NOTHING;

    const grow = frame < first ? 0.6 + (0.4 * (LEAD - (first - frame))) / LEAD : 1;
    const r = u * SWEEP_R * grow * (0.86 + 0.14 * fade);
    // Mirroring is the x radius' sign, so the ring, both trails and both heads
    // flip together and nothing branches on facing.
    const rx = r * dir;
    const ry = r * SWEEP_FLAT;
    const cx = x;
    const cy = y - u * SWEEP_Y;
    const phase = (Math.PI * (frame - first)) / SWEEP_HALF_TURN;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    // The ring itself, dimmer on the half running behind him.
    ctx.lineWidth = Math.max(1, u * 0.26);
    ctx.strokeStyle = withAlpha(SWEEP_COOL, 0.22 * fade);
    sweepArc(ctx, cx, cy, rx, ry, Math.PI, Math.PI * 2);
    ctx.strokeStyle = withAlpha(SWEEP_COOL, 0.42 * fade);
    sweepArc(ctx, cx, cy, rx, ry, 0, Math.PI);

    // A tapered trail behind each fist, and the fist itself.
    for (const side of [0, Math.PI]) {
      const head = phase + side;
      for (let k = 0; k < 3; k++) {
        const a0 = head - 2.1 + k * 0.7;
        ctx.lineWidth = Math.max(1, u * (0.26 + 0.22 * k));
        ctx.strokeStyle = withAlpha(k === 2 ? SWEEP_HOT : SWEEP_COOL, (0.22 + 0.3 * k) * fade);
        sweepArc(ctx, cx, cy, rx, ry, a0, a0 + 0.75);
      }
      glow(
        ctx,
        cx + Math.cos(head) * rx,
        cy + Math.sin(head) * ry,
        u * 2.4 * fade,
        withAlpha(SWEEP_HOT, 0.8 * fade),
        withAlpha(SWEEP_COOL, 0.3 * fade),
      );
    }

    ctx.restore();
    return NOTHING;
  },

  /**
   * Donkey Kong, Headbutt — the arc the skull takes, and what the floor does
   * about it.
   *
   * Two graphics answering two questions. The **arc** says where the crown
   * went: the pose swings the head bone through 158° in six frames, which at
   * 60Hz is three drawings with nothing between them, and a swing that fast
   * needs a smear or it reads as a teleport. Painted under the figure and
   * centred behind his chest, so his own barrel eclipses the inside of it and
   * only the band the crown actually travels is visible.
   *
   * The **burst** says what the move does. Angle 270 with `effect: "bury"`
   * plants a grounded opponent in the stage, so the graphic belongs at floor
   * level under the point of contact rather than out at head height where the
   * hitbox centre is — a crack spreading from the spot with two shards kicked
   * out of it, earth-toned to match Hand Slap because both are DK hitting the
   * ground rather than casting anything.
   *
   * Gated on `f.grounded`: the aerial version meteors rather than burying, and
   * a crack in the floor under an airborne ape is a lie about the move.
   */
  sideB: ({ ctx, f, x, y, u, dir, frame }) => {
    const FIRST = 20; // the hitbox's own frame, as the frame data counts it
    const LIFE = 14;
    const age = frame - FIRST;
    if (age < -3 || age > LIFE) return NOTHING;

    // The swing. Three nested bands, the leading one shortest and brightest,
    // which is a taper without needing a tapered primitive.
    if (age <= 2) {
      ctx.save();
      const swing = Math.min(1, (age + 4) / 6);
      const fade = age <= 0 ? swing : Math.max(0, 1 - age / 3);
      // Mirroring is one multiply on the arc's own x axis, so nothing
      // downstream has to know which way he is facing.
      ctx.translate(x + u * 1.0 * dir, y - u * 8.2);
      ctx.scale(dir, 1);
      ctx.globalCompositeOperation = "lighter";
      const lead = -1.05 + swing * 1.2; // -60° up and back, round to +9° in front
      for (let i = 0; i < 3; i++) {
        crescent(ctx, 0, 0, u * (8.4 - i * 0.5), u * (1.5 - i * 0.35), lead - 0.95 + i * 0.26, lead);
        ctx.fillStyle = withAlpha(i === 2 ? "#FFF1D6" : "#E7B778", (0.14 + i * 0.13) * fade);
        ctx.fill();
      }
      ctx.restore();
    }

    // The bury.
    if (age >= 0 && f.grounded) {
      ctx.save();
      const fade = Math.max(0, 1 - age / LIFE);
      const spread = u * (2.4 + age * 0.85);
      const gx = x + u * 7 * dir;

      ctx.strokeStyle = withAlpha("#E8CFA6", 0.85 * fade);
      ctx.lineWidth = Math.max(2, u * 0.55);
      ctx.beginPath();
      ctx.ellipse(gx, y, spread, u * 1.15, 0, Math.PI, Math.PI * 2);
      ctx.stroke();

      // Two shards of stage, thrown out and falling back. `dir` multiplies so
      // the pair maps onto itself when he turns round.
      for (const side of [1, -1] as const) {
        const lift = Math.max(0, 1 - age / 9);
        ctx.fillStyle = withAlpha("#C9A97B", 0.85 * fade);
        polygon(
          ctx,
          gx + spread * 0.78 * side * dir,
          y - u * 3.4 * lift * (1 - lift * 0.4),
          u * (1.0 - age * 0.035),
          3,
          age * 0.4 * side,
        );
        ctx.fill();
      }

      glow(
        ctx,
        gx,
        y - u * 0.6,
        u * (3.2 + age * 0.55),
        withAlpha("#F2DEBB", 0.6 * fade),
        withAlpha("#8A6B45", 0.12 * fade),
      );
      ctx.restore();
    }

    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
