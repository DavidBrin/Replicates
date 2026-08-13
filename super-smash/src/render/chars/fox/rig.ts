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
  type PropAnim,
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
 * Full run, in rig units per frame: `runSpeed` from `fighters/fox.ts`.
 *
 * The saturation point for everything the tail does with velocity, so that the
 * interesting range is walk-to-run rather than "launched across the stage".
 */
const RUN_SPEED = 2.402;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The tail.
 *
 * A chain of overlapping fur masses along a spine that is *built* rather than
 * listed, so the whole thing can bend: nine joints, each one a fixed step whose
 * heading turns by a per-segment angle. One number opens the arc out and one
 * lifts the root, and the tufts and the white tip come along with them because
 * they are placed off the spine rather than beside it.
 *
 * Circles rather than one path because the rim pass inflates whatever it is
 * given and the union of inflated discs is still a clean silhouette, where an
 * inflated concave path pinches; and because the lumps *are* the bushiness.
 *
 * Hung off `hip` at its base, so it pivots about the pelvis: any clip that names
 * `hip` swings the tail, which is how `dtilt` sweeps with it and how the whole
 * tail follows a body rotation for free.
 *
 * ## What the third argument buys
 *
 * A tail reads as a tail because it does *not* track the body, and none of that
 * is expressible in a pose. Three things are taken from `anim`:
 *
 * 1. **Streaming.** `vx` is signed by facing, so `+` is always the way he is
 *    going and there is no conditional anywhere below. At rest the tail leaves
 *    the rump barely above level and hangs to about knee height; at a full run
 *    the root lifts and the arc opens out, and it streams straight out behind
 *    him. That contrast is the whole reason he is the fastest thing in the game
 *    and the animation used to be silent about it.
 * 2. **Drag in the air.** Falling pushes the tail up, rising pulls it down —
 *    `-vy`, for the same reason and with the same absence of a branch.
 * 3. **Sway, as a travelling wave.** The idle drift is not one rotation of a
 *    rigid tail: the phase runs *down* the chain, so the base leads and the tip
 *    arrives late. That lag is the difference between a tail and a rudder. The
 *    tip covers about twelve degrees over a 114-frame cycle — visible at match
 *    scale, and nowhere near a wag; `fox.test.ts` bounds it at both ends.
 *
 * The sway is damped by speed and by being mid-move, both because a streaming
 * tail does not wander and because a drifting sine on top of a pose that is
 * already swinging the hip reads as noise rather than as life.
 */
function drawTail(b: Brush, p: PropDef, anim: PropAnim): void {
  const ctx = b.ctx;

  // Saturating, because the interesting range is walk-to-run and a fighter
  // launched at fifteen units a frame should not have a tail pointing at the
  // ceiling.
  //
  // These arrive already converted. `renderer.ts` used to pass `f.vx` straight
  // through, which is Q12 — a full run reached here as 9839 rather than 2.402,
  // and the `- vx * 0.35` the doc offers as an example would have swung a tail
  // by three thousand radians. This file compensated locally with `toFloat`;
  // the renderer now honours the units the type promises, so the compensation
  // came out. Two divisions by 4096 leave a tail that does not move at all.
  const drive = clamp(anim.vx / RUN_SPEED, -1, 1);
  const drop = clamp(-anim.vy / RUN_SPEED, -1, 1);
  // Still while a move is on and while he is at speed: see above.
  const calm = (anim.t > 0 ? 0.35 : 1) * (1 - 0.6 * Math.abs(drive));
  const phase = anim.frame * 0.055;

  // Where the tail leaves the rump, and how hard it arcs over per joint. The
  // two together are the whole shape: at rest a long gentle sweep from just
  // above level down to about knee height, and at a run a straight bar angled
  // a little above horizontal. Straightening is most of what says "fast" —
  // more than the root angle does, and it survives a still frame, which is the
  // test.
  //
  // Both terms take `drive` **signed**, not its magnitude. Straightening on
  // `Math.abs` was the first version and it is wrong in a way that only a
  // measurement finds: backing away lifted the tip *above* where it rests,
  // because the straightening won against the root dropping. Signed, a fighter
  // walking backwards gets a tail that hangs and curls under him, which is what
  // being dragged the other way does to one.
  const root = 0.22 + drive * 0.26 + drop * 0.24 + Math.sin(phase) * 0.13 * calm;
  const arc = -0.075 + drive * 0.065 + (anim.airborne ? -0.02 : 0);

  const N = 9;
  const SEG = 0.31;
  // Fattest two thirds of the way along and only then tapering, which is a fox
  // rather than a carrot: an even taper from the base reads as a cone, and a
  // cone at match scale is the fat sausage this drawing exists to stop being.
  const RADII = [0.36, 0.46, 0.54, 0.58, 0.58, 0.53, 0.45, 0.33, 0.21];

  const spine: { x: number; y: number; r: number; a: number }[] = [];
  let x = -0.04;
  let y = 0.18;
  let a = root;
  for (let i = 0; i < N; i++) {
    if (i > 0) {
      // The wave, one segment behind the last: `- i * 0.62` is the lag.
      a += arc + Math.sin(phase - i * 0.62) * 0.034 * calm;
      x -= Math.cos(a) * SEG;
      y += Math.sin(a) * SEG;
    }
    spine.push({ x, y, r: RADII[i], a });
  }

  // Tufts first, so the round masses cover their roots and only the points
  // show. Each one stands off the *local* normal, so they lie along the top
  // edge whatever the tail is doing — and each is a broad, shallow wedge
  // rather than a spike. At 1.9 times the local radius they read as thorns;
  // this is fur, and fur is a serrated edge, not a row of quills.
  for (const i of [1, 3, 5, 7]) {
    const s = spine[i];
    const nx = Math.sin(s.a);
    const ny = Math.cos(s.a);
    const dx = -Math.cos(s.a);
    const dy = Math.sin(s.a);
    ctx.beginPath();
    ctx.moveTo(s.x + dx * s.r * 0.95 + nx * s.r * 0.30, s.y + dy * s.r * 0.95 + ny * s.r * 0.30);
    ctx.lineTo(s.x + dx * s.r * 0.30 + nx * s.r * 1.38, s.y + dy * s.r * 0.30 + ny * s.r * 1.38);
    ctx.lineTo(s.x - dx * s.r * 0.85 + nx * s.r * 0.25, s.y - dy * s.r * 0.85 + ny * s.r * 0.25);
    ctx.closePath();
    b.fill(p.colour);
  }

  for (let i = 0; i < N; i++) {
    const s = spine[i];
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.r, s.r * 0.94, 0, 0, Math.PI * 2);
    ctx.closePath();
    // The last two masses are the white tip. In the rim and silhouette passes
    // `fill` ignores the colour and paints the outline, so the tip costs
    // nothing there.
    b.fill(i >= N - 2 ? (p.detail ?? CREAM) : p.colour);
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
