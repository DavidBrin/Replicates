// Short body, long legs, small head — the digitigrade build, which is what makes
// the ears and the tail read as animal rather than as decoration.
//
// Three things carry the read, in this order:
//
// 1. **The tail.** It is the biggest single shape he has and the only part of
//    him that leaves the body outline in every pose. The shared `tailBushy` is
//    one smooth quadrilateral, and painted in the palette's pale `skin` it read
//    as a fat sausage hanging off his hip — at match scale it was routinely
//    mistaken for a third leg. It is drawn here instead as a chain of
//    overlapping fur masses with tufts along the top edge and a white tip,
//    which is a fox's tail at any size, and it is `primary` so it is fur.
//
// 2. **The ears.** They were invisible. The shared `earsPointed` painter puts
//    its triangle apexes at *negative* y, and the prop frame's +y runs along
//    the bone toward its tip — so both ears pointed down into the skull and
//    only a sliver showed. (Pikachu's `earsBolt` has the same sign error; see
//    the report.) Drawn here as a custom prop with the tips at +y, tall enough
//    to clear a 2.05-unit head circle.
//
// 3. **The white jacket on the torso.** `fighters/fox.ts` says in as many
//    words that the jacket is "the real identifying mark" and that the fur is
//    pulled toward tan-gold so he is not mistaken for Samus — and then the rig
//    put `secondary` (the jacket white) on his *legs* and `primary` (the fur)
//    on his torso, which is the mark inverted. White jacket, fur head and
//    arms, dark trousers, pale boots: that ordering is Fox from across the
//    stage.
//
// The trousers are a literal rather than a palette role because the palette
// has four roles and Fox needs five surfaces. A literal does not follow the
// costume, which is the same trade Mario's white gloves make, and it is the
// right one here: with the legs dark, the white jacket and the white boots
// both separate, and in every alternate costume they still do.

import {
  ARMS,
  FEET,
  LEGS,
  eyes,
  group,
  tweakRig,
  type Brush,
  type CharacterRig,
  type PropDef,
} from "../../rigKit";

/** Trousers. Dark enough that the jacket above and the boots below both read. */
const TROUSER = "#4B5343";
const TROUSER_HIP = "#414937";
/** Boots: pale, but a step off the jacket's white so the two never merge. */
const BOOT = "#CFD8DF";
/** Ear interiors and the shadow under the jaw. A darker cousin of the fur. */
const FUR_SHADE = "#8E6526";
/** Muzzle, chin and tail tip — the cream a fox is two-tone with. */
const CREAM = "#FFF6E8";
/** The Blaster's holster, on the right thigh. Where `neutralB` draws from. */
const HOLSTER = "#3A3E45";

/**
 * The tail.
 *
 * A chain of overlapping fur masses down a spine that sweeps back and a little
 * down, tapering to a white tip, with four tufts along the top edge. Circles
 * rather than one path because the rim pass inflates whatever it is given and
 * the union of inflated discs is still a clean silhouette, where an inflated
 * concave path pinches; and because the lumps *are* the bushiness.
 *
 * Hung off `hip` at its base, so it pivots about the pelvis: any clip that
 * names `hip` swings the tail, which is how `dtilt` sweeps with it and how the
 * whole tail follows a body rotation for free.
 */
function drawTail(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  const spine: readonly (readonly [number, number, number])[] = [
    [0.12, 0.18, 0.44],
    [-0.28, 0.18, 0.50],
    [-0.68, 0.12, 0.53],
    [-1.06, 0.00, 0.50],
    [-1.40, -0.18, 0.44],
    [-1.68, -0.40, 0.35],
    [-1.88, -0.62, 0.24],
  ];

  // Tufts first, so the round masses cover their roots and only the points show.
  for (const [x, y, r, lean] of [
    [-0.42, 0.20, 0.34, 0.30],
    [-0.86, 0.14, 0.36, 0.22],
    [-1.24, -0.02, 0.32, 0.10],
    [-1.56, -0.26, 0.26, -0.02],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y + r * 0.5);
    ctx.lineTo(x + lean * 0.9 - 0.1, y + r * 1.85);
    ctx.lineTo(x + r * 0.7, y + r * 0.4);
    ctx.closePath();
    b.fill(p.colour);
  }

  for (let i = 0; i < spine.length; i++) {
    const [x, y, r] = spine[i];
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.94, 0, 0, Math.PI * 2);
    ctx.closePath();
    // The last two masses are the white tip. In the rim and silhouette passes
    // `fill` ignores the colour and paints the outline, so the tip costs
    // nothing there.
    b.fill(i >= spine.length - 2 ? (p.detail ?? CREAM) : p.colour);
  }
}

/**
 * The ears.
 *
 * Two triangles rising clear of the skull, swept a few degrees back, the near
 * one taller and further forward. Sized against a head circle of radius 2.05:
 * at `size` 1.7 the skull is 1.21 units in this frame, so a base at ~1.0 and a
 * tip at ~2.2 puts a full unit of ear outside the head where the rim pass will
 * find it.
 */
function drawEars(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  // Far ear: further back, slightly shorter, and it reads as the far one only
  // because the near one overlaps it.
  ctx.beginPath();
  ctx.moveTo(-0.92, 0.58);
  ctx.lineTo(-1.06, 2.02);
  ctx.lineTo(-0.16, 0.98);
  ctx.closePath();
  b.fill(p.colour);

  ctx.beginPath();
  ctx.moveTo(-0.04, 1.00);
  ctx.lineTo(0.28, 2.30);
  ctx.lineTo(0.66, 0.72);
  ctx.closePath();
  b.fill(p.colour);

  if (b.mode !== "body") return;
  // Interiors. Body pass only — an inner ear inflated by the rim width is a
  // dark blob with the ear's point missing.
  ctx.beginPath();
  ctx.moveTo(-0.74, 0.74);
  ctx.lineTo(-0.92, 1.72);
  ctx.lineTo(-0.34, 0.98);
  ctx.closePath();
  b.fill(p.detail ?? FUR_SHADE);
  ctx.beginPath();
  ctx.moveTo(0.10, 1.02);
  ctx.lineTo(0.29, 1.94);
  ctx.lineTo(0.52, 0.90);
  ctx.closePath();
  b.fill(p.detail ?? FUR_SHADE);
}

/**
 * The cream on his face: the cheek and the brow stripe.
 *
 * A fox is two-tone above the neck and the muzzle alone does not say so — with
 * the head now fur-coloured, one cream shape under the eye is what turns a
 * round orange head into a face. Body pass only: this is marking, not
 * silhouette, and it must not thicken the skull.
 */
function drawCheek(b: Brush, p: PropDef): void {
  if (b.mode !== "body") return;
  const ctx = b.ctx;
  ctx.beginPath();
  ctx.moveTo(1.02, 0.16);
  ctx.quadraticCurveTo(0.30, 0.02, -0.34, -0.36);
  ctx.quadraticCurveTo(0.16, -0.86, 1.00, -0.62);
  ctx.closePath();
  b.fill(p.colour);
  ctx.beginPath();
  ctx.moveTo(0.24, 0.96);
  ctx.quadraticCurveTo(0.86, 0.86, 1.14, 0.60);
  ctx.quadraticCurveTo(0.80, 0.46, 0.20, 0.62);
  ctx.closePath();
  b.fill(p.detail ?? FUR_SHADE);
}

/**
 * The jacket's collar and the undershirt showing at the open front.
 *
 * Both body-pass only. The torso capsule is already the jacket; what it needs
 * is somewhere for the eye to land, and a collar plus a seam is enough at the
 * size this renders at. Painting them into the rim would only fatten the
 * chest.
 */
function drawJacket(b: Brush, p: PropDef): void {
  if (b.mode !== "body") return;
  const ctx = b.ctx;
  // The undershirt, down the front of the open jacket.
  ctx.beginPath();
  ctx.moveTo(0.16, 0.98);
  ctx.lineTo(0.74, 0.90);
  ctx.lineTo(0.62, -0.86);
  ctx.lineTo(0.10, -0.82);
  ctx.closePath();
  b.fill(p.detail ?? TROUSER);
  // The collar, standing up at the neck.
  ctx.beginPath();
  ctx.moveTo(-0.78, 0.86);
  ctx.lineTo(0.86, 0.74);
  ctx.lineTo(0.94, 1.16);
  ctx.lineTo(-0.72, 1.24);
  ctx.closePath();
  b.fill(p.colour);
}

/**
 * The Blaster's holster, on the right thigh.
 *
 * He is not carrying the gun — `fx.neutralB` paints that for the frames it is
 * out — but the holster is on him in every official render, and it is what
 * makes the draw in `neutralB` read as a draw rather than as a conjuring
 * trick. Small enough to be a detail on the leg rather than a lump on it.
 */
function drawHolster(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  ctx.beginPath();
  ctx.moveTo(0.30, 0.52);
  ctx.lineTo(1.02, 0.42);
  ctx.lineTo(0.96, -0.62);
  ctx.lineTo(0.26, -0.54);
  ctx.closePath();
  b.fill(p.colour);
  if (b.mode !== "body") return;
  ctx.beginPath();
  ctx.moveTo(0.22, 0.34);
  ctx.lineTo(1.06, 0.22);
  ctx.lineTo(1.08, 0.02);
  ctx.lineTo(0.22, 0.14);
  ctx.closePath();
  b.fill(p.detail ?? "#20232A");
}

export const rig: CharacterRig = {
  id: "fox",
  scale: 0.88,
  bones: tweakRig({
    root: { len: 1.16 },
    // A waist. The base hip is 3.1 thick against a 3.7 torso, which on a
    // shortened torso made him a barrel; narrowing it is most of what turns
    // the silhouette from "cub" into "lean".
    hip: { thick: 0.82 },
    torso: { thick: 0.86, len: 0.90 },
    ...group(LEGS, { len: 1.14, thick: 0.90 }),
    ...group(ARMS, { thick: 0.88 }),
    // Boots: half again as long as they are thick. At the old 1.4×1.35 the
    // capsule was wider than it was long, so the two round caps met and it drew
    // a ball — two grey spheres were the loudest thing on him. Past about 1.7
    // it goes the other way and draws a ski, so the ratio is the number that
    // matters here and not either measurement on its own.
    ...group(FEET, { len: 1.7, thick: 0.95 }),
    head: { len: 0.88 },
  }),
  headRadius: 2.05,
  boneColour: {
    torso: "secondary",
    hip: TROUSER_HIP,
    head: "primary",
    thighL: TROUSER,
    thighR: TROUSER,
    shinL: TROUSER,
    shinR: TROUSER,
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "primary",
    forearmR: "primary",
    handL: "#FFFFFF",
    handR: "#FFFFFF",
    footL: BOOT,
    footR: BOOT,
  },
  props: [
    { kind: "custom", bone: "hip", at: 0, size: 2.6, colour: "primary", detail: CREAM, layer: "behind", draw: drawTail },
    { kind: "custom", bone: "torso", at: 0.5, size: 1.85, colour: "accent", detail: TROUSER, draw: drawJacket },
    { kind: "belt", bone: "hip", at: 1, size: 1.45, colour: "accent", detail: "#E4EAF0" },
    { kind: "custom", bone: "thighR", at: 0.5, size: 0.95, across: 0.55, colour: HOLSTER, detail: "#20232A", draw: drawHolster },
    { kind: "custom", bone: "head", at: 1, size: 1.7, colour: "primary", detail: FUR_SHADE, draw: drawEars },
    { kind: "custom", bone: "head", at: 1, size: 1.55, across: 0.35, along: -0.30, colour: CREAM, detail: FUR_SHADE, draw: drawCheek },
    { kind: "snout", bone: "head", at: 1, size: 1.5, across: 1.05, along: -0.38, colour: CREAM, detail: "#2B2118" },
    // Green, which is Fox's eye colour in the Star Fox Zero design Ultimate's
    // model is based on.
    eyes(0.66, "#3F9B52"),
  ],
};
