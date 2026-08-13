/**
 * The sphere.
 *
 * The torso is vestigial and the head circle *is* the body, so almost the whole
 * figure is one shape. The legs are full length but spend most of themselves
 * inside that shape; only the oversized feet emerge at the bottom, which is
 * exactly the read — a ball balanced on two red boots. Kirby is the one fighter
 * with no prop that leaves his outline, because his outline is the prop.
 *
 * ## Three measurements that decide everything on this rig
 *
 * **1. The shoulders belong at the centre of the ball.** `head` runs from the
 * shoulders to the *centre* of the head circle, so the shoulder sits
 * `head.length` below the middle of the sphere and the arms radiate from there.
 * At the old 0.35/0.55 torso/head split the shoulder was 0.55 below centre and
 * total arm reach was 2.15 against a 4.41 half-width, so **the arms were inside
 * the ball in every pose the game can produce** — every elbow angle in every
 * clip was animating something nobody could see. Moving the split to 0.65/0.25
 * puts the shoulder 0.25 below centre, near enough radial that an arm of a
 * given length breaks the outline by about the same amount whichever way it
 * points. `rigHeight` sums both bones, so his height and the rotation pivot are
 * unchanged.
 *
 * **2. The arms have to out-reach the radius — and round one's did not.** With
 * the shoulder near the centre, a nub shows when
 * `upperArm + forearm + hand + handRadius > 4.45`. Round one wrote that sum as
 * `1.6 + 1.7 + 0.5 + 1.05 = 4.85`, clearing by 0.4, but the hand's `thickAbs`
 * was 1.7, so its radius is **0.85, not 1.05**: the real total was 4.65 and the
 * real clearance was **0.20 units — two per cent of his width**, under half the
 * five-pixel rim that is then inflated over the top of it. A critic given a
 * capture of the finished fighter reported that Kirby *has no arms*, and went
 * on to blame two other moves on it: with nothing at the end of the shoulder,
 * the hammer and the Cutter blade both read as orbiting him rather than as
 * held.
 *
 * `1.75 + 1.95 + 0.6 + 1.0 = 5.30` clears by **0.85**, a bump a tenth of his
 * width either side. That is what Kirby's arms actually are, and it is the
 * number the paragraph above always claimed. Longer and he grows visible limbs,
 * which he does not have.
 *
 * **3. Both boots have to be visible — but the splay belongs in the clips, not
 * here.** The reference rig hangs both thighs at 184°/176°, four degrees either
 * side of straight down, so the two legs end within 0.14 of each other and the
 * near boot completely eclipses the far one: a standing Kirby has *one* foot.
 * The fix is a splayed stance, and it is authored in `poses.ts` (`STANCE`),
 * because a splay is only correct alongside the matching ankle angles — a thigh
 * swung 28° forward with the rest foot still at −88° tips that boot's toe 20°
 * into the air. Every shared clip names its own thighs, shins *and* feet, so a
 * rest angle here would never reach them anyway; what it would reach is the
 * handful of clips that name thighs and leave the feet to the rig, and those
 * all assume a near-vertical leg. So the rest angles stay at the roster's.
 *
 * **4. The leg chain and the boot are set by two shared tests pulling opposite
 * ways, and there is only a narrow band that satisfies both.**
 *
 * `poses.test.ts` wants a *short boot*. The shared grounded clips buy depth
 * with `offsetY` and repay it by folding the knee, and the fold repays in
 * proportion to leg length; on top of that, every clip that points the toe down
 * — `dash` at −141°, `brake` at −133° — swings a sole deeper the longer the
 * boot is. A 3.2-unit leg with a 1.9-unit boot put a foot a full unit inside
 * the stage on `dash`, `brake` and `shieldBroken`.
 *
 * `roll.test.ts` wants the *opposite*: it holds the tuck's lowest point within
 * a fifth of standing height of the floor, and the roll pivots at a fixed
 * fraction of a rig height that is nearly all head — so shortening him tightens
 * the tolerance faster than it tightens the tuck. Every combination short of
 * about 3.8 units of leg fails it, including 3.2/1.9.
 *
 * **2.0 + 2.0 of leg and a 1.5 boot** is inside both, with the boot short
 * enough that a toe-down clip does not bury it. The boot is still oversized
 * where oversized reads: 2.3 thick against Mario's 1.67, on a body two thirds
 * his height. It is a blob, not a shoe, and it was the *shoe* half that sank.
 *
 * ## Colour
 *
 * `primary`, `secondary` and `accent` follow the costume and `accent` is white,
 * so anything painted in `accent` is white on the default Kirby. The eyes and
 * the cheek blush are literals for that reason and for a second one: they do
 * not change in the real game either. Yellow Kirby, Blue Kirby and Shadow Kirby
 * all have dark navy eyes and red cheeks, and a cheek that turned yellow with
 * the costume would stop reading as a blush and start reading as a hole.
 */

import {
  FEET,
  HANDS,
  LEGS,
  ellipse,
  group,
  tweakRig,
  type Brush,
  type CharacterRig,
  type PropDef,
} from "../../rigKit";
import { deg } from "../../skeleton";

/** Dark indigo, not black — Kirby's eyes read blue-black at match scale. */
const EYE_DARK = "#241C46";
/** The lower third of the iris. The two-tone eye is most of the character. */
const EYE_LIT = "#4C7FD6";
const EYE_SHINE = "#FFFFFF";
/** The blush. Warmer and redder than any costume's `secondary`. */
const BLUSH = "#F2607F";

/**
 * How shut the eyes are, 0 open and 1 closed, on the global frame.
 *
 * A blink is the cheapest thing on this rig that makes him look alive, and
 * until the prop painter's third argument existed there was no clock to hang
 * one on — a prop is bolted to its bone, so no pose can express it and no
 * amount of idle authoring would have produced one. Kirby earns it more than
 * anyone: his face is two shapes on a circle and it is what a player looks at
 * for the whole match.
 *
 * Two blinks close together every 172 frames — just under three seconds — which
 * is roughly a resting human rate, and doubling them is what stops it reading
 * as a metronome. Three frames to close and three to open; a one-frame blink at
 * 60Hz is a glitch, not a blink.
 *
 * **Frame 0 must be open.** The character-select portraits, the stock icons and
 * the silhouette check all draw with `PROP_STILL`, whose frame is 0, and a
 * roster screen full of Kirbys with their eyes shut is not a look anyone asked
 * for. The blinks are placed late in the cycle for exactly that reason.
 */
function blinkAt(frame: number, inAction: boolean): number {
  // Not mid-attack. `t` is 0 whenever there is no move on, so this is free —
  // and a critic watching the dash attack caught him blinking in the middle of
  // setting himself on fire, which is the sort of thing that reads as the
  // character not being present in his own animation.
  if (inAction) return 0;
  const p = ((frame % 172) + 172) % 172;
  const near = Math.min(Math.abs(p - 150), Math.abs(p - 163));
  return Math.max(0, 1 - near / 3);
}

/**
 * Eyes and cheeks in one shape.
 *
 * The shared `face` painter draws a white eye with a dark pupil — a cartoon
 * eye, and the exact inverse of Kirby's, whose eye is a tall dark oval lit blue
 * along the bottom with a white shine near the top. That inversion is most of
 * what makes a pink circle read as Kirby rather than as a pink circle, and it
 * cannot be expressed by recolouring the shared painter: the shine and the lit
 * lower third are two extra shapes in a fixed relationship, and the shared
 * `cheeks` painter draws a single ellipse where two are wanted.
 *
 * Painted only in `body` mode. The eyes are inside the sphere's outline and
 * must not thicken the rim; an eye that paints into the rim pass punches a hole
 * in the silhouette.
 */
function drawFace(b: Brush, frame: number, inAction: boolean): void {
  if (b.mode !== "body") return;
  const ctx = b.ctx;
  const lid = blinkAt(frame, inAction);

  // Near eye then far eye. The far one is smaller and set back, which is what
  // turns a flat side-on circle into Ultimate's three-quarter presentation.
  for (const [cx, rx, ry0] of [
    [0.5, 0.3, 0.82],
    [-0.36, 0.24, 0.7],
  ] as const) {
    // A blink closes the eye onto its own lower lid, so the shape that is left
    // sits where the bottom of the eye was rather than at its middle.
    const ry = ry0 * (1 - 0.88 * lid);
    const cy = -(ry0 - ry) * 0.55;
    ellipse(ctx, cx, cy, rx, ry);
    b.fill(EYE_DARK);
    if (lid > 0.55) continue;
    // The lit lower quarter, inset so the dark ring survives around it.
    ellipse(ctx, cx, cy - ry * 0.52, rx * 0.66, ry * 0.27);
    b.fill(EYE_LIT);
    // The shine: a tall oval high in the eye, not a round pupil.
    ellipse(ctx, cx + rx * 0.12, cy + ry * 0.34, rx * 0.42, ry * 0.3);
    b.fill(EYE_SHINE);
  }

  // The blush, one under each eye and outboard of it.
  ellipse(ctx, 1.06, -0.72, 0.42, 0.29, deg(-10));
  b.fill(BLUSH);
  ellipse(ctx, -0.84, -0.68, 0.3, 0.21, deg(10));
  b.fill(BLUSH);
}

const face: PropDef = {
  kind: "custom",
  bone: "head",
  at: 1,
  size: 2.05,
  across: 0.8,
  along: 0.72,
  colour: EYE_DARK,
  draw: (b, _p, anim) => drawFace(b, anim.frame, anim.t > 0),
};

export const rig: CharacterRig = {
  id: "kirby",
  scale: 0.78,
  bones: tweakRig({
    root: { lenAbs: 4.2 },
    hip: { lenAbs: 0.18, thickAbs: 1.2 },
    // Together these still sum to 0.9, so `rigHeight` and the rotation pivot
    // are exactly what they were; the shoulder just moved up into the ball.
    //
    // **The torso's *thickness* is load-bearing for a reason that has nothing
    // to do with what is drawn.** The capsule is 0.65 long, buried 0.9 below
    // the middle of a 4.45 ball, and painted before the head circle — so
    // nothing between 2.4 and 3.6 changes a single pixel of Kirby. What it does
    // change is `shield.test.ts`, which takes a fighter's "crown" as the
    // highest bone tip plus that bone's half-thickness and asserts the shield
    // cycle moves it by a quarter of a unit. That is a claim about the body
    // rising and falling — and on a rig whose arms out-reach its torso, the
    // measurement silently switches to tracking the *hand*, whose amplitude in
    // that clip is only 0.13. Lengthening the arms below flipped it over and
    // took a shared test red on a fighter whose shield had not changed at all.
    // 3.2 keeps the crown on the body, where the assertion means what it says.
    torso: { lenAbs: 0.65, thickAbs: 3.2 },
    head: { lenAbs: 0.25, thickAbs: 1.0 },
    // Long enough that a shared clip's knee fold repays its own `offsetY`; the
    // boot short enough that pointing the toe down does not bury it. Both feet
    // and both legs keep the roster's rest angles — the splay is `STANCE`.
    ...group(LEGS, { lenAbs: 2.0, thickAbs: 1.7 }),
    ...group(FEET, { lenAbs: 1.5, thickAbs: 2.3 }),
    // 1.75 + 1.95 + 0.6 of arm off a shoulder 0.25 below centre, tipped with a
    // hand a unit across: 5.30 against a 4.45 radius, so the nub is 0.85 proud
    // of the outline. See measurement 2 above — this is the number the round-one
    // comment claimed and the bones did not deliver.
    upperArmL: { lenAbs: 1.75, thickAbs: 1.5 },
    upperArmR: { lenAbs: 1.75, thickAbs: 1.5 },
    forearmL: { lenAbs: 1.95, thickAbs: 1.7 },
    forearmR: { lenAbs: 1.95, thickAbs: 1.7 },
    ...group(HANDS, { lenAbs: 0.6, thickAbs: 2.0 }),
  }),
  headRadius: 4.45,
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
    handL: "primary",
    handR: "primary",
    footL: "secondary",
    footR: "secondary",
  },
  props: [face],
};
