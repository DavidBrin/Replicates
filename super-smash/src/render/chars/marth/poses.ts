/**
 * Marth: the clips that are Marth’s rather than everybody’s.
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
 */

import { P, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";

export const poses: Partial<Record<PoseName, PoseClip>> = {
  /**
   * Forward Smash — the overhead chop, and the move he is famous for.
   *
   * 18% on the tip against 13% on the body, base knockback 80 against 48: the
   * only move where both halves of the knockback formula jump, and the reason
   * a Marth player spends the match measuring distance. So this clip has
   * exactly one job at its contact key — **put the point of Falchion at world
   * (11, 7.5)** — and everything else serves that.
   *
   * ## The arithmetic that decides the strike pose
   *
   * Angles accumulate down the chain, so the blade's direction is
   * `hip + torso + upperArmR + forearmR + handR`, measuring 0 as straight up
   * and clockwise as forward. Call it A. The shoulder sits 9.6 rig units up,
   * the arm chain is 4.73 and the blade 5.3, so a straight arm puts the point
   * 10.03 rig units from the shoulder along A, and the hitbox at world
   * (11, 7.5) is rig (9.5, 6.5).
   *
   *   9.6 + 10.03·cos A = 6.5  ⇒  A = 108°
   *   10.03·sin A = 9.54 rig = 11.1 world  ✓
   *
   * With the torso pitched to 22 over a hip at −4, that leaves `upperArmR: 90`
   * and a **straight elbow and wrist**. The elbow is the whole move: bend it
   * ten degrees at the contact key and the point falls a world unit short,
   * which is the difference between 18% and 13%.
   *
   * ## Where the keys land
   *
   * `first = 9` (frames 10-13) and `total = 51`, `strike = 0.3`.
   *
   *   t 0     → f 0    the raise, and — see below — the charge stance
   *   t 0.3   → f 9    contact, arm straight, point on the tipper hitbox
   *   t 0.42  → f 16   the blade carries on down and across; the body unwinds
   *   t 0.62  → f 28   weight comes back over the feet, blade lowering
   *   t 1     → f 50 is at t 0.98, so the terminator is very nearly reached
   *
   * A chargeable smash freezes at `strike * 0.55 = 0.165`, and the span out of
   * key 0 is `ease: "in"` — cubic — so the charge pose is `(0.55)³ = 17%` of the
   * way from the raise to the contact. The wind-up key *is* the charge stance,
   * which is why it is authored as a finished drawing rather than as a
   * halfway shape: blade cocked high and behind at A = 312°, weight on the back
   * foot, cape thrown open by the −26° torso.
   *
   * ## The arc
   *
   * A runs 312° → 108° → 143° → 128°. The first span is the swing: 156° of
   * travel, taken the short way, which is over the top and forwards — a wide,
   * unhurried, one-way overhead chop rather than a jab's snap. It is roughly
   * four times the angular distance the shared clip covers.
   */
  fsmash: {
    loop: false,
    strike: 0.3,
    keys: [
      // The raise. Held for nine frames uncharged and up to sixty charged, so
      // it is drawn as a pose and not as a transit: Falchion vertical and
      // tipped back past his own head, chest opened to the front, weight
      // settled on the back leg with the front foot light.
      {
        t: 0,
        pose: P({
          hip: 8, torso: -26, head: 20,
          thighR: 166, shinR: 32, footR: -86,
          thighL: 208, shinL: 28, footL: -76,
          upperArmR: 340, forearmR: -10, handR: 0,
          upperArmL: 150, forearmL: -34,
        }),
        offsetX: -0.45,
        offsetY: -0.3,
        ease: "in",
      },
      // Contact. Elbow and wrist straight — A = 108°, the point at rig
      // (9.5, 6.5) = world (11.1, 7.5), on the tipper. The back leg is driven
      // out behind and the free arm thrown back, so the whole body is one line
      // from the trailing heel to the blade's point.
      {
        t: 0.3,
        pose: P({
          hip: -4, torso: 22, head: -14,
          thighR: 134, shinR: 26, footR: -90,
          thighL: 224, shinL: 30, footL: -72,
          upperArmR: 90, forearmR: 0, handR: 0,
          upperArmL: 228, forearmL: -58,
        }),
        offsetX: 0.5,
        offsetY: -0.5,
        scaleX: 1.05,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 10-13, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.35,
        pose: P({
          hip: -4, torso: 22, head: -14,
          thighR: 134, shinR: 26, footR: -90,
          thighL: 224, shinL: 30, footL: -72,
          upperArmR: 90, forearmR: 0, handR: 0,
          upperArmL: 228, forearmL: -58,
        }),
        offsetX: 0.5,
        offsetY: -0.5,
        scaleX: 1.05,
      },
      // The blade does not stop where the hitbox does. It carries on down and
      // across to A = 143° while the torso is already coming back up, which is
      // what a heavy sword does and what tells the opponent the swing is spent.
      {
        t: 0.42,
        pose: P({
          hip: -2, torso: 14, head: -6,
          thighR: 138, shinR: 28, footR: -88,
          thighL: 218, shinL: 30, footL: -74,
          upperArmR: 118, forearmR: 12, handR: 2,
          upperArmL: 214, forearmL: -46,
        }),
        offsetX: 0.5,
        offsetY: -0.45,
        scaleX: 1.04,
      },
      // Weight back over the feet, blade recovering across the body. Without
      // this the thirty-five recovery frames are one long ease and read as a
      // freeze at under a degree a frame.
      {
        t: 0.62,
        pose: P({
          hip: 0, torso: 8, head: -2,
          thighR: 148, shinR: 22, footR: -88,
          thighL: 206, shinL: 24, footL: -80,
          upperArmR: 122, forearmR: -6, handR: 0,
          upperArmL: 200, forearmL: -36,
        }),
        offsetX: 0.24,
        offsetY: -0.2,
      },
      {
        t: 1,
        pose: P({
          torso: 4,
          upperArmR: 138, forearmR: -22,
          upperArmL: 192, forearmL: -26,
        }),
      },
    ],
  },

  /**
   * Up Smash — the scoop, and the arc over the top.
   *
   * The hitbox table is the whole description of this move. The tip does 17% at
   * world (1.5, **17**) and the body 13% at (1, 12), both directly overhead —
   * and there is a third, set-knockback box at (2, **2**), live for two frames
   * only, that hits *grounded* opponents and launches them at 125°. That is a
   * scoop at ankle height feeding a blade above his own head, so the swing has
   * to start on the floor in front of him and finish vertical. A pose that
   * merely raises the sword — which is what the shared clip does, and what his
   * up special does — leaves the scoop unexplained.
   *
   * Blade direction is `hip + torso + upperArmR + forearmR + handR`, 0 straight
   * up, clockwise forward; call it A.
   *
   *   wind-up  A = 140°  point at rig (6.4, 1.9) = world (7.5, 2.2) — the scoop
   *   contact  A =   5°  point 19.6 rig = 22.7 world up, blade dead vertical
   *
   * The tip hitbox at y = 17 therefore sits about two-thirds of the way along a
   * fully raised blade rather than at its point. That is not a mistake to be
   * fixed by shortening the arm: the alternative is a bent elbow at the contact
   * frame, and a bent elbow on a vertical swing reads as a shrug.
   *
   * ## Where the keys land
   *
   * `first = 12` (frames 13-17) and `total = 58`, `strike = 0.3`.
   *
   *   t 0     → f 0    the crouch and the low blade — also the charge stance
   *   t 0.3   → f 12   contact: risen onto the toes, blade vertical
   *   t 0.42  → f 20   the blade carries past vertical and tips behind
   *   t 0.62  → f 33   heels down, blade coming back across
   *   t 1     → f 57 is at t 0.987
   *
   * The charge freeze is at `0.3 × 0.55 = 0.165`, and with `ease: "in"` out of
   * key 0 that is 17% of the way to contact — so the crouch is what a charging
   * Marth is drawn as, and it is authored as a finished pose: knees folded,
   * blade laid low and forward like a man about to shovel.
   *
   * ## The arc, and why it is not the up special
   *
   * A runs 140° → 5° → 340° → 310°: 135° of one-way travel into the hit and
   * another 55° out of it, the blade passing up through the *front*. `upB` is
   * the opposite shape — four frames of wind-up, no arc at all, a straight
   * vertical thrust out of a crouch with the body arched behind it. This one
   * keeps both feet under him and swings; that one leaves the ground.
   */
  usmash: {
    loop: false,
    strike: 0.3,
    keys: [
      // The crouch. Held for twelve frames uncharged and up to sixty charged,
      // so it is drawn as a pose: weight down, both knees folded, Falchion laid
      // low across the front with the point almost on the stage.
      {
        t: 0,
        pose: P({
          hip: 6, torso: 16, head: -14,
          thighR: 138, shinR: 72, footR: -84,
          thighL: 146, shinL: 68, footL: -82,
          upperArmR: 98, forearmR: 20, handR: 0,
          upperArmL: 132, forearmL: -30,
        }),
        offsetY: -1.3,
        scaleY: 0.94,
        ease: "in",
      },
      // Contact. Legs snapped straight and up onto the toes, spine long, blade
      // dead vertical and a shade forward of the centreline, matching the
      // hitboxes' x = 1.0-1.5. The free arm is thrown down and back as the
      // counterweight, which is also what keeps the cape off the blade.
      {
        t: 0.3,
        pose: P({
          hip: -2, torso: -6, head: 8,
          thighR: 172, shinR: 8, footR: -62,
          thighL: 190, shinL: 6, footL: -60,
          upperArmR: 9, forearmR: 4, handR: 0,
          upperArmL: 300, forearmL: 20,
        }),
        offsetY: 0.3,
        scaleY: 1.1,
        scaleX: 0.94,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 13-17, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.361,
        pose: P({
          hip: -2, torso: -6, head: 8,
          thighR: 172, shinR: 8, footR: -62,
          thighL: 190, shinL: 6, footL: -60,
          upperArmR: 9, forearmR: 4, handR: 0,
          upperArmL: 300, forearmL: 20,
        }),
        offsetY: 0.3,
        scaleY: 1.1,
        scaleX: 0.94,
      },
      // Past vertical. The point keeps going over and tips behind him — the
      // overshoot that says the blade has weight and the swing was not stopped
      // by hand.
      {
        t: 0.42,
        pose: P({
          hip: 0, torso: 2, head: 4,
          thighR: 166, shinR: 14, footR: -74,
          thighL: 194, shinL: 12, footL: -72,
          upperArmR: 338, forearmR: 0, handR: 0,
          upperArmL: 312, forearmL: 14,
        }),
        offsetY: 0.12,
        scaleY: 1.04,
      },
      // Heels down, blade recovering across the body.
      {
        t: 0.62,
        pose: P({
          hip: 2, torso: 6, head: 0,
          thighR: 156, shinR: 24, footR: -84,
          thighL: 200, shinL: 20, footL: -82,
          upperArmR: 306, forearmR: -14, handR: 0,
          upperArmL: 268, forearmL: 6,
        }),
        offsetY: -0.2,
      },
      {
        t: 1,
        pose: P({
          torso: 6,
          upperArmR: 150, forearmR: -34,
          upperArmL: 208, forearmL: -20,
        }),
      },
    ],
  },

  /**
   * Jab — "slashes Falchion twice in front of himself" (SmashWiki). Marth has
   * no jab 3; Ultimate Frame Data lists two hits and there is no `Attack13`
   * script for him, which `fighters/marth.ts` says in its header.
   *
   * `SLOT_POSE` maps `jab1` and `jab2` to this one clip, so it has to be a
   * shape that works played twice in a row — which is what "slashes twice"
   * describes anyway. It is authored as an outward slash rather than a poke:
   * the blade starts high and comes down and out across the front.
   *
   * `first = 4` (frames 5-6), `total = 25`, `strike = 0.28`. Four wind-up frames.
   *
   *   t 0     → f 0    blade up
   *   t 0.28  → f 4    contact, arm straight
   *   t 0.42  → f 7    the blade carries down and across
   *   t 0.62  → f 12   recovering to the carry
   *
   * A runs 20° → 106° → 140° → 160°: 86° into the hit. At contact
   * `hip + torso = 12` and `upperArmR: 94` with a straight elbow, so A = 106°
   * and the point sits at 9.65 rig = 11.2 world out, 6.8 rig = 7.9 world up —
   * the jab's tipper is at (11, 8.0).
   *
   * That tipper is the strange one in his kit: it fires at **angle 180**,
   * straight backwards into Marth, dragging the victim in so jab 2 connects. The
   * pose cannot say that on its own — but a slash that finishes *across* the
   * body rather than away from it is at least not contradicting it.
   */
  jab: {
    loop: false,
    strike: 0.28,
    keys: [
      {
        t: 0,
        pose: P({
          hip: 2, torso: -8, head: 6,
          thighR: 158, shinR: 20, footR: -88,
          thighL: 200, shinL: 18, footL: -86,
          upperArmR: 26, forearmR: 0, handR: 0,
          upperArmL: 158, forearmL: -28,
        }),
        ease: "in",
      },
      {
        t: 0.28,
        pose: P({
          hip: -2, torso: 14, head: -10,
          thighR: 152, shinR: 22, footR: -88,
          thighL: 204, shinL: 20, footL: -84,
          upperArmR: 94, forearmR: 0, handR: 0,
          upperArmL: 202, forearmL: -46,
        }),
        offsetX: 0.4,
        scaleX: 1.08,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 5-6, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.314,
        pose: P({
          hip: -2, torso: 14, head: -10,
          thighR: 152, shinR: 22, footR: -88,
          thighL: 204, shinL: 20, footL: -84,
          upperArmR: 94, forearmR: 0, handR: 0,
          upperArmL: 202, forearmL: -46,
        }),
        offsetX: 0.4,
        scaleX: 1.08,
      },
      {
        t: 0.42,
        pose: P({
          hip: 0, torso: 6, head: -4,
          thighR: 154, shinR: 22, footR: -88,
          upperArmR: 134, forearmR: 0, handR: 0,
          upperArmL: 196, forearmL: -38,
        }),
        offsetX: 0.22,
      },
      {
        t: 0.62,
        pose: P({
          torso: 2,
          upperArmR: 158, forearmR: -8, handR: 0,
          upperArmL: 190, forearmL: -30,
        }),
      },
      { t: 1, pose: P({ upperArmR: 146, forearmR: -22, upperArmL: 192, forearmL: -26 }) },
    ],
  },

  /**
   * Forward Tilt — "a fast upward swipe while leaning forward. It has a large
   * arc" (SmashWiki). The two halves of that sentence are the two things the
   * shared clip gets wrong: it is a swipe travelling **upward**, so the blade
   * has to arrive from below, and the lean is forward, not back.
   *
   * `first = 7` (frames 8-11), `total = 33`, `strike = 0.3`.
   *
   *   t 0     → f 0    blade low and behind, weight back
   *   t 0.3   → f 7    contact, leaning forward, arm straight
   *   t 0.44  → f 11   still live, blade continuing up
   *   t 0.62  → f 17   recovering
   *
   * A runs 190° → 111° → 70° → 50°: 79° upward into the hit and 140° across the
   * clip, one way throughout. At contact `hip + torso = 16` and `upperArmR: 95`
   * with a straight elbow, so A = 111° and the point reaches 9.36 rig = 10.9
   * world out at 6.0 rig = 7.0 world up — the tipper at (11, 7.0).
   *
   * Dancing Blade's stage one is "an outward swing similar to his forward tilt",
   * so these two are deliberately the same family; what separates them is that
   * side-B ends gathered and loaded for a follow-up and this one opens out.
   */
  ftilt: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: 4, torso: -10, head: 8,
          thighR: 166, shinR: 22, footR: -88,
          thighL: 198, shinL: 20, footL: -86,
          upperArmR: 196, forearmR: 0, handR: 0,
          upperArmL: 154, forearmL: -26,
        }),
        offsetX: -0.25,
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          hip: -4, torso: 20, head: -14,
          thighR: 142, shinR: 24, footR: -90,
          thighL: 216, shinL: 24, footL: -76,
          upperArmR: 95, forearmR: 0, handR: 0,
          upperArmL: 214, forearmL: -50,
        }),
        offsetX: 0.55,
        scaleX: 1.1,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 8-11, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.381,
        pose: P({
          hip: -4, torso: 20, head: -14,
          thighR: 142, shinR: 24, footR: -90,
          thighL: 216, shinL: 24, footL: -76,
          upperArmR: 95, forearmR: 0, handR: 0,
          upperArmL: 214, forearmL: -50,
        }),
        offsetX: 0.55,
        scaleX: 1.1,
      },
      {
        t: 0.44,
        pose: P({
          hip: -2, torso: 12, head: -8,
          thighR: 146, shinR: 24, footR: -88,
          thighL: 210, shinL: 24, footL: -80,
          upperArmR: 60, forearmR: 0, handR: 0,
          upperArmL: 206, forearmL: -42,
        }),
        offsetX: 0.32,
        scaleX: 1.03,
      },
      {
        t: 0.62,
        pose: P({
          torso: 6,
          thighR: 152, shinR: 22, footR: -88,
          upperArmR: 44, forearmR: -6, handR: 0,
          upperArmL: 198, forearmL: -34,
        }),
        offsetX: 0.14,
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 118, forearmR: -24, upperArmL: 194, forearmL: -28 }) },
    ],
  },

  /**
   * Up Tilt — "swings Falchion in a large arc above his head, with a large
   * hitbox that can hit enemies behind him" (SmashWiki). The "behind him" is in
   * the data too: a third hitbox on frames 9-12 at (1, 13), after the main pair
   * has gone, which is the blade *finishing* the arc on his back side.
   *
   * `first = 5` (frames 6-8), `total = 33`, `strike = 0.3`. The third hitbox is
   * frames 9-12, i.e. actionFrames 8-11, which is
   *
   *   t = 0.3 + 0.7 × (8 − 5)/(33 − 5) = 0.375  …  t = 0.475
   *
   * so the `t: 0.44` key is inside that window and is authored with the blade
   * past vertical and tipping backwards, which is what that hitbox is.
   *
   *   t 0     → f 0    blade forward and low
   *   t 0.3   → f 5    contact, blade vertical overhead
   *   t 0.44  → f 11   the back half of the arc
   *   t 0.62  → f 12   … and on round
   *
   * A runs 130° → 5° → 330° → 300°: 125° into the hit and 190° across the clip,
   * all one way, front to back over the top. The tip hitbox is at (2, 16) world,
   * two-thirds along a raised blade rather than at its point — same trade as
   * `usmash` and `uair`, for the same reason.
   */
  utilt: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: -2, torso: 12, head: -10,
          thighR: 154, shinR: 30, footR: -86,
          thighL: 202, shinL: 26, footL: -84,
          upperArmR: 120, forearmR: 0, handR: 0,
          upperArmL: 170, forearmL: -30,
        }),
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          hip: 2, torso: -8, head: 10,
          thighR: 164, shinR: 14, footR: -86,
          thighL: 196, shinL: 12, footL: -84,
          upperArmR: 11, forearmR: 0, handR: 0,
          upperArmL: 330, forearmL: 14,
        }),
        offsetY: 0.2,
        scaleY: 1.08,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 6-8, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.35,
        pose: P({
          hip: 2, torso: -8, head: 10,
          thighR: 164, shinR: 14, footR: -86,
          thighL: 196, shinL: 12, footL: -84,
          upperArmR: 11, forearmR: 0, handR: 0,
          upperArmL: 330, forearmL: 14,
        }),
        offsetY: 0.2,
        scaleY: 1.08,
      },
      {
        t: 0.44,
        pose: P({
          hip: 0, torso: -2, head: 6,
          thighR: 160, shinR: 18, footR: -86,
          thighL: 198, shinL: 16, footL: -84,
          upperArmR: 332, forearmR: 0, handR: 0,
          upperArmL: 312, forearmL: 8,
        }),
        offsetY: 0.08,
        scaleY: 1.03,
      },
      {
        t: 0.62,
        pose: P({
          torso: 4,
          thighR: 156, shinR: 22, footR: -86,
          upperArmR: 296, forearmR: -10, handR: 0,
          upperArmL: 260, forearmL: 4,
        }),
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 148, forearmR: -28, upperArmL: 206, forearmL: -20 }) },
    ],
  },

  /**
   * Down Tilt — "a quick crouching sword poke" (SmashWiki). FAF 23 makes it his
   * safest poke by a distance, and both variants semi-spike at 30°.
   *
   * A poke, so the travel is in the *arm*, not the blade: `upperArmR` goes 200°
   * → 103° while A moves only 166° → 125°. Chambered at the hip, driven out
   * along the floor, pulled straight back.
   *
   * `first = 6` (frames 7-8), `total = 23`, `strike = 0.3`. Twenty-three frames
   * total is the shortest clip he has, so there is no room for a follow-through
   * that unwinds slowly — the `t: 0.46` key is a retraction, not a flourish.
   *
   *   t 0     → f 0    crouched, blade drawn back at the hip
   *   t 0.3   → f 6    the poke, arm and blade one line along the floor
   *   t 0.46  → f 9    already retracting
   *
   * The crouch is what makes the reach honest. From the standing shoulder at 9.6
   * rig the point cannot get to world (11, 1.4) at all. Sunk by `offsetY: -2.1`
   * with both knees folded past 88° and the torso pitched 30°, the shoulder sits
   * near (1.5, 6.9) rig, and A = 125° puts the point at (9.7, 1.15) rig =
   * **(11.3, 1.3) world** — on the tipper hitbox.
   */
  dtilt: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: -4, torso: 20, head: -16,
          thighR: 130, shinR: 92, footR: -76,
          thighL: 138, shinL: 88, footL: -74,
          upperArmR: 200, forearmR: -50, handR: 0,
          upperArmL: 178, forearmL: -40,
        }),
        offsetY: -1.9,
        scaleY: 0.9,
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          hip: -8, torso: 30, head: -22,
          thighR: 122, shinR: 96, footR: -74,
          thighL: 148, shinL: 90, footL: -72,
          upperArmR: 103, forearmR: 0, handR: 0,
          upperArmL: 196, forearmL: -46,
        }),
        offsetY: -2.1,
        offsetX: 0.35,
        scaleX: 1.14,
        scaleY: 0.88,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 7-8, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.341,
        pose: P({
          hip: -8, torso: 30, head: -22,
          thighR: 122, shinR: 96, footR: -74,
          thighL: 148, shinL: 90, footL: -72,
          upperArmR: 103, forearmR: 0, handR: 0,
          upperArmL: 196, forearmL: -46,
        }),
        offsetY: -2.1,
        offsetX: 0.35,
        scaleX: 1.14,
        scaleY: 0.88,
      },
      {
        t: 0.46,
        pose: P({
          hip: -6, torso: 24, head: -18,
          thighR: 126, shinR: 94, footR: -76,
          thighL: 142, shinL: 90, footL: -74,
          upperArmR: 134, forearmR: -18, handR: 0,
          upperArmL: 184, forearmL: -42,
        }),
        offsetY: -2.0,
        offsetX: 0.16,
        scaleY: 0.89,
      },
      {
        t: 1,
        pose: P({
          torso: 20,
          thighR: 130, shinR: 92, footR: -76,
          thighL: 138, shinL: 88, footL: -74,
          upperArmR: 178, forearmR: -40,
        }),
        offsetY: -1.9,
        scaleY: 0.9,
      },
    ],
  },

  /**
   * Dash Attack — "a quick, running, upward-sweeping diagonal slash"
   * (SmashWiki). Three hitboxes at descending damage as you come in from the
   * point — 13% / 10% / 9% at x = 11, 7.5 and 4 — so the blade is *along* the
   * line of the slash rather than at one distance, and the pose has to keep the
   * whole arm and blade on that diagonal.
   *
   * `first = 12` (frames 13-16), `total = 49`, `strike = 0.3`.
   *
   *   t 0     → f 0    running, blade trailing low behind
   *   t 0.3   → f 12   contact, on the diagonal
   *   t 0.44  → f 19   the sweep carries on up
   *   t 0.62  → f 28   recovering, still moving forward
   *
   * A runs 200° → 116° → 70° → 40°: 84° upward into the hit and 160° across the
   * clip. At contact `hip + torso = 22` and `upperArmR: 94`, straight elbow, so
   * A = 116° and the point is at 9.0 rig = 10.5 world out, 5.2 rig = 6.0 world
   * up — the tipper at (11, 6.0).
   */
  dashAttack: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: 4, torso: 14, head: -10,
          thighR: 138, shinR: 48, footR: -78,
          thighL: 212, shinL: 40, footL: -72,
          upperArmR: 182, forearmR: 0, handR: 0,
          upperArmL: 146, forearmL: -34,
        }),
        offsetX: 0.2,
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          hip: -4, torso: 26, head: -20,
          thighR: 126, shinR: 40, footR: -72,
          thighL: 222, shinL: 34, footL: -68,
          upperArmR: 94, forearmR: 0, handR: 0,
          upperArmL: 222, forearmL: -52,
        }),
        offsetX: 0.55,
        offsetY: -0.5,
        scaleX: 1.06,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 13-16, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.357,
        pose: P({
          hip: -4, torso: 26, head: -20,
          thighR: 126, shinR: 40, footR: -72,
          thighL: 222, shinL: 34, footL: -68,
          upperArmR: 94, forearmR: 0, handR: 0,
          upperArmL: 222, forearmL: -52,
        }),
        offsetX: 0.55,
        offsetY: -0.5,
        scaleX: 1.06,
      },
      {
        t: 0.44,
        pose: P({
          hip: -2, torso: 18, head: -12,
          thighR: 132, shinR: 42, footR: -74,
          thighL: 214, shinL: 36, footL: -70,
          upperArmR: 54, forearmR: 0, handR: 0,
          upperArmL: 212, forearmL: -44,
        }),
        offsetX: 0.66,
        offsetY: -0.5,
        scaleX: 1.05,
      },
      {
        t: 0.62,
        pose: P({
          torso: 10,
          thighR: 142, shinR: 34, footR: -80,
          thighL: 206, shinL: 30, footL: -76,
          upperArmR: 30, forearmR: -8, handR: 0,
          upperArmL: 200, forearmL: -36,
        }),
        offsetX: 0.34,
        offsetY: -0.3,
      },
      { t: 1, pose: P({ torso: 8, upperArmR: 130, forearmR: -26, upperArmL: 198, forearmL: -30 }) },
    ],
  },

  /**
   * Forward Air — "a descending crescent slash in front of him with great
   * coverage" (SmashWiki). Descending: the blade starts *above and behind* the
   * shoulder and finishes forward and low, so the arc crosses everything in
   * front of him rather than poking at one height.
   *
   * `first = 5` (frames 6-8), `total = 37`, `strike = 0.3`. Five wind-up frames
   * is not enough to travel a coil through, so `ease: "in"` holds the raised
   * shape for three of them and spends the arc in the last two.
   *
   *   t 0     → f 0    blade up and back, knees gathered
   *   t 0.3   → f 5    contact, arm and blade one line
   *   t 0.44  → f 11   the blade carries on down past the hitbox
   *   t 0.62  → f 19   recovering toward the fall
   *
   * A runs 350° → 111° → 150° → 170°: **131° into the hit**, all of it one way
   * over the top. At contact `hip + torso = 14` and `upperArmR: 97` with a
   * straight elbow, so A = 111° and the point sits at 10.03·sin 111° = 9.36 rig
   * = 10.9 world out, 9.6 + 10.03·cos 111° = 6.0 rig = 7.0 world up. That is the
   * tipper hitbox at (11, 7.0).
   *
   * The tipper on this move is the weakest payoff in his kit — base knockback
   * and growth are byte-identical between tip and body, so the whole gap comes
   * from the damage term — which is exactly why the *pose* has to sell it. The
   * player has no knockback cue to learn from; they only have the picture.
   */
  fair: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: 4, torso: -14, head: 10,
          thighR: 150, shinR: 46, footR: -70,
          thighL: 206, shinL: 40, footL: -68,
          upperArmR: 336, forearmR: 14, handR: 0,
          upperArmL: 156, forearmL: -30,
        }),
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          hip: -4, torso: 18, head: -14,
          thighR: 140, shinR: 34, footR: -66,
          thighL: 214, shinL: 30, footL: -64,
          upperArmR: 97, forearmR: 0, handR: 0,
          upperArmL: 210, forearmL: -48,
        }),
        offsetX: 0.3,
        scaleX: 1.12,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 6-8, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.344,
        pose: P({
          hip: -4, torso: 18, head: -14,
          thighR: 140, shinR: 34, footR: -66,
          thighL: 214, shinL: 30, footL: -64,
          upperArmR: 97, forearmR: 0, handR: 0,
          upperArmL: 210, forearmL: -48,
        }),
        offsetX: 0.3,
        scaleX: 1.12,
      },
      {
        t: 0.44,
        pose: P({
          hip: -2, torso: 10, head: -6,
          thighR: 146, shinR: 36, footR: -68,
          thighL: 210, shinL: 32, footL: -66,
          upperArmR: 142, forearmR: 6, handR: 0,
          upperArmL: 204, forearmL: -40,
        }),
        offsetX: 0.16,
        scaleX: 1.04,
      },
      {
        t: 0.62,
        pose: P({
          torso: 4,
          thighR: 150, shinR: 38, footR: -70,
          thighL: 206, shinL: 34, footL: -68,
          upperArmR: 166, forearmR: -10, handR: 0,
          upperArmL: 198, forearmL: -32,
        }),
      },
      { t: 1, pose: P({ torso: 2, upperArmR: 150, forearmR: -26, upperArmL: 200, forearmL: -28 }) },
    ],
  },

  /**
   * Back Air — "an upward crescent slash behind him in an inward swipe"
   * (SmashWiki). The blade starts *crossed over in front*, sweeps down under
   * him and up behind: the "inward" part is that it finishes travelling toward
   * his own back rather than away from it.
   *
   * `first = 6` (frames 7-11), `total = 39`, `strike = 0.28`.
   *
   *   t 0     → f 0    blade down and forward, across the body
   *   t 0.28  → f 6    contact behind him, arm straight
   *   t 0.44  → f 12   the point carries up behind — the window is still live
   *   t 0.62  → f 21   recovering
   *
   * A runs 160° → 249° → 290° → 320°: 89° into the hit and 160° across the clip,
   * every span the same way round (increasing, i.e. down-forward → under →
   * behind → up). At contact `hip + torso = −10` and `upperArmR: 259`, straight
   * elbow, so A = 249° and the point is at 10.03·sin 249° = −9.37 rig = −10.9
   * world, 9.6 + 10.03·cos 249° = 6.0 rig = 7.0 world — the tipper at (−11, 7).
   *
   * This tipper's bonus is in *growth* (94 against 85), so the gap widens with
   * percent, which is why the follow-through key keeps the blade live and
   * travelling rather than stopping it at the hitbox: the move's whole value is
   * that the far edge of the swing is the good part.
   */
  bair: {
    loop: false,
    strike: 0.28,
    keys: [
      {
        t: 0,
        pose: P({
          hip: -2, torso: 14, head: -10,
          thighR: 152, shinR: 48, footR: -70,
          thighL: 204, shinL: 44, footL: -68,
          upperArmR: 148, forearmR: 0, handR: 0,
          upperArmL: 166, forearmL: -26,
        }),
        ease: "in",
      },
      {
        t: 0.28,
        pose: P({
          hip: 8, torso: -18, head: 14,
          thighR: 226, shinR: 10, footR: -70,
          thighL: 232, shinL: 8, footL: -68,
          upperArmR: 259, forearmR: 0, handR: 0,
          upperArmL: 132, forearmL: -34,
        }),
        offsetX: -0.5,
        scaleX: 1.14,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 7-11, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.367,
        pose: P({
          hip: 8, torso: -18, head: 14,
          thighR: 226, shinR: 10, footR: -70,
          thighL: 232, shinL: 8, footL: -68,
          upperArmR: 259, forearmR: 0, handR: 0,
          upperArmL: 132, forearmL: -34,
        }),
        offsetX: -0.5,
        scaleX: 1.14,
      },
      {
        t: 0.44,
        pose: P({
          hip: 6, torso: -12, head: 10,
          thighR: 220, shinR: 16, footR: -72,
          thighL: 226, shinL: 14, footL: -70,
          upperArmR: 302, forearmR: 0, handR: 0,
          upperArmL: 148, forearmL: -28,
        }),
        offsetX: -0.24,
        scaleX: 1.06,
      },
      {
        t: 0.62,
        pose: P({
          hip: 2, torso: -4, head: 4,
          thighR: 204, shinR: 26, footR: -74,
          thighL: 210, shinL: 24, footL: -72,
          upperArmR: 324, forearmR: -8, handR: 0,
          upperArmL: 176, forearmL: -24,
        }),
      },
      { t: 1, pose: P({ torso: 2, upperArmR: 12, forearmR: -20, upperArmL: 196, forearmL: -26 }) },
    ],
  },

  /**
   * Neutral Air — two slashes, forward then back, and the back one is the
   * strong one (9.5% on its tip against the front's 5%).
   *
   * ## The circle
   *
   * The blade has to get from world (+11, 6.5) to (−11, 6.5) and there are two
   * ways round. This clip takes it **downward, under his own feet**, and forces
   * that with a key at A = 180° in between rather than trusting the shortest
   * path: the arc from 114° to 246° is 132° either way to within a hair, which
   * is exactly the case where an interpolator's choice is arbitrary and a
   * fighter spins his arm the wrong way half the time.
   *
   * ## Two windows, one anchor
   *
   * `first = 5` (frames 6-7) and `total = 49`, so only the first swing is
   * anchored. The second is frames 15-21, and
   *
   *   t = strike + (1 − strike)·(14 − 5)/(49 − 5) = 0.3 + 0.7 × 0.2045 = 0.443
   *
   * puts the back-swing key on actionFrame 14 (frame 15), with a further key at
   *
   *   t = 0.3 + 0.7 × (20 − 5)/44 = 0.539
   *
   * on frame 21 — the last live frame — so the blade is still behind him when
   * the hitbox expires rather than having left twenty degrees early.
   *
   *   t 0     → f 0    blade up and forward
   *   t 0.3   → f 5    first hit, in front, A = 114°
   *   t 0.39  → f 11   straight down, the bottom of the circle
   *   t 0.443 → f 14   second hit begins, behind, A = 246°
   *   t 0.539 → f 20   still behind as the window closes
   */
  nair: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: 0, torso: 6, head: -4,
          thighR: 148, shinR: 52, footR: -70,
          thighL: 208, shinL: 46, footL: -68,
          upperArmR: 54, forearmR: 0, handR: 0,
          upperArmL: 172, forearmL: -28,
        }),
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          hip: -2, torso: 12, head: -8,
          thighR: 132, shinR: 30, footR: -66,
          thighL: 220, shinL: 26, footL: -64,
          upperArmR: 104, forearmR: 0, handR: 0,
          upperArmL: 198, forearmL: -40,
        }),
        offsetX: 0.3,
        scaleX: 1.14,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 6-7, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.316,
        pose: P({
          hip: -2, torso: 12, head: -8,
          thighR: 132, shinR: 30, footR: -66,
          thighL: 220, shinL: 26, footL: -64,
          upperArmR: 104, forearmR: 0, handR: 0,
          upperArmL: 198, forearmL: -40,
        }),
        offsetX: 0.3,
        scaleX: 1.14,
      },
      {
        t: 0.39,
        pose: P({
          hip: 0, torso: 4, head: -2,
          thighR: 128, shinR: 44, footR: -64,
          thighL: 226, shinL: 40, footL: -62,
          upperArmR: 176, forearmR: 0, handR: 0,
          upperArmL: 214, forearmL: -30,
        }),
        scaleX: 1.04,
      },
      {
        t: 0.443,
        pose: P({
          hip: 6, torso: -14, head: 10,
          thighR: 214, shinR: 22, footR: -66,
          thighL: 222, shinL: 20, footL: -64,
          upperArmR: 254, forearmR: 0, handR: 0,
          upperArmL: 140, forearmL: -32,
        }),
        offsetX: -0.4,
        scaleX: 1.16,
      },
      {
        t: 0.539,
        pose: P({
          hip: 4, torso: -10, head: 8,
          thighR: 208, shinR: 26, footR: -68,
          thighL: 216, shinL: 24, footL: -66,
          upperArmR: 268, forearmR: 0, handR: 0,
          upperArmL: 152, forearmL: -28,
        }),
        offsetX: -0.24,
        scaleX: 1.08,
      },
      {
        t: 0.72,
        pose: P({
          torso: -2,
          thighR: 190, shinR: 34, footR: -70,
          thighL: 204, shinL: 32, footL: -68,
          upperArmR: 302, forearmR: -10, handR: 0,
          upperArmL: 180, forearmL: -22,
        }),
      },
      { t: 1, pose: P({ torso: 2, upperArmR: 340, forearmR: -20, upperArmL: 198, forearmL: -24 }) },
    ],
  },

  /**
   * Up Air — "an overhead crescent slash with good coverage, ending in a
   * delayed somersault" (SmashWiki).
   *
   * The overhead arc is the hit; the somersault is the *recovery*, and it is
   * most of the clip. It is drawn as a tuck rather than as a turn: whole-body
   * `spin` rotates this rig out of the screen plane and `rotation` interpolates
   * the short way round, so neither can express a full revolution here. What a
   * tuck can say is the same thing — knees to the chest, torso curled, the
   * blade folded in — and it says it without tipping him onto his side.
   *
   * `first = 4` (frames 5-9), `total = 45`, `strike = 0.28`. Four wind-up frames
   * means one shape, held by `ease: "in"`.
   *
   *   t 0     → f 0    blade forward and low
   *   t 0.28  → f 4    contact, blade vertical
   *   t 0.44  → f 12   past vertical and tipping behind
   *   t 0.62  → f 21   the tuck
   *
   * A runs 120° → 8° → 330°: 112° into the hit, one way, through the front. The
   * tip hitbox is at world (1.5, 17) and the point of a vertical blade reaches
   * 22.8 world, so as with `usmash` the hitbox sits two-thirds along the blade
   * rather than at its end — a bent elbow would seat the point in the sphere and
   * cost the silhouette, which is the wrong trade.
   *
   * It differs from `usmash` and `upB`, which also end blade-up, by never
   * straightening: the legs stay gathered the whole way and end tucked, where
   * `usmash` rises onto planted toes and `upB` leaves the ground with the body
   * arched and the legs snapped straight behind.
   */
  uair: {
    loop: false,
    strike: 0.28,
    keys: [
      {
        t: 0,
        pose: P({
          hip: -2, torso: 12, head: -10,
          thighR: 146, shinR: 56, footR: -68,
          thighL: 208, shinL: 50, footL: -66,
          upperArmR: 110, forearmR: 0, handR: 0,
          upperArmL: 176, forearmL: -30,
        }),
        ease: "in",
      },
      {
        t: 0.28,
        pose: P({
          hip: 2, torso: -10, head: 12,
          thighR: 138, shinR: 30, footR: -60,
          thighL: 200, shinL: 28, footL: -58,
          upperArmR: 16, forearmR: 0, handR: 0,
          upperArmL: 314, forearmL: 16,
        }),
        offsetY: 0.3,
        scaleY: 1.14,
        scaleX: 0.92,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 5-9, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.35,
        pose: P({
          hip: 2, torso: -10, head: 12,
          thighR: 138, shinR: 30, footR: -60,
          thighL: 200, shinL: 28, footL: -58,
          upperArmR: 16, forearmR: 0, handR: 0,
          upperArmL: 314, forearmL: 16,
        }),
        offsetY: 0.3,
        scaleY: 1.14,
        scaleX: 0.92,
      },
      {
        t: 0.44,
        pose: P({
          hip: 0, torso: -4, head: 6,
          thighR: 132, shinR: 44, footR: -62,
          thighL: 198, shinL: 40, footL: -60,
          upperArmR: 334, forearmR: 0, handR: 0,
          upperArmL: 300, forearmL: 10,
        }),
        offsetY: 0.12,
        scaleY: 1.05,
      },
      // The somersault, as a tuck: knees to the chest, spine curled, blade
      // folded in across him. Nothing here rotates the body — see the note
      // above — but the shape is the shape a somersault passes through.
      {
        t: 0.62,
        pose: P({
          hip: -6, torso: 26, head: -20,
          thighR: 116, shinR: 98, footR: -54,
          thighL: 124, shinL: 94, footL: -52,
          upperArmR: 34, forearmR: -54, handR: 0,
          upperArmL: 272, forearmL: 28,
        }),
        offsetY: -0.2,
        scaleY: 0.92,
        scaleX: 1.05,
      },
      {
        t: 1,
        pose: P({
          torso: 6,
          thighR: 152, shinR: 40, thighL: 202, shinL: 36,
          upperArmR: 96, forearmR: -30, upperArmL: 210, forearmL: -20,
        }),
      },
    ],
  },

  /**
   * Down Air — "a downward, wide crescent slash with large coverage"
   * (SmashWiki), and the one move in his kit where the reward is *not* the tip.
   *
   * Read `fighters/marth.ts`'s header: the meteor is hitbox **id 0**, 15% at
   * world (−3.0, −3.3) — below and slightly *behind* him — live on **frame 11
   * and frame 11 only**, and it does more than the tip's 14%. The tip (id 1, at
   * (6.7, −1.0)) launches at the Sakurai angle and does not spike. So the
   * animation has one job the frame data cannot do on its own: on frame 11 the
   * blade must genuinely be in the space beneath and behind him, and on the
   * frames either side it must be sweeping through it.
   *
   * `first = 8` (the earliest hitbox is frame 9), `total = 59`, `strike = 0.3`.
   * The meteor is frame 11 = actionFrame 10, and
   *
   *   t = 0.3 + 0.7 × (10 − 8)/(59 − 8) = 0.327
   *
   * so there is a key at `t: 0.327` and it is the one that matters most.
   *
   *   t 0     → f 0    blade up and forward
   *   t 0.3   → f 8    the tip: A = 145°, point at world (6.7, 1.6)
   *   t 0.327 → f 10   the meteor: A = 195°, point at world (−3.0, −0.1)
   *   t 0.38  → f 14   swept through and behind
   *   t 0.6   → f 30   recovering
   *
   * Fifty degrees in two frames is the fastest span in any of his clips, and it
   * should be: a one-frame meteor window is the definition of a moment you
   * either caught or did not.
   *
   * Honest gap: the point reaches the meteor's x exactly and sits about three
   * world units above its y. Getting lower needs the hips above the shoulders,
   * which at this level of abstraction reads as a fall rather than as a chop, so
   * the `offsetY: -0.8` on that key is as far as it goes.
   */
  dair: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: 2, torso: -6, head: 6,
          thighR: 146, shinR: 62, footR: -74,
          thighL: 200, shinL: 58, footL: -72,
          upperArmR: 74, forearmR: 0, handR: 0,
          upperArmL: 168, forearmL: -26,
        }),
        ease: "in",
      },
      {
        t: 0.3,
        pose: P({
          hip: -4, torso: 16, head: -12,
          thighR: 168, shinR: 18, footR: -84,
          thighL: 190, shinL: 16, footL: -82,
          upperArmR: 133, forearmR: 0, handR: 0,
          upperArmL: 200, forearmL: -44,
        }),
        offsetY: -0.3,
        scaleX: 0.94,
        scaleY: 1.1,
        ease: "out",
      },
      // Frame 11. The blade is through the vertical and behind his own legs,
      // which is where the meteor lives.
      {
        t: 0.327,
        pose: P({
          hip: -6, torso: 22, head: -16,
          thighR: 176, shinR: 12, footR: -88,
          thighL: 186, shinL: 10, footL: -86,
          upperArmR: 179, forearmR: 0, handR: 0,
          upperArmL: 210, forearmL: -38,
        }),
        offsetY: -0.8,
        scaleX: 0.92,
        scaleY: 1.12,
      },
      // The hitbox is live for the whole of frames 9-13, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame. The drift across this window is the
      // whole point here rather than a fault: the tip and the meteor are two
      // different sweetspots in two different places, so what is held is the
      // blade being *through* the arc, not parked in one pose.
      {
        t: 0.355,
        pose: P({
          hip: -4, torso: 16, head: -12,
          thighR: 168, shinR: 18, footR: -84,
          thighL: 190, shinL: 16, footL: -82,
          upperArmR: 133, forearmR: 0, handR: 0,
          upperArmL: 200, forearmL: -44,
        }),
        offsetY: -0.3,
        scaleX: 0.94,
        scaleY: 1.1,
      },
      {
        t: 0.38,
        pose: P({
          hip: -2, torso: 14, head: -8,
          thighR: 178, shinR: 14, footR: -86,
          thighL: 188, shinL: 12, footL: -84,
          upperArmR: 201, forearmR: 0, handR: 0,
          upperArmL: 204, forearmL: -30,
        }),
        offsetY: -0.5,
        scaleY: 1.06,
      },
      {
        t: 0.6,
        pose: P({
          torso: 6,
          thighR: 172, shinR: 22, footR: -84,
          thighL: 192, shinL: 20, footL: -82,
          upperArmR: 226, forearmR: -12, handR: 0,
          upperArmL: 196, forearmL: -24,
        }),
        offsetY: -0.2,
      },
      { t: 1, pose: P({ torso: 2, thighR: 166, shinR: 26, thighL: 194, shinL: 24, upperArmR: 258, forearmR: -20 }) },
    ],
  },

  /**
   * Shield Breaker — a stab, not a swing.
   *
   * This is the move most likely to be drawn wrong from memory, because it
   * changed. SmashWiki: in Melee it was "an overhead vertical slash with a
   * large arc"; from Brawl onward "it has become a single powerful stab", and
   * the animation "resembles Marth using his Rapier in Fire Emblem: Mystery of
   * the Emblem", where he "leans back and stabs the opponent", taking a step
   * forward as he does. The hitbox table agrees — `effect: "stab"`, a narrow
   * tip/body pair at chest height and nothing else.
   *
   * So the angular travel of this move is almost all in the *upper arm*, not in
   * the blade: `upperArmR` goes 236° → 96°, a hundred and forty degrees, while
   * the blade's own direction barely moves from horizontal. That is what a
   * thrust is, and drawing it as an arc would be drawing the Melee move.
   *
   * `first = 18` (frames 19-20) and `total = 50`, `strike = 0.3`.
   *
   *   t 0     → f 0    chambered and leaning back — also the charge stance
   *   t 0.3   → f 18   the thrust, arm and blade one straight line
   *   t 0.42  → f 24   the point drops, the body starts back
   *   t 0.62  → f 33   weight recovered
   *
   * Charge freezes at `strike * 0.55 = 0.165`, and `ease: "in"` out of key 0
   * makes that 17% of the way to the thrust — so the chamber is what a charging
   * Marth is drawn as. It is authored as a finished pose: hilt drawn back past
   * the ribs, blade level and pointing at the opponent, weight rocked onto the
   * back foot, chest opened. Held for up to sixty frames, it has to be a shape
   * that says "this is coming at you and it is going to be a point".
   *
   * At the thrust `hip + torso = 12` and `upperArmR: 96` with a straight elbow
   * and wrist, so A = 108° — and 9.6 + 10.03·cos 108° = 6.5 rig = 7.5 world,
   * 10.03·sin 108° = 9.5 rig = 11.1 world. The point lands on the tipper.
   */
  neutralB: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: 6, torso: -22, head: 16,
          thighR: 172, shinR: 20, footR: -88,
          thighL: 200, shinL: 24, footL: -84,
          upperArmR: 236, forearmR: -116, handR: -12,
          upperArmL: 244, forearmL: -104,
        }),
        offsetX: -0.6,
        ease: "in",
      },
      // The stab. Both hands drive forward together — it is a two-handed
      // thrust in the reference — and the back leg is left behind, so the
      // silhouette is one long diagonal from trailing heel to point.
      {
        t: 0.3,
        pose: P({
          hip: -4, torso: 16, head: -10,
          thighR: 132, shinR: 22, footR: -92,
          thighL: 226, shinL: 26, footL: -70,
          upperArmR: 96, forearmR: 0, handR: 0,
          upperArmL: 108, forearmL: -14,
        }),
        offsetX: 0.62,
        offsetY: -0.3,
        scaleX: 1.05,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 19-20, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.322,
        pose: P({
          hip: -4, torso: 16, head: -10,
          thighR: 132, shinR: 22, footR: -92,
          thighL: 226, shinL: 26, footL: -70,
          upperArmR: 96, forearmR: 0, handR: 0,
          upperArmL: 108, forearmL: -14,
        }),
        offsetX: 0.62,
        offsetY: -0.3,
        scaleX: 1.05,
      },
      // A thrust does not follow through the way a swing does; what it does is
      // drop. The point sinks and the shoulder comes off it first.
      {
        t: 0.42,
        pose: P({
          hip: -2, torso: 8, head: -4,
          thighR: 138, shinR: 24, footR: -90,
          thighL: 218, shinL: 28, footL: -74,
          upperArmR: 110, forearmR: 4, handR: 0,
          upperArmL: 128, forearmL: -22,
        }),
        offsetX: 0.86,
        offsetY: -0.25,
        scaleX: 1.06,
      },
      {
        t: 0.62,
        pose: P({
          hip: 0, torso: 6, head: 0,
          thighR: 148, shinR: 22, footR: -88,
          thighL: 206, shinL: 24, footL: -80,
          upperArmR: 124, forearmR: -12, handR: 0,
          upperArmL: 168, forearmL: -34,
        }),
        offsetX: 0.4,
      },
      {
        t: 1,
        pose: P({ torso: 4, upperArmR: 140, forearmR: -26, upperArmL: 196, forearmL: -28 }),
      },
    ],
  },

  /**
   * Down Smash — "sweeps Falchion on the ground toward the front-outward then
   * toward the back inward" (SmashWiki). One scything motion through the floor,
   * not two pokes, and the back half is the one that kills: 17% on its tip
   * against the front's 12%.
   *
   * ## Two windows, one anchor
   *
   * `first = 5` (frames 6-7) and `total = 55`, so `poseTimeFor` anchors only the
   * **front** hit. The back hit is on frames 21-23 and has to be placed by hand:
   *
   *   t = strike + (1 − strike)·(20 − 5)/(55 − 5) = 0.3 + 0.7 × 0.30 = 0.51
   *
   * so the back-sweep key sits at `t: 0.51`, and an intermediate at `t: 0.4`
   * (actionFrame ≈ 12) paces the blade through the bottom of the arc instead of
   * letting a single ease dump all 108° into the first few frames.
   *
   * ## Reaching the floor
   *
   * The hitboxes are at world (±11, 1.4) — ankle height, full extension. From a
   * standing shoulder 9.6 rig units up, the straight-line distance to that point
   * is 12.2 rig against an arm-plus-blade of 10.03: **he cannot reach it
   * standing**. So the pose sinks him — `offsetY: -2.4`, paid for by folding
   * both knees past 80° — and pitches the torso 34° forward, which drops the
   * shoulder to about 6.6 rig and puts the point at roughly world (11.5, 0.8).
   * That is on the hitbox in x and a shade low in y, which is the right way to
   * be wrong for a move whose whole idea is scraping the stage.
   *
   * A runs 215° → 126° → 180° → 234° → 260°. The middle span is the sweep:
   * 108° taken the short way, which is *downward through his own feet*, front to
   * back. Nothing else in the roster travels through that arc.
   */
  dsmash: {
    loop: false,
    strike: 0.3,
    keys: [
      // The charge stance, and only five frames of wind-up: one shape. Down on
      // both knees' fold with the blade drawn back and across the body, point
      // low behind him, loaded to whip forward through the floor.
      {
        t: 0,
        pose: P({
          hip: -6, torso: 22, head: -16,
          thighR: 132, shinR: 84, footR: -80,
          thighL: 140, shinL: 80, footL: -78,
          upperArmR: 210, forearmR: -20, handR: 9,
          upperArmL: 158, forearmL: -40,
        }),
        offsetY: -1.6,
        scaleY: 0.9,
        ease: "in",
      },
      // The front hit. Torso pitched hard over the front foot, arm and blade
      // one straight line out at ankle height.
      {
        t: 0.3,
        pose: P({
          hip: -10, torso: 34, head: -24,
          thighR: 124, shinR: 92, footR: -76,
          thighL: 146, shinL: 86, footL: -74,
          upperArmR: 102, forearmR: 0, handR: 0,
          upperArmL: 196, forearmL: -50,
        }),
        offsetY: -2.4,
        offsetX: 0.35,
        scaleX: 1.18,
        scaleY: 0.84,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 6-7, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.314,
        pose: P({
          hip: -10, torso: 34, head: -24,
          thighR: 124, shinR: 92, footR: -76,
          thighL: 146, shinL: 86, footL: -74,
          upperArmR: 102, forearmR: 0, handR: 0,
          upperArmL: 196, forearmL: -50,
        }),
        offsetY: -2.4,
        offsetX: 0.35,
        scaleX: 1.18,
        scaleY: 0.84,
      },
      // The bottom of the arc, blade straight down through his own feet. This
      // key exists to pace the sweep: without it the fifteen frames between the
      // two hits are one ease and the blade is behind him by frame nine.
      //
      // He also comes *up* here, and the elbow folds. A straight arm at A = 180°
      // out of the frame-6 crouch puts the point four world units under the
      // stage — the blade vanishes into the floor and the middle of the sweep
      // is a fighter holding nothing. Rising to `offsetY: -1.2` and bending the
      // elbow 46° keeps A at 180° while pulling the point back to about a unit
      // below the surface, which reads as scraping it.
      {
        t: 0.4,
        pose: P({
          hip: -4, torso: 18, head: -12,
          thighR: 138, shinR: 74, footR: -80,
          thighL: 146, shinL: 70, footL: -78,
          upperArmR: 212, forearmR: -46, handR: 0,
          upperArmL: 210, forearmL: -44,
        }),
        offsetY: -1.2,
        scaleX: 1.1,
        scaleY: 0.9,
      },
      // The back hit, fifteen frames later and harder than the front. He has
      // rotated through the crouch rather than stood up out of it.
      {
        t: 0.51,
        pose: P({
          hip: 6, torso: -10, head: 14,
          thighR: 136, shinR: 86, footR: -78,
          thighL: 142, shinL: 84, footL: -76,
          upperArmR: 238, forearmR: 0, handR: 0,
          upperArmL: 128, forearmL: -34,
        }),
        offsetY: -2.2,
        offsetX: -0.3,
        scaleX: 1.16,
        scaleY: 0.86,
      },
      // …and the same again for the back window, frames 21-23, which is the
      // half that kills: 17% on its tip against the front's 12%.
      {
        t: 0.538,
        pose: P({
          hip: 6, torso: -10, head: 14,
          thighR: 136, shinR: 86, footR: -78,
          thighL: 142, shinL: 84, footL: -76,
          upperArmR: 244, forearmR: 0, handR: 0,
          upperArmL: 128, forearmL: -34,
        }),
        offsetY: -2.2,
        offsetX: -0.34,
        scaleX: 1.16,
        scaleY: 0.86,
      },
      // The blade carries on up behind him, which is what stops the second hit
      // reading as the end of the move rather than the end of the swing.
      {
        t: 0.66,
        pose: P({
          hip: 4, torso: -4, head: 8,
          thighR: 140, shinR: 76, footR: -80,
          thighL: 148, shinL: 74, footL: -78,
          upperArmR: 262, forearmR: 14, handR: 0,
          upperArmL: 150, forearmL: -28,
        }),
        offsetY: -1.9,
        scaleX: 1.06,
      },
      {
        t: 1,
        pose: P({ torso: 12, thighR: 146, shinR: 60, thighL: 152, shinL: 58, upperArmR: 200, forearmR: -20 }),
        offsetY: -1.2,
      },
    ],
  },

  /**
   * Dancing Blade — stage one, and it has to read as *stage one*.
   *
   * SmashWiki's Ultimate change list is explicit about what this swing is: "The
   * first one is an outward swing similar to his forward tilt, the second is a
   * vertical swing instead of a horizontal one", and it records the first hit's
   * angles being retuned to 361°/90°/361° — that 90° is the hitbox this repo's
   * `sideB` encodes as the tipper, so the blade is genuinely *travelling
   * upward* when it connects. Forward tilt, the thing it is "similar to", is
   * "a fast upward swipe while leaning forward. It has a large arc." So this is
   * a rising outward slash off the floor, not a lunging thrust, and the pop-up
   * is what it is drawn as rather than only what the data says.
   *
   * The engine has one `sideB` slot, so only stage one exists — 39 frames,
   * hitbox live on 9-11. What makes it read as the *opening* of a string is
   * Ultimate Frame Data's other line: "Can transition to next slash on frame
   * 12-30". Those nineteen frames are not recovery, they are the window, and
   * Marth spends them poised rather than unwinding. The `t: 0.76` key lands on
   * frame 30 — the last frame the string can continue — and holds the blade
   * high and forward with the elbow gathered in and the weight still on the
   * front foot, which is the load for stage two's inward vertical swing. Only
   * frames 31-38 begin to lower it, and they never reach a stance.
   *
   *   t 0     → f 1    on guard, blade carried low and forward
   *   t 0.10  → f 4    the coil, torso turned 36° away from where it ends
   *   t 0.26  → f 9    contact, elbow and wrist at zero
   *   t 0.43  → f 16   top of the arc, blade vertical
   *   t 0.76  → f 30   the tell — gathered, still loaded
   *
   * At contact the arm and blade are one straight line: the hand sits at 5.95
   * rig units forward and the point at 11.28, against `BODY_REACH = 6.0` and
   * `TIP_REACH = 11.0`. The two hitboxes land on the hilt and on the point
   * respectively, which is the geometry the whole character is about.
   *
   * `upperArmR` and `forearmR` travel 227° between the coil and contact, and
   * the blade's accumulated angle covers 364° across the clip. That is the
   * difference from Fox's snap: distance, not speed.
   *
   * The leg angles look wrong next to the shared clips — `footL: -113` where
   * the library writes -80 — and are not. The shared clips point the far foot
   * nearly straight down because that foot is in the air; these are planted,
   * and a planted foot on a bent knee needs `foot ≈ 90 − (thigh + shin)`.
   */
  sideB: {
    loop: false,
    strike: 0.26,
    keys: [
      {
        t: 0,
        pose: P({
          torso: 6, head: -6, hip: 0,
          thighR: 157, shinR: 18, footR: -87,
          thighL: 185, shinL: 18, footL: -113,
          upperArmR: 132, forearmR: -30, handR: 12,
          upperArmL: 204, forearmL: -40,
        }),
        offsetY: -0.2,
        ease: "out",
      },
      // The coil: torso turned away, hilt drawn behind at chest height, blade
      // trailing back and down. `in`, so the whip happens in three frames.
      {
        t: 0.1,
        pose: P({
          torso: -18, head: 14, hip: 4,
          thighR: 141, shinR: 42, footR: -101,
          thighL: 194, shinL: 13, footL: -121,
          upperArmR: 212, forearmR: 88, handR: -58,
          upperArmL: 134, forearmL: -32,
        }),
        offsetX: -0.45,
        offsetY: -0.45,
        ease: "in",
      },
      {
        t: 0.26,
        pose: P({
          torso: 26, head: -16, hip: -4,
          thighR: 151, shinR: 14, footR: -73,
          thighL: 196, shinL: 44, footL: -108,
          upperArmR: 82, forearmR: 0, handR: 0,
          upperArmL: 234, forearmL: -54,
        }),
        offsetX: 0.1,
        offsetY: -0.5,
        scaleX: 1.0,
        ease: "out",
      },
      // The hitbox is live for the whole of frames 9-11, and `ease: "out"` is a
      // cubic: without this key the fighter is a third of the way into the
      // recovery before the last live frame, so the tip a Marth player is
      // aiming with has already started coming back. This holds the extension
      // to the frame the hitbox actually dies.
      {
        t: 0.308,
        pose: P({
          torso: 26, head: -16, hip: -4,
          thighR: 151, shinR: 14, footR: -73,
          thighL: 196, shinL: 44, footL: -108,
          upperArmR: 82, forearmR: 0, handR: 0,
          upperArmL: 234, forearmL: -54,
        }),
        offsetX: 0.1,
        offsetY: -0.5,
        scaleX: 1.0,
      },
      // The swing carries past the hitbox rather than stopping in it: frames 10
      // and 11 are still live and the point is still 10.6 and 9.1 units out.
      {
        t: 0.43,
        pose: P({
          torso: 20, head: -12, hip: -4,
          thighR: 151, shinR: 18, footR: -77,
          thighL: 197, shinL: 41, footL: -108,
          upperArmR: 26, forearmR: -8, handR: -12,
          upperArmL: 226, forearmL: -40,
        }),
        offsetX: 0.24,
        offsetY: -0.48,
      },
      {
        t: 0.76,
        pose: P({
          torso: 12, head: -6, hip: -2,
          thighR: 150, shinR: 19, footR: -79,
          thighL: 193, shinL: 41, footL: -112,
          upperArmR: 115, forearmR: -107, handR: 30,
          upperArmL: 216, forearmL: -34,
        }),
        offsetX: 0.2,
        offsetY: -0.42,
      },
      {
        t: 1,
        pose: P({
          torso: 10, head: -4, hip: 0,
          thighR: 153, shinR: 15, footR: -80,
          thighL: 188, shinL: 37, footL: -113,
          upperArmR: 129, forearmR: -108, handR: 41,
          upperArmL: 210, forearmL: -32,
        }),
        offsetX: 0.14,
        offsetY: -0.3,
      },
    ],
  },

  /**
   * Counter. 64 frames, hitbox on frames 4-6, counter window 6-27.
   *
   * SmashWiki, verbatim: "Marth's countering stance has him face away while
   * holding the Falchion slanted downward in reverse grip, and counterattacks
   * with an outward slash in normal grip"; and, on Ultimate, "Marth's Counter
   * retains the same stance and attack animation as in SSB4". So: turned away,
   * weight settled, blade held low and slanted across the front — not a crouch,
   * and not a blade held vertically in front of him. The rig cannot flip
   * Falchion into a reverse grip, since the prop always leaves the hand along
   * `handR`, so what is built here is the *silhouette* that grip makes: hilt at
   * the near hip, point out low and forward, one long diagonal crossing the
   * body from waist to below the knee.
   *
   * ## The strike key is the guard, not the cut
   *
   * `first = 3`, `total = 64`. The single hitbox is the *returned* strike and
   * the schema has nowhere to put it but frames 4-6, three frames in — and
   * there is no counter mechanic in the engine, so a player simply sees 64
   * frames of a defensive move. Anchoring the cut there would put a fully
   * committed slash on frame 4 and then sixty dead frames. So `strike = 0.08`
   * names the moment the **guard forms**, which lands it on actionFrame 3, and
   * the rest of the clip stretches over frames 3..64:
   *
   *   t 0     → f 0    sword drawn back to the rear hip
   *   t 0.08  → f 3    the guard — the strike key, held
   *   t 0.43  → f 27   the coil, one frame after the window closes
   *   t 0.578 → f 36   the counter-slash at full extension
   *   t 0.698 → f 44   follow-through
   *
   * `hold` on the guard is what makes the window read: it keeps that pose to
   * the exact degree from actionFrame 3 to 26 — move frames 4-27, the
   * documented window — and then cuts. Easing instead would rotate the blade a
   * slow visible 16° through the window and stop it being one shape.
   *
   * The honest gap: on the frames the hitbox is actually live the fighter is in
   * the guard, and the guard's blade does not cover the encoded hitbox at
   * (7, 7.5). The blade covers it at frame 37 instead. That is the price of the
   * move having no counter mechanic to hang its two halves on.
   *
   * The blade's accumulated angle runs 210° → 138° → 228° → 100° → 118°: 308°
   * of travel, against about 40° in the shared crouch this replaces. The coil
   * and the cut are one sweep — 228° to 100° interpolates the short way, so the
   * point drops behind him, passes under, and comes out forward.
   */
  downB: {
    loop: false,
    strike: 0.08,
    keys: [
      // The draw: he turns away and pulls Falchion back to the rear hip, point
      // trailing low behind him. `in`, so the three startup frames sit still
      // and the guard arrives as a snap — a counter that eased into position
      // would not be a counter.
      {
        t: 0,
        pose: P({
          hip: 4, torso: -10, head: 8,
          thighR: 172, shinR: 10, footR: -88,
          thighL: 190, shinL: 8, footL: -88,
          upperArmR: 200, forearmR: 22, handR: -6,
          upperArmL: 186, forearmL: -22,
        }),
        offsetX: -0.15,
        ease: "in",
      },
      // The guard. Torso turned away and leaning back, head brought back to
      // vertical so he is still watching; hilt at the waist, point out low and
      // forward, free arm trailing so it does not cross the blade.
      {
        t: 0.08,
        pose: P({
          hip: 4, torso: -20, head: 18,
          thighR: 162, shinR: 22, footR: -86,
          thighL: 202, shinL: 12, footL: -96,
          upperArmR: 168, forearmR: -22, handR: 8,
          upperArmL: 244, forearmL: -30,
        }),
        offsetX: -0.35,
        offsetY: -0.25,
        scaleY: 0.97,
        ease: "hold",
      },
      // The load, one frame after the window closes: the hand goes back past
      // the hip and the point drops behind him to knee height, the free arm
      // swings forward to counter-rotate, the weight sinks onto the back leg.
      {
        t: 0.43,
        pose: P({
          hip: 8, torso: -30, head: 26,
          thighR: 150, shinR: 26, footR: -84,
          thighL: 206, shinL: 16, footL: -100,
          upperArmR: 214, forearmR: 30, handR: 6,
          upperArmL: 130, forearmL: -40,
        }),
        offsetX: -0.65,
        offsetY: -0.3,
        scaleX: 0.97,
        scaleY: 0.96,
        ease: "in",
      },
      // The counter-slash at full extension. Counter is the one move with no
      // tipper — all four of its real hitboxes are identical — so the contact
      // is the body of the blade at mid reach with his whole weight stepped in
      // behind it, not a point poke at TIP_REACH.
      {
        t: 0.578,
        pose: P({
          hip: -6, torso: 24, head: -16,
          thighR: 150, shinR: 26, footR: -84,
          thighL: 220, shinL: 22, footL: -76,
          upperArmR: 88, forearmR: -8, handR: 2,
          upperArmL: 222, forearmL: -56,
        }),
        offsetX: 0.95,
        offsetY: -0.4,
        scaleX: 1.06,
        ease: "out",
      },
      // The blade keeps going the way it was going while the torso unwinds
      // first. Without this key the twenty-seven recovery frames are one ease
      // and read as a freeze.
      {
        t: 0.698,
        pose: P({
          hip: -2, torso: 12, head: -6,
          thighR: 154, shinR: 22, footR: -86,
          thighL: 212, shinL: 18, footL: -82,
          upperArmR: 104, forearmR: 0, handR: 4,
          upperArmL: 208, forearmL: -40,
        }),
        offsetX: 0.55,
        offsetY: -0.25,
      },
      // Terminator. Sword lowered to a carried guard so the blend back to
      // `idle` has forty degrees to travel rather than a hundred and eighty.
      {
        t: 1,
        pose: P({
          hip: 0, torso: 4, head: -3,
          thighR: 172, shinR: 8, footR: -88,
          thighL: 188, shinL: 6, footL: -88,
          upperArmR: 158, forearmR: -12, handR: 0,
          upperArmL: 196, forearmL: -20,
        }),
      },
    ],
  },

  /**
   * Dolphin Slash — a frame-5 rising sword, and fifty frames of hanging.
   *
   * SmashWiki, verbatim: "The user slightly moves forward, quickly swipes their
   * sword upward, and performs a high-spiraling leap, with their blade extended
   * horizontally-to-vertically", and then "will slowly stall in the air until
   * they start falling". It is an uppercut through the *front* — the blade
   * starts low and forward, not behind him — which is also the only version
   * this interpolator can draw: a blade authored down-and-back at 200° lerps
   * the short way round *backwards* through 270° to reach vertical, and you get
   * a windmill.
   *
   * Every other Marth move carries a TIP_REACH/BODY_REACH pair. `marth.ts` says
   * of this one, "No tipper on this one", and puts both hitboxes at x = 2 —
   * directly above him. So there is nothing to gain from extending forward and
   * everything to gain from getting the point high: the strike key runs the
   * whole arm chain to within 14° of vertical, which puts Falchion's point six
   * rig units clear of his own crown. That, not reach, is the silhouette.
   *
   * `first = 4` (frame 5) and `total = 55`, so the strike is at the seventh
   * percent of the action and almost everything here is what happens after the
   * sword: t 0 → f 0-3 the coil, 0.26 → f 4 the clean hit, 0.36 → f 11 the peak
   * arch, 0.55 → f 24, 0.78 → f 40.
   *
   * `ease: "in"` rather than `"hold"` on the coil: cubic-in puts frames 0-2 at
   * 0%, 1.6% and 12.5% — the same held shape to the eye — and frame 3 at 42%,
   * which is one breakdown drawing with the blade passing through horizontal,
   * exactly where "horizontally-to-vertically" puts it.
   *
   * `"linear"` on the two long spans, against this file's usual `smooth`: the
   * engine's `momentum` holds vy at 3.5 to frame 16 and gravity only decays it
   * to 0.575 by frame 55, so **he is still rising on the last drawn frame**.
   * The recovery is the stall SmashWiki describes, and it is drawn as energy
   * leaving him — the locked arm breaking at the elbow then the wrist, the
   * pointed toes slackening, the legs drifting apart, `offsetX` going negative
   * so he trails his own momentum. Smooth's zero derivative at a key would put a
   * freeze exactly where the move is at its most helpless.
   */
  upB: {
    loop: false,
    strike: 0.26,
    keys: [
      // The coil, drawn four times: down on the balls of the feet, torso
      // pitched over the front foot, Falchion swept low and forward.
      {
        t: 0,
        pose: P({
          hip: -6, torso: 20, head: -16,
          thighR: 136, shinR: 78, footR: -84,
          thighL: 150, shinL: 72, footL: -80,
          upperArmR: 172, forearmR: -52, handR: -10,
          upperArmL: 150, forearmL: -44, handL: -8,
        }),
        offsetX: 0.2,
        offsetY: -1.0,
        scaleX: 1.06,
        scaleY: 0.94,
        ease: "in",
      },
      // Move frame 5, the 11% clean hit. Blade 14° off vertical and a unit
      // forward of the centreline, agreeing with the hitbox's x = 2. Legs
      // snapped straight, toes pointed, on the exact frame the engine's
      // momentum takes him off the stage.
      {
        t: 0.26,
        pose: P({
          hip: -2, torso: -10, head: -10,
          thighR: 176, shinR: 4, footR: -34,
          thighL: 184, shinL: 2, footL: -30,
          upperArmR: 14, forearmR: 6, handR: 6,
          upperArmL: 238, forearmL: -26, handL: -6,
        }),
        offsetX: 0.4,
        offsetY: 0.8,
        scaleX: 0.9,
        scaleY: 1.18,
        ease: "out",
      },
      // Move frame 12, one past the late hitbox. The blade holds vertical
      // through the whole active window while the body keeps travelling —
      // spine arched, legs trailing, free arm at the bottom of its swing. The
      // longest line in the clip, toe to point.
      {
        t: 0.36,
        pose: P({
          hip: -4, torso: -16, head: -8,
          thighR: 194, shinR: -8, footR: -28,
          thighL: 202, shinL: -10, footL: -24,
          upperArmR: 20, forearmR: 2, handR: 0,
          upperArmL: 256, forearmL: -18, handL: -4,
        }),
        offsetX: 0.25,
        offsetY: 1.0,
        scaleX: 0.94,
        scaleY: 1.12,
        ease: "linear",
      },
      // Move frame 25. The scripted rise ended at 16 and gravity has been
      // eating it since; the pose gives way on the same beat.
      {
        t: 0.55,
        pose: P({
          hip: 0, torso: -2, head: 4,
          thighR: 178, shinR: 24, footR: -60,
          thighL: 190, shinL: 20, footL: -56,
          upperArmR: 24, forearmR: -18, handR: -14,
          upperArmL: 292, forearmL: 14, handL: 4,
        }),
        offsetX: 0.05,
        offsetY: 0.5,
        scaleX: 0.98,
        scaleY: 1.05,
      },
      // Move frame 41. The stall: head down, legs hanging apart, the free arm
      // out of momentum, the blade tipped behind vertical — held up, but no
      // longer held out.
      {
        t: 0.78,
        pose: P({
          hip: 2, torso: 6, head: 10,
          thighR: 168, shinR: 36, footR: -70,
          thighL: 198, shinL: 32, footL: -66,
          upperArmR: 28, forearmR: -30, handR: -20,
          upperArmL: 272, forearmL: 26, handL: 8,
        }),
        offsetX: -0.1,
        offsetY: 0.15,
        ease: "linear",
      },
      { t: 1,
        pose: P({
          hip: 5, torso: 10, head: 14,
          thighR: 160, shinR: 46, footR: -78,
          thighL: 206, shinL: 42, footL: -74,
          upperArmR: 34, forearmR: -46, handR: -26,
          upperArmL: 256, forearmL: 34, handL: 10,
        }),
        offsetX: -0.2,
        scaleY: 0.98,
      },
    ],
  },
};
