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
//   2. **The shield on his back.** Ultimate's Link is Breath of the Wild's, and
//      he carries the Hylian Shield slung across his back — he only brings it
//      round when he actually guards. Hanging it off `forearmL` (which is where
//      it was) puts a dinner plate in the hand that has to draw a bow, throw a
//      boomerang and hold a bomb, and every one of those poses read as him
//      shoving a shield at the opponent.
//   3. **The cap.** Long, pointed, trailing behind the head. Kept exactly as it
//      was, because it is already doing its job.

import {
  ARMS,
  FEET,
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

  // Grip, and the pommel below the fist.
  poly(ctx, [
    [-0.062, -0.3],
    [0.062, -0.3],
    [0.062, 0.05],
    [-0.062, 0.05],
  ]);
  b.fill("#3D56B2");
  poly(ctx, [
    [-0.13, -0.28],
    [0.13, -0.28],
    [0, -0.46],
  ]);
  b.fill("accent");

  // The crossguard: two swept wings rising toward the blade. This is the read.
  poly(ctx, [
    [-0.42, 0.2],
    [-0.3, 0.02],
    [0.3, 0.02],
    [0.42, 0.2],
    [0.26, 0.23],
    [0.13, 0.12],
    [-0.13, 0.12],
    [-0.26, 0.23],
  ]);
  b.fill("accent");

  // The blade: broad at the guard, tapering to a point a little over four rig
  // units out — about a third of his height, which is what it is in the game.
  poly(ctx, [
    [-0.115, 0.1],
    [0.115, 0.1],
    [0.092, 0.78],
    [0, 1.0],
    [-0.092, 0.78],
  ]);
  b.fill("#DCE4EC");

  // The fuller, body pass only. In the rim pass it would be a dark stripe
  // painted over the rim's own silhouette.
  if (b.mode === "body") {
    poly(ctx, [
      [-0.042, 0.16],
      [0.042, 0.16],
      [0.034, 0.76],
      [-0.034, 0.76],
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
  b.fill("#C3CBD8");

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

const SWORD: PropDef = {
  kind: "custom",
  bone: "handR",
  at: 1,
  size: 4.6,
  colour: "#DCE4EC",
  detail: "accent",
  draw: (b) => masterSword(b),
};

// Wider than the torso capsule on purpose. Props layered "behind" are drawn
// before the body, so a shield the same width as the chest is a shield nobody
// ever sees — only what overhangs it reads.
const SHIELD: PropDef = {
  kind: "custom",
  bone: "torso",
  at: 0.58,
  size: 3.1,
  across: -0.85,
  colour: "#C3CBD8",
  detail: "accent",
  layer: "behind",
  draw: (b) => hylianShield(b),
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
    ...group(LEGS, { len: 1.02 }),
    ...group(ARMS, { len: 1.04, thick: 0.96 }),
    ...group(FEET, { len: 1.15, thick: 1.15 }),
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
    SHIELD,
    { kind: "tunic", bone: "hip", at: 0.5, size: 2.1, colour: "primary" },
    { kind: "belt", bone: "hip", at: 0.9, size: 1.7, colour: "#5A3A18", detail: "accent" },
    SWORD,
    { kind: "capPointed", bone: "head", at: 1, size: 2.5, along: 0.75, colour: "primary" },
    { kind: "hairSwoop", bone: "head", at: 1, size: 1.5, across: 0.75, along: 0.5, colour: "#E8C86A" },
    { kind: "earsPointed", bone: "head", at: 1, size: 1.0, along: -0.15, angle: 0.5, colour: "skin" },
    eyes(0.66, "#2E6BB0"),
  ],
};
