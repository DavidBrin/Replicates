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
 */
const CHEST: readonly (readonly [number, number])[] = [
  [2.35, -1.3], // collar, front
  [2.75, -2.4],
  [2.35, -3.8],
  [0.9, -4.55], // the belly hangs a little past the waist
  [-1.2, -4.4],
  [-2.4, -3.15],
  [-2.3, -1.5], // collar, back
  [0.0, -1.0], // and a rise between the pectorals
];

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
      if (closed) {
        b.line("outline", 0.26);
        return;
      }
      // Sides only: two capsules meeting at the elbow would otherwise cross
      // each other's end caps and draw a lens over the joint.
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(r, length);
      ctx.moveTo(-r, 0);
      ctx.lineTo(-r, length);
      b.line("outline", 0.26);
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
      },
    },
    // Ears sit low and well back, and are fur rather than skin: their job is to
    // put a lump on the back of a circle, not to add a second pale shape
    // competing with the muzzle.
    { kind: "earsRound", bone: "head", at: 1, size: 0.9, across: -1.35, along: -0.2, colour: "primary" },
    // The muzzle is most of his face, and it has to leave the head's circle at
    // the front and hang below it at the jaw, or the head is a ball with
    // markings painted on it.
    { kind: "muzzle", bone: "head", at: 1, size: 1.5, across: 1.0, along: -1.25, colour: "accent" },
    // Small and close-set, sat on the muzzle's top edge. Spelt out rather than
    // `eyes()` because they need an `along` to land there.
    {
      kind: "face",
      bone: "head",
      at: 1,
      size: 0.5,
      across: 0.55,
      along: 0.2,
      colour: "#FFFFFF",
      detail: "#1B1B22",
    },
    // The brow ridge, *after* the eyes: DK's brow overhangs them, and a prop
    // drawn before them is a bar behind their heads instead — which is what it
    // looked like, a headband.
    { kind: "brow", bone: "head", at: 1, size: 0.95, across: 0.6, along: 0.62, colour: "#3A2412" },
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
        b.ctx.arc(0, 0, HEAD_RADIUS, -Math.PI / 2 - JAW_ARC, -Math.PI / 2 - 0.16);
        b.line(p.colour, 0.3);
      },
    },
    // Last, so it is never buried by the arm that hangs down the middle of a
    // strictly side-on rig. Ultimate presents him three-quarters and the tie is
    // always the thing you see; a red band down his chest is the read, and an
    // arm passing behind it is the smaller lie.
    {
      kind: "tie",
      bone: "torso",
      at: 0.68,
      size: 1.55,
      across: 1.0,
      angle: Math.PI,
      colour: "secondary",
      detail: SMASH_YELLOW,
    },
  ],
};
