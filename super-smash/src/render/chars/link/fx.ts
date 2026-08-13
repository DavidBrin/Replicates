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

/**
 * The bow's limb arc: the radius it is bent to, and how far round that circle
 * the limbs run.
 *
 * Sized against the fighter rather than by eye. Measured off the exported
 * model, Ultimate's bow — the Traveler's Bow from Breath of the Wild, the same
 * one he carries on his back — is **0.83 of Link's height, tip to tip, which is
 * the same length as the Master Sword**. Link is 14.2 world units tall, so that
 * is 11.8; the chord these two numbers describe, `2 · r · sin(OPEN)`, is 10.2,
 * which is 0.72 H. Held at arm's length the top limb clears his head and the
 * bottom limb reaches below his knee, which is what the reference shows.
 *
 * The first pass drew a 6.2-unit arc half a forearm thick and it read as a gold
 * hair floating beside him rather than as a weapon he was holding.
 *
 * The circle is centred a full radius *behind* the hand, so the forward-most
 * point of the arc — the grip — is exactly where the hand is. It used to be
 * centred half a unit behind the hand, which put the whole bow one to three
 * units in front of his fist with nothing joining them.
 */
const BOW_R = 5.6;
const BOW_OPEN = 1.15;
/** How far behind the grip the limb tips sit — `r · (1 − cos OPEN)`. */
const BOW_TIPS = BOW_R * (1 - Math.cos(BOW_OPEN));
/** Half the string's length, from the grip line. */
const BOW_HALF = BOW_R * Math.sin(BOW_OPEN);
/** How far past the brace line a full draw pulls the nock. */
const BOW_DRAW = 4.2;

/**
 * Half the Boomerang's tip-to-tip span, in world units.
 *
 * 0.59 of Link's height, measured off the exported model and cross-checked
 * against its own 3-unit hitbox radius. He is 14.2 world units tall, so the
 * whole thing is eight units across — the first pass drew it at three and a
 * half, which at match scale was a tan comma.
 */
const BOOMERANG_HALF = 4.0;

/**
 * The Boomerang's outline, in its own frame: `s` is **half the tip-to-tip
 * span**, tips at `(0, ±s)`, elbow bulging toward `+x`.
 *
 * Ultimate's is the plain Breath of the Wild Boomerang, not Brawl's Gale
 * Boomerang, and the model is a *smooth slender crescent* rather than the sharp
 * V it was drawn as — measured, the two arms sit 28.8° off the tip-to-tip
 * chord, giving about 122° at the elbow, but as a continuous curve with no
 * hinge in it. Tip to tip it is 0.59 of Link's own height, which on this rig is
 * eight world units: two and a half times the width of his torso, and more than
 * twice what the first pass drew.
 *
 * The proportions are the measured ones for the span and the bend — depth 0.55
 * of the half-span, tips tapering to points — and deliberately *not* for the
 * arm, which is really only 0.064 of the span across. Drawn honestly that is
 * half a world unit, six pixels at match scale, and it disappears exactly the
 * way the shared `sword` prop did. Doubled to 0.12 it is still a slender
 * crescent and it survives being three inches tall on a screen.
 */
function boomerangPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -1.0 * s);
  // Outer, convex edge: tip, round the elbow, tip.
  ctx.quadraticCurveTo(0.98 * s, -0.52 * s, 0.66 * s, 0);
  ctx.quadraticCurveTo(0.98 * s, 0.52 * s, 0, 1.0 * s);
  // Inner, concave edge back again.
  ctx.quadraticCurveTo(0.5 * s, 0.36 * s, 0.34 * s, 0);
  ctx.quadraticCurveTo(0.5 * s, -0.36 * s, 0, -1.0 * s);
  ctx.closePath();
}

/**
 * Paint one boomerang at the origin: wood, dark rim, gunmetal caps at both
 * tips and the green cord binding just inboard of them.
 *
 * The caps are the reason it reads as a weapon rather than as a croissant —
 * they are a unit and a half of hard grey at each end of an otherwise soft
 * golden curve, and they are the only high-contrast detail on it.
 */
function paintBoomerang(ctx: CanvasRenderingContext2D, s: number, wood: string): void {
  boomerangPath(ctx, s);
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.strokeStyle = "#4A2318";
  ctx.lineWidth = Math.max(1.5, s * 0.09);
  ctx.stroke();

  ctx.lineCap = "round";
  for (const end of [-1, 1]) {
    ctx.strokeStyle = "#6A6D73";
    ctx.lineWidth = Math.max(1.5, s * 0.14);
    ctx.beginPath();
    ctx.moveTo(0.02 * s, end * 0.98 * s);
    ctx.lineTo(0.2 * s, end * 0.78 * s);
    ctx.stroke();
    ctx.strokeStyle = "#2E5A3C";
    ctx.lineWidth = Math.max(1, s * 0.11);
    ctx.beginPath();
    ctx.moveTo(0.24 * s, end * 0.72 * s);
    ctx.lineTo(0.31 * s, end * 0.6 * s);
    ctx.stroke();
  }
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
  /**
   * The Hero's Bow.
   *
   * Painted **over** the figure, all of it. A drawn bow is three quarters
   * string and arrow, and both of those live in the space between the bow hand
   * and the archer's cheek — which is to say inside Link's own outline, where
   * an effect painted under him is not drawn at all. The first pass put the
   * nock and the back half of the shaft behind his chest, so what reached the
   * screen was a thin arc floating in front of his fist with nothing attached
   * to it.
   *
   * Split, not moved wholesale. The **limbs and the grip stay underneath**,
   * because they are at arm's length in front of him where nothing occludes
   * them and because his fist ought to close *over* the grip rather than the
   * grip being painted on top of his hand. Everything from the string inward —
   * the nock, the shaft, the fletching, the charge glow — goes in front,
   * because that is the part that lives inside his outline.
   */
  neutralB: ({ ctx, x, y, u, dir, frame, total, over }) => {
    // Gone the moment the arrow is away: frame 16 of 44.
    const loose = total * 0.364;
    if (frame > loose + 3) return NOTHING;

    const cx = x + u * HAND_X * dir;
    const cy = y - u * HAND_Y;
    const r = u * BOW_R;
    const pull = Math.min(1, frame / Math.max(1, loose));
    const fired = frame > loose;
    // Brace, then the draw on top of it. Signed by facing exactly once, at the
    // point of use, so every offset below is a plain forward distance.
    const brace = u * BOW_TIPS;
    const nock = fired ? -brace * 0.55 : -(brace + u * BOW_DRAW * pull);

    // ---- under the figure: the bow itself ----
    ctx.save();
    ctx.lineCap = "round";

    // The limbs. Three strokes: a dark core that is the bow's own outline
    // against a bright sky, the wood over it, and a highlight down the back.
    // One thin stroke was legible on a contact sheet and invisible in a
    // match — the same failure the Master Sword had before it was widened.
    const limb = (width: number, colour: string) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1.5, u * width);
      ctx.beginPath();
      ctx.arc(cx - r * dir, cy, r, -BOW_OPEN, BOW_OPEN);
      ctx.stroke();
    };
    ctx.save();
    // Mirroring about the hand is what lets the arc be written once, facing
    // right, and never carry a sign inside it.
    ctx.translate(cx, cy);
    ctx.scale(dir, 1);
    ctx.translate(-cx, -cy);
    limb(0.86, "#3A2A12");
    limb(0.58, "#9C7430");
    limb(0.24, "#E0BE7A");
    ctx.restore();

    // The grip: a short fat bar where his fist closes round it, which is the
    // one shape that says the bow is *held* rather than hovering.
    ctx.strokeStyle = "#5A3A18";
    ctx.lineWidth = Math.max(2.5, u * 1.0);
    ctx.beginPath();
    ctx.moveTo(cx, cy - u * 0.95);
    ctx.lineTo(cx, cy + u * 0.95);
    ctx.stroke();
    ctx.restore();

    // ---- in front of the figure: everything the body would swallow ----
    over(() => {
      ctx.save();
      ctx.lineCap = "round";

      // The string, nocked back with the draw and snapped flat once it is
      // loosed. Two strokes, because a one-pixel line over a blue sky is a
      // suggestion rather than a string.
      const tipX = cx - u * BOW_TIPS * dir;
      const tipY = u * BOW_HALF;
      for (const [w, c] of [
        [0.26, "rgba(20,16,10,0.55)"],
        [0.14, "#F4EFE2"],
      ] as const) {
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(1, u * w);
        ctx.beginPath();
        ctx.moveTo(tipX, cy - tipY);
        ctx.lineTo(cx + nock * dir, cy);
        ctx.lineTo(tipX, cy + tipY);
        ctx.stroke();
      }

      if (!fired) {
        // The arrow on the string, sliding forward as the draw comes back. The
        // shaft is the only part of the whole graphic that says which way the
        // shot is going before it goes, so it runs the full length from the
        // nock to a head well clear of the bow.
        const head = cx + u * 2.6 * dir;
        ctx.strokeStyle = "#6B4A24";
        ctx.lineWidth = Math.max(2, u * 0.44);
        ctx.beginPath();
        ctx.moveTo(cx + nock * dir, cy);
        ctx.lineTo(head, cy);
        ctx.stroke();
        ctx.strokeStyle = "#D8C9A8";
        ctx.lineWidth = Math.max(1.2, u * 0.24);
        ctx.beginPath();
        ctx.moveTo(cx + nock * dir, cy);
        ctx.lineTo(head, cy);
        ctx.stroke();

        ctx.fillStyle = "#E4EAF2";
        ctx.beginPath();
        ctx.moveTo(head + u * 1.1 * dir, cy);
        ctx.lineTo(head, cy - u * 0.5);
        ctx.lineTo(head, cy + u * 0.5);
        ctx.closePath();
        ctx.fill();

        // Fletching at the nock, which is the other end of the same read.
        // Teal, not red. The real fletching is a two-tone swept chevron in
        // dark teal and pale grey-green, and the teal is deliberate: it matches
        // the cord wraps at the bow's tips and it is the only colour on the
        // whole weapon that is not wood or steel.
        ctx.fillStyle = "#214D4A";
        ctx.beginPath();
        ctx.moveTo(cx + nock * dir, cy);
        ctx.lineTo(cx + (nock + u * 1.3) * dir, cy - u * 0.55);
        ctx.lineTo(cx + (nock + u * 1.1) * dir, cy);
        ctx.lineTo(cx + (nock + u * 1.3) * dir, cy + u * 0.55);
        ctx.closePath();
        ctx.fill();

        // Full draw is worth saying out loud: the charge is the whole move.
        if (pull > 0.92) {
          glow(ctx, cx + nock * dir, cy, u * 2.2, "rgba(255,240,190,0.8)");
          glow(ctx, head + u * dir, cy, u * 1.6, "rgba(255,248,214,0.7)");
        }
      }
      ctx.restore();
    });
    return NOTHING;
  },

  /**
   * The Boomerang, from the hand to the moment it leaves it on frame 27 of 45.
   *
   * **Wound up behind the head, and painted over the figure.** Those two facts
   * are one decision. Ultimate's throw is a big overhand with a full torso
   * coil: his back turns to the camera, he bends deeply forward at the waist,
   * and the throwing arm cocks *above and behind his skull*, roughly a head's
   * width past it, before whipping forward and down into a lunge. Round one
   * could not draw that. Effects were painted under the fighter and had no way
   * out, so a boomerang held behind him was a boomerang behind his cap, and two
   * capture rounds had nothing visible until the throw was two thirds done. It
   * was solved authorially, by moving the wind-up *in front of* his head where
   * nothing could occlude it — which was the right call with the tools of the
   * time and the wrong shape.
   *
   * `over` is the tool that was missing. The wind-up goes back where the real
   * one is, and the fifteen frames of coil that are the whole tell of this move
   * are visible for the first time.
   *
   * The port tag is the one thing `over` still lands under, so the held
   * position is kept behind the head rather than directly above it — the tag is
   * readability and a graphic should move out of its way rather than fight it.
   */
  sideB: ({ ctx, x, y, u, dir, frame, total, over }) => {
    // In the hand until it is thrown on frame 27 of 45; after that the
    // projectile system owns it and a second one here would be a second
    // boomerang.
    const release = total * 0.6;
    if (frame > release) return NOTHING;

    const k = Math.min(1, frame / Math.max(1, release));
    // Cubic, so the arm sits in the cocked position for most of the wind-up and
    // covers the distance in the last few frames. That ratio is the move: three
    // fifths of it is coil.
    // Fourth power, not cubed: cubed already had it two thirds of the way
    // home by frame 18, and the reference holds the cocked position until about
    // frame 22 of 27. The coil is the move; the whip is five frames.
    const swing = k * k * k * k;
    // The first beat is separate — he reaches up and back over the shoulder to
    // take it off his belt, which is a fast lift under a slow wind.
    const lift = Math.min(1, k * 3.2);
    // Clear of him, not merely behind him. `over` fixes occlusion and does
    // nothing about legibility: the first version of this held an eight-unit
    // tan crescent centred on his own head, and painting it in front only meant
    // a tan shape lying across a green shape with no readable edge between
    // them. Held two and a half units past the back of his skull, its outline
    // is against the sky for the whole coil.
    // Where the *pose* actually puts his hand, not where the graphic reads
    // best. The clip cocks the off arm to (−2.9, 11.7) rig units at the top of
    // the coil and drives it to (4.8, 8.6) at the release; an effect never sees
    // the skeleton, so these are that arithmetic, and drifting them apart to
    // buy clearance is how a held object ends up floating beside the fighter
    // holding it. Half a unit high and behind is the grip.
    const hx = (-2.4 - lift * 1.1 + swing * 10.6) * u * dir;
    const hy = -(11.2 + lift * 2.0 - swing * 4.2) * u;
    // Held nearly *flat* at the top of the coil rather than upright. Upright
    // and tan and two units behind his skull, an eight-unit crescent reads as a
    // ponytail — which is a shape Link plausibly has, so the eye accepts it and
    // stops looking. Laid over, it is a wing above his head and nothing else.
    const spin = (0.35 + lift * 1.15 - swing * 3.6) * dir;

    over(() => {
      ctx.save();
      ctx.translate(x + hx, y + hy);

      // A white blur ring under it once the arm is actually moving: the throw
      // spins it up before it leaves, and this is the frame or two where that
      // is legible.
      if (swing > 0.45) {
        ctx.globalAlpha = Math.min(0.5, (swing - 0.45) * 1.6);
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = u * 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, u * 3.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.rotate(spin);
      ctx.scale(dir, 1);
      paintBoomerang(ctx, u * BOOMERANG_HALF, "#C9B27A");
      ctx.restore();

      // The release flare: a blue-white star at the hand on the last frames
      // before it goes, which is what the real one does and what tells a player
      // the projectile is out rather than still being wound.
      if (k > 0.88) {
        const f = (k - 0.88) / 0.12;
        ctx.save();
        ctx.translate(x + hx, y + hy);
        glow(ctx, 0, 0, u * 4.5 * f, `rgba(150,200,255,${0.55 * f})`);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "#FFFFFF";
        ctx.globalAlpha = f;
        for (const [ax, ay] of [
          [1, 0],
          [0, 1],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(ax * u * 5 * f, ay * u * 5 * f);
          ctx.lineTo(ay * u * 0.9, -ax * u * 0.9);
          ctx.lineTo(-ax * u * 5 * f, -ay * u * 5 * f);
          ctx.lineTo(-ay * u * 0.9, ax * u * 0.9);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    });
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
    // The same span as the one in his hand. It used to shrink to under half
    // that the moment it left him, which is a boomerang that reads as a thrown
    // pebble — and made the graphic smaller than the hitbox it stands for.
    const s = u * BOOMERANG_HALF;

    // Two blurred echoes behind it, so it reads as spinning rather than as a
    // shape that happens to be at a different angle each frame. The official
    // art draws three overlapping rings for exactly this reason.
    ctx.save();
    for (const [back, alpha] of [
      [1.05, 0.16],
      [0.52, 0.3],
    ] as const) {
      ctx.save();
      ctx.rotate(spin - back * (returning ? -1 : 1) * dir);
      boomerangPath(ctx, s);
      ctx.fillStyle = `rgba(226,214,178,${alpha})`;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.save();
    ctx.rotate(spin);
    paintBoomerang(ctx, s, returning ? "#D8C48C" : "#C9B27A");
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
