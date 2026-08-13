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
 */
const SWEEP_Y = 9.6;
const SWEEP_R = 10.4;
/** How open the ellipse is. 0 would be exactly edge-on, and invisible. */
const SWEEP_FLAT = 0.3;
const SWEEP_HALF_TURN = 11;
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
  neutralB: ({ ctx, f, def, x, y, u, frame }) => {
    const side = f.facing >= 0 ? 1 : -1;
    const fistX = x + u * 5.4 * side;
    const fistY = y - u * 8.2;
    const charge = Math.min(1, f.charge / SMASH_CHARGE_MAX);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, fistX, fistY, u * (2.6 + charge * 4), withAlpha("#FFD37A", 0.5 + charge * 0.5));

    const armour = armourWindow(def, "neutralB");
    if (armour && frame >= armour[0] && frame <= armour[1]) {
      ctx.strokeStyle = withAlpha("#FFFFFF", 0.75);
      ctx.lineWidth = Math.max(2, u * 0.5);
      ctx.beginPath();
      ctx.arc(x, y - u * 6, u * 7.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
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
