/**
 * Samus: round shoulders, and a forearm twice the thickness of the other one.
 *
 * The asymmetry is the whole read — no other fighter has one fat arm — so the
 * two shapes that carry her are the **arm cannon** and the **pauldrons**, and
 * both are drawn here rather than taken from the shared prop table. The shared
 * `cannon` is a box with an ellipse on the end, which at match scale reads as a
 * satchel; the shared `shoulderPad` is an ellipse the same colour as the torso,
 * which at match scale does not read at all. Neither is fixable from a rig
 * entry, and both are the kind of shape only one fighter will ever want, which
 * is exactly what `kind: "custom"` exists for.
 *
 * ## Colour
 *
 * The previous rig spent `accent` — cyan — on the cannon, both boots and the
 * belt, so the most identifying prop on the roster was pale blue and her feet
 * matched it. The Power Suit is orange with red at the shoulders, hips and
 * boots, one green visor and dark grey at the joints and the muzzle. Cyan is
 * now the muzzle's energy ring and the chest lamp and nothing else: small, hot,
 * and the only cool colour on her, which is what makes those two read as
 * *powered* rather than as trim.
 */

import {
  ARMS,
  FEET,
  LEGS,
  ellipse,
  group,
  poly,
  tweakRig,
  type Brush,
  type CharacterRig,
  type PropAnim,
  type PropDef,
} from "../../rigKit";

/** Dark grey: joint seams, the muzzle, the belt. Not a palette role — the
 *  gunmetal stays gunmetal in every costume, the same way Mario's gloves stay
 *  white. */
const GUNMETAL = "#2B3138";
const MUZZLE_BORE = "#0B0E11";

/** Under the pauldron's dome.
 *
 *  It was gunmetal, which is right on a joint seam and wrong on a plate a
 *  torso's width across: at match scale a dark ellipse that size on an orange
 *  chest reads as a *hole*, not as shading, and it was the second thing the eye
 *  found after the visor. Dark red keeps the two tones that turn a disc into
 *  armour and reads as the shadow under a plate. */
const PAULDRON_SHADE = "#8E1220";

/**
 * The arm cannon.
 *
 * Authored in the prop frame: `+y` runs along the forearm toward the wrist,
 * `+x` points at her front. So the barrel is a trapezium growing along `+y`,
 * and the muzzle is the flat end at the far tip.
 *
 * Three things make it read where the old box did not. It is **longer than it
 * is wide**, so the silhouette says barrel rather than block. It **flares**
 * toward the muzzle instead of tapering, which is the actual Varia shape and
 * also the thing that survives being sixteen pixels tall. And it is filled in
 * every mode, so it thickens the rim pass and the arm stays one solid mass
 * instead of a hand with luggage.
 */
function drawCannon(b: Brush, p: PropDef, anim: PropAnim): void {
  const ctx = b.ctx;

  // Barrel: narrow at the elbow, flaring to the muzzle.
  poly(ctx, [
    [-0.72, -0.62],
    [0.72, -0.62],
    [0.96, 0.86],
    [-0.96, 0.86],
  ]);
  b.fill(p.colour);

  // The muzzle collar, and behind it the energy ring. Body pass only for the
  // ring — a hot 2px band has no business inflating the silhouette.
  poly(ctx, [
    [-1.0, 0.82],
    [1.0, 0.82],
    [1.0, 1.16],
    [-1.0, 1.16],
  ]);
  b.fill(p.detail ?? GUNMETAL);

  /**
   * The breech housing, at the elbow end.
   *
   * The barrel is `primary`, which is the torso's colour, so wherever the arm
   * folds the cannon in against the body — which is the whole idle, and the
   * meteor frame of the down air — the barrel and the torso are one orange
   * shape and the only part of the weapon anyone can see is the dark muzzle. A
   * capture of the idle reads as "a dark angular thing at her hip".
   *
   * Dark at *both* ends is what separates it: gunmetal muzzle, orange barrel,
   * gunmetal housing, and the eye reads a cylinder with two collars instead of
   * a lump of torso. It is also where the real one's bulk is — the wide housing
   * carrying the glowing ring sits at the elbow, not at the front.
   */
  poly(ctx, [
    [-0.78, -0.74],
    [0.78, -0.74],
    [0.74, -0.26],
    [-0.74, -0.26],
  ]);
  b.fill(p.detail ?? GUNMETAL);

  if (b.mode === "body") {
    /**
     * The energy ring, and why it sits here rather than on the housing.
     *
     * The real one is on the wide housing at the *elbow*, and that is where the
     * first attempt put it — where, for the whole idle, it is inside her own
     * torso. On screen it was a green stripe lying across her chest, which the
     * eye reads as a second visor and not as a lamp on a gun. It is on the front
     * third of the barrel instead, which is the part that is outside her
     * silhouette in every pose she has.
     *
     * It **breathes**, which is what the third argument to a prop painter is
     * for: a lamp at a fixed brightness is a painted dot, and nothing else on
     * this fighter can say the weapon is live while she is standing still. The
     * pulse is in the *size*, not the alpha, so the colour stays the palette's
     * `accent` and follows an alternate costume the way the rest of her does.
     * Slow — a fast flicker on a fighter doing nothing reads as a fault.
     */
    const lit = 0.5 + 0.5 * Math.sin(anim.frame * 0.055);
    ellipse(ctx, 0, 0.66, 0.6 + 0.11 * lit, 0.15 + 0.05 * lit);
    b.fill("accent");

    // The bore. Flat black rather than shaded: it is a hole, and a hole is the
    // one thing on a fighter that should never catch the light.
    ellipse(ctx, 0, 1.08, 0.62, 0.2);
    b.fill(MUZZLE_BORE);

    // A seam down the barrel's top, so the cylinder reads as a cylinder rather
    // than as a flat slab when the arm is level with the camera.
    poly(ctx, [
      [0.4, -0.5],
      [0.62, -0.5],
      [0.82, 0.78],
      [0.58, 0.78],
    ]);
    b.fill(p.colour === "primary" ? "secondary" : GUNMETAL);
  }
}

/**
 * A pauldron.
 *
 * Wider than her head and hung *outboard* of the shoulder joint, because the
 * only version of this shape that reads at match scale is the one that leaves
 * the torso's outline. Drawn in every mode for the same reason — inside the
 * rim pass it is a bump in her silhouette, which is where the eye finds it.
 */
function drawPauldron(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  // Squashed dome, tipped forward and lifted off the joint so it crowns the
  // shoulder rather than sitting on it.
  //
  // ## How wide
  //
  // The first pass was twice this and turned her chest into one red slab, which
  // reads as a bib rather than as armour; the correction went too far the other
  // way. Measured off a match-scale capture, the helmet came out 63 pixels wide
  // and the shoulder line below it 54–60 — **her head was wider than her
  // shoulders**, which is a bobblehead, and the Power Suit's pauldrons are the
  // first thing anyone recognises about her from across a stage.
  //
  // So the dome is wider and hung further outboard, and the fix is *width*
  // rather than height: a taller dome grows down the chest and brings the slab
  // back, where a wider one only pushes the silhouette out at the shoulder,
  // which is the only place the eye is looking for it.
  //
  // The **colour** is the thing that took two passes. The dome was `primary`,
  // which is the torso's colour, so on screen the dome did not exist and the
  // only part of the shoulder anyone could see was the darker band across its
  // bottom — a red streak lying diagonally across an orange chest, which reads
  // as a wound. The Power Suit's shoulders are red on orange, which is both
  // the right answer and the one the rig's own note at the top of this file
  // already said; it just was not what the props were asking for.
  ellipse(ctx, 0.06, -0.24, 1.16, 0.74, -0.2);
  b.fill(p.colour);
  if (b.mode === "body" && p.detail) {
    // The band along the bottom edge. Two tones is what turns a disc into
    // armour; the band is the *small* half, or the shoulder stops reading as a
    // shoulder and starts reading as a second torso.
    ellipse(ctx, 0.1, 0.26, 1.06, 0.32, -0.2);
    b.fill(p.detail);
  }
}

/**
 * The visor.
 *
 * Body pass only, deliberately: it is glass set *into* the helmet, and a visor
 * that inflated the rim would grow a green horn off the front of her head. The
 * green is a literal and does not follow the costume — Dark Samus and the
 * Gravity Suit change the armour, and the one thing every Samus has is a green
 * visor, so it is the wrong thing to hand to the palette.
 */
function drawVisor(b: Brush, p: PropDef): void {
  if (b.mode !== "body") return;
  const ctx = b.ctx;
  poly(ctx, [
    [-0.15, 0.62],
    [1.02, 0.44],
    [1.06, -0.34],
    [-0.2, -0.2],
  ]);
  b.fill(p.colour);
  // A hot sliver along the top edge. One highlight is the difference between
  // glass and a painted rectangle.
  poly(ctx, [
    [0.05, 0.5],
    [0.94, 0.34],
    [0.96, 0.18],
    [0.06, 0.34],
  ]);
  b.fill(p.detail ?? "#FFFFFF");
}

/**
 * The helmet.
 *
 * Replaces the shared `helmet`, whose crest is a thin zigzag hung *below* the
 * head — at this rig's proportions it lands behind the torso and is never seen.
 * What actually identifies the helmet in a fifty-pixel silhouette is the
 * **forward brow**: the crown overhangs the visor, so her head has a beak, and
 * a beak is the one head shape on this roster that is not a circle.
 */
function drawHelmet(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  ctx.beginPath();
  ctx.moveTo(-1.02, -0.28);
  ctx.bezierCurveTo(-1.12, 0.72, -0.5, 1.16, 0.26, 1.12);
  // The brow, pushed out past the dome so it overhangs the visor.
  ctx.lineTo(1.16, 0.62);
  ctx.lineTo(1.1, 0.12);
  ctx.bezierCurveTo(1.02, -0.62, 0.3, -1.06, -0.34, -0.98);
  ctx.closePath();
  b.fill(p.colour);
  if (b.mode === "body" && p.detail) {
    // The crown fin, running front to back over the top.
    poly(ctx, [
      [-0.66, 0.74],
      [0.34, 1.04],
      [0.5, 0.72],
      [-0.6, 0.44],
    ]);
    b.fill(p.detail);

    // The jaw seal, along the bottom edge of the helmet.
    //
    // This is the only thing separating her head from her chest. Helmet, head
    // and torso are all `primary`, and three orange shapes stacked with no
    // line between them are one orange shape — which is what a contact sheet
    // of her idle showed: a lozenge with a visor on it. Gunmetal, because that
    // is where the suit's neck ring actually is.
    poly(ctx, [
      [-0.92, -0.34],
      [0.98, -0.1],
      [1.02, -0.44],
      [-0.86, -0.72],
    ]);
    b.fill(GUNMETAL);
  }
}

export const rig: CharacterRig = {
  id: "samus",
  scale: 1.1,
  bones: tweakRig({
    torso: { thick: 1.22 },
    hip: { thick: 1.18 },
    ...group(LEGS, { thick: 1.3 }),
    ...group(FEET, { thick: 1.4, len: 1.2 }),
    ...group(ARMS, { thick: 1.12 }),
    // The cannon arm. Thicker and a touch shorter than the other one, so the
    // cannon prop starts where a forearm would still have wrist left to go.
    forearmR: { thick: 1.6, len: 0.98 },
    handR: { thickAbs: 0, lenAbs: 0.2 },
    head: { len: 0.92 },
  }),
  headRadius: 2.45,
  boneColour: {
    torso: "primary",
    hip: "secondary",
    head: "primary",
    // Red thigh, orange shin, red boot. The legs are the hardest part of a
    // stubby rig to read; alternating the three segments is what separates them
    // at the size a match is actually played at.
    thighL: "secondary",
    thighR: "secondary",
    shinL: "primary",
    shinR: "primary",
    footL: "secondary",
    footR: "secondary",
    upperArmL: "primary",
    upperArmR: "primary",
    // The free arm's forearm is gunmetal, and it is the only bone here whose
    // colour is chosen for legibility before accuracy. An orange forearm on an
    // orange torso is not a limb, it is a smudge: the jab read as a red mitt
    // arriving at the end of nothing, because `handL` was the only part of the
    // arm with a colour of its own. The suit does have grey at the gauntlet,
    // and this also balances the cannon — one dark forearm each side.
    forearmL: GUNMETAL,
    forearmR: "primary",
    handL: "secondary",
  },
  props: [
    { kind: "custom", bone: "head", at: 1, size: 2.6, colour: "primary", detail: "secondary", draw: drawHelmet },
    // Bigger than it looks it should be. The visor is the single feature that
    // names her, and at 1.45 it was under a third of the helmet's width and
    // read as a sticker; the real one is nearly half.
    { kind: "custom", bone: "head", at: 1, size: 1.9, across: 0.78, along: -0.12, colour: "#3CE08C", detail: "#D8FFE8", draw: drawVisor },
    // Far shoulder first, so the near one paints over it.
    { kind: "custom", bone: "upperArmL", at: 0.02, size: 1.95, across: -0.12, colour: "secondary", detail: PAULDRON_SHADE, flip: true, draw: drawPauldron },
    { kind: "custom", bone: "upperArmR", at: 0.02, size: 2.15, across: 0.1, colour: "secondary", detail: PAULDRON_SHADE, draw: drawPauldron },
    { kind: "custom", bone: "forearmR", at: 0.55, size: 2.2, colour: "primary", detail: GUNMETAL, draw: drawCannon },
    { kind: "belt", bone: "hip", at: 0.78, size: 1.55, colour: GUNMETAL, detail: "accent" },
  ],
};
