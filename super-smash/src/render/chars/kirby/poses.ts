/**
 * Kirby: the clips that are Kirby’s rather than everybody’s.
 *
 * The shared library in `render/poses/` has one `fsmash` and one `neutralB`
 * for the whole roster, which is the right default — fifty clips across eight
 * rigs instead of four hundred hand-authored ones — and the wrong answer for
 * any move whose *shape* is the character. Whatever is named here wins over the
 * shared clip for this fighter alone; whatever is not named falls through
 * unchanged, so this file only ever holds the moves that earn their place.
 *
 * ## Why nearly everything is named here
 *
 * Because Kirby is a sphere. The shared clips carry a fighter's identity in
 * their elbows and their shoulders, and Kirby's elbows are *inside his body* —
 * even after `rig.ts` lengthened the arms enough to break the outline, an arm
 * is a nub with about 0.4 units of travel outside a 4.45-unit ball. A shared
 * `fsmash` played on this rig is a pink circle sitting still for forty-seven
 * frames, which is exactly what the contact sheet showed.
 *
 * So these clips are authored in the four channels that *do* read on a ball:
 *
 * 1. **`rotation`, and which side's limbs are in front.** The face and the
 *    boots whirl around the outline, and for a corkscrew or a spinning split
 *    that is the entire read.
 *
 *    **Nothing in this file uses `spin`, and the three moves that look like
 *    they should are exactly the three that must not.** `spin` turns the whole
 *    rig in the plane of the screen. Kirby's spinning moves — the down smash's
 *    pirouette, the down air's corkscrew, the neutral air's star — all turn
 *    about his *vertical* axis, and played as `spin` each one puts his face
 *    underneath him, which on a fighter who is one face on one circle reads as
 *    a tumbling victim rather than an attack. A vertical-axis turn is faked
 *    instead by swapping the near and far limbs on `hold` cuts; see
 *    `swapSides`.
 * 2. **`offsetX` / `offsetY`.** How far the ball travels.
 * 3. **The boots.** The legs are the only limb with the reach to leave the
 *    sphere, so a kick is a boot outside the outline or it is nothing. Kirby's
 *    moveset is almost entirely kicks, which is lucky.
 * 4. **`scaleX` as a size pulse.** `drawFigure` derives the head circle's
 *    radius from `scale * scaleX`, so on this rig `scaleX` inflates the whole
 *    of him and `scaleY` does not touch the ball at all — it only moves the
 *    bones, which lowers where the ball sits. There is no way to squash Kirby
 *    into an ellipse; `scaleX` up is the impact accent and `scaleY` down is the
 *    crouch.
 *
 * ## Where the `t` values come from
 *
 * `poseTimeFor` stretches the wind-up so the `strike` key lands on the move's
 * first active frame, then stretches the recovery across what is left. For a
 * move with more than one beat the later beats have to be placed with the same
 * arithmetic the sampler uses:
 *
 *     t(f) = strike + (1 − strike) · (f − firstActive) / (total − firstActive)
 *
 * where `firstActive = startFrame − 1` (`actionFrameOf`). Every multi-beat clip
 * below shows its working, because getting this wrong is silent — the beat
 * simply happens on the wrong frame and the move still looks like *an*
 * animation.
 */

import { P, type Keyframe, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";

/**
 * A key, and the same key again at `until`: the extension *held* for as long as
 * the hitbox is live.
 *
 * `ease: "out"` on a strike key is a cubic, and a cubic leaves at speed. On the
 * forward smash — 47 frames, hitbox live on 13–19, strike at `t = 0.3` and the
 * next key at 0.46 — that put him 6% into the recovery one frame after contact
 * and 60% into it by the last active frame. One frame of extension and six of
 * visibly putting the move away, on a move whose whole point is that it is out
 * there for seven.
 *
 * Naming the end of the active window as a second, *identical* key pins the
 * shape for the whole window, and `hold` on the first cuts to it rather than
 * drifting toward it. The time comes from the move's own hitboxes:
 *
 *     until = strike + (1 − strike)·(lastActive − firstActive)/(total − firstActive)
 *
 * with `firstActive`/`lastActive` counted in `actionFrame`s — one less than the
 * frame numbers written in `fighters/kirby.ts`, per `actionFrameOf`. A hitbox
 * live for a single frame has nothing to hold and gets its key back unchanged,
 * which is why the jab and three of the four throws are untouched.
 */
function holdThrough(until: number, key: Keyframe): Keyframe[] {
  if (until <= key.t + 1e-6) return [key];
  return [{ ...key, ease: "hold" }, { ...key, t: until }];
}

/**
 * Near arm at four o'clock, far arm at eight.
 *
 * The shared clips rest Kirby's arms at 162°/195° — all but straight down —
 * which on the lengthened arm puts both nubs at the bottom of the ball, on top
 * of each other and on top of the boots. Out at the sides they read as the two
 * bumps he actually has.
 */
const ARMS_REST = { upperArmR: 116, forearmR: 10, upperArmL: 244, forearmL: -10 };

/**
 * Both boots planted, splayed, toes forward and both at the same depth.
 *
 * The splay lives here rather than in the rig's rest angles because a splay is
 * only half a stance: swing the thigh 28° forward and the ankle comes 0.9
 * forward *and 0.25 up*, and the boot — whose angle accumulates down the chain
 * — tips its toe 28° into the air. Two boots splayed opposite ways then plant
 * at two different depths, one of them through the floor.
 *
 * So the shins take the splay back out (`144 + 34 = 178`, near enough vertical)
 * and the feet are set from the accumulated total rather than from the rig's
 * −88: `footR = 92 − 178`, `footL = 92 − 182`. The knees end up splayed, the
 * shins hang plumb, both soles land within a hundredth of each other, and the
 * ankles are 2.35 apart — which is what stops the near boot eclipsing the far
 * one. Rule 4 in `docs/character-art.md` still holds: both feet are negative.
 *
 * **Round one splayed 28° and it was not enough.** Each boot is 1.5 long with
 * 2.3 of thickness, so it covers about 3.3 units of ground; at ankles 1.9 apart
 * the two overlapped along nearly half their length and a critic given a
 * capture of the idle described "one peanut lump" rather than two feet. 36°
 * puts them 2.35 apart, which is the first spacing that leaves daylight between
 * the toe of the far boot and the heel of the near one.
 */
const STANCE = { thighR: 144, shinR: 34, footR: -86, thighL: 216, shinL: -34, footL: -90 };

export const poses: Partial<Record<PoseName, PoseClip>> = {
  /**
   * Standing. The shared idle breathes with the torso, and Kirby's torso is
   * 0.65 units long and buried, so he stood *perfectly* still for 108 frames.
   * A ball can only breathe by changing size.
   *
   * It names the legs, which the shared idle does not have to: every other clip
   * in the library sets its own thighs, so the rig's rest angles are only ever
   * seen *here*, and a Kirby standing with one boot behind the other is the one
   * pose a player looks at for longer than a second.
   */
  idle: {
    loop: true,
    period: 96,
    keys: [
      { t: 0, pose: P({ ...STANCE, ...ARMS_REST }), scaleX: 1.0, scaleY: 1.0 },
      {
        // The breath in. `scaleX` is the only channel that changes the size of
        // the circle — `drawFigure` takes the head radius from `scale * scaleX`
        // — so on this rig it *is* the breath, and `scaleY` only lifts where
        // the ball sits on the legs. Round one moved it 2%, which is a fifth of
        // a rig unit on a 4.45 radius and about one pixel at match scale: the
        // contact sheet showed a hundred and eight identical drawings. 4% is
        // still small for a cartoon breath and it is the first amount that can
        // actually be seen.
        t: 0.28,
        pose: P({ ...STANCE, ...ARMS_REST, upperArmR: 104, forearmR: 16, upperArmL: 256, forearmL: -16 }),
        scaleX: 1.04,
        scaleY: 1.05,
        offsetY: 0.1,
      },
      {
        t: 0.52,
        pose: P({ ...STANCE, ...ARMS_REST }),
        scaleX: 1.0,
        scaleY: 1.0,
      },
      {
        // The breath out, and the arms drop past their rest angle before they
        // settle — a nub that returns straight to where it started has no
        // weight, and the arms are two of the four bumps on his outline.
        t: 0.78,
        pose: P({ ...STANCE, ...ARMS_REST, upperArmR: 128, forearmR: 4, upperArmL: 232, forearmL: -4 }),
        scaleX: 0.975,
        scaleY: 0.955,
      },
    ],
  },

  /* ------------------------------------------------------------- normals -- */

  /** Vulcan Jab's opener: a straight punch. total 14, firstActive 1. */
  jab: {
    loop: false,
    strike: 0.24,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, upperArmR: 158, forearmR: 22, upperArmL: 236, forearmL: -14 }),
        offsetX: -0.2,
        ease: "in",
      },
      {
        t: 0.24,
        pose: P({
          ...STANCE,
          thighR: 148,
          upperArmR: 94,
          forearmR: -4,
          handR: 0,
          upperArmL: 250,
          forearmL: -18,
        }),
        offsetX: 0.55,
        scaleX: 1.06,
        ease: "out",
      },
      {
        t: 0.42,
        pose: P({ ...STANCE, upperArmR: 104, forearmR: 4, upperArmL: 244, forearmL: -12 }),
        offsetX: 0.28,
        scaleX: 1.02,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Forward tilt — "a spinning roundhouse kick". The whip of the body is the
   * move; the boot arriving out front is the hit. total 23, firstActive 4.
   */
  ftilt: {
    loop: false,
    strike: 0.26,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, thighR: 186, shinR: 16, upperArmR: 150, upperArmL: 250 }),
        rotation: -0.38,
        offsetX: -0.45,
        ease: "in",
      },
      // hitbox 5–8 → firstActive 4, lastActive 7, total 23:
      //   0.26 + 0.74·(7−4)/(23−4) = 0.377
      ...holdThrough(0.377, {
        // The kick: near leg straight out forward, toe pointed, body turned
        // through the swing.
        t: 0.26,
        pose: P({
          thighR: 96,
          shinR: -4,
          footR: -12,
          thighL: 200,
          shinL: -6,
          footL: -88,
          upperArmR: 74,
          forearmR: -8,
          upperArmL: 268,
          forearmL: -16,
        }),
        rotation: 0.4,
        offsetX: 0.7,
        scaleX: 1.09,
        ease: "out",
      }),
      {
        t: 0.44,
        pose: P({ thighR: 122, shinR: 6, footR: -46, thighL: 202, shinL: -4, footL: -88 }),
        rotation: 0.18,
        offsetX: 0.36,
        scaleX: 1.03,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Up tilt — "a scorpion kick", foot intangible, reaching up and slightly
   * forward. The boot has to clear the top of the ball: the leg is 1.6 + 1.6
   * with a 1.9 boot off a hip at 4.2, so straight up it reaches 9.2 against a
   * crown at 9.73 and the boot's own radius carries it out. total 20, first 3.
   */
  utilt: {
    loop: false,
    strike: 0.24,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, thighR: 168, shinR: 22 }),
        scaleY: 0.9,
        ease: "in",
      },
      // hitboxes 4–5 and 6–10 → firstActive 3, lastActive 9, total 20:
      //   0.24 + 0.76·(9−3)/(20−3) = 0.508. Seven frames of intangible boot at
      //   the top of the arc is what the move *is*; it used to start coming
      //   down on the second of them.
      ...holdThrough(0.508, {
        t: 0.24,
        pose: P({
          thighR: 14,
          shinR: 4,
          footR: -20,
          thighL: 196,
          shinL: -8,
          footL: -84,
          upperArmR: 40,
          forearmR: -12,
          upperArmL: 316,
          forearmL: 12,
        }),
        rotation: 0.16,
        offsetY: 0.2,
        scaleY: 1.08,
        ease: "out",
      }),
      {
        t: 0.62,
        pose: P({ thighR: 52, shinR: 14, footR: -46, thighL: 200, shinL: -6, footL: -86 }),
        rotation: 0.06,
        scaleY: 1.02,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Down tilt — a crouching shin kick that slides him forward. `scaleY` is the
   * only crouch this rig has: it lowers where the ball sits without touching
   * the circle's radius. total 20, firstActive 3.
   */
  dtilt: {
    loop: false,
    strike: 0.24,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, thighR: 160, shinR: 20 }),
        scaleY: 0.78,
        ease: "in",
      },
      // hitbox 4–6 → firstActive 3, lastActive 5, total 20:
      //   0.24 + 0.76·(5−3)/(20−3) = 0.329
      ...holdThrough(0.329, {
        t: 0.24,
        pose: P({
          thighR: 104,
          shinR: -8,
          footR: -22,
          thighL: 212,
          shinL: -10,
          footL: -84,
          upperArmR: 128,
          forearmR: 10,
          upperArmL: 236,
          forearmL: -10,
        }),
        scaleY: 0.66,
        scaleX: 1.05,
        offsetX: 0.62,
        ease: "out",
      }),
      {
        t: 0.44,
        pose: P({ thighR: 128, shinR: 4, footR: -56, thighL: 206, shinL: -6, footL: -86 }),
        scaleY: 0.72,
        offsetX: 0.3,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }), scaleY: 0.96 },
    ],
  },

  /**
   * Dash attack — Burning. He becomes a horizontal flaming missile, and the
   * hitbox is live from frame 9 to 34, so the shape is *held* for twenty-five
   * frames rather than passed through. total 51, firstActive 8.
   *   t(33) = 0.16 + 0.84·(33−8)/(51−8) = 0.65 — the end of the burn.
   */
  dashAttack: {
    loop: false,
    strike: 0.16,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, thighR: 172, shinR: 26, upperArmR: 150, upperArmL: 250 }),
        rotation: -0.12,
        offsetX: -0.3,
        scaleY: 0.88,
        ease: "in",
      },
      {
        // Tucked and tipped almost onto his face, legs trailing.
        t: 0.16,
        pose: P({
          thighR: 236,
          shinR: 34,
          footR: -70,
          thighL: 244,
          shinL: 30,
          footL: -68,
          upperArmR: 82,
          forearmR: -10,
          upperArmL: 268,
          forearmL: 10,
        }),
        rotation: 1.05,
        offsetX: 1.4,
        offsetY: 0.55,
        scaleX: 1.08,
        ease: "out",
      },
      {
        t: 0.5,
        pose: P({
          thighR: 232,
          shinR: 30,
          footR: -72,
          thighL: 240,
          shinL: 26,
          footL: -70,
          upperArmR: 86,
          upperArmL: 264,
        }),
        rotation: 1.12,
        offsetX: 2.4,
        offsetY: 0.5,
        scaleX: 1.05,
        ease: "hold",
      },
      {
        // The burn ends and he drops back onto his feet.
        t: 0.65,
        pose: P({ thighR: 190, shinR: 24, footR: -84, thighL: 214, shinL: 18, footL: -86 }),
        rotation: 0.34,
        offsetX: 2.7,
        offsetY: 0.1,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }), offsetX: 2.8 },
    ],
  },

  /* -------------------------------------------------------------- smashes -- */

  /**
   * Forward smash — the Spin Kick: he pulls back, then drives a thrust kick
   * out in front, lunging. The boot ends 5.1 units from the body axis against
   * a 4.45 radius, so nearly half a leg is outside the outline: that is the
   * whole difference between this and the shared clip, which kept everything
   * inside the sphere. total 47, firstActive 12.
   */
  fsmash: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        // Coiled back on the far leg. Smashes park here while charging.
        t: 0,
        pose: P({
          thighR: 196,
          shinR: 24,
          footR: -86,
          thighL: 218,
          shinL: -8,
          footL: -84,
          upperArmR: 158,
          forearmR: 20,
          upperArmL: 250,
          forearmL: -14,
        }),
        rotation: -0.34,
        offsetX: -0.75,
        scaleY: 0.9,
        ease: "in",
      },
      // hitboxes 13–15 and 16–19 → firstActive 12, lastActive 18, total 47:
      //   0.3 + 0.7·(18−12)/(47−12) = 0.42
      ...holdThrough(0.42, {
        t: 0.3,
        pose: P({
          thighR: 92,
          shinR: -2,
          footR: -6,
          thighL: 208,
          shinL: -6,
          footL: -86,
          upperArmR: 66,
          forearmR: -10,
          upperArmL: 274,
          forearmL: -12,
        }),
        rotation: 0.3,
        offsetX: 1.85,
        scaleX: 1.13,
        ease: "out",
      }),
      {
        t: 0.46,
        pose: P({
          thighR: 116,
          shinR: 4,
          footR: -34,
          thighL: 204,
          shinL: -4,
          footL: -88,
          upperArmR: 92,
          upperArmL: 262,
        }),
        rotation: 0.14,
        offsetX: 1.15,
        scaleX: 1.05,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }), offsetX: 0.5 },
    ],
  },

  /**
   * Up smash — the Somersault Kick, and **round one had it running backwards**.
   *
   * SmashWiki calls it "a bicycle kick that hits all around" him, and the
   * hitbox visualisation settles the direction: frames 12–13 are up *and
   * forward*, frame 14 is directly overhead, and 15–17 are up *and behind*. So
   * the boot starts in front, goes over the crown and finishes behind him —
   * which is the opposite of the round-one clip, where it scythed up from
   * behind and carried over to the front. The body tips back as the leg passes
   * over, which is what sells the somersault rather than a high kick.
   *
   * total 45, firstActive 11, strike 0.3: t(af) = 0.3 + 0.7·(af − 11)/34.
   *   overhead, frame 14 → actionFrame 13 → t = 0.341
   *   behind,   frame 17 → actionFrame 16 → t = 0.403
   *
   * The boot only ever clears the crown by about a quarter of a radius: the leg
   * is 2.0 + 2.0 + 1.5 off a hip 1.08 below the ball's middle, so straight up it
   * reaches 5.57 from the centre against a 4.45 radius. Pointing the toe *along*
   * the leg rather than across it is what buys even that, and a leg posed
   * forward of vertical buys less, because the ball's surface is lower out
   * there. There is no pose that makes this a big read on this rig.
   */
  usmash: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, thighR: 176, shinR: 26, thighL: 214, shinL: 12 }),
        scaleY: 0.82,
        rotation: 0.12,
        ease: "in",
      },
      {
        // Up and in front, which is where the first two active frames hit.
        t: 0.3,
        pose: P({
          thighR: 42,
          shinR: 10,
          footR: -30,
          thighL: 210,
          shinL: -10,
          footL: -82,
          upperArmR: 60,
          forearmR: -12,
          upperArmL: 300,
          forearmL: 12,
        }),
        rotation: 0.14,
        offsetY: 0.2,
        scaleY: 1.06,
        ease: "out",
      },
      {
        // Straight through the crown. Toe pointed along the leg — across it,
        // the boot lies flat over the head and clears nothing.
        t: 0.341,
        pose: P({
          thighR: 358,
          shinR: 6,
          footR: -14,
          thighL: 216,
          shinL: -12,
          footL: -80,
          upperArmR: 24,
          forearmR: -10,
          upperArmL: 330,
          forearmL: 10,
        }),
        rotation: -0.1,
        offsetY: 0.35,
        scaleY: 1.12,
      },
      {
        // And out behind him, with the body tipped back under it.
        t: 0.403,
        pose: P({
          thighR: 318,
          shinR: 4,
          footR: -6,
          thighL: 220,
          shinL: -14,
          footL: -78,
          upperArmR: 10,
          forearmR: -8,
          upperArmL: 344,
          forearmL: 8,
        }),
        rotation: -0.34,
        offsetY: 0.3,
        scaleY: 1.1,
        ease: "out",
      },
      {
        // Down out of the somersault with the **knee folded**. Interpolating a
        // straight leg from behind-and-above back to `STANCE` swings it through
        // the floor on the way — the sole went nine tenths of a unit into the
        // stage around t = 0.67, which the shared grounded-clip check catches
        // and a player would see as his boot inside the platform. Folding the
        // knee (thigh 268 against a shin of +52) keeps the ankle high while the
        // thigh comes round, which is also what a leg actually does.
        t: 0.52,
        pose: P({ ...STANCE, thighR: 268, shinR: 52, footR: -60 }),
        rotation: -0.16,
        offsetY: 0.1,
        scaleY: 0.98,
      },
      {
        t: 0.62,
        pose: P({ ...STANCE }),
        scaleY: 0.92,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Down smash — a spinning split kick, front and back, feet intangible.
   *
   * **Not `spin`.** The pirouette in the real move turns about Kirby's vertical
   * axis, and `spin` turns about the axis out of the screen: played as `spin`
   * the split swings up to vertical and the two boots leave the ground, which
   * is a cartwheel, not a split. Worse, a split is symmetric, so an in-plane
   * half-turn of it is *invisible* — the silhouette maps onto itself.
   *
   * What sells a vertical-axis turn in two dimensions is the legs **swapping
   * ends**, which is also exactly what the frame data describes: the front
   * hitbox is live on frames 7–11 and the rear one on 12–19. So the near leg
   * kicks forward for the first window and back for the second, and the body
   * dips between them. total 50, firstActive 6:
   *   t(f) = 0.22 + 0.78·(f − 6)/44
   *   rear hitbox, frame 12 → actionFrame 11 → t = 0.309
   *   rear hitbox ends, frame 19 → actionFrame 18 → t = 0.433
   */
  dsmash: {
    loop: false,
    strike: 0.22,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, thighR: 168, shinR: 30, thighL: 208, shinL: 14 }),
        scaleY: 0.86,
        ease: "in",
      },
      // The front window runs to frame 11 → actionFrame 10 → t = 0.291, and
      // the rear one opens on the very next frame at 0.309. Nothing samples
      // between them, so the "legs gathered halfway round" key that used to sit
      // at 0.27 was never drawn on any frame — the swap *is* a one-frame cut,
      // which is the only way a vertical-axis turn reads in two dimensions.
      ...holdThrough(0.291, {
        // Front half of the split: near boot out forward at ground level, far
        // boot trailing behind.
        t: 0.22,
        pose: P({
          thighR: 106,
          shinR: -8,
          footR: -14,
          thighL: 254,
          shinL: 6,
          footL: 6,
          upperArmR: 96,
          forearmR: -6,
          upperArmL: 264,
          forearmL: 6,
        }),
        scaleY: 0.9,
        scaleX: 1.12,
        ease: "hold",
      }),
      ...holdThrough(0.433, {
        // Rear half: the legs have swapped ends.
        t: 0.309,
        pose: P({
          thighR: 250,
          shinR: 8,
          footR: 8,
          thighL: 104,
          shinL: -8,
          footL: -14,
          upperArmR: 268,
          forearmR: 6,
          upperArmL: 100,
          forearmL: -6,
        }),
        scaleY: 0.9,
        scaleX: 1.12,
        ease: "out",
      }),
      {
        // Gathering out of the split. Both ankles are set from the accumulated
        // thigh+shin, not from a round number: at `footR: -60` off a 208°
        // shin this boot pointed 58° into the floor and put its toe a full unit
        // under the stage — a foot angle that is *fine on Mario* and buries a
        // boot half as long again on legs a third shorter.
        t: 0.56,
        pose: P({ thighR: 190, shinR: 18, footR: -118, thighL: 178, shinL: -14, footL: -74 }),
        scaleY: 0.9,
        scaleX: 1.02,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /* -------------------------------------------------------------- aerials -- */

  /**
   * Neutral air — limbs out, spinning, one big hitbox around the whole of him
   * for twenty-five frames. hitboxes 8–32 → firstActive 7, lastActive 31,
   * total 52: 0.15 + 0.85·(31−7)/(52−7) = 0.603.
   *
   * **`spin` was wrong here, for the third time in this file.** It was authored
   * as `spin: 1`, a cartwheel, and the contact sheet showed what that means on
   * a rig whose whole identity is one face on one circle: he is 54° over at the
   * strike, past 90° by the fifth active frame and fully **upside down** across
   * the middle third of the window. Kirby's is a horizontal spin — he turns
   * about his own vertical axis with his arms and legs out, and his face stays
   * the right way up throughout, which on a sphere is the difference between
   * "attacking" and "in hitstun".
   *
   * So the turn is `starSpin`: six half-turns of the near and far limbs
   * swapping ends on `hold` cuts, which is the only vertical-axis turn this
   * renderer can actually express. See the note on `swapSides`.
   */
  nair: {
    loop: false,
    strike: 0.15,
    keys: [
      {
        t: 0,
        pose: P({ thighR: 168, shinR: 30, footR: -84, thighL: 202, shinL: -12, footL: -86, ...ARMS_REST }),
        ease: "in",
      },
      ...starSpin(0.15, 0.603, 6),
      {
        t: 0.78,
        pose: P({ thighR: 150, shinR: 16, footR: -70, thighL: 214, shinL: -8, footL: -84 }),
        scaleX: 1.0,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Forward air — three consecutive kicks moving forward, and the frame data
   * says so: hitboxes on 10–11, 17–18 and 25–27. Three extensions, two
   * retractions, or it is one kick with a long tail.
   *
   * total 47, firstActive 9, strike 0.26:
   *   t(f) = 0.26 + 0.74·(f − 9)/38
   *   kick 2, frame 17 → actionFrame 16 → t = 0.396
   *   kick 3, frame 25 → actionFrame 24 → t = 0.552
   * with the retractions placed between them.
   */
  fair: {
    loop: false,
    strike: 0.26,
    keys: [
      {
        t: 0,
        pose: P({ thighR: 178, shinR: 26, footR: -84, thighL: 208, shinL: -10, footL: -86, ...ARMS_REST }),
        rotation: -0.14,
        ease: "in",
      },
      // Kick one, high. Held to actionFrame 10 → 0.26 + 0.74·1/38 = 0.280.
      ...holdThrough(0.28, {
        t: 0.26,
        pose: P({
          thighR: 84,
          shinR: -6,
          footR: -8,
          thighL: 206,
          shinL: -8,
          footL: -86,
          upperArmR: 96,
          forearmR: -6,
          upperArmL: 258,
          forearmL: -8,
        }),
        rotation: 0.18,
        offsetX: 0.4,
        scaleX: 1.07,
        ease: "out",
      }),
      { t: 0.33, pose: P({ thighR: 146, shinR: 22, footR: -62 }), rotation: 0.04, offsetX: 0.2, ease: "in" },
      // Kick two, held to actionFrame 17 → 0.416.
      ...holdThrough(0.416, {
        t: 0.396,
        pose: P({ thighR: 92, shinR: -4, footR: -10, upperArmR: 92, upperArmL: 262 }),
        rotation: 0.2,
        offsetX: 0.55,
        scaleX: 1.07,
        ease: "out",
      }),
      { t: 0.48, pose: P({ thighR: 150, shinR: 24, footR: -64 }), rotation: 0.04, offsetX: 0.34, ease: "in" },
      // Kick three, the one that launches — three active frames, 25–27, so it
      // is the one that most needs holding: actionFrame 26 → 0.591.
      ...holdThrough(0.591, {
        t: 0.552,
        pose: P({ thighR: 100, shinR: -4, footR: -14, upperArmR: 88, upperArmL: 266 }),
        rotation: 0.24,
        offsetX: 0.72,
        scaleX: 1.1,
        ease: "out",
      }),
      {
        t: 0.7,
        pose: P({ thighR: 152, shinR: 20, footR: -70, thighL: 206, shinL: -6, footL: -88 }),
        rotation: 0.08,
        offsetX: 0.4,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Back air — a dropkick. Both boots fire backwards together and the body
   * tips forward to counterweight them. total 40, firstActive 5.
   */
  bair: {
    loop: false,
    strike: 0.2,
    keys: [
      {
        t: 0,
        pose: P({ thighR: 158, shinR: 34, footR: -84, thighL: 190, shinL: 24, footL: -86, ...ARMS_REST }),
        rotation: -0.16,
        offsetX: 0.25,
        ease: "in",
      },
      // hitboxes 6–8 and 9–12 → firstActive 5, lastActive 11, total 40:
      //   0.2 + 0.8·(11−5)/(40−5) = 0.337. The late hit is a *different* hitbox
      //   on the same shape, so the shape has to survive to frame 12.
      ...holdThrough(0.337, {
        t: 0.2,
        pose: P({
          thighR: 262,
          shinR: 4,
          footR: 4,
          thighL: 270,
          shinL: 2,
          footL: 4,
          upperArmR: 88,
          forearmR: -8,
          upperArmL: 96,
          forearmL: -8,
        }),
        rotation: 0.5,
        offsetX: -0.9,
        scaleX: 1.1,
        ease: "out",
      }),
      {
        t: 0.42,
        pose: P({
          thighR: 250,
          shinR: 6,
          footR: 6,
          thighL: 258,
          shinL: 4,
          footL: 6,
          upperArmR: 96,
          upperArmL: 104,
        }),
        rotation: 0.4,
        offsetX: -0.55,
        scaleX: 1.04,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Up air — the bicycle kick again, in midair. Same shape as the up smash and
   * that is correct: SmashWiki calls it "a bicycle kick similar to his up
   * smash". total 35, firstActive 7.
   */
  uair: {
    loop: false,
    strike: 0.24,
    keys: [
      {
        t: 0,
        pose: P({ thighR: 186, shinR: 22, footR: -84, thighL: 212, shinL: 8, footL: -86, ...ARMS_REST }),
        rotation: 0.14,
        ease: "in",
      },
      // hitbox 8–13 → firstActive 7, lastActive 12, total 35:
      //   0.24 + 0.76·(12−7)/(35−7) = 0.376
      ...holdThrough(0.376, {
        t: 0.24,
        pose: P({
          thighR: 350,
          shinR: 8,
          footR: -18,
          thighL: 220,
          shinL: -16,
          footL: -78,
          upperArmR: 26,
          forearmR: -8,
          upperArmL: 330,
          forearmL: 8,
        }),
        rotation: -0.42,
        offsetY: 0.4,
        scaleY: 1.1,
        ease: "out",
      }),
      {
        t: 0.44,
        pose: P({ thighR: 52, shinR: 14, footR: -44, thighL: 210, shinL: -8, footL: -84 }),
        rotation: -0.12,
        offsetY: 0.14,
        scaleY: 1.03,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Down air — "a diagonal corkscrew dropkick", five hits on odd frames from
   * 18 to 31 and a meteor finisher on 34.
   *
   * **Not `spin`, for the second time, and for the opposite reason to the down
   * smash.** `spin` turns the whole rig in the plane of the screen, so two
   * turns sweeps the boots through every clock position and Kirby reads as
   * *tumbling* — which the contact sheet showed plainly. The corkscrew in the
   * real move is about his own vertical axis, and the one thing that must stay
   * true of a drill is that the drill bit points **down**, because the last hit
   * is a meteor.
   *
   * So the boots are pinned downward and the turn is faked by flicking the body
   * back and forth on `hold`, which cuts rather than eases: a hard alternation
   * every four frames reads as something spinning too fast to follow, and it is
   * the same trick a held drawing plays in hand animation. The corkscrew proper
   * is drawn by `fx.ts`.
   *
   * total 54, firstActive 17. t(f) = 0.3 + 0.7·(f − 17)/37, so the five hits at
   * actionFrames 17, 21, 25, 29 and the finisher at 33 land on
   * t = 0.300, 0.376, 0.451, 0.527, 0.603.
   */
  dair: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({ thighR: 168, shinR: 28, footR: -84, thighL: 206, shinL: -8, footL: -86, ...ARMS_REST }),
        ease: "in",
      },
      ...drill(0.3, 0.603, 4),
      {
        // The finisher: the meteor hit, boots together and driven down.
        t: 0.603,
        pose: P({
          thighR: 178,
          shinR: 2,
          footR: -4,
          thighL: 182,
          shinL: -2,
          footL: -4,
          upperArmR: 158,
          forearmR: -10,
          upperArmL: 202,
          forearmL: 10,
        }),
        rotation: 0,
        offsetY: -0.75,
        scaleX: 0.94,
        scaleY: 1.06,
        ease: "out",
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /* ------------------------------------------------------------- specials -- */

  /**
   * Inhale. Not a strike — a 35-frame suction window, so the shape is opened
   * and *held* rather than travelled through, and the mouth itself is painted
   * by `fx.ts` because the rig has no mouth.
   *
   * total 67, firstActive 9, strike 0.2:
   *   suction ends frame 44 → actionFrame 43 → t = 0.2 + 0.8·34/58 = 0.669.
   * He plants, leans back away from the pull, and swells as he draws air in.
   */
  neutralB: {
    loop: false,
    strike: 0.2,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, upperArmR: 140, upperArmL: 220 }),
        ease: "in",
      },
      {
        // Braced: far foot back, near foot forward, body tipped back off the
        // suction, and visibly bigger — he is full of air.
        t: 0.2,
        pose: P({
          thighR: 138,
          shinR: 10,
          footR: -84,
          thighL: 220,
          shinL: -12,
          footL: -82,
          upperArmR: 88,
          forearmR: -14,
          upperArmL: 272,
          forearmL: 14,
        }),
        rotation: -0.2,
        offsetX: -0.3,
        scaleX: 1.12,
        ease: "out",
      },
      {
        // Held wide open for the whole suction window, pulsing very slightly.
        t: 0.44,
        pose: P({
          thighR: 136,
          shinR: 10,
          footR: -84,
          thighL: 222,
          shinL: -12,
          footL: -82,
          upperArmR: 84,
          upperArmL: 276,
        }),
        rotation: -0.22,
        offsetX: -0.34,
        scaleX: 1.16,
      },
      {
        t: 0.669,
        pose: P({
          thighR: 142,
          shinR: 8,
          footR: -86,
          thighL: 216,
          shinL: -10,
          footL: -84,
          upperArmR: 96,
          upperArmL: 264,
        }),
        rotation: -0.14,
        offsetX: -0.2,
        scaleX: 1.1,
        ease: "out",
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Hammer Flip — a two-handed overhead swing. The mallet is painted by
   * `fx.ts`; what the body does is wind back onto the rear foot with both arms
   * cocked behind the head, then throw the whole of himself through the swing.
   * total 54, firstActive 25 — a long, heavy wind-up, which is the point.
   */
  sideB: {
    loop: false,
    strike: 0.34,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, upperArmR: 150, upperArmL: 210 }),
        ease: "in",
      },
      {
        // Cocked: weight on the back foot, both arms up and behind.
        t: 0.2,
        pose: P({
          thighR: 168,
          shinR: 18,
          footR: -86,
          thighL: 222,
          shinL: -6,
          footL: -82,
          upperArmR: 306,
          forearmR: 26,
          upperArmL: 314,
          forearmL: 22,
        }),
        rotation: -0.42,
        offsetX: -0.7,
        scaleY: 0.94,
        ease: "in",
      },
      // hitbox 26–27 → firstActive 25, lastActive 26, total 54:
      //   0.34 + 0.66·(26−25)/(54−25) = 0.363. Two frames, and both of them
      //   matter more here than anywhere else in the file: a hammer that has
      //   begun to lift on the second one weighs nothing.
      ...holdThrough(0.363, {
        // Through: arms swung down and out in front, body thrown after them.
        t: 0.34,
        pose: P({
          thighR: 128,
          shinR: 8,
          footR: -84,
          thighL: 218,
          shinL: -8,
          footL: -82,
          upperArmR: 104,
          forearmR: 18,
          upperArmL: 112,
          forearmL: 14,
        }),
        rotation: 0.46,
        offsetX: 0.95,
        scaleX: 1.1,
        ease: "out",
      }),
      {
        // The recoil — the hammer is heavy and it takes him with it.
        t: 0.52,
        pose: P({
          thighR: 138,
          shinR: 12,
          footR: -86,
          thighL: 214,
          shinL: -6,
          footL: -84,
          upperArmR: 128,
          forearmR: 10,
          upperArmL: 134,
          forearmL: 8,
        }),
        rotation: 0.24,
        offsetX: 0.5,
        scaleY: 0.92,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Final Cutter — three beats: a rising slash, a fall, and a ground shockwave.
   *
   * total 60, firstActive 22 (hitbox starts frame 23), strike 0.3:
   *   t(f) = 0.3 + 0.7·(f − 22)/38
   *   descent, frame 41 → actionFrame 40 → t = 0.632
   *   landing, frame 50 → actionFrame 49 → t = 0.797
   *
   * **`offsetY` stays near zero on purpose.** The move carries a `momentum`
   * list — `+3.2` from frame 3 and `−3.4` from frame 24 — so the engine already
   * flies him up and drops him. A clip that also drove `offsetY` would double
   * the travel in a match while looking right in a contact sheet, which draws
   * no momentum. The rise is sold with `scaleY` stretch and a tucked, vertical
   * body instead, and the fall with the boots pointing down.
   */
  upB: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, thighR: 164, shinR: 30, thighL: 210, shinL: 12 }),
        scaleY: 0.8,
        ease: "in",
      },
      // Three windows, three holds. Rise 23–26 → actionFrame 25 → 0.355;
      // descent 41–49 → actionFrame 48 → 0.779; landing 50–51 → 50 → 0.816.
      ...holdThrough(0.355, {
        // The rise: streamlined, legs together and pointed, arm up with the
        // blade, stretched tall and narrowed.
        t: 0.3,
        pose: P({
          thighR: 178,
          shinR: 2,
          footR: -8,
          thighL: 182,
          shinL: -2,
          footL: -6,
          upperArmR: 8,
          forearmR: -4,
          upperArmL: 350,
          forearmL: 4,
        }),
        offsetY: 0.5,
        scaleY: 1.18,
        scaleX: 0.9,
        ease: "out",
      }),
      ...holdThrough(0.779, {
        // The descent: still vertical, boots down, blade held under him. The
        // meteor hitbox is live for nine frames of this, which is most of the
        // fall — so the fall *is* the shape, not a transition through it.
        t: 0.632,
        pose: P({
          thighR: 176,
          shinR: 2,
          footR: -10,
          thighL: 184,
          shinL: -2,
          footL: -8,
          upperArmR: 152,
          forearmR: -16,
          upperArmL: 208,
          forearmL: 16,
        }),
        offsetY: 0.2,
        scaleY: 1.06,
        scaleX: 0.94,
        ease: "in",
      }),
      ...holdThrough(0.816, {
        // The landing: the blade hits the floor and he squashes onto it.
        t: 0.797,
        pose: P({
          thighR: 132,
          shinR: 30,
          footR: -78,
          thighL: 224,
          shinL: -18,
          footL: -78,
          upperArmR: 118,
          forearmR: 16,
          upperArmL: 244,
          forearmL: -16,
        }),
        offsetY: -0.05,
        scaleY: 0.7,
        scaleX: 1.14,
        ease: "out",
      }),
      {
        t: 0.88,
        pose: P({ ...STANCE, thighR: 148, shinR: 16, thighL: 214, shinL: 4 }),
        scaleY: 0.88,
        scaleX: 1.04,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Stone. `fx.ts` replaces the figure with the rock for the armour window
   * (frames 10–48), so this clip only has to sell the ten frames before the
   * transformation and the eleven after it: a compression down into the change,
   * and a shake-it-off on the way out.
   * total 60, firstActive 28 — but the figure is hidden across that, so the
   * `strike` key is only ever seen if the armour window ever moves.
   */
  downB: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, ...ARMS_REST }),
        ease: "in",
      },
      {
        // Frames 1–9: he pulls in tight and hardens before the rock appears.
        t: 0.12,
        pose: P({
          thighR: 168,
          shinR: 30,
          footR: -80,
          thighL: 202,
          shinL: -14,
          footL: -80,
          upperArmR: 140,
          forearmR: -20,
          upperArmL: 220,
          forearmL: 20,
        }),
        scaleY: 0.74,
        scaleX: 1.08,
        ease: "hold",
      },
      { t: 0.3, pose: P({ ...STANCE }), scaleY: 0.72, scaleX: 1.1, ease: "hold" },
      {
        // Frames 49+: back to flesh, landing squash, shaking the dust off.
        t: 0.83,
        pose: P({
          thighR: 140,
          shinR: 34,
          footR: -76,
          thighL: 220,
          shinL: -20,
          footL: -76,
          upperArmR: 108,
          forearmR: 18,
          upperArmL: 252,
          forearmL: -18,
        }),
        scaleY: 0.68,
        scaleX: 1.16,
        ease: "out",
      },
      { t: 0.93, pose: P({ ...STANCE, ...ARMS_REST }), scaleY: 0.95, scaleX: 1.03 },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /* --------------------------------------------------- grab and the throws -- */

  /** Reaches out with one hand — and on this rig the hand finally shows. */
  grab: {
    loop: false,
    strike: 0.22,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, upperArmR: 150, forearmR: 20, upperArmL: 238, forearmL: -12 }),
        ease: "in",
      },
      // hitbox 6–7 → firstActive 5, lastActive 6, total 34: 0.22 + 0.78/29 = 0.247
      ...holdThrough(0.247, {
        t: 0.22,
        pose: P({
          ...STANCE,
          thighR: 146,
          upperArmR: 88,
          forearmR: -6,
          handR: 0,
          upperArmL: 250,
          forearmL: -16,
        }),
        offsetX: 0.5,
        scaleX: 1.04,
        ease: "out",
      }),
      {
        t: 0.4,
        pose: P({ ...STANCE, upperArmR: 98, forearmR: 2, upperArmL: 246, forearmL: -12 }),
        offsetX: 0.26,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Forward throw — he hops forward and hurls them ahead of him.
   * total 58, firstActive 44, so the wind-up owns three quarters of the clip.
   */
  fthrow: {
    loop: false,
    strike: 0.55,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, upperArmR: 108, forearmR: -30, upperArmL: 252, forearmL: 30 }),
        ease: "in",
      },
      {
        t: 0.34,
        pose: P({ ...STANCE, thighR: 168, shinR: 22, upperArmR: 138, upperArmL: 222 }),
        rotation: -0.24,
        offsetX: -0.4,
        scaleY: 0.86,
        ease: "in",
      },
      {
        t: 0.55,
        pose: P({
          thighR: 130,
          shinR: 10,
          footR: -84,
          thighL: 224,
          shinL: -10,
          footL: -82,
          upperArmR: 74,
          forearmR: -8,
          upperArmL: 286,
          forearmL: 8,
        }),
        rotation: 0.42,
        offsetX: 0.9,
        offsetY: 0.35,
        scaleX: 1.08,
        ease: "out",
      },
      {
        t: 0.72,
        pose: P({ ...STANCE, thighR: 146, upperArmR: 96, upperArmL: 264 }),
        rotation: 0.14,
        offsetX: 0.45,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Back throw — a backward dive. He takes them over and behind him, which on
   * a sphere is a half-turn backwards; `rotation` can express half a turn, and
   * it stays a rotation rather than a `spin` because he does not come round.
   * total 49, firstActive 40.
   */
  bthrow: {
    loop: false,
    strike: 0.6,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, upperArmR: 100, forearmR: -26, upperArmL: 260, forearmL: 26 }),
        ease: "in",
      },
      {
        t: 0.36,
        pose: P({ ...STANCE, thighR: 142, shinR: 14, upperArmR: 82, upperArmL: 278 }),
        rotation: 0.3,
        offsetX: 0.35,
        ease: "in",
      },
      {
        // Over the back, feet up.
        t: 0.6,
        pose: P({
          thighR: 236,
          shinR: -18,
          footR: -8,
          thighL: 250,
          shinL: -20,
          footL: -8,
          upperArmR: 252,
          forearmR: 24,
          upperArmL: 262,
          forearmL: 18,
        }),
        rotation: -1.15,
        offsetX: -0.85,
        offsetY: 0.45,
        scaleX: 1.06,
        ease: "out",
      },
      {
        t: 0.78,
        pose: P({ thighR: 190, shinR: 12, footR: -96, thighL: 216, shinL: -6, footL: -90 }),
        rotation: -0.4,
        offsetX: -0.45,
        offsetY: 0.1,
      },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Up throw — he carries them into the sky and comes back down with them; the
   * def gives it eighty-six frames and a landing hitbox for exactly that
   * reason. total 86, firstActive 57.
   */
  uthrow: {
    loop: false,
    strike: 0.62,
    keys: [
      {
        t: 0,
        pose: P({ ...STANCE, upperArmR: 60, forearmR: -20, upperArmL: 300, forearmL: 20 }),
        ease: "in",
      },
      {
        // The crouch before the leap.
        t: 0.22,
        pose: P({ ...STANCE, thighR: 160, shinR: 28, thighL: 212, shinL: 10 }),
        scaleY: 0.76,
        ease: "in",
      },
      {
        // Up, legs trailing, both arms overhead holding them.
        t: 0.46,
        pose: P({
          thighR: 190,
          shinR: 14,
          footR: -92,
          thighL: 200,
          shinL: -8,
          footL: -88,
          upperArmR: 10,
          forearmR: -4,
          upperArmL: 350,
          forearmL: 4,
        }),
        offsetY: 1.5,
        scaleY: 1.14,
        scaleX: 0.92,
      },
      {
        // The release, at the top.
        t: 0.62,
        pose: P({
          thighR: 176,
          shinR: 8,
          footR: -86,
          thighL: 202,
          shinL: -6,
          footL: -88,
          upperArmR: 348,
          forearmR: 8,
          upperArmL: 12,
          forearmL: -8,
        }),
        offsetY: 1.9,
        scaleY: 1.1,
        scaleX: 0.94,
        ease: "out",
      },
      {
        // Down again, and the landing squash the def's second hitbox belongs to.
        t: 0.82,
        pose: P({ thighR: 136, shinR: 32, footR: -78, thighL: 222, shinL: -18, footL: -78 }),
        offsetY: 0,
        scaleY: 0.7,
        scaleX: 1.14,
        ease: "out",
      },
      { t: 0.93, pose: P({ ...STANCE, ...ARMS_REST }), scaleY: 0.96 },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },

  /**
   * Down throw — ten stomps at a literal 270 degrees, then a release. The def
   * runs the stomping hitbox from frame 9 to 42 and the launcher on 58, so the
   * clip is a bounce cycle across that window rather than one shape.
   *
   * total 87, firstActive 8, strike 0.12:
   *   t(f) = 0.12 + 0.88·(f − 8)/79
   *   end of the stomps, actionFrame 41 → t = 0.487
   *   the launcher,      actionFrame 57 → t = 0.666
   * Five bounces across 0.12–0.487 is one every seven frames, which is the
   * cadence that reads as stomping rather than as vibrating.
   */
  dthrow: {
    loop: false,
    strike: 0.12,
    keys: [
      { t: 0, pose: P({ ...STANCE, upperArmR: 120, forearmR: -30, upperArmL: 240, forearmL: 30 }), ease: "in" },
      ...stomps(0.12, 0.487, 5),
      {
        // The launcher: he hauls them up and out.
        t: 0.666,
        pose: P({
          thighR: 150,
          shinR: 12,
          footR: -86,
          thighL: 212,
          shinL: -8,
          footL: -86,
          upperArmR: 40,
          forearmR: -10,
          upperArmL: 320,
          forearmL: 10,
        }),
        offsetY: 0.5,
        scaleY: 1.1,
        ease: "out",
      },
      { t: 0.8, pose: P({ ...STANCE, upperArmR: 86, upperArmL: 274 }), offsetY: 0.1 },
      { t: 1, pose: P({ ...STANCE, ...ARMS_REST }) },
    ],
  },
};

/**
 * A turn about Kirby's **vertical** axis, faked by swapping which side's limbs
 * are in front.
 *
 * Neither of the two usual dodges works on this rig. `spin` turns him in the
 * plane of the screen, which is a cartwheel — his face ends up underneath him.
 * And the flat-animation trick of squashing `scaleX` through a narrow waist and
 * back does not survive contact with a sphere: `drawFigure` takes the head
 * circle's radius from `scale * scaleX`, so a `scaleX` of 0.3 does not turn
 * Kirby edge-on, it makes him a third of the size — he reads as receding, not
 * as turning.
 *
 * What is left is the thing the renderer does give: `FAR_BONES` are drawn
 * behind the ball and shaded down, `NEAR_BONES` in front and not. Swap the two
 * sides' angles and the *bright* boot jumps from the front of the outline to
 * the back of it while a shaded one takes its place. Cut, do not ease — an
 * eased alternation is a wobble, a cut alternation is something turning too
 * fast to follow, and it is exactly what a held drawing does by hand.
 *
 * `front`/`back` are one side's angles; the other side gets the other set.
 */
interface Half {
  readonly thigh: number;
  readonly shin: number;
  readonly foot: number;
  readonly upper: number;
  readonly fore: number;
}

function swapSides(front: Half, back: Half, near: boolean): Record<string, number> {
  const R = near ? front : back;
  const L = near ? back : front;
  return {
    thighR: R.thigh, shinR: R.shin, footR: R.foot, upperArmR: R.upper, forearmR: R.fore,
    thighL: L.thigh, shinL: L.shin, footL: L.foot, upperArmL: L.upper, forearmL: L.fore,
  };
}

/**
 * The corkscrew: `n` half-turns between two clip times, boots pinned down.
 *
 * The one thing that must stay true of a drill is that the bit points **down**,
 * because the last hit is a meteor — so the legs never leave the vertical and
 * the turn is carried entirely by the limb swap and a shallow rock of the body.
 * The old version rocked ±24°, which on a rig whose legs are its only visible
 * limb tipped the boots off vertical and read as tumbling rather than drilling.
 */
function drill(from: number, to: number, n: number): Keyframe[] {
  // Toes **down**, not forward: this is the bit of the drill and the last hit
  // is a meteor. The two halves are exact mirrors about the vertical — 178°/182°
  // of shin and 156°/204° of accumulated ankle — so the swap turns him without
  // changing how far down he reaches, which is the one thing the meteor's
  // hitbox is measured on.
  const front: Half = { thigh: 170, shin: 8, foot: -22, upper: 130, fore: -14 };
  const back: Half = { thigh: 190, shin: -8, foot: 22, upper: 230, fore: 14 };
  const keys: Keyframe[] = [];
  const step = (to - from) / n;
  for (let i = 0; i < n; i++) {
    const near = i % 2 === 0;
    keys.push({
      t: from + i * step,
      pose: P(swapSides(front, back, near)),
      // **Diagonal**, which is in the move's own name — SmashWiki calls it "a
      // diagonal corkscrew dropkick", and the hitbox visualisation has the body
      // and the drilling capsule leaning 20–30° off vertical the whole way
      // down. Round one alternated ±8° about plumb, which is a drill standing
      // straight up. The lean is a constant forward bias with the alternation
      // riding on top of it, so the axis stays put while the body turns about
      // it — a drill that changed its own angle every four frames would read as
      // wobbling rather than boring.
      rotation: 0.34 + (near ? 0.1 : -0.1),
      offsetY: -0.4 - i * 0.06,
      scaleX: 0.9,
      scaleY: 1.05,
      ease: "hold",
    });
  }
  return keys;
}

/**
 * The same turn, arms and legs thrown out into a star: the neutral air.
 *
 * `n` half-turns from `from` to `to` inclusive. Each one is two drawings, not
 * one, and the second is the reason it reads at all: a figure turning about its
 * vertical axis is *wide* when you see it face-on and **narrow** when you catch
 * it edge-on, and alternating the two is how flat animation has drawn a spin
 * since before it had a name. The narrow drawing gets a quarter of the beat —
 * about one frame in four — so it flickers rather than poses, and the wide
 * drawings either side of it are mirror images, which is the half-turn.
 *
 * The width has to come from the limbs. On this rig it cannot come from
 * `scaleX`: that scales the ball's radius too, so squashing him narrow just
 * makes him smaller.
 */
function starSpin(from: number, to: number, n: number): Keyframe[] {
  const front: Half = { thigh: 112, shin: -6, foot: -22, upper: 70, fore: -10 };
  const back: Half = { thigh: 248, shin: 6, foot: 10, upper: 290, fore: 10 };
  // Edge-on: everything pulled in under him and the ball at its roundest.
  const edge = P({
    thighR: 170, shinR: 8, footR: -86, thighL: 190, shinL: -8, footL: -92,
    upperArmR: 150, forearmR: -12, upperArmL: 210, forearmL: 12,
  });
  const keys: Keyframe[] = [];
  const step = (to - from) / n;
  for (let i = 0; i <= n; i++) {
    const near = i % 2 === 0;
    keys.push({
      t: from + i * step,
      pose: P(swapSides(front, back, near)),
      rotation: near ? 0.1 : -0.1,
      scaleX: 1.06,
      ease: i === n ? "out" : "hold",
    });
    if (i < n) {
      keys.push({ t: from + (i + 0.74) * step, pose: edge, scaleX: 0.98, ease: "hold" });
    }
  }
  return keys;
}

/**
 * A run of stomps between two clip times: up, then down hard, `n` times.
 *
 * Written as a generator rather than twenty hand-typed keys because the only
 * thing that varies is `t`, and a hand-typed run is where a transposed digit
 * hides. `hold` on the rising key is what makes each stomp *land* — eased, the
 * bounce becomes a sine wave and Kirby looks like he is hovering.
 */
function stomps(from: number, to: number, n: number): PoseClip["keys"][number][] {
  const keys: PoseClip["keys"][number][] = [];
  const step = (to - from) / n;
  for (let i = 0; i < n; i++) {
    const t = from + i * step;
    keys.push({
      t,
      pose: P({
        thighR: 168,
        shinR: 24,
        footR: -84,
        thighL: 200,
        shinL: -14,
        footL: -84,
        upperArmR: 150,
        forearmR: -18,
        upperArmL: 210,
        forearmL: 18,
      }),
      offsetY: 0.85,
      scaleY: 1.06,
      ease: "in",
    });
    keys.push({
      t: t + step * 0.45,
      pose: P({
        thighR: 178,
        shinR: 2,
        footR: -6,
        thighL: 184,
        shinL: -2,
        footL: -4,
        upperArmR: 132,
        forearmR: -10,
        upperArmL: 228,
        forearmL: 10,
      }),
      offsetY: -0.1,
      scaleY: 0.82,
      scaleX: 1.06,
      ease: "hold",
    });
  }
  return keys;
}
