/**
 * fox: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  glow,
  polygon,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

/**
 * Where the pistol sits, in rig units forward of and above his feet.
 *
 * Taken off the pose in `poses.ts` rather than invented: the hand is at the
 * holster at (1.2, 4.3) on action frame 3 and locked out at (4.1, 7.0) on
 * action frame 10, and the barrel runs 2.4 units forward of the grip — which
 * puts the muzzle within half a unit of the (7.0, 6.0) the bolt actually
 * spawns at, so the shot leaves the gun rather than leaving his elbow.
 *
 * An effect cannot ask the renderer where a bone ended up — `FxContext` gives
 * it the feet and the scale and nothing else — so this is the one place a
 * duplicated number is unavoidable. Changing the arm angles in `neutralB`
 * without changing these two points is what would break it.
 */
const HOLSTERED = { x: 1.2, y: 4.3 } as const;
const AIMED = { x: 4.1, y: 7.0 } as const;

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Fox, Blaster. The gun itself, because the rig does not carry one.
   *
   * A pistol welded to his hand would be wrong in the twenty-five moves that
   * are not this one — he holsters it, and `rig.ts` draws the holster on his
   * right thigh — so the weapon belongs to the move rather than to the
   * fighter, which is what this layer is for.
   *
   * Effects paint *under* the figure, so the grip disappears behind his hand
   * and the barrel is what shows. That is the right way round: a barrel
   * sticking forward past the fist reads as a drawn pistol at any size, and
   * nothing is lost by the part inside his grip being hidden.
   *
   * `frame` is counted the way the frame data is, so the numbers below are the
   * frame-data ones: the bolt's `spawnFrame` is 11 and that is where the flash
   * goes.
   */
  neutralB: ({ ctx, x, y, u, frame, dir }) => {
    if (frame < 5 || frame > 31) return NOTHING;

    // Track the hand out of the holster.
    //
    // The cube is not decoration. The pose's own span from the holster key to
    // the shot carries `ease: "in"`, which is cubic, so a gun interpolated
    // linearly across the same frames is half way up while the hand is a fifth
    // of the way — and on the first capture the pistol was visibly floating
    // two units in front of the fist through the whole draw. Same span, same
    // curve: `applyEase("in")` is `c³`, and the arm's span runs from action
    // frame 3 to action frame 10, which is frame 4 to frame 11 here.
    const c = Math.min(1, Math.max(0, (frame - 4) / 7));
    const rise = c * c * c;
    const kick = frame >= 11 && frame <= 13 ? (14 - frame) / 3 : 0;
    const gx = HOLSTERED.x + (AIMED.x - HOLSTERED.x) * rise;
    const gy = HOLSTERED.y + (AIMED.y - HOLSTERED.y) * rise + kick * 0.35;
    // Muzzle up while it kicks, level otherwise.
    const tilt = -0.18 + kick * 0.5;

    const hx = x + dir * u * gx;
    const hy = y - u * gy;

    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(dir, 1);
    ctx.rotate(tilt);

    // Barrel, receiver and grip — three boxes, which at this size is a pistol
    // and anything more detailed is noise.
    ctx.fillStyle = "#9AA6B2";
    ctx.fillRect(0, -u * 0.34, u * 2.45, u * 0.5);
    ctx.fillStyle = "#5C6874";
    ctx.fillRect(-u * 0.5, -u * 0.62, u * 1.5, u * 0.95);
    ctx.fillRect(u * 1.9, -u * 0.42, u * 0.6, u * 0.66);
    ctx.fillStyle = "#38414B";
    ctx.fillRect(-u * 0.36, u * 0.2, u * 0.72, u * 1.15);
    // The sight rail, in his own accent blue — the one part that says this is
    // a Star Fox sidearm and not a revolver.
    ctx.fillStyle = "#2B7FD4";
    ctx.fillRect(u * 0.2, -u * 0.56, u * 1.5, u * 0.2);

    // The muzzle flash, on the frame the bolt leaves and the two after it.
    if (kick > 0) {
      ctx.globalCompositeOperation = "lighter";
      glow(ctx, u * 2.7, -u * 0.08, u * 2.6 * kick, withAlpha("#FFD9A0", kick));
      ctx.fillStyle = withAlpha("#FFF4D8", kick);
      ctx.beginPath();
      ctx.moveTo(u * 2.5, -u * 0.5 * kick);
      ctx.lineTo(u * (2.5 + 2.2 * kick), 0);
      ctx.lineTo(u * 2.5, u * 0.5 * kick);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return NOTHING;
  },

  /**
   * Fox, Reflector. A hexagon is the single most recognisable shape in his
   * whole moveset.
   *
   * Two things changed here after checking it against the move rather than
   * against the previous drawing.
   *
   * **It surrounds him.** SmashWiki: "Activates his Reflector, surrounding
   * himself with a blue hexagonal energy field." It was drawn 3.4 units out to
   * his front, which is a shield *held* rather than a field he is inside, and
   * it is also a worse read: a hexagon centred on the fighter is unmistakable
   * at any size, and one floating beside him looks like a projectile.
   *
   * **It is honest about its window.** The file's own comment already claimed
   * the hexagon is on screen "for exactly the frames the reflector is out",
   * and it was not — it ran from frame 1 to `total - 6`, thirty frames, when
   * the thing reflects on frames 4 to 23. The whole value of drawing it is
   * telling the opponent when it is safe to throw something, so a field that
   * outlives its own reflect window is worse than no field.
   *
   * It pops in oversize on frame 3 (the hitbox frame), settles over two
   * frames, holds, and snaps out on 23 rather than fading — the shine ends
   * abruptly and the graphic should too.
   */
  downB: ({ ctx, x, y, u, frame }) => {
    // Frame 3 is the hitbox; 4 to 23 is the reflect window; the two frames
    // after are the dispel.
    if (frame < 3 || frame > 25) return NOTHING;
    const pop = frame <= 5 ? (6 - frame) / 3 : 0;
    const out = frame > 23 ? (frame - 23) / 3 : 0;
    const cx = x;
    const cy = y - u * 5.5;
    const r = u * 6.0 * (1 + pop * 0.35 - out * 0.55);
    const alpha = 1 - out;
    const spin = frame * 0.18;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    glow(ctx, cx, cy, r * 1.25, withAlpha("#2E7ED8", 0.32 * alpha));
    ctx.fillStyle = withAlpha("#4FA8FF", 0.26 * alpha);
    polygon(ctx, cx, cy, r, 6, spin);
    ctx.fill();

    // A rim bright enough to be the shape's edge, plus a counter-rotating
    // inner hex so the field has a surface rather than being a flat wash.
    ctx.strokeStyle = withAlpha("#DCF0FF", alpha);
    ctx.lineWidth = Math.max(1.5, u * 0.34);
    polygon(ctx, cx, cy, r, 6, spin);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#7FD0FF", 0.6 * alpha);
    ctx.lineWidth = Math.max(1, u * 0.18);
    polygon(ctx, cx, cy, r * 0.66, 6, -spin);
    ctx.stroke();

    // Three scan lines crawling up the field, off the frame counter so two
    // machines watching the same replay draw the same thing.
    ctx.strokeStyle = withAlpha("#BFE4FF", 0.4 * alpha);
    ctx.lineWidth = Math.max(1, u * 0.12);
    for (let i = 0; i < 3; i++) {
      const p = ((frame * 0.06 + i / 3) % 1) * 2 - 1;
      const w = r * Math.sqrt(Math.max(0, 1 - p * p)) * 0.86;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy + p * r);
      ctx.lineTo(cx + w, cy + p * r);
      ctx.stroke();
    }

    if (pop > 0) glow(ctx, cx, cy, r * 0.8, withAlpha("#FFFFFF", 0.5 * pop));
    ctx.restore();
    return NOTHING;
  },

  /**
   * Fox, Fire Fox. "Engulfs himself in an aura of flame before launching
   * himself in a fiery tackle."
   *
   * Half of this move is painted rather than posed, and it is the half that
   * makes the other half legible: the pose spends nineteen frames in a held
   * coil and then thirty in a rigid straight line, and neither of those is an
   * animation on its own. What sells them is that the coil is *gathering* and
   * the straight line is *on fire*. Without this the recovery reads as a
   * fighter standing to attention for forty-five frames — which is exactly
   * what the first full-length capture of it showed.
   *
   * `frame` is counted the way the frame data is, so these are the frame-data
   * numbers: the charging hitbox is frames 20-32 and the momentum entry fires
   * on frame 20, which is why the ignition is there and not anywhere else.
   */
  upB: ({ ctx, x, y, u, frame, dir }) => {
    if (frame < 4 || frame > 80) return NOTHING;
    const core = { x, y: y - u * 5.6 };

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // ---- frames 4-19: the gather.
    //
    // Sixteen motes on two counter-rotating rings, each spiralling *inward* on
    // its own phase. Inward is the whole point: fire converging on him is a
    // charge, fire leaving him is an explosion, and the same particles read as
    // either depending only on which way the radius goes.
    if (frame < 20) {
      const k = (frame - 4) / 16;
      for (let i = 0; i < 16; i++) {
        const ring = i % 2 === 0 ? 1 : -1;
        // Each mote starts its fall at a different moment, so they arrive in a
        // stream rather than as one collapsing hoop.
        const lead = ((i * 7) % 16) / 16;
        const p = Math.min(1, Math.max(0, (k - lead * 0.45) / 0.55));
        if (p <= 0) continue;
        const a = ring * (i * 1.31 + frame * 0.22);
        const rad = u * (9.5 * (1 - p) + 1.2);
        const mx = core.x + Math.cos(a) * rad * 0.85;
        const my = core.y + Math.sin(a) * rad;
        glow(ctx, mx, my, u * (0.5 + 1.5 * p), withAlpha("#FFC864", 0.28 + 0.5 * p));
      }
      // The aura tightening around him.
      glow(ctx, core.x, core.y, u * (7 - 2.4 * k), withAlpha("#FF7A1E", 0.1 + 0.34 * k));
      ctx.restore();
      return NOTHING;
    }

    // ---- frame 20-23: ignition. A ring leaving him at speed, plus a flash.
    if (frame <= 23) {
      const b = (frame - 20) / 3;
      ctx.strokeStyle = withAlpha("#FFF0C0", 1 - b);
      ctx.lineWidth = Math.max(2, u * 1.4 * (1 - b));
      ctx.beginPath();
      ctx.arc(core.x, core.y, u * (2 + 11 * b), 0, Math.PI * 2);
      ctx.stroke();
      glow(ctx, core.x, core.y, u * (9 - 3 * b), withAlpha("#FFF4D0", 0.95 - 0.5 * b));
    }

    // ---- frames 20-72: the comet.
    //
    // The trail streams *opposite the launch*, and the launch is the momentum
    // entry in `fighters/fox.ts`: x 1.3, y 4.3, i.e. up and forward at about
    // 73 degrees. So the tail goes down and back, `dir`-signed so it is behind
    // him whichever way he is facing. The context follows him as he flies, so
    // this stays attached without the effect knowing where he is.
    const life = Math.min(1, (frame - 20) / 52);
    const fade = frame > 72 ? Math.max(0, 1 - (frame - 72) / 8) : 1;
    const tx = -dir * 0.30;
    const ty = 0.96;

    // Eighteen puffs at 1.3 units apart rather than nine at 2.5: at the wider
    // spacing the first capture drew a *string of beads* behind him, because a
    // radial gradient falls off faster than the eye joins two of them up. The
    // rule is that consecutive puffs have to overlap by more than their own
    // radius, and then the same nine-unit plume reads as one continuous flame.
    for (let i = 1; i <= 18; i++) {
      const d = i * u * 1.3;
      const taper = 1 - i / 22;
      const w = u * 3.9 * taper * (0.88 + 0.22 * Math.sin(frame * 0.7 + i * 0.9));
      const a = fade * 0.4 * taper;
      if (a <= 0) continue;
      glow(
        ctx,
        core.x + tx * d,
        core.y + ty * d,
        Math.max(1, w),
        withAlpha(i < 7 ? "#FFD98A" : "#FF6A1A", a),
      );
    }

    // The body of the flame, wrapped round him and stretched along the launch.
    ctx.save();
    ctx.translate(core.x, core.y);
    ctx.rotate(-dir * 0.28);
    ctx.scale(0.72, 1.5);
    glow(ctx, 0, 0, u * 5.4, withAlpha("#FFE9B0", fade * 0.85));
    ctx.restore();
    glow(ctx, core.x, core.y, u * 3.0, withAlpha("#FFFFFF", fade * (0.5 + 0.3 * (1 - life))));

    ctx.restore();
    return NOTHING;
  },

  /**
   * Fox, Fox Illusion — the afterimages, which *are* the move. Ultimate's are
   * copies of the model rather than an abstract blur, and blue-tinted; that is
   * where both the colour and the three discrete ghosts come from. Without
   * them a fighter who has silently travelled fifty units is a rendering
   * fault, and with them he is the fastest character in the game.
   *
   * Live from frame 18, where the engine's `momentum` entry launches him, to
   * 32 — a couple of frames past the trailing hitbox — fading over the last
   * six. Everything is `back * something` so it trails the way he came from
   * whichever way he faces, and every wobble is derived from `frame`, so two
   * players watching the same replay see the same trail.
   *
   * Ghost *slabs* rather than translucent copies of the figure: fifteen
   * capsules at 40% alpha on top of fifteen more is mud at this size, and the
   * tapering slab is what the eye actually reads as "he was there a frame ago".
   */
  sideB: ({ ctx, x, y, u, frame, dir }) => {
    if (frame < 18 || frame > 32) return NOTHING;
    const fade = frame <= 26 ? 1 : Math.max(0, 1 - (frame - 26) / 6);
    const back = -dir;
    const mid = y - u * 4.2;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // The wash he is inside: one long taper from his back to well behind him,
    // brightest where he is and gone twenty-six units back.
    const tail = x + back * u * 26;
    const wash = ctx.createLinearGradient(x, mid, tail, mid);
    wash.addColorStop(0, withAlpha("#BFE4FF", fade * 0.5));
    wash.addColorStop(0.45, withAlpha("#5FB4FF", fade * 0.2));
    wash.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.moveTo(x + back * u * 0.5, mid - u * 3.4);
    ctx.lineTo(tail, mid - u * 0.5);
    ctx.lineTo(tail, mid + u * 0.5);
    ctx.lineTo(x + back * u * 0.5, mid + u * 3.4);
    ctx.closePath();
    ctx.fill();

    // Three of him, further back and fainter each time.
    for (let i = 0; i < 3; i++) {
      const near = u * (2.2 + i * 5.4);
      const far = near + u * (5.0 - i * 0.8);
      const hn = u * (2.9 - i * 0.55);
      const hf = hn * 0.45;
      ctx.fillStyle = withAlpha(i === 0 ? "#F2FAFF" : "#9FDCFF", fade * (0.5 - i * 0.15));
      ctx.beginPath();
      ctx.moveTo(x + back * near, mid - hn);
      ctx.lineTo(x + back * far, mid - hf);
      ctx.lineTo(x + back * far, mid + hf);
      ctx.lineTo(x + back * near, mid + hn);
      ctx.closePath();
      ctx.fill();
    }

    // Speed lines at seven heights, each a different length, crawling on a
    // clock taken off the frame number rather than off a random number.
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, u * 0.2);
    for (let i = 0; i < 7; i++) {
      const h = 1.2 + i * 1.4;
      const wob = (((frame * 7 + i * 13) % 5) - 2) * u * 0.12;
      const from = u * (1.5 + ((i * 5) % 7));
      const to = from + u * (10 + ((i * 3 + frame) % 6) * 2.4);
      ctx.strokeStyle = withAlpha("#EAF6FF", fade * (0.62 - i * 0.06));
      ctx.beginPath();
      ctx.moveTo(x + back * from, y - u * h + wob);
      ctx.lineTo(x + back * to, y - u * h + wob);
      ctx.stroke();
    }
    ctx.restore();
    return NOTHING;
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
  /**
   * The Blaster bolt.
   *
   * Keyed by the projectile's def id in `fighters/fox.ts`, not by the move.
   * Without a painter it falls through to `paintEnergy`, which is a round
   * orange ball — the same graphic as Samus's Charge Shot and Mario's
   * fireball, and the exact thing this layer exists to stop.
   *
   * It has to read as a *laser*, and what makes something read as a laser is
   * length along its own direction of travel plus a core hotter than its
   * jacket. So: a stretched lozenge with a white centre in a red-orange
   * sheath, plus a tail that tapers off behind. The context arrives translated
   * to the bolt but deliberately not rotated, so the heading is applied here —
   * which is also what keeps it correct for the shots his throws fire off at
   * angles.
   *
   * It travels 5.5 units a frame and lives 22 frames, so it crosses about a
   * third of Final Destination; and it does *not* die on contact, which is why
   * the graphic is drawn at full strength for its whole life rather than
   * fading in the way a spent projectile would.
   */
  blaster: ({ ctx, u, age, heading }) => {
    // A single frame of extra heat as it leaves the muzzle.
    const born = age <= 1 ? 1 : 0;
    const len = u * (4.2 + born * 0.9);
    const r = u * 0.34;

    ctx.save();
    ctx.rotate(heading);
    ctx.globalCompositeOperation = "lighter";

    // The tail: a long, low-alpha taper behind the head, which is what makes a
    // 5.5-units-a-frame projectile look like it is moving in a still frame.
    const tail = ctx.createLinearGradient(0, 0, -len * 2.4, 0);
    tail.addColorStop(0, withAlpha("#FF6A2A", 0.55));
    tail.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(-len * 2.4, 0);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.fill();

    // Small and tight. A glow as wide as the bolt is long turns it into a lens
    // flare — which is what the first live capture showed against Battlefield's
    // blue: under `lighter`, a broad orange falloff over a blue sky washes to
    // pink and swallows the core. The bolt has to be longer than its own halo.
    glow(ctx, 0, 0, len * 0.42, withAlpha("#FF8A3C", 0.5 + born * 0.2));

    // The jacket, then the core. Both ellipses stretched along the heading.
    ctx.fillStyle = "#FF4A18";
    ctx.beginPath();
    ctx.ellipse(0, 0, len, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FFD08A";
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.74, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.5, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  },
};
