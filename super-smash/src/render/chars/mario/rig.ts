// Short, round and big-headed. Mario is the roster's baseline and the shape
// everyone else is read against, so he is drawn as squarely "average person,
// slightly cartooned" — which in a cast containing DK and Kirby is itself
// distinct.
//
// What actually makes a silhouette say "Mario" is a very short list, and it is
// all above the shoulders: a peaked cap with the brim over the eyes, a nose
// that breaks the outline of the face, and a moustache under it. Everything
// below the neck is a stocky man in dungarees, which is worth exactly as much
// effort as it takes to get the straps over the shoulders and no more.
//
// Four of the props here are `custom`. The shared table's `cap` is a
// semicircle, twice as wide as it is tall, and no placement of it reads as a
// cap on a round head — it reads as a bowl. `nose` is a plain ellipse in the
// palette's own skin colour, which on a skin-coloured head is invisible. Those
// are not shortcomings of the shared shapes; they are shapes only Mario needs,
// which is what `custom` is for.

import {
  FEET,
  HANDS,
  LEGS,
  SMASH_YELLOW,
  group,
  tweakRig,
  type Brush,
  type CharacterRig,
  type PropDef,
} from "../../rigKit";

/** Mario's hair and moustache. Not the outline colour — that is nearly black. */
const HAIR = "#4A2A14";
/** The nose and ear, a shade under the palette's skin so they read as relief. */
const SKIN_SHADE = "#EBB183";

const D = Math.PI / 180;

/**
 * The cap.
 *
 * An arc struck just outside the skull from low at the back round to the brow,
 * closed across its underside, plus a separate wedge for the brim. Drawn rather
 * than borrowed because the shared `cap` is a semicircle: 2 wide by 1 tall,
 * where a cap sitting on a head of radius r has to be about 2r by 1.6r or the
 * skull shows through at the temples.
 */
function drawCap(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  ctx.beginPath();
  ctx.arc(0, 0, 1.07, 191 * D, 14 * D, true);
  ctx.closePath();
  b.fill(p.colour);

  // The brim, forward and a shade down, coming to rest on the eyebrows.
  ctx.beginPath();
  ctx.moveTo(0.40, 0.58);
  ctx.lineTo(1.62, 0.34);
  ctx.lineTo(1.58, 0.10);
  ctx.lineTo(0.36, 0.22);
  ctx.closePath();
  b.fill(p.colour);

  // The white roundel, and inside it the M. Both are detail rather than
  // silhouette, so neither is painted in the rim pass — an M inflated by the
  // rim width is a white blob with a dark hole in it.
  if (b.mode !== "body") return;
  ctx.beginPath();
  ctx.arc(0.60, 0.72, 0.29, 0, Math.PI * 2);
  ctx.closePath();
  b.fill(p.detail ?? "#FFFFFF");
  ctx.beginPath();
  ctx.moveTo(0.46, 0.60);
  ctx.lineTo(0.50, 0.85);
  ctx.lineTo(0.60, 0.69);
  ctx.lineTo(0.70, 0.85);
  ctx.lineTo(0.74, 0.60);
  ctx.lineTo(0.68, 0.60);
  ctx.lineTo(0.66, 0.72);
  ctx.lineTo(0.60, 0.61);
  ctx.lineTo(0.54, 0.72);
  ctx.lineTo(0.52, 0.60);
  ctx.closePath();
  b.fill(p.colour);
}

/**
 * The nose.
 *
 * Pushed far enough forward that it clears the head circle, because the rim
 * pass is the only thing that will draw an edge on it: a skin-coloured ellipse
 * inside a skin-coloured head is not a nose, it is nothing, and that is what
 * was there before.
 */
function drawNose(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  ctx.beginPath();
  ctx.ellipse(0.2, 0, 1, 0.86, 0, 0, Math.PI * 2);
  ctx.closePath();
  b.fill(p.colour);
}

/** Sideburn and the hair that shows below the cap at the back of the neck. */
function drawHair(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  // The nape, hugging the back of the skull below the cap's rear edge.
  ctx.beginPath();
  ctx.moveTo(-0.70, 0.16);
  ctx.lineTo(-1.02, -0.06);
  ctx.lineTo(-0.90, -0.62);
  ctx.lineTo(-0.60, -0.44);
  ctx.closePath();
  b.fill(p.colour);
  // The sideburn, in front of the ear and clear of the moustache.
  ctx.beginPath();
  ctx.moveTo(-0.42, 0.04);
  ctx.lineTo(-0.18, -0.04);
  ctx.lineTo(-0.22, -0.46);
  ctx.lineTo(-0.46, -0.36);
  ctx.closePath();
  b.fill(p.colour);
}

/**
 * The dungarees: a bib, two straps over the shoulders, two buttons.
 *
 * The straps are the whole reason this is not the shared `bib`. Blue running up
 * over a red shoulder is the second thing after the cap that says Mario, and a
 * bib alone reads as a tabard.
 */
function drawOveralls(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  ctx.beginPath();
  ctx.moveTo(-0.94, -1.25);
  ctx.lineTo(0.94, -1.25);
  ctx.lineTo(0.88, 0.24);
  ctx.lineTo(-0.86, 0.24);
  ctx.closePath();
  b.fill(p.colour);

  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.72, 0.18);
    ctx.lineTo(s * 0.40, 0.18);
    ctx.lineTo(s * 0.34, 1.02);
    ctx.lineTo(s * 0.68, 1.02);
    ctx.closePath();
    b.fill(p.colour);
  }

  if (b.mode !== "body" || !p.detail) return;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * 0.55, 0.05, 0.17, 0, Math.PI * 2);
    ctx.closePath();
    b.fill(p.detail);
  }
}

export const rig: CharacterRig = {
  id: "mario",
  scale: 0.96,
  bones: tweakRig({
    // The root strut is the leg's length: scale one without the other and the
    // feet float above the stage or sink through it.
    root: { len: 0.86 },
    ...group(LEGS, { len: 0.86, thick: 1.14 }),
    ...group(HANDS, { thick: 1.26 }),
    ...group(FEET, { thick: 1.24, len: 1.2 }),
    hip: { thick: 1.1 },
    torso: { thick: 1.14, len: 0.96 },
  }),
  headRadius: 2.5,
  boneColour: {
    torso: "primary",
    hip: "secondary",
    thighL: "secondary",
    thighR: "secondary",
    shinL: "secondary",
    shinR: "secondary",
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "skin",
    forearmR: "skin",
    handL: "#FFFFFF",
    handR: "#FFFFFF",
    footL: "#5A2E12",
    footR: "#5A2E12",
  },
  props: [
    { kind: "custom", bone: "torso", at: 0.45, size: 1.9, colour: "secondary", detail: SMASH_YELLOW, draw: drawOveralls },
    { kind: "custom", bone: "head", at: 1, size: 2.5, colour: HAIR, draw: drawHair },
    { kind: "custom", bone: "head", at: 1, size: 2.5, colour: "primary", detail: "#FFFFFF", draw: drawCap },
    // Moustache before nose: it spreads from *under* the nose, so the nose has
    // to be the thing drawn on top of it or the face loses its one bit of
    // relief.
    { kind: "moustache", bone: "head", at: 1, size: 1.5, across: 1.0, along: -1.62, colour: HAIR },
    { kind: "custom", bone: "head", at: 1, size: 0.95, across: 1.9, along: -0.52, colour: SKIN_SHADE, draw: drawNose },
    // Hand-written rather than `eyes()`, which has no way to say "up a bit":
    // Mario's eyes sit high on the face, right under the brim, with the whole
    // nose below them. At `eyes()`'s default height they land beside the nose
    // and he reads as looking out of his own cheek.
    { kind: "face", bone: "head", at: 1, size: 0.8, across: 0.5, along: 0.24, colour: "#FFFFFF", detail: "#1B1B22" },
  ],
};
