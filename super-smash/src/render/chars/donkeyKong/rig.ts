// Barrel torso on tiny legs, arms past the knees, shoulders half again as wide
// as his hips. Blacked out this is already DK and nobody else in the roster —
// or it is, once three things stop fighting the drawing order.
//
// **1. The upper body is a trapezoid, not a capsule.** A capsule's rounded top
// cap *is* a second head: it used to rise to within 0.9 units of the skull, so
// the head circle never left the body and DK read as one continuous egg with a
// face painted near the top of it. `FUR_MASS` paints the real shape behind the
// torso — widest across the shoulders, tapering to the waist, hunched so there
// is more of him behind the spine than in front — and the torso capsule shrinks
// to the barrel inside it. The head also had to come down: at `headRadius` 2.35
// on an 11.4-unit rig he was headier than Mario, which is the wrong way round
// for the roster's biggest body.
//
// **2. The near arm is repainted as a prop.** See `furSegment`.
//
// **3. Colour, last and least.** The tie is `secondary`, which the palette
// spells out as "the tie" and which had been `accent` — cream — so his single
// most cited feature was the same colour as his chest and merged into it. It was
// also upside down: a prop's `+y` runs toward the bone's *tip* and the torso's
// tip is the shoulders, so the blade hung up over his chin. It needs `angle`,
// the same way Fox's and Pikachu's tails do.

import {
  ARMS,
  FEET,
  HANDS,
  LEGS,
  SMASH_YELLOW,
  group,
  poly,
  tweakRig,
  type CharacterRig,
  type PropDef,
} from "../../rigKit";

const HEAD_RADIUS = 2.0;
/** Height of the fur mass's top edge above the shoulder joint, rig units. */
const FUR_TOP = 1.15;
/**
 * How hard the near arm's own edge is drawn, in rig units of stroke width.
 *
 * At match scale one rig unit is about seven pixels, so the 0.26 this started
 * at is under two — a hairline, and the arm that is supposed to be the whole
 * character read as a scratch on the barrel.
 */
const ARM_EDGE = 0.42;
/**
 * The near limb's lift off the body it hangs down. See `furSegment`.
 *
 * A review measured the first attempt at this — an 11% wash — at **1.27:1**
 * against the torso behind it and called the arm invisible, which it was: what
 * survived was two parallel outline strokes that read as a zipper down his
 * chest. A quarter is what it takes for the limb to be a limb.
 */
const LIMB_WASH = "rgba(255,242,224,0.26)";

const bones = tweakRig({
  // The root strut is the leg's length: scale one without the other and the
  // feet float above the stage or sink through it.
  root: { len: 0.79 },
  hip: { thick: 1.3, len: 0.864 },
  // Long, and narrower than he looks: the fur mass behind it carries the
  // shoulders, and a torso capsule wide enough to be DK's chest on its own
  // swallows his head.
  torso: { thick: 1.08, len: 1.39 },
  // Not a neck so much as clearance — the skull has to finish clear of the
  // shoulder line or there is no head in the silhouette at all.
  head: { len: 0.976, thick: 1.5 },
  ...group(LEGS, { len: 0.778, thick: 1.34 }),
  // Broad rather than long, and that split is load-bearing.
  //
  // At `len: 1.8` his soles went through the stage on three SHARED clips —
  // `dash` (0.89), `brake` (0.86) and `shieldBroken` (0.84), against a 0.8
  // tolerance — which are clips this fighter does not own and cannot fix. Foot
  // *length* is the whole cause: the shared stances solve from angles, and
  // where they pitch the foot toe-down the extra length digs in, while `idle`
  // holds the foot flat so it never showed at rest.
  //
  // Foot *thickness* costs nothing, because the sole depth is measured against
  // this rig's own standing plant and a uniform thickness cancels out of both
  // sides. So the mass a 400lb ape's feet need is bought across the foot
  // instead of along it: `len` down to 1.4 (dash 0.60, brake 0.55,
  // shieldBroken 0.66) and `thick` up to 1.55.
  ...group(FEET, { len: 1.4, thick: 1.55 }),
  // Arms past the knees is the whole character, and this is as long as they can
  // be without breaking a *shared* clip. `poses/roll.test.ts` asserts the roll's
  // tuck stays roughly ball-shaped on every rig, and its own comment already
  // names DK as the loose end: "his arms are long enough that even wrapped round
  // his shins they stretch the ball sideways". At `len: 1.62` he is 1-4% outside
  // both limits (tuck 1.5617 and aspect 1.5208 against 1.5); at 1.50 he is
  // inside both (1.4870 / 1.4493) and still 2.01 times his own leg length, which
  // is a gorilla. Thinning does not substitute for shortening — at len 1.62,
  // thick 1.40 the tuck is still 1.5224, because the overshoot is reach.
  ...group(ARMS, { len: 1.5, thick: 1.65 }),
  ...group(HANDS, { thick: 1.55, len: 1.3 }),
});

/*
 * The shapes below are authored in **rig units, with `size: 1`**, so a prop's
 * local frame is the rig's own and the numbers can be compared straight to a
 * bone length. For the torso props the origin is the torso's tip, which is the
 * shoulder joint: `+y` runs up the spine, `+x` is his front, and the waist is
 * at `-4.45`.
 */

/**
 * Shoulders, back and flanks in one shape, behind everything.
 *
 * 8.15 units across the shoulders against 4.2 at the waist. The taper is not
 * decoration: a trunk as wide at the bottom as at the top is a barrel, and a
 * barrel swallows the arms hanging down it.
 */
const FUR_MASS: readonly (readonly [number, number])[] = [
  [2.4, FUR_TOP], // trapezius, flat either side of the neck
  [3.4, 0.85],
  [3.85, 0.0], // the front deltoid, rounded rather than pointed
  [3.5, -1.15],
  [2.05, -4.3], // front of the waist
  [-2.15, -4.25], // back of the waist
  [-3.8, -1.2],
  [-4.3, 0.0], // the hump behind the shoulder — the widest point on him
  [-3.75, 0.9],
  [-2.6, FUR_TOP],
];

/**
 * Chest and belly: the tan patch, framed by fur on every side.
 *
 * Wide enough to show on both sides of the near arm, which hangs straight down
 * the middle of it in a strictly side-on rig. A patch narrower than that reads
 * as a slab stuck on one flank.
 *
 * It is carried **0.8 forward** of where it started, and that is a bug fix
 * rather than taste. Drawn centred on the spine, the tie — which sits a unit
 * in front of it — landed clear of its front edge with a strip of bare fur
 * between the two, and a review reading the render cold called them "a white
 * bandage on his shoulder blade and a separate bib". The chest is one lighter
 * mass on his **front**, with the tie lying on top of it; the patch has to
 * reach past the tie for that to be what it looks like.
 */
const CHEST: readonly (readonly [number, number])[] = [
  [3.15, -1.3], // collar, front
  [3.5, -2.4],
  [3.1, -3.85],
  [1.6, -4.6], // the belly hangs a little past the waist
  [-0.2, -4.4],
  [-1.1, -3.15],
  [-1.0, -1.5], // collar, back
  [0.75, -1.0], // and a rise between the pectorals
];

/**
 * The tie, hand-drawn rather than the shared `tie` prop, for three reasons a
 * review of the render found in one pass.
 *
 * It ran from **43% to 65% of his height** — a full tie-length too low, no
 * collar, no knot, tip at the crotch — so it read as "a bib", or a tongue. It
 * was **too short**, 22% of his height against the 30% the real one covers.
 * And it carried the yellow marking as a **plain square**, where the two
 * letters `DK` are the single most load-bearing thing in the whole design:
 * without them a brown ape in a red band is a brown ape in a red band.
 *
 * Drawn in the torso-tip frame the other body props use, so the knot starts at
 * the collar — one unit below the shoulder joint — and the point finishes 5.6
 * down, which is past the waist at 4.45. Carried forward on `x` so it lies on
 * the chest patch rather than beside it.
 */
const TIE_KNOT: readonly (readonly [number, number])[] = [
  [-0.6, 0.0],
  [0.6, 0.0],
  [0.86, -1.03],
  [-0.86, -1.03],
];

const TIE_BLADE: readonly (readonly [number, number])[] = [
  [-0.78, -1.07],
  [0.78, -1.07],
  [1.24, -3.0],
  [0.02, -4.67],
  [-1.22, -3.0],
];

/**
 * Where the knot hangs from, in the torso-tip frame: the collar, his front.
 *
 * Carried well out onto the front of the chest, and that is a fix rather than a
 * placement. The tie is painted **after** the near arm, deliberately — the arm
 * hangs down the middle of a strictly side-on rig and would otherwise bury the
 * one marking everybody knows him by. But with the tie hanging plumb from a
 * point only 1.4 along his front, and the arm hanging plumb from the shoulder
 * joint at zero, the two ran parallel and overlapped by more than a unit: the
 * tie cut the near forearm in half and left its two edge strokes showing either
 * side of the red. A review reading the idle cold called it "wearing
 * **suspenders**", which is exactly what it looked like. At 2.55 the lean
 * carries the knot 1.6 units clear of the arm's line and both shapes survive
 * whole — the tie in front, the arm beside it.
 */
const TIE_COLLAR: readonly [number, number] = [2.55, -1.05];

/**
 * How much of the body's own tilt the tie is allowed to keep.
 *
 * Zero would be a plumb bob welded to his collar, which is what a tie actually
 * is and which looks dead. A tenth is enough that it leans into a lunge and
 * settles out of it, without ever reading as painted on.
 */
const TIE_FOLLOW = 0.12;

/**
 * The rotation, in the prop's own frame, that points the blade at the floor.
 *
 * The tie is the only plumb line on the character — a red vertical against a
 * chest pitched fifty degrees over — and it is one of the handful of things a
 * player names him by. A prop is bolted rigidly to its bone, though, so the
 * tie hung at whatever angle the spine did and read as a sash.
 *
 * The bone's angle is not handed to a painter, but the canvas transform is.
 * Local `(0, -1)` — down the blade — lands on screen at `(-c, -d)`; rotating
 * the local frame by `phi` first sends it to
 * `(a·sin φ − c·cos φ, b·sin φ − d·cos φ)`, and that is vertical exactly when
 * `tan φ = c / a`. The sign test picks the solution that points *down* rather
 * than up. Deriving it from the live matrix rather than from the pose is what
 * makes it correct under the facing mirror as well, where a hand-computed
 * angle would come out backwards.
 */
function plumbAngle(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform?.();
  if (!m) return 0;
  let phi = Math.atan2(m.c, m.a);
  if (m.b * Math.sin(phi) - m.d * Math.cos(phi) < 0) phi += Math.PI;
  // Shortest way round, so the damping below cannot be applied to a 350° turn.
  phi = ((phi + Math.PI) % (Math.PI * 2)) - Math.PI;
  return phi * (1 - TIE_FOLLOW);
}

/**
 * The jaw-and-neck line: the back of the head circle's underside, drawn dark.
 *
 * The head and the shoulders are both `primary` — they are the same animal —
 * so once the head clears the shoulders in *outline* there is still nothing
 * separating them in *colour*, and at HUD sizes the outline is two pixels. This
 * is the arc of the skull from the point where it enters the fur mass round to
 * just short of straight down: any further and it would cut across the muzzle,
 * which sits over the front half of the same arc.
 */
const JAW_ARC = Math.acos((bones.head.length - FUR_TOP) / HEAD_RADIUS);

/**
 * One segment of the *near* arm, repainted over the front props.
 *
 * DK's arms are the whole character and they were invisible. Three things at
 * once: `primary` fur crossing a `primary` barrel has no edge; the rim pass
 * outlines the *union* of the figure, so nothing at all is drawn where a limb
 * lies inside the body; and the chest patch and the tie are front props, which
 * `paintFigure` draws **after** the near limbs — so they painted cream and red
 * straight over the arm that crosses them.
 *
 * There is no palette role for a second fur tone (`secondary` is the tie,
 * `accent` and `skin` are both pale) and a literal brown would not survive the
 * costumes, which run from white to purple. So the arm gets a contour instead:
 * the same capsule the bone draws, refilled in the same role on top of the
 * props, with its two long edges stroked in `outline`. `outline` is
 * costume-invariant, it is the colour the rim is already drawn in, and a drawn
 * edge down a limb is what the source art does anyway. The fist strokes the
 * whole capsule rather than the sides, because it is nearly round and because
 * it hangs next to a foot of exactly the same colour.
 *
 * Body pass only — the bone already owns this shape in the rim and silhouette
 * passes, and painting it twice there would quietly fatten the arm.
 */
function furSegment(
  bone: "upperArmR" | "forearmR" | "handR",
  colour: string,
  closed = false,
): PropDef {
  const length = bones[bone].length;
  const r = bones[bone].thickness / 2;
  return {
    kind: "custom",
    bone,
    at: 0,
    size: 1, // one local unit is one rig unit, so this *is* the bone
    colour,
    draw: (b) => {
      if (b.mode !== "body") return;
      const ctx = b.ctx;
      ctx.beginPath();
      ctx.arc(0, length, r, 0, Math.PI);
      ctx.arc(0, 0, r, Math.PI, Math.PI * 2);
      ctx.closePath();
      b.fill(colour);
      // A wash rather than a second palette entry. `roleColour` passes anything
      // that is neither a role name nor a hex straight through, so an rgba()
      // lightens whatever the costume made `primary` without naming a colour of
      // its own — white DK stays white, purple DK stays purple. It is needed
      // because the near arm hangs down a barrel painted in exactly the same
      // role, and two long stroked edges on their own read as a pair of lines
      // drawn *on* the chest rather than as the limb in front of it. Lighter
      // and not darker: `paintFigure` already shades the far limbs by −0.24, so
      // far < body < near is the depth order the eye is being given.
      b.fill(LIMB_WASH);
      if (closed) {
        b.line("outline", ARM_EDGE);
        return;
      }
      // Sides only: two capsules meeting at the elbow would otherwise cross
      // each other's end caps and draw a lens over the joint.
      //
      // Inset by half the stroke width at both ends, because `b.line` strokes
      // with a **square** cap — a rail drawn flush to `0..length` therefore
      // sticks a blunt half-width tab out past the rounded cap it is supposed
      // to be tangent to. A review reading the render at 7x described the
      // result exactly: "each rail overshoots the cap with a blunt square end
      // and dangles free in the fur". Two dangling scratches are what made the
      // idle read as braces rather than as an arm.
      const inset = ARM_EDGE / 2;
      ctx.beginPath();
      ctx.moveTo(r, inset);
      ctx.lineTo(r, length - inset);
      ctx.moveTo(-r, inset);
      ctx.lineTo(-r, length - inset);
      b.line("outline", ARM_EDGE);
    },
  };
}

export const rig: CharacterRig = {
  id: "donkeyKong",
  // Feet to crown is 13.16 rig units and 1.163 of them is 15.3 world units,
  // which is the 15.0-unit hurtbox in `fighters/donkeyKong.ts`. Change a bone
  // length and change this with it.
  scale: 1.163,
  bones,
  headRadius: HEAD_RADIUS,
  boneColour: {
    torso: "primary",
    hip: "primary",
    head: "primary",
    thighL: "primary",
    thighR: "primary",
    shinL: "primary",
    shinR: "primary",
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "primary",
    forearmR: "primary",
    handL: "skin",
    handR: "skin",
    footL: "skin",
    footR: "skin",
  },
  props: [
    {
      kind: "custom",
      bone: "torso",
      at: 1,
      size: 1,
      colour: "primary",
      layer: "behind",
      draw: (b, p) => {
        poly(b.ctx, FUR_MASS);
        b.fill(p.colour);
      },
    },
    {
      // `accent` is spelled "muzzle and chest" in the palette and stays pale
      // across all six costumes, which is right for bare skin and wrong for fur.
      kind: "custom",
      bone: "torso",
      at: 1,
      size: 1,
      colour: "accent",
      draw: (b, p) => {
        if (b.mode !== "body") return; // a flat marking must not thicken the rim
        poly(b.ctx, CHEST);
        b.fill(p.colour);
        // Its own edge, drawn in the body pass only so it still costs the rim
        // nothing. The chest patch and the muzzle are the *same* palette role,
        // and the chest was the one element on him with no outline at all — so
        // the moment the spine pitched far enough for them to touch they welded
        // into a single cream puddle. Measured on the contact frames of the
        // forward smash, the back air and the neutral air, the two shapes came
        // out as **one** connected component of about 1700 pixels each time,
        // and on the down air the muzzle was 81% eaten. A patch that can merge
        // with the face is a patch that deletes the face.
        b.line("outline", 0.2);
      },
    },
    // Ears sit low and well back, and are fur rather than skin: their job is to
    // put a lump on the back of a circle, not to add a second pale shape
    // competing with the muzzle. Bigger and pushed further out than they were,
    // because at `size: 0.9, across: -1.35` they sat *inside* the skull circle
    // and a review looking at the render found no ears at all: "the head is a
    // smooth unbroken dome". An ear that does not break the outline is not in
    // the silhouette, and the silhouette is the whole game.
    { kind: "earsRound", bone: "head", at: 1, size: 1.2, across: -1.7, along: -0.25, colour: "primary" },
    // The muzzle is most of his face, and it has to leave the head's circle at
    // the front and hang below it at the jaw, or the head is a ball with
    // markings painted on it.
    { kind: "muzzle", bone: "head", at: 1, size: 1.5, across: 1.0, along: -1.25, colour: "accent" },
    // Small and close-set, sat on the muzzle's top edge. Spelt out rather than
    // `eyes()` because they need an `along` to land there.
    //
    // Half again the size they were, and that is the whole face read. At 0.5
    // the two eyes came to *seven pixels* of white between them, mostly
    // occluded by the brow, while the muzzle's nose is a large solid black
    // circle high on a pale oval — so the biggest, darkest, roundest mark on
    // his head sat where an eye goes and the face parsed as a one-eyed seal.
    // Eyes have to out-mass the nose or the nose becomes the eye.
    {
      kind: "face",
      bone: "head",
      at: 1,
      size: 0.78,
      across: 0.5,
      along: 0.26,
      colour: "#FFFFFF",
      detail: "#1B1B22",
    },
    // The brow ridge, *after* the eyes: DK's brow overhangs them, and a prop
    // drawn before them is a bar behind their heads instead — which is what it
    // looked like, a headband. Lifted with the eyes so it shades them rather
    // than covering them.
    { kind: "brow", bone: "head", at: 1, size: 1.0, across: 0.62, along: 0.7, colour: "#3A2412" },
    furSegment("upperArmR", "primary"),
    furSegment("forearmR", "primary"),
    furSegment("handR", "skin", true),
    // The jaw line, after the arm: the near arm's shoulder cap reaches up under
    // the chin and was painting over it.
    {
      kind: "custom",
      bone: "head",
      at: 1,
      size: 1,
      colour: "outline",
      draw: (b, p) => {
        if (b.mode !== "body") return;
        b.ctx.beginPath();
        // `-PI/2` is straight down the bone: the prop frame's `+y` runs up it.
        //
        // Only the *back* half of the arc, and that is a correction. Drawn
        // across its full 50° it swept round far enough to read as a thick
        // black crescent across the front of the skull — a review called it "a
        // mouth drawn on his forehead" and it was the reason the face did not
        // parse: brow, nose and this arc assembled into brow, eye and grin.
        // What it is for is separating a `primary` skull from a `primary`
        // shoulder, which only needs the part actually against the fur.
        b.ctx.arc(0, 0, HEAD_RADIUS, -Math.PI / 2 - JAW_ARC, -Math.PI / 2 - JAW_ARC * 0.42);
        b.line(p.colour, 0.3);
      },
    },
    // Last, so it is never buried by the arm that hangs down the middle of a
    // strictly side-on rig. Ultimate presents him three-quarters and the tie is
    // always the thing you see; a red band down his chest is the read, and an
    // arm passing behind it is the smaller lie.
    {
      kind: "custom",
      bone: "torso",
      at: 1,
      size: 1,
      colour: "secondary",
      detail: SMASH_YELLOW,
      draw: (b, p) => {
        if (b.mode !== "body") return; // a flat marking must not thicken the rim
        b.ctx.save();
        b.ctx.translate(TIE_COLLAR[0], TIE_COLLAR[1]);
        b.ctx.rotate(plumbAngle(b.ctx));
        poly(b.ctx, TIE_KNOT);
        b.fill(p.colour);
        poly(b.ctx, TIE_BLADE);
        b.fill(p.colour);
        // The monogram, as two stroked glyphs rather than a text call. Both
        // letters are symmetric top to bottom, so it does not matter which way
        // up the prop frame runs, and both are drawn in `detail` rather than
        // set on the context directly — a painter that touches `ctx.fillStyle`
        // paints that colour into the rim pass and punches a hole in him.
        const y = -2.6;
        const h = 0.6; // half the glyph height
        b.ctx.beginPath();
        b.ctx.moveTo(-0.72, y + h);
        b.ctx.lineTo(-0.72, y - h);
        b.ctx.moveTo(-0.72, y + h);
        b.ctx.quadraticCurveTo(0.18, y, -0.72, y - h);
        b.ctx.moveTo(0.34, y + h);
        b.ctx.lineTo(0.34, y - h);
        b.ctx.moveTo(1.0, y + h);
        b.ctx.lineTo(0.34, y);
        b.ctx.lineTo(1.0, y - h);
        b.line(p.detail ?? SMASH_YELLOW, 0.28);
        b.ctx.restore();
      },
    },
  ],
};
