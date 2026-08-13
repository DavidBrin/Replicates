/**
 * Pikachu: the clips that are Pikachu’s rather than everybody’s.
 *
 * The shared library in `render/poses/` has one `fsmash` and one `neutralB`
 * for the whole roster, which is the right default — fifty clips across eight
 * rigs instead of four hundred hand-authored ones — and the wrong answer for
 * any move whose *shape* is the character. Whatever is named here wins over the
 * shared clip for this fighter alone; whatever is not named falls through
 * unchanged, so this file only ever holds the moves that earn their place.
 *
 * Author against the real move: the frame data (ultimateframedata.com) says
 * when the hitbox is live, and `poseTimeFor` will put the clip’s `strike` key
 * on that frame whatever the numbers are, so the clip only has to be the right
 * *shape*.
 *
 * ## Why nearly every clip here is whole-body
 *
 * Pikachu's arms are the reason. His head circle has a radius of 2.6 rig units
 * centred 7.05 up, his shoulders are at 5.25, and his whole arm — upper, fore
 * and hand — is 2.68 units. **An arm swung sideways still cannot reach the edge
 * of his own head**, so an elbow angle changes almost nothing about his outline;
 * a limb that does not break the silhouette is not on screen.
 *
 * The one place it now does is *forward and down*, in front of the chest, which
 * is where Pikachu carries his forepaws and is the whole reason the arms were
 * lengthened from 2.25 in round two: at 2.25 a paw brought forward finished up
 * inside the torso capsule, whose radius is 2.0. It clears by a third of a unit
 * now, and the hands are a different value from the body, so a standing Pikachu
 * has hands. That is the only clip that spends them.
 *
 * Everywhere else, the elbow angles that carry Mario's forward smash carry
 * nothing at all here. What is visible on Pikachu is the head circle, the two
 * ears, the bolt tail and the paws — and the ears turn with `head`, the tail
 * turns with the body, and the paws with the legs. Every attack below is
 * therefore written in `rotation`, `scaleX`/`scaleY`, `offsetX`/`offsetY` and
 * the legs, and names an arm only where the arm happens to be free.
 *
 * ## The tail is not a bone
 *
 * It is a prop hung off `hip`, so it turns with the body and cannot be swung on
 * its own. Five of his moves are tail swipes. Each is written as the body
 * rotation that carries the tail through the real arc — which is genuinely what
 * he does for the somersault — and the *sweep itself* is painted in `fx.ts` as
 * an electric crescent, which is also what the real game draws and is the part
 * a player actually tracks.
 */

import { P, type Keyframe, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";
import { deg } from "../../skeleton";

/**
 * The contact shape, **held for as long as the hitbox is live**.
 *
 * `ease: "out"` is a cubic, so a clip leaves its strike key almost at once: a
 * forward smash whose hitbox is live for fifteen frames was a quarter of the way
 * into its recovery by the fourth of them, and three quarters of the active
 * window showed a fighter visibly putting the move away while it was still
 * hitting. One frame of extension and fourteen of withdrawal is not what an
 * attack looks like.
 *
 * So every attack with a window worth holding emits two keys instead of one:
 * the contact at `strike`, cut-held, and an identical key at
 *
 *   `strike + (1 - strike) * (lastActive - firstActive) / (total - firstActive)`
 *
 * which is where `poseTimeFor` puts the hitbox's *last* live frame, after which
 * the recovery eases out normally. The numbers below are all derived from the
 * hitbox tables in `fighters/pikachu.ts`, and `pikachu.test.ts` recomputes them
 * from that same data rather than trusting what is written here.
 */
function held(strike: number, until: number, key: Omit<Keyframe, "t">): Keyframe[] {
  return [
    { ...key, t: strike, ease: "hold" },
    { ...key, t: until, ease: key.ease ?? "out" },
  ];
}

/**
 * The legs planted and braced, for a grounded attack.
 *
 * Repeated in nearly every clip and worth a name: `footR`'s rest angle is
 * negative and mirroring is applied once to the whole rig rather than per leg,
 * so a pose that says `footL: -84, footR: 84` puts one foot on backwards.
 */
const BRACED = {
  thighR: 148,
  shinR: 26,
  footR: -86,
  thighL: 208,
  shinL: 24,
  footL: -82,
} as const;

export const poses: Partial<Record<PoseName, PoseClip>> = {
  /**
   * The standing loop, and the one clip here that is not an attack.
   *
   * The shared `idle` is a **person**: knees straight, spine vertical, both arms
   * hanging at the sides, weight trading between two feet a body's width apart.
   * That is the right default for six of the eight fighters and it costs Pikachu
   * more than anyone — he and Kirby are the two who are mostly head, so a
   * humanoid stand puts a sphere on top of a column and the character underneath
   * it disappears. Standing still is also the pose he is in for most of a match.
   *
   * What the real one is: he is up on his hind legs but **hunched**, knees
   * folded so the belly sits low, the spine pitched well forward so the head
   * leads the hips, the forepaws carried up in front of the chest rather than
   * hanging, and the tail out behind. The silhouette is a rounded animal with a
   * bolt behind it, not a figure — and that shape, seen for two seconds between
   * every exchange, is most of what a player looks at.
   *
   * ## What it borrows from the shared clip and what it does not
   *
   * Borrowed, because they are the reason `idle.ts` is four keys rather than
   * two: **no two parts of the body turn round at the same moment** — the chest
   * is highest at key 1, the head arrives late at key 2, the paws are furthest
   * forward at key 3 — and the key times are uneven, so the cycle has no
   * countable beat. Only the inhale is cushioned; smoothstep on every span would
   * bring every bone to a halt at every key, which is a worse metronome than two
   * keys.
   *
   * Not borrowed: the *height* of the breath. A fighter 6.9 units tall breathing
   * the shared clip's 2% of `scaleY` moves about a pixel, so his rise is carried
   * by the knees and the pitch of the spine instead, which are angles rather
   * than scale and read at any size.
   *
   * `period` is 96 rather than 108 for a reason that has nothing to do with
   * Pikachu being quick: `poseTimeFor` offsets each port by `port * 27` in the
   * *shared* clip, so four fighters idling on the same period drift in lockstep
   * with a fixed phase between them. A different period is what stops him
   * breathing in time with the Mario next to him.
   */
  idle: {
    loop: true,
    period: 96,
    keys: [
      {
        // The settle at the bottom of the breath: knees at their deepest, chest
        // low, paws drawn back toward the chest. The body leaves this slowly —
        // the span out of here is the one the ease is spent on.
        t: 0,
        pose: P({
          hip: -5.5,
          torso: 25,
          head: -19,
          thighR: 141, shinR: 78, footR: -124,
          thighL: 199, shinL: 33, footL: -137,
          upperArmR: 120, forearmR: -22, handR: -12,
          upperArmL: 127, forearmL: -26, handL: -10,
        }),
        offsetY: -0.35,
        offsetX: 0.1,
      },
      {
        // Top of the inhale. The rise is knee angle, not `offsetY`: straightening
        // eight degrees of knee lifts the belly a fifth of a unit and leaves both
        // paws on the floor, where translating the body lifts them off it.
        t: 0.34,
        pose: P({
          hip: -4.0,
          torso: 21.5,
          head: -16,
          thighR: 145, shinR: 70, footR: -120,
          thighL: 201, shinL: 29, footL: -135,
          upperArmR: 116, forearmR: -18, handR: -14,
          upperArmL: 124, forearmL: -23, handL: -12,
        }),
        offsetY: -0.35,
        offsetX: 0.1,
        ease: "linear",
      },
      {
        // The head arrives late — it is still coming up as the chest starts back
        // down, which is the whole of what "the head has its own rhythm" amounts
        // to on a fighter whose head is half of him.
        t: 0.58,
        pose: P({
          hip: -5.0,
          torso: 23,
          head: -21,
          thighR: 143, shinR: 74, footR: -122,
          thighL: 200, shinL: 31, footL: -136,
          upperArmR: 112, forearmR: -15, handR: -16,
          upperArmL: 121, forearmL: -20, handL: -14,
        }),
        offsetY: -0.28,
        offsetX: 0.12,
        ease: "linear",
      },
      {
        // Lowest point, a hair under key 0, so the last span is a small recovery
        // into the settle rather than a fourth extreme.
        t: 0.8,
        pose: P({
          hip: -5.8,
          torso: 26,
          head: -18,
          thighR: 140, shinR: 80, footR: -125,
          thighL: 199, shinL: 34, footL: -138,
          upperArmR: 118, forearmR: -21, handR: -11,
          upperArmL: 125, forearmL: -25, handL: -9,
        }),
        offsetY: -0.4,
        offsetX: 0.09,
        ease: "linear",
      },
    ],
  },

  /**
   * Headbutt. Not a punch — SmashWiki's name for the move is literally
   * `Headbutt`, and on a fighter who is four fifths head that is the entire
   * animation: rear the skull back, then drive it forward. Frame 2, so the
   * wind-up key is only ever drawn on frame 0 and has to read instantly.
   */
  jab: {
    loop: false,
    strike: 0.22,
    keys: [
      {
        t: 0,
        pose: P({ torso: -10, head: -18, ...BRACED }),
        offsetX: -0.3,
        rotation: deg(-7),
        ease: "in",
      },
      ...held(0.22, 0.27, {
        pose: P({
          torso: 14,
          head: 26,
          thighR: 142, shinR: 30, footR: -88,
          thighL: 214, shinL: 26, footL: -78,
        }),
        offsetX: 0.75,
        rotation: deg(14),
        scaleX: 1.1,
        scaleY: 0.95,
      }),
      {
        t: 0.42,
        pose: P({ torso: 6, head: 10, ...BRACED }),
        offsetX: 0.3,
        rotation: deg(6),
      },
      { t: 1, pose: P({ torso: 2, head: 2 }) },
    ],
  },

  /**
   * Double-Footed Kick, thrown from the *baby freeze* — Pikachu drops onto one
   * shoulder and fires both feet out together. It is the one attack of his that
   * the legs really do carry: fully extended forward they are the only part of
   * him that leaves the head's outline, and tipping the body back is what puts
   * them there.
   */
  ftilt: {
    loop: false,
    strike: 0.28,
    keys: [
      {
        t: 0,
        pose: P({ torso: 10, head: -8, thighR: 148, shinR: 62, footR: -118, thighL: 156, shinL: 58, footL: -122 }),
        offsetY: -0.9,
        rotation: deg(-6),
        ease: "in",
      },
      ...held(0.28, 0.34, {
        pose: P({
          torso: -6, head: 14, hip: 4,
          thighR: 94, shinR: 8, footR: -14,
          thighL: 114, shinL: 14, footL: -26,
          upperArmR: 226, forearmR: -30,
          upperArmL: 232, forearmL: -26,
        }),
        offsetY: -1.7,
        offsetX: -0.3,
        rotation: deg(-32),
        scaleX: 1.12,
        scaleY: 0.9,
      }),
      {
        t: 0.46,
        pose: P({
          torso: -2, head: 8,
          thighR: 118, shinR: 26, footR: -52,
          thighL: 126, shinL: 22, footL: -56,
        }),
        offsetY: -1.3,
        rotation: deg(-24),
        scaleX: 1.05,
      },
      {
        t: 0.7,
        pose: P({ torso: 4, thighR: 140, shinR: 50, footR: -98, thighL: 148, shinL: 46, footL: -102 }),
        offsetY: -0.9,
        rotation: deg(-10),
      },
      { t: 1, pose: P({ torso: 4, ...BRACED }) },
    ],
  },

  /**
   * Tail Attack: an overhead tail swipe that starts from *behind* him. The tail
   * rides on the body, so the arc is a body rotation — coil forward-down so the
   * tail drops behind, then whip the whole animal backward through the vertical
   * so the tail comes up and over the front. `fx.ts` draws the arc it travels.
   */
  utilt: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({ torso: 12, head: -10, thighR: 146, shinR: 54, footR: -78, thighL: 154, shinL: 50, footL: -76 }),
        offsetY: -0.7,
        rotation: deg(-16),
        ease: "in",
      },
      ...held(0.3, 0.51, {
        pose: P({
          torso: -8, head: 12,
          thighR: 166, shinR: 12, footR: -86,
          thighL: 196, shinL: 10, footL: -84,
        }),
        offsetY: 0.45,
        rotation: deg(30),
        scaleY: 1.12,
        scaleX: 0.93,
      }),
      {
        t: 0.66,
        pose: P({ torso: -2, head: 6, ...BRACED }),
        offsetY: 0.15,
        rotation: deg(16),
        scaleY: 1.04,
      },
      { t: 1, pose: P({ torso: 4, ...BRACED }) },
    ],
  },

  /**
   * Tail Sweep. He lies down flat and sweeps the tail along the floor in front
   * of him, which is why the real move has such absurd horizontal reach for a
   * fighter this small. Flattened and stretched forward, with the sweep itself
   * painted along the ground.
   */
  dtilt: {
    loop: false,
    strike: 0.34,
    keys: [
      {
        t: 0,
        pose: P({ torso: 14, head: -12, thighR: 140, shinR: 76, footR: -124, thighL: 148, shinL: 72, footL: -128 }),
        offsetY: -1.0,
        ease: "in",
      },
      ...held(0.34, 0.4, {
        pose: P({
          torso: 22, head: -20, hip: -8,
          thighR: 124, shinR: 96, footR: -128,
          thighL: 230, shinL: -86, footL: -52,
          upperArmR: 150, forearmR: -40,
          upperArmL: 214, forearmL: 36,
        }),
        offsetY: -0.35,
        offsetX: 0.45,
        rotation: deg(20),
        scaleX: 1.34,
        scaleY: 0.58,
      }),
      {
        t: 0.5,
        pose: P({
          torso: 18, head: -14,
          thighR: 130, shinR: 88, footR: -126,
          thighL: 222, shinL: -60, footL: -70,
        }),
        offsetY: -0.3,
        offsetX: 0.24,
        rotation: deg(12),
        scaleX: 1.22,
        scaleY: 0.66,
      },
      { t: 1, pose: P({ torso: 12, thighR: 142, shinR: 66, footR: -116, thighL: 150, shinL: 62, footL: -120 }), offsetY: -1.0 },
    ],
  },

  /**
   * Running Headbutt — the Japanese name is *Jump Headbutt*, and the jump is
   * the point: he leaves the ground and goes forward as a battering ram with
   * the skull leading. Pitched hard forward so the ears trail, legs streaming
   * out behind.
   */
  dashAttack: {
    loop: false,
    strike: 0.26,
    keys: [
      {
        t: 0,
        pose: P({ torso: 16, head: -10, thighR: 138, shinR: 66, footR: -74, thighL: 210, shinL: 44, footL: -72 }),
        offsetX: 0.2,
        offsetY: -0.6,
        rotation: deg(10),
        ease: "in",
      },
      ...held(0.26, 0.41, {
        pose: P({
          torso: 10, head: 18, hip: -6,
          thighR: 228, shinR: -18, footR: -60,
          thighL: 238, shinL: -14, footL: -58,
          upperArmR: 128, forearmR: -34,
          upperArmL: 136, forearmL: -30,
        }),
        offsetX: 1.4,
        offsetY: 0.5,
        rotation: deg(38),
        scaleX: 1.2,
        scaleY: 0.9,
      }),
      {
        t: 0.54,
        pose: P({
          torso: 8, head: 10,
          thighR: 206, shinR: 6, footR: -70,
          thighL: 218, shinL: 8, footL: -68,
        }),
        offsetX: 0.9,
        offsetY: 0.1,
        rotation: deg(24),
        scaleX: 1.08,
      },
      { t: 1, pose: P({ torso: 10, ...BRACED }), offsetX: 0.2 },
    ],
  },

  /**
   * Thundershock. "Rears its head back before leaning forward and releasing a
   * large orb of electricity in front of it, leaving a trail of electricity."
   * The orb is the move and it is painted in `fx.ts`; the body's whole job is
   * the recoil — a deep backward coil, then the lunge that throws it.
   *
   * The charge parks at `strike * 0.55`, which lands between the first two keys,
   * so the wind-up has to be worth looking at for as long as the button is held.
   */
  fsmash: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          torso: -18, head: -24, hip: 6,
          thighR: 160, shinR: 34, footR: -84,
          thighL: 214, shinL: 30, footL: -76,
        }),
        offsetX: -0.55,
        offsetY: -0.5,
        rotation: deg(-22),
        scaleX: 0.94,
        ease: "in",
      },
      ...held(0.3, 0.55, {
        pose: P({
          torso: 18, head: 22, hip: -6,
          thighR: 130, shinR: 24, footR: -90,
          thighL: 224, shinL: 28, footL: -70,
          upperArmR: 84, forearmR: -6,
          upperArmL: 92, forearmL: -4,
        }),
        offsetX: 1.2,
        offsetY: -0.4,
        rotation: deg(17),
        scaleX: 1.12,
        scaleY: 0.95,
      }),
      {
        t: 0.68,
        pose: P({
          torso: 10, head: 12,
          thighR: 138, shinR: 26, footR: -88,
          thighL: 216, shinL: 26, footL: -74,
          upperArmR: 98, forearmR: 4,
          upperArmL: 104, forearmL: 4,
        }),
        offsetX: 0.6,
        offsetY: -0.35,
        rotation: deg(15),
        scaleX: 1.06,
      },
      {
        t: 0.84,
        pose: P({ torso: 4, head: 4, ...BRACED }),
        offsetX: 0.25,
        rotation: deg(5),
      },
      { t: 1, pose: P({ torso: 2, ...BRACED }) },
    ],
  },

  /**
   * Tail Somersault. Unlike the up tilt it starts *in front* of him and goes up
   * and over to behind, and the move's own name says how: he throws himself
   * backward through a somersault and the tail follows the body round. Coiled
   * forward at the charge, then a hard backward pitch.
   */
  usmash: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 18, head: -14, hip: -4,
          thighR: 136, shinR: 78, footR: -122,
          thighL: 144, shinL: 74, footL: -126,
        }),
        offsetY: -1.0,
        rotation: deg(14),
        ease: "in",
      },
      ...held(0.3, 0.44, {
        pose: P({
          torso: -14, head: 16,
          thighR: 172, shinR: 8, footR: -88,
          thighL: 190, shinL: 6, footL: -86,
          upperArmR: 16, forearmR: -8,
          upperArmL: -16, forearmL: 8,
        }),
        offsetY: 0.7,
        rotation: deg(-46),
        scaleY: 1.16,
        scaleX: 0.9,
      }),
      {
        t: 0.56,
        pose: P({
          torso: -6, head: 8,
          thighR: 166, shinR: 14, footR: -86,
          thighL: 194, shinL: 12, footL: -84,
        }),
        offsetY: 0.25,
        rotation: deg(-26),
        scaleY: 1.06,
      },
      {
        t: 0.66,
        pose: P({ torso: 0, head: 4, ...BRACED }),
        offsetY: 0.05,
        rotation: deg(-10),
      },
      { t: 1, pose: P({ torso: 4, ...BRACED }) },
    ],
  },

  /**
   * Electric Flower — *Mouse Fireworks* in Japanese, which is the better
   * description. He charges the tail and then spins it round himself: five
   * two-percent hits three frames apart and a finisher, all at ankle height.
   *
   * The spin is about a **vertical** axis — he stays flat on the floor and the
   * tail goes round him like a pinwheel — so it cannot be a body rotation. The
   * first version turned him through two full revolutions in the screen plane,
   * which cartwheeled a grounded attack and took his feet off the stage with
   * it. What is left is the read a side-on camera can actually carry:
   * foreshortening. He widens and narrows as he comes side-on and edge-on, and
   * the sweep itself is the flat ring in `fx.ts`.
   *
   * `scaleX` bottoms out at 0.78 rather than going properly edge-on because the
   * head circle scales *uniformly* with it — at 0.4 he does not turn away, he
   * shrinks into the distance.
   */
  dsmash: {
    loop: false,
    strike: 0.28,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 14, head: -12,
          thighR: 138, shinR: 82, footR: -128,
          thighL: 146, shinL: 78, footL: -132,
        }),
        offsetY: -0.8,
        rotation: deg(-8),
        ease: "in",
      },
      {
        t: 0.28,
        pose: P({
          torso: 6, head: -6, hip: -4,
          thighR: 126, shinR: 92, footR: -126,
          thighL: 236, shinL: -88, footL: -56,
        }),
        offsetY: -1.0,
        rotation: deg(-12),
        scaleX: 1.3,
        scaleY: 0.76,
        ease: "linear",
      },
      { t: 0.35, pose: P({ torso: 6, thighR: 126, shinR: 92, footR: -126, thighL: 236, shinL: -88, footL: -56 }), offsetY: -1.0, rotation: deg(10), scaleX: 0.82, scaleY: 0.86, ease: "linear" },
      { t: 0.42, pose: P({ torso: 6, thighR: 126, shinR: 92, footR: -126, thighL: 236, shinL: -88, footL: -56 }), offsetY: -1.0, rotation: deg(-12), scaleX: 1.32, scaleY: 0.75, ease: "linear" },
      { t: 0.49, pose: P({ torso: 6, thighR: 126, shinR: 92, footR: -126, thighL: 236, shinL: -88, footL: -56 }), offsetY: -1.0, rotation: deg(10), scaleX: 0.8, scaleY: 0.86, ease: "linear" },
      { t: 0.56, pose: P({ torso: 8, thighR: 124, shinR: 94, footR: -126, thighL: 238, shinL: -86, footL: -60 }), offsetY: -1.0, rotation: deg(-12), scaleX: 1.3, scaleY: 0.76, ease: "out" },
      {
        t: 0.7,
        pose: P({
          torso: 10, head: -8,
          thighR: 132, shinR: 86, footR: -126,
          thighL: 228, shinL: -56, footL: -80,
        }),
        offsetY: -0.9,
        rotation: deg(-4),
        scaleX: 1.12,
        scaleY: 0.9,
      },
      { t: 1, pose: P({ torso: 12, thighR: 142, shinR: 70, footR: -120, thighL: 150, shinL: 66, footL: -124 }), offsetY: -0.8 },
    ],
  },

  /**
   * Pikachu Shock. He does not swing anything — he "poses while charging itself
   * with electricity", four hits at frames 3, 9, 15 and 21, and the graphic is
   * the whole move. So the body holds one compact tucked shape and *pulses* on
   * each discharge, which is the only thing the figure can usefully contribute
   * while `fx.ts` throws four rings of current off him.
   */
  nair: {
    loop: false,
    strike: 0.18,
    keys: [
      {
        t: 0,
        pose: P({ torso: 6, thighR: 148, shinR: 52, footR: -74, thighL: 208, shinL: 46, footL: -72 }),
        ease: "in",
      },
      {
        t: 0.18,
        pose: P({
          torso: 2, head: -4,
          thighR: 128, shinR: 66, footR: -58,
          thighL: 232, shinL: -58, footL: 56,
          upperArmR: 118, forearmR: -46,
          upperArmL: 244, forearmL: 44,
        }),
        scaleX: 1.14,
        scaleY: 0.9,
        ease: "out",
      },
      { t: 0.32, pose: P({ torso: 2, thighR: 132, shinR: 62, footR: -60, thighL: 228, shinL: -54, footL: 58 }), scaleX: 0.94, scaleY: 1.1 },
      { t: 0.45, pose: P({ torso: 2, thighR: 128, shinR: 66, footR: -58, thighL: 232, shinL: -58, footL: 56 }), scaleX: 1.12, scaleY: 0.92 },
      { t: 0.59, pose: P({ torso: 2, thighR: 132, shinR: 62, footR: -60, thighL: 228, shinL: -54, footL: 58 }), scaleX: 0.95, scaleY: 1.09 },
      {
        t: 0.72,
        pose: P({ torso: 4, thighR: 140, shinR: 56, footR: -66, thighL: 216, shinL: -20, footL: 20 }),
        scaleX: 1.04,
      },
      { t: 1, pose: P({ torso: 4, thighR: 146, shinR: 40, footR: -74, thighL: 208, shinL: 34, footL: -72 }) },
    ],
  },

  /**
   * Electric Drill. He spins forward head-first through six hits — the head is
   * the drill bit, which is why the looping hitboxes sit right on top of it.
   * Two turns across the active window, then a caught landing shape.
   */
  fair: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({ torso: -10, head: 8, thighR: 150, shinR: 58, footR: -70, thighL: 204, shinL: 52, footL: -68 }),
        rotation: deg(-16),
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          torso: 8, head: 10,
          thighR: 226, shinR: -28, footR: -50,
          thighL: 236, shinL: -24, footL: -48,
        }),
        rotation: deg(120),
        scaleX: 1.06,
        scaleY: 0.94,
        ease: "linear",
      },
      { t: 0.4, pose: P({ torso: 8, head: 10, thighR: 226, shinR: -28, footR: -50, thighL: 236, shinL: -24, footL: -48 }), rotation: deg(270), scaleX: 1.02, scaleY: 0.97, ease: "linear" },
      { t: 0.5, pose: P({ torso: 8, head: 10, thighR: 226, shinR: -28, footR: -50, thighL: 236, shinL: -24, footL: -48 }), rotation: deg(420), scaleX: 1.06, scaleY: 0.94, ease: "linear" },
      { t: 0.6, pose: P({ torso: 8, head: 10, thighR: 226, shinR: -28, footR: -50, thighL: 236, shinL: -24, footL: -48 }), rotation: deg(570), scaleX: 1.02, scaleY: 0.97, ease: "linear" },
      {
        t: 0.72,
        pose: P({ torso: 6, head: 6, thighR: 210, shinR: -6, footR: -62, thighL: 226, shinL: -4, footL: -60 }),
        rotation: deg(720),
        ease: "out",
      },
      { t: 1, pose: P({ torso: 4, thighR: 152, shinR: 40, footR: -72, thighL: 204, shinL: 34, footL: -70 }), rotation: deg(720) },
    ],
  },

  /**
   * Glider. He goes flat — "spins around horizontally in a skydiver position" —
   * and hits six times all round himself before a pose at the end to launch.
   * The spin is about a *vertical* axis, which a side-on camera cannot show as
   * rotation, so it is carried by the body lying along the screen and
   * foreshortening as it turns edge-on. `scaleX` never drops far enough to
   * shrink the head circle to a dot, because the head circle scales uniformly
   * with it; the rest of the read comes from the flat rings in `fx.ts`.
   */
  bair: {
    loop: false,
    strike: 0.2,
    keys: [
      {
        t: 0,
        pose: P({ torso: 12, head: -10, thighR: 152, shinR: 56, footR: -74, thighL: 204, shinL: 52, footL: -72 }),
        rotation: deg(-10),
        ease: "in",
      },
      {
        t: 0.2,
        pose: P({
          torso: 4, head: -12,
          thighR: 214, shinR: -14, footR: -66,
          thighL: 224, shinL: -12, footL: -64,
          upperArmR: 250, forearmR: 30,
          upperArmL: 262, forearmL: 26,
        }),
        rotation: deg(-76),
        offsetY: 0.3,
        scaleX: 1.14,
        scaleY: 0.92,
        ease: "out",
      },
      { t: 0.3, pose: P({ torso: 4, head: -12, thighR: 214, shinR: -14, footR: -66, thighL: 224, shinL: -12, footL: -64 }), rotation: deg(-86), offsetY: 0.3, scaleX: 0.82, scaleY: 1.06 },
      { t: 0.4, pose: P({ torso: 4, head: -12, thighR: 214, shinR: -14, footR: -66, thighL: 224, shinL: -12, footL: -64 }), rotation: deg(-72), offsetY: 0.3, scaleX: 1.16, scaleY: 0.9 },
      { t: 0.5, pose: P({ torso: 4, head: -12, thighR: 214, shinR: -14, footR: -66, thighL: 224, shinL: -12, footL: -64 }), rotation: deg(-88), offsetY: 0.3, scaleX: 0.84, scaleY: 1.05 },
      {
        t: 0.6,
        pose: P({ torso: 8, head: -14, thighR: 220, shinR: -18, footR: -60, thighL: 230, shinL: -16, footL: -58 }),
        rotation: deg(-70),
        offsetY: 0.25,
        scaleX: 1.18,
        scaleY: 0.88,
      },
      {
        t: 0.76,
        pose: P({ torso: 10, head: -8, thighR: 196, shinR: 12, footR: -70, thighL: 210, shinL: 10, footL: -68 }),
        rotation: deg(-34),
        offsetY: 0.1,
      },
      { t: 1, pose: P({ torso: 8, thighR: 160, shinR: 36, footR: -74, thighL: 200, shinL: 32, footL: -72 }) },
    ],
  },

  /**
   * Tail Chop: the same overhead swipe from behind as the up tilt, thrown in
   * the air on frame 4 and gone by 26. Faster and shallower than the tilt — the
   * whole thing is a flick, and the strong hitbox lives behind and above him,
   * which is where the arc starts.
   */
  uair: {
    loop: false,
    strike: 0.24,
    keys: [
      {
        t: 0,
        pose: P({ torso: 14, head: -12, thighR: 148, shinR: 58, footR: -72, thighL: 206, shinL: 54, footL: -70 }),
        rotation: deg(-22),
        ease: "in",
      },
      ...held(0.24, 0.37, {
        pose: P({
          torso: -10, head: 14,
          thighR: 168, shinR: 6, footR: -84,
          thighL: 194, shinL: 4, footL: -82,
          upperArmR: 18, forearmR: -10,
          upperArmL: -18, forearmL: 10,
        }),
        rotation: deg(34),
        offsetY: 0.3,
        scaleY: 1.14,
        scaleX: 0.92,
      }),
      {
        t: 0.52,
        pose: P({ torso: -2, head: 6, thighR: 158, shinR: 20, footR: -80, thighL: 200, shinL: 18, footL: -78 }),
        rotation: deg(16),
        offsetY: 0.1,
        scaleY: 1.05,
      },
      { t: 1, pose: P({ torso: 4, thighR: 152, shinR: 34, footR: -74, thighL: 202, shinL: 30, footL: -72 }) },
    ],
  },

  /**
   * Electric Screw. "Points down and spins its head downwards" — he inverts and
   * screws straight down, which is why the clean hit is a meteor and the hitbox
   * sits *below* his feet at y = -1.4. Rotated past the vertical and kept
   * turning, then caught upright for the landing hit.
   */
  dair: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({ torso: -8, head: 8, thighR: 146, shinR: 70, footR: -66, thighL: 200, shinL: 66, footL: -64 }),
        rotation: deg(20),
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          torso: 4, head: 12,
          thighR: 186, shinR: -6, footR: -96,
          thighL: 190, shinL: -6, footL: -94,
          upperArmR: 168, forearmR: -18,
          upperArmL: 192, forearmL: 18,
        }),
        rotation: deg(172),
        scaleX: 0.9,
        scaleY: 1.12,
        ease: "linear",
      },
      { t: 0.4, pose: P({ torso: 4, head: 12, thighR: 186, shinR: -6, footR: -96, thighL: 190, shinL: -6, footL: -94 }), rotation: deg(320), scaleX: 0.92, scaleY: 1.1, ease: "linear" },
      { t: 0.5, pose: P({ torso: 4, head: 12, thighR: 186, shinR: -6, footR: -96, thighL: 190, shinL: -6, footL: -94 }), rotation: deg(470), scaleX: 0.9, scaleY: 1.12, ease: "linear" },
      { t: 0.6, pose: P({ torso: 4, head: 12, thighR: 186, shinR: -6, footR: -96, thighL: 190, shinL: -6, footL: -94 }), rotation: deg(620), scaleX: 0.92, scaleY: 1.1, ease: "out" },
      {
        t: 0.78,
        pose: P({ torso: 2, thighR: 172, shinR: 16, footR: -86, thighL: 192, shinL: 14, footL: -84 }),
        rotation: deg(720),
        scaleY: 1.04,
      },
      { t: 1, pose: P({ torso: 2, thighR: 160, shinR: 30, footR: -78, thighL: 198, shinL: 26, footL: -76 }), rotation: deg(720) },
    ],
  },

  /**
   * Thunder Jolt. The move has no hitbox of its own — everything is the
   * projectile — so `poseTimeFor` finds no contact frame to anchor on and plays
   * this clip straight through at `actionFrame / 51`. The release therefore has
   * to be authored where the projectile actually spawns: frame 19 of 51, which
   * is `t = 0.36`, and `strike` is declared to match for the day someone gives
   * the move a hitbox.
   */
  neutralB: {
    loop: false,
    strike: 0.36,
    keys: [
      {
        t: 0,
        pose: P({ torso: -6, head: -12, ...BRACED }),
        rotation: deg(-8),
        ease: "in",
      },
      {
        t: 0.24,
        pose: P({
          torso: -16, head: -22, hip: 6,
          thighR: 156, shinR: 40, footR: -80,
          thighL: 210, shinL: 36, footL: -76,
        }),
        offsetX: -0.4,
        offsetY: -0.5,
        rotation: deg(-20),
        scaleY: 0.94,
        ease: "in",
      },
      {
        t: 0.36,
        pose: P({
          torso: 16, head: 22,
          thighR: 134, shinR: 24, footR: -88,
          thighL: 220, shinL: 26, footL: -72,
          upperArmR: 88, forearmR: -8,
          upperArmL: 96, forearmL: -6,
        }),
        offsetX: 0.8,
        rotation: deg(22),
        scaleX: 1.14,
        scaleY: 0.92,
        ease: "out",
      },
      {
        t: 0.5,
        pose: P({ torso: 8, head: 10, ...BRACED }),
        offsetX: 0.35,
        rotation: deg(10),
      },
      { t: 1, pose: P({ torso: 4, ...BRACED }) },
    ],
  },

  /**
   * Skull Bash. He compresses into a crouch while the charge builds, then
   * launches head-first as a projectile — the hitbox sits *inside* his own
   * hurtbox, which is the tell that the animation is him, flat out, nose first.
   */
  sideB: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 16, head: -18, hip: -6,
          thighR: 134, shinR: 86, footR: -74,
          thighL: 142, shinL: 82, footL: -72,
        }),
        offsetX: -0.4,
        offsetY: -1.5,
        rotation: deg(-14),
        scaleX: 1.06,
        scaleY: 0.88,
        ease: "in",
      },
      // **Horizontal, nose first.** At 56° of rotation with the legs kicked out
      // at 232 he came out of the crouch tumbling: the capture showed a Pikachu
      // face-planting at forty-five degrees with his ears trailing up behind
      // him, which is what being launched *by* a Skull Bash looks like rather
      // than what throwing one does. SmashWiki has three words for the move —
      // "launches itself headfirst" — and the shape that says it is the spine
      // laid flat along the direction of travel with the skull at the front and
      // everything else streaming behind. So: 82° puts the body axis on the
      // horizontal, the legs sit near-straight *along* that axis so they trail
      // rather than kick, and `scaleX` stretches the whole thing lengthwise
      // because after the rotation his length is the screen's x.
      ...held(0.3, 0.6, {
        pose: P({
          torso: 8, head: 14, hip: -2,
          thighR: 176, shinR: -4, footR: -74,
          thighL: 186, shinL: -6, footL: -70,
          upperArmR: 172, forearmR: -10,
          upperArmL: 188, forearmL: 10,
        }),
        offsetX: 1.0,
        offsetY: 0.15,
        rotation: deg(58),
        scaleX: 1.3,
        scaleY: 0.84,
      }),
      {
        t: 0.7,
        pose: P({
          torso: 3, head: 6,
          thighR: 180, shinR: 0, footR: -76,
          thighL: 190, shinL: -2, footL: -72,
        }),
        offsetX: 0.85,
        offsetY: 0.12,
        rotation: deg(52),
        scaleX: 1.24,
        scaleY: 0.86,
      },
      {
        t: 0.82,
        pose: P({ torso: 10, head: 6, thighR: 200, shinR: 10, footR: -70, thighL: 214, shinL: 8, footL: -68 }),
        offsetX: 0.6,
        offsetY: 0.1,
        rotation: deg(28),
        scaleX: 1.08,
      },
      { t: 1, pose: P({ torso: 8, ...BRACED }), offsetX: 0.2 },
    ],
  },

  /**
   * Quick Attack. Two zips, aimed independently, with the second only coming
   * out if it differs from the first by thirty degrees — so the clip has to
   * show two distinct launches and the beat between them, not one leap.
   *
   * The displacement itself belongs to the engine (`momentum` at frames 8 and
   * 20), so the offsets here stay small and cancel: what sells a zip is the
   * body stretched to a streak along the direction of travel and *held* there
   * for a few frames, which is what `hold` easing is for. Frame 14 is the first
   * hitbox and frame 28 the second, which land at `t` 0.28 and 0.55.
   */
  upB: {
    loop: false,
    strike: 0.28,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 18, head: -16,
          thighR: 132, shinR: 90, footR: -72,
          thighL: 140, shinL: 86, footL: -70,
        }),
        offsetY: -1.6,
        scaleX: 1.12,
        scaleY: 0.82,
        ease: "in",
      },
      {
        // Zip one: straight up. Stretched to twice his height and a third his
        // width, which at this size is a streak with two ears on it.
        t: 0.28,
        pose: P({
          torso: -4, head: 6,
          thighR: 176, shinR: 2, footR: -92,
          thighL: 184, shinL: 2, footL: -90,
          upperArmR: 8, forearmR: -4,
          upperArmL: -8, forearmL: 4,
        }),
        offsetY: 0.9,
        scaleX: 0.56,
        scaleY: 1.62,
        ease: "hold",
      },
      {
        // The beat between the two dashes: he is briefly a compact ball again.
        t: 0.4,
        pose: P({
          torso: 8, head: -6,
          thighR: 150, shinR: 50, footR: -74,
          thighL: 206, shinL: 46, footL: -72,
        }),
        offsetY: 0.4,
        scaleX: 1.04,
        scaleY: 0.96,
        ease: "hold",
      },
      {
        // Zip two: forward. Same stretch, laid over on its side.
        t: 0.55,
        pose: P({
          torso: 2, head: 12,
          thighR: 224, shinR: -16, footR: -62,
          thighL: 232, shinL: -14, footL: -60,
          upperArmR: 128, forearmR: -30,
          upperArmL: 136, forearmL: -28,
        }),
        offsetX: 0.9,
        offsetY: 0.3,
        rotation: deg(62),
        scaleX: 1.66,
        scaleY: 0.58,
        ease: "hold",
      },
      {
        t: 0.7,
        pose: P({ torso: 6, head: 4, thighR: 190, shinR: 16, footR: -72, thighL: 206, shinL: 14, footL: -70 }),
        offsetX: 0.4,
        offsetY: 0.15,
        rotation: deg(26),
        scaleX: 1.1,
        scaleY: 0.92,
      },
      { t: 1, pose: P({ torso: 6, thighR: 156, shinR: 34, footR: -76, thighL: 200, shinL: 30, footL: -74 }) },
    ],
  },

  /**
   * Thunder. Almost none of this move is Pikachu: the bolt falls from off the
   * top of the screen and the discharge happens where it lands. What the body
   * does is brace — he plants, drops his head back and *waits*, which is also
   * the honest read for a move that is famously easy to punish before it
   * connects — and then takes the blast, on frames 16-17, as a hard compression.
   */
  downB: {
    loop: false,
    strike: 0.2,
    keys: [
      {
        t: 0,
        pose: P({ torso: 8, head: -10, ...BRACED }),
        offsetY: -0.4,
        ease: "in",
      },
      {
        t: 0.2,
        pose: P({
          torso: 14, head: -28, hip: -4,
          thighR: 136, shinR: 80, footR: -124,
          thighL: 144, shinL: 76, footL: -128,
          upperArmR: 210, forearmR: 40,
          upperArmL: 224, forearmL: -40,
        }),
        offsetY: -1.1,
        scaleY: 0.92,
        scaleX: 1.06,
        ease: "out",
      },
      {
        // The discharge lands on him. Squashed flat under it, then thrown back
        // up as the shockwave leaves.
        t: 0.26,
        pose: P({
          torso: 20, head: -20,
          thighR: 128, shinR: 96, footR: -132,
          thighL: 138, shinL: 92, footL: -138,
        }),
        offsetY: -1.4,
        scaleY: 0.8,
        scaleX: 1.18,
        ease: "out",
      },
      {
        t: 0.36,
        pose: P({
          torso: -6, head: 6,
          thighR: 162, shinR: 20, footR: -84,
          thighL: 198, shinL: 18, footL: -82,
        }),
        offsetY: 0.2,
        scaleY: 1.12,
        scaleX: 0.92,
      },
      {
        t: 0.55,
        pose: P({ torso: 6, head: -4, ...BRACED }),
        offsetY: -0.4,
      },
      { t: 1, pose: P({ torso: 4, ...BRACED }) },
    ],
  },

  /**
   * He "reaches out", and with a paw that cannot leave his own outline the
   * reach has to be the whole animal leaning after it. Short, and the fear in
   * the real animation — Pikachu pulls a scared face on a whiff — is not
   * something a sixteen-bone rig is going to sell, so it is not attempted.
   */
  grab: {
    loop: false,
    strike: 0.26,
    keys: [
      {
        t: 0,
        pose: P({ torso: -8, head: -6, upperArmR: 150, forearmR: -40, upperArmL: 158, forearmL: -36 }),
        rotation: deg(-6),
        ease: "in",
      },
      ...held(0.26, 0.29, {
        pose: P({
          torso: 14, head: 12,
          thighR: 140, shinR: 28, footR: -86,
          thighL: 216, shinL: 26, footL: -76,
          upperArmR: 82, forearmR: -6,
          upperArmL: 90, forearmL: -4,
        }),
        offsetX: 0.7,
        rotation: deg(16),
        scaleX: 1.08,
      }),
      {
        t: 0.44,
        pose: P({ torso: 8, head: 6, ...BRACED, upperArmR: 96, forearmR: 2, upperArmL: 104, forearmL: 2 }),
        offsetX: 0.3,
        rotation: deg(8),
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 120, forearmR: -20, upperArmL: 130, forearmL: -18 }) },
    ],
  },

  /**
   * Electric Throw: he lays them across his tail and shocks them, five times.
   * So the body tips *back* to present the tail rather than throwing forward,
   * and the electricity — five discharges of two percent — is `fx.ts`'s job.
   */
  fthrow: {
    loop: false,
    strike: 0.42,
    keys: [
      { t: 0, pose: P({ torso: -10, upperArmR: 128, forearmR: -46, upperArmL: 136, forearmL: -44 }), ease: "in" },
      {
        t: 0.42,
        pose: P({
          torso: -22, head: 16, hip: 8,
          thighR: 158, shinR: 26, footR: -84,
          thighL: 206, shinL: 24, footL: -80,
          upperArmR: 62, forearmR: -18,
          upperArmL: 70, forearmL: -16,
        }),
        offsetX: -0.3,
        offsetY: -0.3,
        rotation: deg(-26),
        ease: "out",
      },
      {
        t: 0.6,
        pose: P({ torso: -8, head: 8, ...BRACED, upperArmR: 84, forearmR: -6, upperArmL: 92, forearmL: -4 }),
        rotation: deg(-10),
      },
      { t: 1, pose: P({ torso: 4, ...BRACED }) },
    ],
  },

  /**
   * Submission — a tomoe nage, the judo sacrifice throw. He rolls backward
   * underneath them and launches them over his head, which is a full backward
   * revolution of the body and nothing an arm angle can express.
   */
  bthrow: {
    loop: false,
    strike: 0.42,
    keys: [
      {
        t: 0,
        pose: P({ torso: 10, head: -8, upperArmR: 110, forearmR: -40, upperArmL: 118, forearmL: -38 }),
        ease: "in",
      },
      {
        t: 0.24,
        pose: P({
          torso: -6, head: 8,
          thighR: 138, shinR: 74, footR: -70,
          thighL: 146, shinL: 70, footL: -68,
        }),
        offsetY: -1.6,
        rotation: deg(-70),
        ease: "linear",
      },
      {
        t: 0.42,
        pose: P({
          torso: -4, head: 10,
          thighR: 122, shinR: 30, footR: -50,
          thighL: 130, shinL: 26, footL: -48,
        }),
        offsetY: -1.9,
        rotation: deg(-210),
        scaleX: 1.06,
        ease: "out",
      },
      {
        t: 0.6,
        pose: P({ torso: 2, head: 6, thighR: 150, shinR: 46, footR: -66, thighL: 202, shinL: 42, footL: -64 }),
        offsetY: -1.2,
        rotation: deg(-330),
      },
      { t: 0.8, pose: P({ torso: 6, ...BRACED }), offsetY: -0.4, rotation: deg(-360) },
      { t: 1, pose: P({ torso: 4, ...BRACED }), rotation: deg(-360) },
    ],
  },

  /**
   * Heading. He heaves them up onto his skull and headbutts them off it, so the
   * whole body extends and the *head* is what finishes the move — the one throw
   * where his best feature does the work.
   */
  uthrow: {
    loop: false,
    strike: 0.42,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 16, head: -16,
          thighR: 136, shinR: 80, footR: -124,
          thighL: 144, shinL: 76, footL: -128,
        }),
        offsetY: -1.0,
        ease: "in",
      },
      {
        t: 0.42,
        pose: P({
          torso: -12, head: -24,
          thighR: 172, shinR: 8, footR: -88,
          thighL: 190, shinL: 6, footL: -86,
          upperArmR: 12, forearmR: -6,
          upperArmL: -12, forearmL: 6,
        }),
        offsetY: 0.8,
        rotation: deg(-16),
        scaleY: 1.2,
        scaleX: 0.88,
        ease: "out",
      },
      {
        t: 0.6,
        pose: P({ torso: -4, head: -10, thighR: 164, shinR: 16, footR: -86, thighL: 196, shinL: 14, footL: -84 }),
        offsetY: 0.3,
        scaleY: 1.07,
      },
      { t: 1, pose: P({ torso: 4, ...BRACED }) },
    ],
  },

  /**
   * Hip Press — a senton. He puts them on the floor and drops his entire body
   * weight onto them, which for a fighter weighing 79 units is more comedy than
   * threat and is exactly how it reads in the real game. Up first, then flat.
   */
  dthrow: {
    loop: false,
    strike: 0.5,
    keys: [
      { t: 0, pose: P({ torso: -6, upperArmR: 124, forearmR: -44, upperArmL: 132, forearmL: -42 }), ease: "in" },
      {
        t: 0.3,
        pose: P({
          torso: -14, head: 10,
          thighR: 168, shinR: 10, footR: -86,
          thighL: 194, shinL: 8, footL: -84,
        }),
        offsetY: 0.9,
        scaleY: 1.16,
        scaleX: 0.9,
        ease: "in",
      },
      {
        t: 0.5,
        pose: P({
          torso: 24, head: -22, hip: -10,
          thighR: 116, shinR: 100, footR: -124,
          thighL: 244, shinL: -96, footL: -56,
          upperArmR: 158, forearmR: -24,
          upperArmL: 202, forearmL: 22,
        }),
        offsetY: -0.4,
        scaleY: 0.56,
        scaleX: 1.32,
        ease: "out",
      },
      {
        t: 0.64,
        pose: P({
          torso: 18, head: -14,
          thighR: 126, shinR: 92, footR: -126,
          thighL: 234, shinL: -70, footL: -72,
        }),
        offsetY: -0.35,
        scaleY: 0.68,
        scaleX: 1.22,
      },
      { t: 1, pose: P({ torso: 10, thighR: 142, shinR: 66, footR: -116, thighL: 150, shinL: 62, footL: -120 }), offsetY: -0.9 },
    ],
  },
};
