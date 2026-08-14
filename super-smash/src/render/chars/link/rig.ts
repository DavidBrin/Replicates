// Taller and leaner than Mario, but stockier than Marth: the athletic middle of
// the three humanoids, which is the gap the cap and the shield then widen.
//
// Three things carry Link at the size a fighter is actually seen at — an eighth
// of the screen — and they are all silhouette:
//
//   1. **The Master Sword.** The shared `sword` prop is a 0.11-unit-wide strip
//      beside a 1.25-unit-wide forearm, so at match scale it is a scratch on the
//      glass: the very thing that was reported as "the sword does not swing" is
//      partly that the sword cannot be seen swinging. It is drawn here instead,
//      as a `custom` prop, wide enough to read and with the winged crossguard
//      that is the one shape nobody else on the roster has.
//   2. **The shield on his back.** Not where Ultimate puts it. His Link holds
//      the Hylian Shield up on the left forearm through every frame of his
//      idle, his walk and his crouch — that is what his passive projectile
//      block is, and a reference pass ranks it the second strongest cue in his
//      whole silhouette after the leg A-frame. It is on his back here because a
//      prop is welded to one bone for every clip a fighter has, and that same
//      hand draws a bow, throws a boomerang and holds a bomb. See `SHIELD`.
//   3. **The cap.** Long, pointed, trailing behind the head — and the thing that
//      was quietly eating the Master Sword, twice over. It was drawn *after* the
//      sword, so any pose that carried the blade up past the shoulder painted a
//      green wedge over it; and it was anchored 1.8 units too low, so it sat
//      across his eyes like a mask with the top of his skull bare. Both are
//      fixed below.
//
// The second and third of those had survived a full round of work each. Neither
// is subtle at the size this file is authored at; both are invisible at the size
// a fighter is *seen* at, which is about forty screen pixels of head. Nothing
// here was found by reading it. Everything was found by magnifying a capture.

import {
  ARMS,
  FEET,
  HANDS,
  LEGS,
  eyes,
  group,
  poly,
  tweakRig,
  type Brush,
  type CharacterRig,
  type PropDef,
} from "../../rigKit";

/* --------------------------------------------------------- the two props -- */

/**
 * The Master Sword.
 *
 * Painted in the prop's own frame: `+y` runs along `handR` away from the fist,
 * `+x` is the fighter's front, and one unit is the prop's `size`. Drawn from
 * the grip outward, so the blade points wherever the hand points and swings
 * with the arm for free — which is the whole reason the sword is a prop on a
 * bone rather than a graphic laid over the fighter.
 *
 * Never `ctx.fillStyle`: the figure is drawn twice, once inflated in the
 * outline colour for the rim and once in body colours, and a painter that sets
 * its own fill paints that colour into the rim pass and punches a hole in the
 * silhouette. `b.fill` is the one that knows which pass it is in.
 */
function masterSword(b: Brush): void {
  const ctx = b.ctx;

  // Grip, and the pommel below the fist. Short: the whole hilt is under a third
  // of the blade, which is the proportion the real sword has and not the one
  // this prop used to have.
  poly(ctx, [
    [-0.055, -0.18],
    [0.055, -0.18],
    [0.055, 0.03],
    [-0.055, 0.03],
  ]);
  b.fill("#3D56B2");
  poly(ctx, [
    [-0.1, -0.17],
    [0.1, -0.17],
    [0, -0.27],
  ]);
  b.fill("accent");

  // The crossguard: two swept wings rising toward the blade. This is the read.
  poly(ctx, [
    [-0.3, 0.14],
    [-0.22, 0.0],
    [0.22, 0.0],
    [0.3, 0.14],
    [0.19, 0.16],
    [0.095, 0.085],
    [-0.095, 0.085],
    [-0.19, 0.16],
  ]);
  b.fill("accent");

  // The blade: broad at the guard, tapering to a point a full `size` out.
  poly(ctx, [
    [-0.105, 0.06],
    [0.105, 0.06],
    [0.084, 0.8],
    [0, 1.0],
    [-0.084, 0.8],
  ]);
  b.fill("#DCE4EC");

  // The fuller, body pass only. In the rim pass it would be a dark stripe
  // painted over the rim's own silhouette.
  if (b.mode === "body") {
    poly(ctx, [
      [-0.038, 0.12],
      [0.038, 0.12],
      [0.031, 0.78],
      [-0.031, 0.78],
    ]);
    b.fill("#9BB0C4");
  }
}

/** The Hylian Shield, slung across his back: steel rim, blue face, gold crest. */
function hylianShield(b: Brush): void {
  const ctx = b.ctx;

  ctx.beginPath();
  ctx.moveTo(-0.86, 0.86);
  ctx.lineTo(0.86, 0.86);
  ctx.lineTo(0.8, -0.16);
  ctx.quadraticCurveTo(0.5, -0.78, 0, -1.0);
  ctx.quadraticCurveTo(-0.5, -0.78, -0.8, -0.16);
  ctx.closePath();
  b.fill("#9FAABC");

  if (b.mode === "body") {
    ctx.beginPath();
    ctx.moveTo(-0.62, 0.66);
    ctx.lineTo(0.62, 0.66);
    ctx.lineTo(0.58, -0.14);
    ctx.quadraticCurveTo(0.36, -0.6, 0, -0.78);
    ctx.quadraticCurveTo(-0.36, -0.6, -0.58, -0.14);
    ctx.closePath();
    b.fill("#2A4B9B");

    poly(ctx, [
      [0, 0.56],
      [0.3, 0.06],
      [-0.3, 0.06],
    ]);
    b.fill("accent");
  }
}

/**
 * The Traveler's Bow, stowed across his back.
 *
 * Ultimate's Link physically carries it — the skeleton in the exported model
 * has a dedicated `BowB` bone mid-back, behind the spine and under the Master
 * Sword's sheath, and a reference pass ranked "the bow limb arcing up behind
 * the trailing shoulder" fifth of nine silhouette cues and noted that it is the
 * one only *this* Link has. Nothing else on the rig draws a curve: the shield
 * is a slab, the quiver a box, the cap and the blade straight wedges, so a
 * single arc reads immediately even though it is thin.
 *
 * Drawn as the stave alone with a string across the chord — three strokes, an
 * outline under a wood colour under the teal cord wrap the real bow has at each
 * tip. The teal is the one colour on Link that is neither tunic green, steel
 * nor leather, and it is what stops the bow reading as another strap.
 */
function travellersBow(b: Brush): void {
  const ctx = b.ctx;

  // The stave. A shallow arc, belly toward the spine.
  const arc = (width: number, colour: string) => {
    ctx.beginPath();
    ctx.moveTo(-0.34, -1.0);
    ctx.quadraticCurveTo(0.5, 0, -0.34, 1.0);
    b.line(colour, width);
  };
  arc(0.3, "outline");
  arc(0.19, "#A0763E");

  if (b.mode === "body") {
    // The string, and the cord wrap at each tip.
    ctx.beginPath();
    ctx.moveTo(-0.34, -1.0);
    ctx.lineTo(-0.34, 1.0);
    b.line("#E8DCC0", 0.07);
    for (const y of [-0.78, 0.78]) {
      ctx.beginPath();
      ctx.moveTo(-0.28, y);
      ctx.lineTo(-0.02, y * 0.82);
      b.line("#40746C", 0.2);
    }
  }
}

/** The quiver, and the arrow fletchings that clear his shoulder. */
function quiver(b: Brush): void {
  const ctx = b.ctx;
  poly(ctx, [
    [-0.34, -0.7],
    [0.34, -0.7],
    [0.28, 0.5],
    [-0.28, 0.5],
  ]);
  b.fill("#6B4A24");
  for (const dx of [-0.2, 0, 0.2]) {
    poly(ctx, [
      [dx - 0.1, 0.5],
      [dx + 0.1, 0.5],
      [dx + 0.06, 1.0],
      [dx - 0.06, 1.0],
    ]);
    b.fill("#E8DCC0");
  }
}

/**
 * Long. The first pass drew grip-to-tip at 4.6 rig units — a third of Link's
 * height — and three independent reads called it short: the reference measures
 * the Master Sword at **0.83 of his height overall**, the same length as his
 * bow, with a blade about three times the hilt; and two critics working from
 * magnified captures put the drawn blade at 0.23–0.29 H against a wanted 0.55
 * and called it a gladius.
 *
 * It also explained something that looked unrelated. `swing.ts` derives the
 * swoosh from the move's own hitboxes, so on the forward smash the arc reaches
 * 13.7 world units from his centre — and the sword tip reached 10. The graphic
 * that says "this is how far the move goes" and the weapon that is supposed to
 * be making it were four units apart, which reads as two swings happening at
 * once. Lengthening the blade closes most of that gap without touching a
 * hitbox.
 *
 * 6.4 rather than the reference's ratio outright: at this length the tip clears
 * his crown in the standing pose and stays off the stage in the forward smash's
 * low hold, and a longer one does neither.
 */
const SWORD: PropDef = {
  kind: "custom",
  bone: "handR",
  at: 1,
  size: 6.4,
  colour: "#DCE4EC",
  detail: "accent",
  draw: (b) => masterSword(b),
};

/**
 * The Hylian Shield, slung across his back.
 *
 * Only the **overhang** is ever seen. Props layered "behind" are drawn before
 * the body, and the torso capsule is 3.7 rig units through, so everything
 * inside ±1.85 of the torso axis is painted and then covered. Round one hung it
 * at `across: -0.85` with `size: 3.1`, which left 1.7 units of shield sticking
 * out past his back — a blue stripe at match scale, and a reference pass ranked
 * the shield the *second* strongest cue in Link's whole silhouette. Pushed back
 * to -1.45 and grown to 3.4, the visible slab is 2.5 units: half again as much
 * shield, and enough of the curved lower edge and the gold crest to be a shield
 * rather than a stripe.
 *
 * It is on his back and not on his arm, and that is wrong for the pose it is
 * most looked at in. Ultimate's Link holds it up on the left forearm through
 * every frame of his idle, his walk and his crouch — that is what his passive
 * projectile block is — and stows it on his back for exactly three animations,
 * the bow, the boomerang and the bomb, because those need the hand. A prop here
 * is welded to one bone for every clip the fighter has, so one of those two
 * truths has to be given up; giving up the idle is the cheaper of the two only
 * because the alternative puts a dinner plate through three specials. The
 * report for this round asks for the shared change that would end the choice.
 */
const SHIELD: PropDef = {
  kind: "custom",
  bone: "torso",
  at: 0.42,
  size: 3.3,
  across: -1.5,
  colour: "#9FAABC",
  detail: "accent",
  layer: "behind",
  draw: (b) => hylianShield(b),
};

/**
 * The bow on his back, canted so it crosses behind the trailing shoulder.
 *
 * Behind the shield and slightly higher, so what clears both the torso and the
 * shield is the upper limb — one thin arc above the shoulder line, which is
 * exactly the part the reference describes.
 */
const BOW: PropDef = {
  kind: "custom",
  bone: "torso",
  at: 0.62,
  size: 3.0,
  across: -1.1,
  angle: -0.34,
  colour: "#A0763E",
  detail: "#40746C",
  layer: "behind",
  draw: (b) => travellersBow(b),
};

const QUIVER: PropDef = {
  kind: "custom",
  bone: "torso",
  at: 0.78,
  size: 1.35,
  across: -0.5,
  angle: 0.42,
  colour: "#6B4A24",
  layer: "behind",
  draw: (b) => quiver(b),
};

/* ----------------------------------------------------------------- rig --- */

export const rig: CharacterRig = {
  id: "link",
  scale: 1.06,
  bones: tweakRig({
    root: { len: 1.02 },
    // A longer neck than the shared humanoid, for one reason: the torso capsule
    // is 3.7 units through, so its top cap reaches within a whisker of the head
    // circle's centre and swallows everything below the eye. A critic reading a
    // match-scale capture called it "a green bandana over his face" — no cheek,
    // no jaw, no chin. Two fifths of a unit of extra neck is what puts a chin
    // above the collar.
    head: { len: 1.18 },
    ...group(LEGS, { len: 1.02 }),
    ...group(ARMS, { len: 1.04, thick: 0.96 }),
    ...group(FEET, { len: 1.15, thick: 1.15 }),
    // Slimmer fists. The shared hand capsule is 1.75 units through against a
    // 1.2-unit forearm, so a hand at the end of an arm reads as a ball on a
    // stick — and Link's off hand, which is the far-side limb and shaded down
    // a quarter, was coming out as an olive lump at his waist rather than as a
    // fist. Two critics named it independently.
    ...group(HANDS, { thick: 0.86 }),
  }),
  headRadius: 2.3,
  boneColour: {
    torso: "primary",
    hip: "primary",
    thighL: "#E9DCC0",
    thighR: "#E9DCC0",
    shinL: "#E9DCC0",
    shinR: "#E9DCC0",
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "skin",
    forearmR: "skin",
    handL: "#D8CBA8",
    handR: "#D8CBA8",
    footL: "#6B4A24",
    footR: "#6B4A24",
  },
  props: [
    QUIVER,
    BOW,
    SHIELD,
    // Shorter than it was. The shared skeleton already gives every fighter only a
    // third of their height in leg, and a tunic hanging to mid-shin took another
    // slice off the one part of Link that is supposed to read as a wide brace.
    { kind: "tunic", bone: "hip", at: 0.5, size: 1.75, colour: "primary" },
    { kind: "belt", bone: "hip", at: 0.9, size: 1.7, colour: "#5A3A18", detail: "accent" },
    /*
     * On his head, which it was not.
     *
     * `capPointed` draws a half-disc **hanging below its anchor**: the flat
     * chord is at `−0.1 × size` in the prop's frame and the fill runs down from
     * there to `−1.1 × size`. So the chord is the *brim* and the anchor has to
     * sit at the crown for the fill to land on the skull. It was anchored at
     * `along: 0.7` — seven tenths of a unit above the head's *centre*, which put
     * the brim half a unit above centre and the fill from there down to nearly
     * the jaw. The cap was a green band straight across his eyes with a crescent
     * under them, and the top of his skull was bare skin.
     *
     * That has been true since round one, whose note read "kept exactly as it
     * was, because it is already doing its job." It was invisible at 1:1: the
     * whole head is about forty screen pixels in a match, and a band across the
     * middle of it reads as shadow. It took a capture magnified five times to
     * see that Link was wearing his hat over his face.
     *
     * `along: 2.5` puts the brim at the crown (head radius 2.3, plus the
     * painter's own 0.1 × size chord offset). The `angle` that was here is gone
     * with it — it was added to lay the tail back away from the blade, and all
     * it really did was tilt the brim into a diagonal across his face. The
     * separation problem it was for is solved better by the draw order below:
     * the blade is silver, on top, and now starts from a hand that is not where
     * the cap starts.
     */
    { kind: "capPointed", bone: "head", at: 1, size: 2.05, along: 2.5, colour: "primary" },
    // Tucked under the brim as a fringe. Pushed forward 0.75 of a unit it
    // reached past the head's own edge and read, at this size, as a beak.
    { kind: "hairSwoop", bone: "head", at: 1, size: 1.3, across: 0.5, along: 0.75, colour: "#E8C86A" },
    { kind: "earsPointed", bone: "head", at: 1, size: 1.5, along: -0.3, angle: 0.5, colour: "skin" },
    /*
     * After the cap, and that is the whole reason it moved.
     *
     * Props in one layer are drawn in array order, and the cap is a five-unit
     * green wedge hung off the head that covers most of the space above and
     * behind the shoulder. Every pose that carries the blade through that space
     * — the whole of the forward smash's wind-up, the up smash, the charge
     * hold, and the standing pose itself, where the sword rakes up past his ear
     * — was drawing the sword *and then painting the cap over it*. Two rounds of
     * captures had a wind-up with no visible sword in it, and it read as the
     * pose being wrong rather than as the draw order being wrong.
     *
     * In front is also simply where it belongs: the sword is in the near hand
     * and the cap is on the far side of it.
     */
    SWORD,
    eyes(0.66, "#2E6BB0"),
  ],
};
