// The tallest and by some distance the thinnest, with the smallest head — the
// elongated build that lets the cape and Falchion read as elegant rather than
// as clutter.
//
// ## The cape was upside down
//
// The shared `cape` painter is authored with its bulk at **positive local y**,
// and a prop's local `+y` runs along its bone *toward the tip*. Hung on the
// `torso`, whose tip is the shoulders, that put six rig units of navy cloth
// **above** the shoulder line — a hood standing two units clear of the crown.
// On a fighter whose whole read is a narrow silhouette it was the widest,
// darkest shape on screen and it sat where his head is. Link gets away with the
// same painter because his is a third of the size.
//
// So the cape is a `custom` prop here: the same idea, drawn downward from the
// shoulders to the knee and flared back, which is what a cape is and what makes
// the space between it and the legs read as *thin*.
//
// ## Falchion's length is not a taste decision
//
// Every tipper hitbox in `fighters/marth.ts` is at `TIP_REACH = 11.0` **world**
// units, and `rig.scale` is the rig-unit-to-world multiplier, so the blade has
// to be sized in rig units and then checked in world ones — a step easy to skip
// and worth 16% of his reach. The arm is 4.73 rig units, so an extended arm plus
// a blade of `s` reaches `(4.73 + s) * 1.16` world. The forward-smash tip sits
// 11.6 world from the shoulder, which puts `s` at 5.3: the drawn point lands on
// the tipper hitbox rather than a unit short of it or, worse, well past it,
// promising reach the move does not have.

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
  type PropAnim,
  type PropDef,
} from "../../rigKit";

/**
 * The hair, and why it is not the tunic's blue.
 *
 * It was `#3C63C8` against a `#2B4FC9` tunic: the same hue at 7% more
 * luminance (98 against 80 on a 255 scale). A critic sampling a match capture
 * put it plainly — head and torso fuse into one blue mass with a hairline of
 * outline between them. The reference measures the real model at the same seven
 * percent and says the same thing: do not rely on a hair/tunic value step at
 * small scale, it isn't there.
 *
 * The real model separates them with the light-blue mantle at the shoulders,
 * which `CAPE` below now provides. This lightens the hair as well rather than
 * instead — belt and braces on the one read that has to survive a 160-pixel
 * figure, and Marth's hair is the brightest blue on him in every official
 * render, so it costs nothing in accuracy.
 */
const HAIR = "#6289E2";

/**
 * The cape's own colours, and the one place on this fighter where a literal
 * beats a palette role.
 *
 * ## Why not a role
 *
 * It was `secondary` — and `secondary` is also his boots, his shins and his
 * armour, so the cape, both calves and both feet were one flat `#1A2A5E` mass
 * behind a `#0E1430` outline. At match scale the bottom half of Marth was a
 * single dark blob with a head on it. `primary` would have merged it with the
 * tunic instead. There is no role that separates it, so it is a literal, and
 * the cost is stated plainly: the five alt costumes in `fighters/marth.ts` swap
 * the roles and will not swap this. Costume 2 is a red-caped Marth and will
 * come out light blue.
 *
 * ## Which way round, and how that was got wrong once
 *
 * The cape is **two-tone: light, cyan-leaning blue on the outer face, dark
 * brick red on the lining.** An earlier pass here had it crimson, on a
 * reference read that sampled SmashWiki's idle GIFs and reported "dark
 * crimson". That reading was not invented — it was a sampling artefact, and the
 * mechanism is worth recording because it will catch the next person too. In
 * every *front-facing* pose the cape flares forward and outward, so the camera
 * sees the **lining**; on the official render there are 53,255 lining pixels
 * against 6,140 of outer face, nearly nine to one. Dark red is genuinely the
 * largest colour mass on the model from the front, and any naive sample of a
 * front view returns it.
 *
 * Two straight-on **back** views settle it — a frame of the Final Smash
 * cutscene and one of the on-screen appearance, the latter with a red-caped Roy
 * standing a few metres away in the same shot, not reading alike. The outer face
 * is blue at hue 204-213 across every lighting condition, against the tunic's
 * royal blue at 222.
 *
 * That also fixes an identity problem rather than only an accuracy one: a
 * crimson cape on a blue-haired swordsman is Marth's *second* costume, and at a
 * glance it is Roy.
 *
 * ## What the light blue is doing structurally
 *
 * More than covering his back. The same reference measures Marth's hair and
 * tunic at 78 and 95 luma — seven percent of the range apart, in the same hue
 * family, with overlapping distributions — and says outright that a viewer
 * cannot separate head from torso on that step, because in the real model the
 * separating shapes are the face, the gold circlet and **the light-blue mantle
 * around the neck and shoulders**. This prop runs to the shoulders, so making it
 * light blue puts that separator where the reference has it.
 */
// `#6B93B8` is the reference's neutral-studio sample; this is a touch deeper and
// more saturated, nearer the in-game daylight reading of `#45719D`, because the
// rest of this palette is flat and saturated and the studio value read washed
// out beside a `#2B4FC9` tunic. Hue is held in the reference's 204-213 band.
const CAPE = "#4E82B4";
const CAPE_LINING = "#7A3A33";

/**
 * The shoulder cape, hanging — and, since the prop clock arrived, moving.
 *
 * Local frame: `+y` runs up the torso toward the shoulders, `+x` is forward, one
 * unit is `size`. Everything here is therefore negative-y — down the back — and
 * mostly negative-x, which is behind him.
 *
 * ## Why it cannot be a pose
 *
 * The cape hangs off `torso`, so bolted rigidly it can only ever do what the
 * chest does, and a cape that is welded to the chest is a painted-on shape: it
 * arrived at every key exactly when the shoulders did and nothing about it read
 * as cloth. There is no bone for it and no pose can name one, which is the exact
 * case `PropAnim` exists for.
 *
 * Two inputs, and both act on the **hem** rather than on the whole shape — cloth
 * is pinned at the collar and free at the bottom, so every displacement is
 * weighted by `k`, how far down the panel a point is, squared so the top third
 * barely moves and the hem carries almost all of it:
 *
 * - `frame` gives a slow drift, a twelfth of a unit at the hem over a
 *   115-frame cycle. It is deliberately slower and smaller than the idle breath
 *   (108 frames, and the whole body) so the two never lock into one beat.
 * - `vx` streams it. `vx` is signed by *facing*, so `-vx` trails the cape behind
 *   him in both directions with no conditional — and a sign added here would be
 *   a sign applied twice, since the frame is already mirrored.
 *
 * The hem rises as it goes back because it is swinging on the shoulder rather
 * than sliding: a panel thrown 0.6 of a unit behind has to come up about half
 * that, or the cloth reads as having stretched. Falling adds to it directly —
 * `vy` is negative going down, so `-vy` billows the cape up around him, which is
 * the one bit of air resistance the eye actually looks for.
 */
function drawCape(b: Brush, p: PropDef, anim: PropAnim): void {
  const ctx = b.ctx;
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

  // Where the hem wants to be, relative to where it is drawn.
  const drift = Math.sin(anim.frame * 0.0546) * 0.085;
  const stream = clamp(-anim.vx * 0.3, -0.85, 0.85);
  const sway = drift + stream;
  // Swinging, not sliding: back is also up. Plus the billow of a fall.
  const lift = Math.abs(sway) * 0.5 + (anim.airborne ? clamp(-anim.vy * 0.12, -0.25, 0.55) : 0);

  /** A point on the panel, displaced by how far down the panel it is. */
  const px = (x: number, y: number) => x + sway * weight(y);
  const py = (y: number) => y + lift * weight(y);
  // The shoulder line sits at y ≈ 0.14 and the hem at y ≈ −2.5; `k²` is what
  // keeps the collar pinned while the hem does the moving.
  function weight(y: number): number {
    const k = clamp(-y / 2.4, 0, 1);
    return k * k;
  }

  ctx.beginPath();
  ctx.moveTo(0.34, 0.1);
  ctx.lineTo(-0.44, 0.14);
  // The outer edge falls from the shoulder and flares back as it goes.
  ctx.quadraticCurveTo(px(-0.92, -0.95), py(-0.95), px(-0.8, -2.26), py(-2.26));
  // The hem, cut on a slant so it reads as cloth rather than as a plank.
  ctx.quadraticCurveTo(px(-0.5, -2.52), py(-2.52), px(-0.12, -2.28), py(-2.28));
  // Back up the inside edge, close to the body.
  ctx.quadraticCurveTo(px(0.14, -1.15), py(-1.15), 0.3, -0.12);
  ctx.closePath();
  b.fill(p.colour);

  // The lining, on the body pass only: a narrow band inside the hem is the
  // whole reason a cape reads as having a front and a back.
  if (b.mode === "body" && p.detail) {
    ctx.beginPath();
    ctx.moveTo(px(-0.12, -2.28), py(-2.28));
    ctx.quadraticCurveTo(px(-0.5, -2.52), py(-2.52), px(-0.8, -2.26), py(-2.26));
    ctx.quadraticCurveTo(px(-0.72, -1.98), py(-1.98), px(-0.64, -1.86), py(-1.86));
    ctx.quadraticCurveTo(px(-0.42, -2.06), py(-2.06), px(-0.1, -1.9), py(-1.9));
    ctx.closePath();
    b.fill(p.detail);
  }
}

/**
 * The clasp the cape hangs from, at the throat.
 *
 * A gold bar, and it used to be the third of three: circlet, collar and belt
 * were all `accent`, the same width, stacked down the front, so the one that
 * identifies him — the circlet — was competing with two that do not. This is
 * smaller than it was, and it carries the reference costume's **red gem**,
 * which both breaks the run of gold and is the one warm note at face height.
 */
function drawCollar(b: Brush, p: PropDef): void {
  poly(b.ctx, [
    [0.44, 0.3],
    [-0.5, 0.34],
    [-0.44, -0.12],
    [0.4, -0.16],
  ]);
  b.fill(p.colour);
  // Body pass only: a gem is a detail, and in the rim pass it would fatten the
  // clasp's silhouette by its own radius.
  if (b.mode === "body") {
    b.ctx.beginPath();
    b.ctx.arc(-0.02, 0.1, 0.19, 0, Math.PI * 2);
    b.ctx.closePath();
    b.fill("#C4384A");
  }
}

/**
 * Falchion.
 *
 * The shared `swordLong` painter is the right silhouette, but its crossguard is
 * 0.48 of a unit across and the blade has to be `size: 5.3` to land its point on
 * the tipper hitbox — which scaled that guard to 2.5 rig units, wider than
 * Marth's whole torso. Blade length and guard width are one number in that
 * painter and two here, which is the only reason this is custom.
 *
 * ## The blade was still a black stick
 *
 * Going custom fixed the guard and did nothing for the width, which round one
 * did not re-check at match scale. The figure is drawn twice — once inflated by
 * `rimWidth` in the outline colour, once in body colours — and the rim is a
 * **pixel** measurement while the blade is a fraction of the prop's own unit. At
 * match scale one rig unit is about ten pixels, so `size: 5.3` makes the local
 * unit ~56px: a half-width of 0.036 drew 4px of white inside 5px of navy rim on
 * each side. A black bar with a white pinstripe down it, on every frame of every
 * move, and worst of all on Dolphin Slash, where a vertical blade against the
 * night sky read as an aerial rather than as a sword.
 *
 * So the half-width is 0.072 — about 0.8 rig units across, two-thirds of his
 * forearm's own thickness. That is wide for a rapier and it is what it takes:
 * the doc's rule is that a weapon has to be checked at match scale, and at match
 * scale the visible white is what the rim leaves behind, not what was drawn.
 * The guard went out to 0.175 with it, because a guard the blade's own width is
 * not a guard — and no further: `swordLong`'s guard scaled to 2.5 rig units
 * against a 2.74-unit torso, which is the thing round one went custom to fix.
 *
 * Local frame: `+y` runs out along the hand, `+x` is forward, one unit is `size`.
 */
function drawFalchion(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  // The grip, back down the hand, and the pommel behind it.
  //
  // 0.13 of a unit, not 0.3. The prop's origin is the *tip* of `handR` and the
  // hand bone is 0.6 rig units long, so a grip reaching to −0.3 — 1.6 rig units
  // — ran the whole length of the fist and a rig unit up the forearm besides. A
  // critic reading a match capture called the result "a dark blob above the
  // guard" and could not find a hand anywhere on the sword; there wasn't one,
  // the grip was painted over it. This ends about where the fist does.
  poly(ctx, [
    [-0.05, -0.13],
    [0.05, -0.13],
    [0.05, 0.02],
    [-0.05, 0.02],
  ]);
  b.fill("#2B3348");
  ctx.beginPath();
  ctx.arc(0, -0.155, 0.062, 0, Math.PI * 2);
  ctx.closePath();
  b.fill(p.detail ?? "accent");

  // The winged guard: swept forward toward the point, which is what makes
  // Falchion's hilt read as Falchion's and not as a cross. It has to stay
  // visibly wider than the blade now that the blade is a blade — the guard is
  // the one shape that says which end of this thing is the hilt.
  ctx.beginPath();
  ctx.moveTo(-0.16, 0.0);
  ctx.quadraticCurveTo(-0.12, 0.14, -0.05, 0.115);
  ctx.lineTo(0.05, 0.115);
  ctx.quadraticCurveTo(0.12, 0.14, 0.16, 0.0);
  ctx.quadraticCurveTo(0.075, -0.055, 0, -0.055);
  ctx.quadraticCurveTo(-0.075, -0.055, -0.16, 0.0);
  ctx.closePath();
  b.fill(p.detail ?? "accent");

  // The blade: near-parallel for most of its length, then a long leaf taper.
  ctx.beginPath();
  ctx.moveTo(-0.072, 0.07);
  ctx.lineTo(0.072, 0.07);
  // Parallel for the first 55% of its length, then the point. Tapering from the
  // guard makes a triangle, and a triangle 5.3 units long and 0.8 wide reads as
  // a gladius: a critic given a match capture called it exactly that. The
  // *ratio* cannot be fixed by narrowing — the rim eats anything thinner — and
  // it cannot be fixed by lengthening, because 5.3 is pinned to the tipper
  // hitbox. A straight shaft is what is left, and it is most of the read.
  ctx.lineTo(0.076, 0.62);
  ctx.quadraticCurveTo(0.062, 0.87, 0.01, 1.0);
  ctx.quadraticCurveTo(-0.048, 0.87, -0.066, 0.62);
  ctx.closePath();
  b.fill(p.colour);

  // The fuller, body pass only — one darker line is the difference between a
  // blade and a white stick.
  if (b.mode === "body") {
    poly(ctx, [
      [-0.026, 0.13],
      [0.026, 0.13],
      [0.021, 0.8],
      [-0.021, 0.8],
    ]);
    b.fill("#A9BCD2");
  }
}

/**
 * The blue hair.
 *
 * The head circle takes exactly one colour — `boneColour.head`, defaulting to
 * skin — so hair has to be a prop over the top of it. It is worth the prop:
 * blue hair under a gold circlet is the single fastest read on this character,
 * and without it the crown is a bare skin disc that could be anybody.
 *
 * Local frame: `+y` up the head bone, `+x` forward, one unit is `size`. The head
 * circle's radius is about 0.92 of a unit at the size used below.
 */
function drawHair(b: Brush, p: PropDef): void {
  const ctx = b.ctx;
  // The crown, a shade proud of the skull so it reads as hair and not as a hat
  // band.
  ctx.beginPath();
  ctx.arc(0, 0.1, 0.95, 0.12, Math.PI - 0.02);
  ctx.closePath();
  b.fill(p.colour);
  // The fringe: one short point over the brow, not a curtain. It has to stop
  // well above the eyes — the face is nine pixels tall at match scale and hair
  // over it turns him into a hood.
  poly(ctx, [
    [0.34, 0.72],
    [1.02, 0.44],
    [0.88, 0.06],
    [0.5, 0.36],
  ]);
  b.fill(p.colour);
  // The longer sweep at the back, which is what gives the head a direction.
  poly(ctx, [
    [-0.36, 0.7],
    [-1.04, 0.36],
    [-1.28, -0.3],
    [-0.66, 0.1],
  ]);
  b.fill(p.colour);
}

export const rig: CharacterRig = {
  id: "marth",
  scale: 1.16,
  bones: tweakRig({
    // `root` is the strut from the feet to the pelvis and has to move with the
    // legs or the feet leave the stage. Both go up together.
    root: { len: 1.2 },
    torso: { thick: 0.74, len: 1.08 },
    hip: { thick: 0.78 },
    ...group(LEGS, { len: 1.2, thick: 0.76 }),
    ...group(ARMS, { len: 1.1, thick: 0.76 }),
    ...group(FEET, { len: 1.2, thick: 0.96 }),
    ...group(HANDS, { thick: 0.7 }),
  }),
  headRadius: 1.84,
  boneColour: {
    torso: "primary",
    hip: "secondary",
    // Not near-black. The outline is #0E1430, and legs and forearms painted at
    // #22262E vanished into their own rim — the lower half of him was one dark
    // mass and the limbs had no shape in it. These read as *dark blue* against
    // the outline, which is the point.
    // Leggings, then boots. These were `#2C3660` over `secondary`, and
    // `secondary` is also the cape, so cape, both calves and both feet were one
    // flat navy mass with a navy outline round it — the bottom half of Marth was
    // a blob. The reference costume is grey leggings under knee-high brown
    // boots, which is a value *and* a temperature break exactly at the knee,
    // where a leg needs one. Blue and gold still carry him: tunic, hair,
    // circlet, belt and hilt are untouched, and the boots are the smallest area
    // on the figure.
    thighL: "#454E70",
    thighR: "#454E70",
    shinL: "#6A4732",
    shinR: "#6A4732",
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "#2C3660",
    forearmR: "#2C3660",
    // Gauntlets. These were `#E6E2D8`, near-white, and the *far* one — shaded
    // 24% to a neutral (175,172,164) — was the brightest thing on the lower half
    // of him. A critic measuring a match capture logged it as "a 12×23 grey prop
    // I cannot identify, a rock in a bumbag". It was his left hand. The
    // reference costume is dark navy fingerless gauntlets, which removes the
    // block and is what he actually wears.
    handL: "#242B52",
    handR: "#242B52",
    footL: "#6A4732",
    footR: "#6A4732",
  },
  props: [
    { kind: "custom", bone: "torso", at: 1, size: 3.0, colour: CAPE, detail: CAPE_LINING, layer: "behind", draw: drawCape },
    { kind: "custom", bone: "torso", at: 1, size: 0.95, along: 0.06, across: 0.22, colour: "accent", draw: drawCollar },
    { kind: "belt", bone: "hip", at: 0.8, size: 1.15, colour: "accent" },
    { kind: "custom", bone: "handR", at: 1, size: 5.3, colour: "#E6EEF6", detail: "accent", draw: drawFalchion },
    { kind: "custom", bone: "head", at: 1, size: 2.0, colour: HAIR, draw: drawHair },
    { kind: "tiara", bone: "head", at: 1, size: 1.25, along: 0.68, colour: "accent", detail: "#5FC8E8" },
    eyes(0.6, "#2E4C8F"),
  ],
};
