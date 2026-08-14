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
 * is 11.8; the chord these two numbers describe, `2 · r · sin(OPEN)`, is 10.0,
 * which is 0.71 H. Held at arm's length the top limb clears his head and the
 * bottom limb reaches below his knee, which is what the reference shows.
 *
 * The first pass drew a 6.2-unit arc half a forearm thick and it read as a gold
 * hair floating beside him rather than as a weapon he was holding.
 *
 * The circle is centred a full radius *behind* the hand, so the forward-most
 * point of the arc — the grip — is exactly where the hand is. It used to be
 * centred half a unit behind the hand, which put the whole bow one to three
 * units in front of his fist with nothing joining them.
 *
 * The **brace** — how far the limb tips sit behind the grip, `r · (1 − cos
 * OPEN)` — is the number that decides whether this reads as a bow at all, and
 * it was wrong in a way neither the arithmetic nor a 1:1 capture showed. At
 * `r = 5.6, OPEN = 1.15` the brace was 3.3 world units and the bow hand is only
 * 4.8 out from his centre, so the tips landed 1.5 units forward — *inside* a
 * torso that is 2 units to the half. The limbs disappeared into his chest at
 * both ends and what was left, seen from the side, was a shallow arc entering
 * and leaving his body: two critics independently described it as a hoop or an
 * ellipse closed around his torso, and one filed it as a bug — the prop looked
 * bound to the wrong bone.
 *
 * A flatter, larger circle fixes it without shrinking the bow. Radius 8.9 over
 * 0.6 radians gives the same 10-unit chord, seven tenths of his height, with a
 * brace of only 1.6 — so the tips sit 3.2 units forward, clear of him, and the
 * whole limb is against the sky. It is also closer to what a recurve looks like
 * side-on, which is much flatter than the semicircle the first pass drew.
 */
const BOW_R = 8.9;
const BOW_OPEN = 0.6;
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
 * The Boomerang's palette.
 *
 * This is the part four rounds of critics kept calling hair, and the reason is
 * arithmetic rather than taste. The old body was `#C9B27A`; Link's hair swoop
 * is `#E8C86A`. Converted to HSL those are **hue 42.5° and hue 44.8°** — two
 * degrees apart — at luma 178 against 199, with his skin a third warm mid-tone
 * at 208. Three shapes in the same hue family at the same value, touching, with
 * a warm brown rim (`#3A1C12`) around the moving one that is itself the colour
 * hair is shaded in. There is no placement that rescues that, and five attempts
 * at placement is what the last round spent.
 *
 * So: cool, and away from *everything* on him. Link is warm nearly everywhere —
 * skin, hair and trim are golds, leather and the quiver are browns — and the
 * tunic, the one exception, is dark green. The bar in `docs/character-art.md`
 * is "would someone who plays Ultimate name this character from a still frame
 * of this move". Nobody names Link from the boomerang's wood tone; they name
 * him from a big two-armed spinning V leaving his hand. Silhouette first,
 * colour last — but *last* is not *never*, and the silhouette work is done.
 */

/**
 * Teal, and **saturated** — which is the second half of the colour problem and
 * the half that is easy to walk straight into while fixing the first.
 *
 * Going cool escapes Link's hair and skin. It does not escape his *sword*. A
 * neutral slate body (`#96A6C0`) with steel caps is the Master Sword's own
 * palette — blade `#DCE4EC`, fuller `#9BB0C4` — and the Hylian Shield's rim
 * (`#9FAABC`) besides. A critic reading a capture cold named the object "a bent
 * or snapped-off sword blade" *first*, and boomerang only third, and said the
 * whole left half of his silhouette had become an unresolvable pile of
 * overlapping silver shapes. Escaping one collision into another is not
 * progress.
 *
 * Saturation is what neither the hair nor the sword has. The tunic is the only
 * saturated thing on him and it is green at 120°; his steel is 8% saturated;
 * his hair, skin and trim are all warm 30–45°. A 57%-saturated teal at 173° is
 * outside every one of those, in the one axis none of them use.
 *
 * It is also not invented. The bow on his back is wrapped in `#40746C` and its
 * arrows are fletched `#214D4A`, and `rig.ts` says of that teal, in exactly
 * this situation: "the one colour on Link that is neither tunic green, steel
 * nor leather, and it is what stops the bow reading as another strap." The
 * boomerang had the same problem and wanted the same answer. Ultimate's is the
 * plain Breath of the Wild Boomerang — a Rito weapon, teal-bound and
 * bone-capped — rather than Brawl's Gale Boomerang; this is that object read
 * for legibility, not a recolour of it.
 */
const BOOM_BODY = "#4FB8AC";
/**
 * The end caps.
 *
 * Bone was the obvious choice and it was wrong for a reason that only a pixel
 * sample finds. `#EDE4CC` against Link's trousers, `#E9DCC0`: a critic reading
 * a capture cold sampled them at (237,228,204) and (233,220,192) and called
 * them "the same cream" — which they are, four points apart per channel. On the
 * frames where the throw sweeps across his thigh the tips simply dissolved into
 * his leg. Checking a new colour against his hair, his skin and his sword and
 * not against his trousers is how that got shipped twice in one session.
 *
 * Tinted toward the body instead: a very pale cyan-white at hue 172°, which is
 * the teal's own hue at the top of the value range. It keeps the pop against
 * the navy sky that made the tips work at all, and there is nothing else on the
 * fighter or the stage in that hue at that value.
 */
const BOOM_CAP = "#CFF3EE";
/**
 * The rim, and deliberately not the near-black it was.
 *
 * The same critic noted that the object's outline was a different colour from
 * the character's — his is `#16240F`, a dark green — and that the mismatch was
 * "a large part of why it reads as a foreign asset pasted on". This is dark
 * enough to edge the shape against the sky and in his own outline's family, but
 * not the outline colour itself: an effect painted in exactly that vanishes
 * into the fighter's own rim wherever the two cross, which is the failure
 * `docs/character-art.md` records against Kirby's Inhale.
 */
const BOOM_RIM = "#12291F";

/**
 * The Boomerang's outline, in its own frame: `s` is **half the tip-to-tip
 * span**, tips at `(0, ±s)`, elbow bulging toward `+x`.
 *
 * Tip to tip it is 0.59 of Link's own height, which on this rig is eight world
 * units: two and a half times the width of his torso, and more than twice what
 * the first pass drew.
 *
 * **Straight arms and a hard elbow, not a smooth crescent.** The previous pass
 * measured the model as a continuous curve with no hinge in it and drew that
 * honestly, and it is the single geometric reason the object read as hair: a
 * hank of hair is exactly a smooth tapered curve with no vertex anywhere on it,
 * so a smooth tapered curve beside a head is read as hair before it is read as
 * anything else. A vertex is what says *manufactured*.
 *
 * Two of the measured numbers are then deliberately not used, and both for the
 * same reason — this object has to survive being eight screen units of a
 * thousand-pixel frame.
 *
 * The **elbow** measures 122° and is drawn at 105°. A shallower bend is a
 * straighter object, and a straight object at match scale is a stick; the bend
 * is the entire identity of a boomerang and it is the first thing distance
 * takes away.
 *
 * The **arm** measures 0.064 of the span across. Drawn honestly that is half a
 * world unit — six pixels at match scale — and it disappears exactly the way
 * the shared `sword` prop did. It tapers 0.21 → 0.16 of the half-span instead,
 * elbow to tip. A first cut at 0.17 → 0.11 was still a wire in a capture.
 *
 * Tips are left blunt rather than needled, because a blunt tip is what the
 * steel caps below have to sit on.
 */
const TIP = 1.0;
const TIP_IN = 0.74;
const ELBOW = 0.72;
const ELBOW_IN = 0.46;

function boomerangPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  // Outer edge: tip, down the arm to the elbow, back out to the other tip.
  ctx.moveTo(0, -TIP * s);
  ctx.lineTo(ELBOW * s, -0.06 * s);
  ctx.lineTo(ELBOW * s, 0.06 * s);
  ctx.lineTo(0, TIP * s);
  // Inner edge back again, blunt across each tip.
  ctx.lineTo(0, TIP_IN * s);
  ctx.lineTo(ELBOW_IN * s, 0.05 * s);
  ctx.lineTo(ELBOW_IN * s, -0.05 * s);
  ctx.lineTo(0, -TIP_IN * s);
  ctx.closePath();
}

/**
 * How far down each arm, from the tip, the steel cap runs — as a fraction of
 * the arm.
 *
 * A third, and that number is the whole point. The caps have been in this file
 * since round one, described as "the reason it reads as a weapon rather than as
 * a croissant", and they have never once been visible. They were slivers laid
 * *along* the outer edge — 0.178 of the half-span across at the widest, which
 * is 6 pixels at match scale — and then stroked with their own `0.08 · s` dark
 * outline, centred on the path, which eats 0.04 · s from each side. Six pixels
 * of grey minus five and a half pixels of brown leaves about half a pixel of
 * cap. The detail that the comment said was doing all the work was, measurably,
 * not drawn.
 *
 * These span the **full width of the arm** instead, so the outer third of each
 * arm is pale and the inner two thirds are teal. That banding is the second
 * half of the anti-hair argument and the more robust half: hair is one
 * continuous tone from root to tip. A two-tone object with hard bright ends is
 * not hair whatever colour you paint it.
 */
const CAP = 1 / 3;

/**
 * Paint one boomerang at the origin: teal body, dark rim, and pale caps over
 * the outer third of each arm. Nothing else — see the note at the foot of
 * this function about the markings that used to be here.
 */
function paintBoomerang(ctx: CanvasRenderingContext2D, s: number, body: string): void {
  // **Stroked first, then filled**, and that order is the whole difference
  // between a teal boomerang and a black one. A stroke is centred on its path,
  // so a rim of `0.14 · s` laid over an arm that is `0.16 · s` across takes
  // `0.055 · s` off each side and leaves about a third of the body colour
  // showing — at match scale, five pixels of dark rim on a six-pixel arm. The
  // first cut of this drew the fill and then the rim on top of it, and a
  // capture of the hold came back as a near-black wire with two pale tips,
  // which is precisely the failure the old steel caps had. Filling *after*
  // covers the inner half of the stroke, so the rim keeps its outer half and
  // the body keeps its full width.
  boomerangPath(ctx, s);
  ctx.strokeStyle = BOOM_RIM;
  ctx.lineWidth = Math.max(2, s * 0.14);
  ctx.stroke();
  ctx.fillStyle = body;
  ctx.fill();

  // The caps, filled and not stroked. The body's own rim already outlines the
  // silhouette they sit inside; a second outline around a shape this size is
  // exactly what consumed the last pair.
  ctx.fillStyle = BOOM_CAP;
  for (const end of [-1, 1]) {
    // Lerped along the two edges the body is drawn from, so the cap sits on the
    // arm rather than beside it and stays on it if the outline is retuned.
    ctx.beginPath();
    ctx.moveTo(0, end * -TIP * s);
    ctx.lineTo(ELBOW * CAP * s, end * (-TIP + (TIP - 0.06) * CAP) * s);
    ctx.lineTo(ELBOW_IN * CAP * s, end * (-TIP_IN + (TIP_IN - 0.05) * CAP) * s);
    ctx.lineTo(0, end * -TIP_IN * s);
    ctx.closePath();
    ctx.fill();
  }

  // **No grip wrap, and that is a deletion rather than an omission.**
  //
  // There have now been two attempts at a binding on this object and both made
  // it read as something else. Cord at the tips, on the old tan body, read as
  // hair ties — two bands at the ends of a curve beside a head. Moved to the
  // elbow it became two dark bars at the inside of a bend, which is 2 × 4
  // pixels at match scale, and a critic reading a capture cold reported them as
  // "a knuckle or elbow crease" reinforcing a read of the whole object as a
  // bent arm.
  //
  // Both times the detail was authored for the close-up and judged at the
  // close-up. At the size this is seen, a small mark at the vertex of a dogleg
  // is a joint, whatever it is drawn as. The object has one job — be an angular
  // two-tone V — and every further mark on it has so far bought a new wrong
  // answer.
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
    // The grip: a short fat bar where his fist closes round it, which is the
    // one shape that says the bow is *held* rather than hovering — and the one
    // part that belongs *behind* the hand, because a fist closes over a grip
    // rather than the other way round.
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

      // The limbs, in front. They clear his torso now, but only just at the
      // tips, and half a limb drawn behind a shoulder while the string in front
      // of it runs the full span is exactly what made this read as a broken
      // bow with a loose string.
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

      // The string, nocked back with the draw and snapped flat once it is
      // loosed. Two strokes, because a one-pixel line over a blue sky is a
      // suggestion rather than a string.
      const tipX = cx - u * BOW_TIPS * dir;
      const tipY = u * BOW_HALF;
      for (const [w, c] of [
        [0.38, "rgba(20,16,10,0.6)"],
        [0.2, "#F4EFE2"],
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
    // Clear of him, not merely behind him — and this is the compromise in the
    // move, so it is worth being plain about.
    //
    // `over` fixes occlusion and does nothing about legibility. Two things were
    // still eating this graphic, and neither is colour:
    //
    // **The port tag amputates it.** `over` lands under the tag by design, and
    // the tag is `46 · zoom/7` wide, centred on the fighter — about ±3.3 world
    // units, from the crown up another 3.4. The hold sat at −5.2 laid over 60°,
    // so its inboard arm reached x = −3.4 and the tag covered the upper half of
    // the object through the whole coil. **One arm of a V is a hank of hair.**
    // The symmetry that makes it a boomerang was precisely the part being
    // clipped. `docs/character-art.md` warns about this in as many words; the
    // note this replaces believed it had dodged it by sitting behind the head
    // rather than above it, and the arithmetic says otherwise.
    //
    // **The whip dragged it across his face.** The old path was a straight
    // chord from (−5.2, 13.8) to the hand at (4.8, 8.6), and at x = 0 that is
    // y = 11.1 — inside a head that spans 9.3 to 14.2. Frames 18 to 24 laid the
    // whole object over his skull, and a capture of frame 21 is a ponytail with
    // a hair tie on it. Frames 6 and 12 are the ones that were checked, and
    // those two happen to be the clear ones.
    //
    // So: held further back, at −7.0, which clears the tag with the object
    // upright; and thrown **under the chin** rather than through it, with
    // `dip` bowing the path down past the shoulder. That is also the throw
    // Ultimate actually has — SmashWiki has him swing it behind himself and
    // toss it "forward sideways and somewhat underhanded", which is a sidearm
    // and not an overhand.
    //
    // The cost is the hold sitting about four units behind the fist rather than
    // two. The release is unchanged and still lands at (4.8, 8.6), which is the
    // hand, so the throw is honest and only the hold is displaced. An effect
    // never sees the skeleton, so every number here is arithmetic against
    // `poses.ts` and drifts silently if that clip's arm moves.
    // Starts behind his hip, not at his chest. The object is eight units long,
    // so wherever its centre sits it reaches four units either side of it —
    // from a chest-height start its top tip grazed the underside of the port
    // tag on frame 0 and its elbow sat on his jaw on frame 2. This is also
    // where the reach honestly begins: he takes it off his belt.
    const hx = (-5.0 - lift * 2.4 + swing * 12.2) * u * dir;
    const rise = 8.0 + lift * 6.4 - swing * 5.8;
    // **The throw passes under his chin, and the depth is not a taste choice.**
    // The hold is at 14.4 and the hand at 8.6, so the whole vertical travel is
    // 5.8 units — and his head occupies 9.4 to 14.2 of it. A path that merely
    // interpolates between the two ends spends nearly all of it inside the
    // skull whatever easing it is given, which is exactly what the straight
    // chord this replaces did.
    //
    // Five units of bow, together with the spin below, is the shallowest path
    // that keeps *every painted point* of an eight-unit object off his face for
    // all 27 frames. Found by search rather than by eye: three coupled easings
    // against a head and a UI box is more than a contact sheet can be read for,
    // and reading contact sheets for it is what the five previous attempts did.
    //
    // It is not only a dodge. SmashWiki has Ultimate's Link swing the boomerang
    // behind himself and toss it "forward sideways and somewhat underhanded",
    // and an underhand throw *is* a hand that drops past the hip and sweeps up.
    const dip = Math.sin(swing * Math.PI) * 5.0;
    const hy = -(rise - dip) * u;
    // Laid over about 40° through the coil, which is the angle at which the
    // bend is legible. This is the one number that had to be found in a capture
    // rather than reasoned: near-upright the object is presented very nearly
    // along its own bend axis, so the elbow flattens out and eight units of
    // boomerang read as a slightly bent stick — a capture of the hold at 22°
    // was exactly that, and a critic reading it cold called it a snapped blade.
    // At 40° both arms and the vertex are visible, and it still needs only
    // about 6 units of width, which is what there is between the tag's edge and
    // the open sky.
    //
    // 4.6 through the whip — a little over 260° — and that number is doing more
    // than spinning it up. It is what turns the object broadside as it passes
    // his chin, so its long axis is across the throw rather than reaching up
    // into his face. The dip and the spin solve the same constraint together.
    //
    // **Laying it the other way does not work, and has been measured.** At
    // +40° the object's upper tip ends against his raised sleeve, and two
    // critics independently read that as the boomerang being socketed into his
    // arm or his cap. The obvious answer is to flip the lay so that tip points
    // into open sky instead. Swept across hold angles from −26° to −46° and
    // every dip and spin rate that pairs with them, the flipped lay is strictly
    // worse: the only settings that keep the object out of the port tag are
    // near-upright, which is the bent-stick failure above, and every legible
    // angle either buries points under the tag or drops head clearance under
    // the 2.44-unit radius. The tip landing on the sleeve is a real defect and
    // it is not fixable from this file — see the report.
    const spin = (0.1 + lift * 0.6 - swing * 4.6) * dir;

    over(() => {
      ctx.save();
      ctx.translate(x + hx, y + hy);

      // Ghosts of the shape itself, at the rotations it has just come through,
      // once the arm is actually moving.
      //
      // This replaces a white ring of radius 3.4 that was stroked here for the
      // same purpose. A closed circle is not a blur — a critic reading a
      // capture cold reported "a pale disc behind him, no shape language shared
      // with anything else on screen; I first read it as a moon in the
      // background". Motion is read from *the same silhouette, repeated*, which
      // is why the projectile painter below already does exactly this and why
      // the official art draws three overlapping rings.
      if (swing > 0.4) {
        const blur = Math.min(1, (swing - 0.4) * 2.4);
        for (const [back, alpha] of [
          [0.9, 0.16],
          [0.45, 0.26],
        ] as const) {
          ctx.save();
          ctx.rotate(spin + back * dir);
          ctx.scale(dir, 1);
          boomerangPath(ctx, u * BOOMERANG_HALF);
          ctx.fillStyle = `rgba(190,235,225,${alpha * blur})`;
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.rotate(spin);
      ctx.scale(dir, 1);
      paintBoomerang(ctx, u * BOOMERANG_HALF, BOOM_BODY);
      ctx.restore();

      // The release flare, on the last two frames only.
      //
      // It used to run from `k > 0.88`, which is five frames — and for four of
      // them the graphic is still mid-sweep at his waist, so a critic reading
      // the capture cold said the star was "centred on his shield/torso, not on
      // the hand, and the brightest thing in the frame by a wide margin. It
      // reads as him getting hit, not throwing." A flare that says *released*
      // has to be where the release is and no earlier, and it does not need to
      // out-shout the object it is about.
      //
      // 0.94 rather than 0.96, which would put the whole flare on the single
      // frame the object is exactly at the hand. Two frames is the least that
      // reads as a flash rather than as a dropped frame.
      if (k > 0.94) {
        const f = (k - 0.94) / 0.06;
        ctx.save();
        // At the **hand**, which is a fixed point, rather than on the moving
        // graphic.
        //
        // Painted at the object's own origin this landed over his chest, and a
        // critic reading a capture cold reported the burst as "overlapping his
        // face/fist, not on the object — it doesn't read as coming from the
        // thing being thrown". Offsetting it along the object's own axis was
        // tried and is worse: by the release the shape has swung through 260°,
        // so its axis points backwards and the correction moves the flare
        // further behind him.
        //
        // The flare is not a property of the boomerang, it is the moment it
        // leaves. Anchoring it to the hand the throw ends at makes it
        // independent of the rotation, puts it forward of the fighter against
        // open sky, and is where a player is already looking.
        ctx.translate(x + HAND_X * u * dir, y - HAND_Y * u);
        glow(ctx, 0, 0, u * 2.6 * f, `rgba(170,240,225,${0.4 * f})`);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "#EAFFF8";
        ctx.globalAlpha = f * 0.8;
        for (const [ax, ay] of [
          [1, 0],
          [0, 1],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(ax * u * 3.0 * f, ay * u * 3.0 * f);
          ctx.lineTo(ay * u * 0.6, -ax * u * 0.6);
          ctx.lineTo(-ax * u * 3.0 * f, -ay * u * 3.0 * f);
          ctx.lineTo(-ay * u * 0.6, ax * u * 0.6);
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

    // Blurred echoes behind it, so it reads as spinning rather than as a shape
    // that happens to be at a different angle each frame. The official art
    // draws three overlapping rings for exactly this reason.
    //
    // Three, close together, rather than two spread over a radian. At 1.05 and
    // 0.52 radians back the first echo was far enough round to be seen as a
    // *second shape* rather than as the same one a moment ago: a critic reading
    // a capture cold called the projectile "a bird in flight — the pale trail
    // renders as a separate upswept wing above the body instead of a blur
    // behind it. Gull." Tightening the spread and adding a third step turns
    // three distinct objects into one smeared one.
    ctx.save();
    for (const [back, alpha] of [
      [0.54, 0.1],
      [0.36, 0.15],
      [0.18, 0.22],
    ] as const) {
      ctx.save();
      ctx.rotate(spin - back * (returning ? -1 : 1) * dir);
      boomerangPath(ctx, s);
      ctx.fillStyle = `rgba(150,225,212,${alpha})`;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.save();
    ctx.rotate(spin);
    // Lighter on the way home, which is the same tell the spin reversal gives
    // and the one that survives a frame where the spin happens to match.
    paintBoomerang(ctx, s, returning ? "#79D8CC" : BOOM_BODY);
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
