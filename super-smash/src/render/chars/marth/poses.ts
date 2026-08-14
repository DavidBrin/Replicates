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
   * The standing loop, and the pose a player looks at more than any other.
   *
   * ## What the shared clip does to a five-unit blade
   *
   * The library's `idle` hangs both arms straight down — `upperArmR: 162.5`
   * with `forearmR: +21.7`, which accumulates to a blade direction of **190°**.
   * That is fine for a fist and catastrophic for Falchion: the arm is 4.73 rig
   * units and the blade 5.3, so 190° puts the drawn point at world
   * **(−0.7, −0.3)** — behind his heel and *under the stage*. Every frame he
   * spends not attacking, Marth is standing on his own sword.
   *
   * It is the same failure Samus's agent found — the shared arm angle laying her
   * cannon across her hips — and it presents differently here only because
   * Falchion is long rather than wide. A wide prop makes a slab; a long one
   * makes a walking stick, and a walking stick planted in the floor is what a
   * man leaning on a cane looks like, not a fencer.
   *
   * ## The stance, measured rather than invented
   *
   * The numbers here come from SmashWiki's own idle GIFs, read off frame by
   * frame as fractions of his height (head-top 0.00, sole 1.00):
   *
   * - **Upright.** Spine essentially vertical, no forward lean, head level.
   *   `torso` breathes around 3° where the shared clip sits at 5.5. The
   *   readiness is in the sword, not in a crouch.
   * - **The sword hand hangs.** Arm nearly straight — the elbow barely broken at
   *   12° — with the grip at 0.53 of his height, i.e. **upper thigh**, a little
   *   forward of the leg. World (1.2, 5.8) here. Note that this is *below* the
   *   belt, which matters for more than accuracy: with the hand at waist height
   *   the gold crossguard sat exactly on the gold belt and the two merged into
   *   one bar across his middle.
   * - **The blade is nearly vertical.** Measured at **27° off straight down**,
   *   canted forward; this clip carries it at 32°, A ≈ 148°, putting the point
   *   at about world (4.7, 0.7) — forward of his front shin, crossing in front
   *   of it, and hovering just clear of the stage where the reference has it at
   *   ankle height. An intermediate pass sat at 46° off vertical and a critic
   *   given a match capture measured it at "45.0 degrees from horizontal — he
   *   isn't resting, he's presenting", which is exactly right: at that angle the
   *   frame reads as the middle of a swing. The blade crossing the leg mass also
   *   matters on its own, because an overlap is what makes a weapon read as
   *   *held* rather than as hardware bolted to the hip.
   * - **The feet are barely staggered.** "Roughly shoulder-width, both flat,
   *   only slightly staggered — *not* a wide fencer's lunge; every attack drops
   *   him into a split lunge and the idle deliberately doesn't." Twenty-four
   *   degrees between the thighs, which is a compromise: an earlier pass had
   *   thirty-two and read as a man permanently about to fence, and nineteen was
   *   faithful but left the two legs one shape at match scale.
   * - **The free hand hangs**, relaxed at his side — but a third of a right
   *   angle behind vertical (33° at the settle) rather than straight down. That
   *   is a deliberate step away from the reference and it buys the arm's
   *   existence. His torso is 2.74 rig units thick, the arm is 4.73 long, and
   *   the far limbs are drawn *before* the torso; hung straight down in a strict
   *   profile the whole arm is inside the torso's own silhouette and Marth has
   *   one arm. Twenty-two degrees, which is the library's own rest angle, was
   *   still invisible. Thirty-three puts the forearm and the dark gauntlet clear
   *   of the hip and onto the crimson of the cape, where they read as an arm and
   *   not — as an earlier pass with a pale, near-white hand did — as an
   *   unidentifiable bright block at his waist.
   *
   * Both feet are planted, so each foot angle is `92 − hip − thigh − shin`
   * rather than the library's hanging −88: the library points the far foot down
   * because in most of its clips that foot is in the air.
   *
   * ## The breath
   *
   * Same construction as the shared clip and for the same reasons — four keys at
   * uneven times so nothing turns round at the same moment, only the inhale
   * cushioned so the exhale is not three dead frames, thighs subtracting the
   * pelvis tilt so a rocking hip does not skate the feet, and a knee bending
   * `shin += d, thigh −= d/2` so the ankle stays where it was.
   *
   * Two things are Marth's rather than inherited. The period is **92** against
   * the shared 108: he is the lightest, quickest fighter here and a slower
   * breath than everyone else's read as sedated. And the amplitude is small on
   * purpose — the reference traces three pixels of head travel on a 290-pixel
   * figure, about 1% of height, so at match scale this is a one-pixel bob. The
   * blade's own direction moves 5° across the cycle — deliberately *more*
   * excursion at the point than at the head, not less. A critic measured the
   * previous version at 3px of head travel against under 1px at the blade and
   * called it right: a sword hanging off a relaxed arm is a pendulum, and one
   * that is stiller than the chest carrying it reads as nailed to the world.
   * The 5° is spent almost entirely in `handR`, so the arm keeps hanging and it
   * is the wrist that gives.
   *
   * The cape is not keyed here at all. It is a `custom` prop with its own clock
   * (see `rig.ts`), drifting on a 115-frame cycle deliberately prime to this
   * one, so the two never lock into a single visible beat.
   */
  idle: {
    loop: true,
    period: 92,
    keys: [
      // The settle at the end of the exhale: chest low, weight on the far leg,
      // the point at the near end of its swing.
      {
        t: 0,
        pose: P({
          hip: 0.6, torso: 4.2, head: -3.4,
          thighR: 167.4, shinR: 7.0, footR: -83.0,
          thighL: 191.4, shinL: 1.0, footL: -101.0,
          upperArmR: 178, forearmR: -26, handR: -5.8,
          upperArmL: 208.6, forearmL: -10.0,
        }),
        offsetY: 0.02,
        scaleY: 1.0,
      },
      // Top of the inhale. The rise is mostly `scaleY`, which stretches about
      // the feet and leaves the soles on the floor where `offsetY` would lift
      // them.
      {
        t: 0.32,
        pose: P({
          hip: 0.0, torso: 1.8, head: -2.4,
          thighR: 167.25, shinR: 8.5, footR: -83.75,
          thighL: 192.75, shinL: -0.5, footL: -100.25,
          upperArmR: 178, forearmR: -26, handR: -7.8,
          upperArmL: 206.0, forearmL: -13.0,
        }),
        offsetY: 0.1,
        scaleY: 1.018,
        ease: "linear",
      },
      // The head arrives late — still coming up as the chest starts down. Weight
      // has crossed to the near leg and that knee is at its softest.
      {
        t: 0.57,
        pose: P({
          hip: -0.6, torso: 3.0, head: -5.6,
          thighR: 166.6, shinR: 11.0, footR: -85.0,
          thighL: 194.6, shinL: -3.0, footL: -99.0,
          upperArmR: 178, forearmR: -26, handR: -7.4,
          upperArmL: 203.6, forearmL: -11.5,
        }),
        offsetY: 0.05,
        scaleY: 1.008,
        ease: "linear",
      },
      // Lowest point of the cycle, a hair under key 0, so the last span is a
      // small recovery into the settle rather than a fourth extreme.
      {
        t: 0.79,
        pose: P({
          hip: 0.2, torso: 4.6, head: -4.0,
          thighR: 166.55, shinR: 9.5, footR: -84.25,
          thighL: 193.05, shinL: -1.5, footL: -99.75,
          upperArmR: 178, forearmR: -26, handR: -6.3,
          upperArmL: 206.2, forearmL: -9.2,
        }),
        offsetY: 0.0,
        scaleY: 0.997,
        ease: "linear",
      },
    ],
  },

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
   *   t 0.42  → f 16   the blade plants at the ground in front, body still low
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
   * A runs 312° → 108° → 165° → 128°. The first span is the swing: 156° of
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
      // The blade does not stop where the hitbox does — it **plants**. The
      // reference is specific: overhead at f10, horizontal at head height at
      // f11, angled down-forward at f12, and "planted at the ground in front of
      // him at f13", with the body very low by then. Round one stopped the blade
      // at A = 143°, halfway, and stood him back up; this carries it to 165° and
      // keeps him down, which is what makes the swing read as one chop "from his
      // head to the ground" rather than as a swipe that ran out of energy.
      {
        t: 0.42,
        pose: P({
          hip: -4, torso: 20, head: -12,
          thighR: 130, shinR: 40, footR: -84,
          thighL: 224, shinL: 34, footL: -70,
          upperArmR: 140, forearmR: 10, handR: 3,
          upperArmL: 214, forearmL: -46,
        }),
        offsetX: 0.5,
        offsetY: -0.9,
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
   * Up Smash — a **pure vertical thrust**, not a scoop.
   *
   * ## What round one got wrong, and why the data misled it
   *
   * `fighters/marth.ts` gives this move a third hitbox at world (2, **2**) — an
   * ankle-height box live for two frames that launches grounded opponents at
   * 125°. Round one read that as a blade scooping off the floor in front of him
   * and authored 135° of arc from a low forward blade up to vertical. The
   * official hitbox visualisation says otherwise: that low box is a *body*-
   * anchored capsule on the `top` bone with a radius of 5.5, sitting around his
   * feet, whose job is to drag a nearby opponent up into the stab. It is not a
   * blade position at all.
   *
   * SmashWiki: "A quick, upward thrust based on a pose Marth does many times in
   * his games." Frame by frame: f4-f10 he **coils down into a deep crouch, free
   * hand thrust out in front, sword dropped low behind**; at f13 he thrusts
   * Falchion **straight up, dead vertical, one-handed, arm fully extended
   * overhead — no arc at all** — with the legs snapping into a fencer's split
   * lunge and the torso leaning slightly back under the raised arm; and the
   * sword is **held overhead through f19-f28** before it comes down.
   *
   * So all three of the wind-up, the leg shape and the hold changed. The blade
   * still travels — A runs 230° → 5°, 135° of it — but it travels *up his back*
   * rather than up through the front, which is what a shoulder does when a hand
   * starts behind the hip and finishes overhead. 230 → 5 is 135° the short way,
   * so the interpolator takes that path on its own and no breakdown key is
   * needed to force it.
   *
   * The free hand thrown forward in the crouch is the pose's other signature and
   * costs nothing: `upperArmL: 95` is an arm straight out in front, and it reads
   * against the deep crouch as a man about to launch.
   *
   * `first = 12` (frames 13-17) and `total = 58`, `strike = 0.3`.
   *
   *   t 0     → f 0    the crouch, free hand forward, blade low behind
   *   t 0.3   → f 12   contact: split lunge, blade dead vertical overhead
   *   t 0.42  → f 20   still overhead
   *   t 0.53  → f 28   still overhead — the last frame the reference holds it
   *   t 0.72  → f 40   coming down
   *
   * The tip hitbox at y = 17 sits about two-thirds of the way along a fully
   * raised blade rather than at its point. That is not a mistake to be fixed by
   * shortening the arm: the alternative is a bent elbow at the contact frame,
   * and a bent elbow on a vertical thrust reads as a shrug.
   */
  usmash: {
    loop: false,
    strike: 0.3,
    keys: [
      // The crouch. Held for twelve frames uncharged and up to sixty charged,
      // so it is drawn as a pose: weight down, both knees folded, free hand
      // thrust out in front, Falchion dropped low and raked back behind him.
      {
        t: 0,
        pose: P({
          hip: 6, torso: 16, head: -14,
          thighR: 138, shinR: 72, footR: -84,
          thighL: 146, shinL: 68, footL: -82,
          upperArmR: 222, forearmR: -22, handR: 8,
          upperArmL: 95, forearmL: -10,
        }),
        offsetY: -1.3,
        scaleY: 0.94,
        ease: "in",
      },
      // Contact. A fencer's split lunge — front knee bent, back leg driven
      // straight out behind — with the spine long, the torso leaning back under
      // the arm, and the blade dead vertical a shade forward of the centreline,
      // matching the hitboxes' x = 1.0-1.5.
      {
        t: 0.3,
        pose: P({
          hip: -2, torso: -10, head: 10,
          thighR: 150, shinR: 30, footR: -72,
          thighL: 216, shinL: 8, footL: -60,
          upperArmR: 13, forearmR: 4, handR: 0,
          upperArmL: 300, forearmL: 20,
        }),
        offsetY: 0.1,
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
          hip: -2, torso: -10, head: 10,
          thighR: 150, shinR: 30, footR: -72,
          thighL: 216, shinL: 8, footL: -60,
          upperArmR: 13, forearmR: 4, handR: 0,
          upperArmL: 300, forearmL: 20,
        }),
        offsetY: 0.1,
        scaleY: 1.1,
        scaleX: 0.94,
      },
      // Move frame 20. Still overhead. Round one sent the blade past vertical
      // and tipped it behind here, as an overshoot; the reference holds it up,
      // and a thrust that overshoots is a swing. What gives instead is the
      // lunge — the front knee takes the weight and the spine comes back to
      // level.
      {
        t: 0.42,
        pose: P({
          hip: 0, torso: -6, head: 8,
          thighR: 154, shinR: 26, footR: -76,
          thighL: 210, shinL: 12, footL: -66,
          upperArmR: 8, forearmR: 2, handR: 0,
          upperArmL: 306, forearmL: 16,
        }),
        offsetY: 0.04,
        scaleY: 1.06,
        scaleX: 0.96,
      },
      // Move frame 28, the last frame the reference still has the sword up.
      {
        t: 0.53,
        pose: P({
          hip: 2, torso: 0, head: 4,
          thighR: 160, shinR: 22, footR: -82,
          thighL: 202, shinL: 16, footL: -74,
          upperArmR: 2, forearmR: -6, handR: 0,
          upperArmL: 292, forearmL: 10,
        }),
        offsetY: -0.1,
        scaleY: 1.02,
      },
      // …and only now does it come down, across the front.
      {
        t: 0.72,
        pose: P({
          hip: 2, torso: 6, head: 0,
          thighR: 158, shinR: 22, footR: -84,
          thighL: 198, shinL: 20, footL: -80,
          upperArmR: 96, forearmR: -22, handR: -8,
          upperArmL: 250, forearmL: -2,
        }),
        offsetY: -0.2,
      },
      {
        t: 1,
        pose: P({
          torso: 5,
          upperArmR: 166, forearmR: -16, handR: -20,
          upperArmL: 202, forearmL: -18,
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
      // …and round. SmashWiki calls the second hit "a full 360° outward spin",
      // and the two encoded windows only cover the half of it that hits: the
      // recovery is where the blade finishes the circle, up behind him, over the
      // top and back to the front. Stopping it behind him left the move a
      // swipe-and-a-swipe rather than a spin.
      {
        t: 0.72,
        pose: P({
          torso: -2,
          thighR: 190, shinR: 34, footR: -70,
          thighL: 204, shinL: 32, footL: -68,
          upperArmR: 338, forearmR: -10, handR: 0,
          upperArmL: 180, forearmL: -22,
        }),
      },
      { t: 1, pose: P({ torso: 2, upperArmR: 58, forearmR: -20, upperArmL: 198, forearmL: -24 }) },
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
   * Shield Breaker — a stab, not a swing, and a *lunge*, not a lean-back.
   *
   * This is the move most likely to be drawn wrong from memory, because it
   * changed. SmashWiki: in Melee it was "an overhead vertical slash with a
   * large arc"; from Brawl onward "it has become a single powerful stab", and
   * SmashWiki phrases the Ultimate animation as "Marth assumes a readying
   * stance and charges Falchion **at chest level** before powerfully thrusting
   * it forward". The hitbox table agrees — `effect: "stab"`, a narrow tip/body
   * pair at chest height and nothing else.
   *
   * ## What round one got wrong
   *
   * The chamber was authored **leaning back** — `torso: -22`, weight rocked
   * onto the rear foot — from the SmashWiki line about the Fire Emblem original,
   * where Marth "leans back and stabs". That is the *Mystery of the Emblem*
   * sprite, not this animation. Stepping the official hitbox visualisation frame
   * by frame gives the opposite: a deep, wide, **forward**-leaning crouch, front
   * knee bent hard, rear leg extended straight back, torso pitched low over the
   * front knee, and the sword arm cocked with the hilt beside the rear shoulder
   * and the blade running forward and slightly **above** horizontal — a javelin
   * about to be thrown, not a man recoiling. It is held for up to sixty frames,
   * so it is the pose the move mostly *is*.
   *
   * So the chamber sits at A = 78° with the hilt at world (1.0, 9.4) — beside
   * the chest, where the wiki puts it — and the point out at (7.0, 10.7), above
   * the line the thrust will travel. The travel is then almost all in the
   * shoulder: `upperArmR` goes 234° → 92°, a hundred and forty degrees, while
   * the blade's own direction moves 78° → 108°. That is what a thrust is, and
   * drawing it as an arc would be drawing the Melee move.
   *
   * ## The hold
   *
   * The other correction. A fencing lunge does not recoil: the visualisation
   * shows him reach full extension in about three frames and then **stay there
   * for twenty-odd**, drawing slowly back up over the last stretch. Round one
   * had the point dropping by frame 24 and the weight recovered by 33, which
   * turned the longest commitment in his kit into a poke. Keys at `t: 0.5` and
   * `t: 0.7` — move frames 26 and 36 — now hold the extension out and only then
   * let it come back.
   *
   * `first = 18` (frames 19-20) and `total = 50`, `strike = 0.3`.
   *
   *   t 0     → f 0    the charge crouch — held up to sixty frames
   *   t 0.3   → f 18   the lunge, arm and blade one straight line
   *   t 0.5   → f 26   still out
   *   t 0.7   → f 36   the draw-back begins
   *   t 0.88  → f 44   nearly recovered
   *
   * Charge freezes at `strike * 0.55 = 0.165`, and `ease: "in"` out of key 0
   * makes that 17% of the way to the thrust — so the chamber is what a charging
   * Marth is drawn as, which is why it is authored as a finished pose.
   *
   * At the thrust `hip + torso = 16` and `upperArmR: 92` with a straight elbow
   * and wrist, so A = 108° and the drawn point lands at world (12.2, 6.8),
   * within 1.4 of the tipper sphere at (11, 7.5) — inside its 2.4 radius. The
   * body cannot lean any further than this: another ten degrees of torso is
   * another world unit of shoulder, and the point leaves the hitbox it is
   * supposed to be selling.
   */
  neutralB: {
    loop: false,
    strike: 0.3,
    keys: [
      {
        t: 0,
        pose: P({
          hip: -8, torso: 30, head: -22,
          thighR: 128, shinR: 58, footR: -88,
          thighL: 214, shinL: 6, footL: -64,
          upperArmR: 234, forearmR: -134, handR: -44,
          upperArmL: 250, forearmL: -24,
        }),
        offsetX: -0.5,
        offsetY: 0.2,
        ease: "in",
      },
      // The lunge. Front leg driven far forward, rear leg trailing dead
      // straight, torso pitched over the front knee, and the sword arm fully
      // extended so that shoulder, hand and point are one line.
      {
        t: 0.3,
        pose: P({
          hip: -10, torso: 26, head: -20,
          thighR: 120, shinR: 30, footR: -56,
          thighL: 232, shinL: 18, footL: -52,
          upperArmR: 92, forearmR: 0, handR: 0,
          upperArmL: 108, forearmL: -12,
        }),
        offsetX: 0.25,
        offsetY: -0.5,
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
          hip: -10, torso: 26, head: -20,
          thighR: 120, shinR: 30, footR: -56,
          thighL: 232, shinL: 18, footL: -52,
          upperArmR: 92, forearmR: 0, handR: 0,
          upperArmL: 108, forearmL: -12,
        }),
        offsetX: 0.25,
        offsetY: -0.5,
        scaleX: 1.05,
      },
      // Move frame 26, and still out there. The only things that move across
      // this span are the free arm settling and two degrees of shoulder — a
      // lunge held is the whole read of the move's commitment, and the frames
      // that sell it are the ones after the hitbox has gone.
      {
        t: 0.5,
        pose: P({
          hip: -10, torso: 25, head: -18,
          thighR: 121, shinR: 31, footR: -57,
          thighL: 231, shinL: 19, footL: -53,
          upperArmR: 96, forearmR: 2, handR: 0,
          upperArmL: 128, forearmL: -22,
        }),
        offsetX: 0.3,
        offsetY: -0.48,
        scaleX: 1.05,
      },
      // Move frame 36. The draw-back: the elbow breaks first and the weight
      // comes off the front foot, the point still the last thing to leave.
      {
        t: 0.7,
        pose: P({
          hip: -6, torso: 18, head: -12,
          thighR: 130, shinR: 28, footR: -70,
          thighL: 220, shinL: 22, footL: -64,
          upperArmR: 118, forearmR: -14, handR: 0,
          upperArmL: 156, forearmL: -32,
        }),
        offsetX: 0.2,
        offsetY: -0.3,
        scaleX: 1.02,
      },
      {
        t: 0.88,
        pose: P({
          hip: -2, torso: 10, head: -4,
          thighR: 148, shinR: 20, footR: -82,
          thighL: 204, shinL: 16, footL: -78,
          upperArmR: 142, forearmR: -26, handR: -2,
          upperArmL: 184, forearmL: -26,
        }),
        offsetX: 0.08,
      },
      {
        t: 1,
        pose: P({ torso: 5, upperArmR: 162, forearmR: -32, handR: -4, upperArmL: 198, forearmL: -20 }),
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
   * A runs 215° → 126° → 60° → 0° → 300° → 234° → 260°. The sweep between the
   * two hits goes **over the top** — see the keys — which is what the reference
   * shows and what keeps the point out of the floor.
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
      // Between the two sweeps the blade goes **over the top**, not under.
      //
      // Round one took it down through his own feet — 108° the short way from
      // 126° to 234° — on the grounds that no other move in the roster travels
      // that arc. It doesn't, and neither does this one: the reference has him
      // "pivot his torso and carry the blade back around over/behind" across
      // frames 9-19, and the under path also has to be fudged (elbow folded 46°,
      // body raised a unit) to stop the point disappearing four units below the
      // stage in the middle of the move. Over the top needs no fudge, and it is
      // the shape that reads — a blade that leaves the floor, goes up past his
      // own head and comes down behind is legible in a way that a point buried
      // under his boots never was.
      //
      // It takes three keys because the interpolator picks the short way and
      // 126° → 234° *is* the short way under. Stepping the chain round — 126° →
      // 60° → 0° → 300° → 234°, every span decreasing — is how a chain of keys
      // expresses a turn a single pair cannot. He stays in the low kneeling
      // crouch for all of it, which the reference is explicit about.
      {
        t: 0.37,
        pose: P({
          hip: -4, torso: 16, head: -10,
          thighR: 132, shinR: 82, footR: -80,
          thighL: 140, shinL: 78, footL: -78,
          upperArmR: 66, forearmR: -14, handR: -4,
          upperArmL: 200, forearmL: -44,
        }),
        offsetY: -1.9,
        offsetX: 0.1,
        scaleX: 1.08,
        scaleY: 0.9,
      },
      {
        t: 0.426,
        pose: P({
          hip: 0, torso: 6, head: -2,
          thighR: 134, shinR: 84, footR: -82,
          thighL: 142, shinL: 80, footL: -80,
          upperArmR: 6, forearmR: -8, handR: -4,
          upperArmL: 214, forearmL: -40,
        }),
        offsetY: -2.0,
        scaleX: 1.04,
        scaleY: 0.88,
      },
      {
        t: 0.468,
        pose: P({
          hip: 4, torso: -4, head: 6,
          thighR: 136, shinR: 86, footR: -80,
          thighL: 142, shinL: 82, footL: -78,
          upperArmR: 306, forearmR: -8, handR: 2,
          upperArmL: 176, forearmL: -36,
        }),
        offsetY: -2.05,
        offsetX: -0.1,
        scaleX: 1.08,
        scaleY: 0.88,
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
   *   t 0.43  → f 16   the arm carried across, blade still forward
   *   t 0.76  → f 30   the tell — gathered, still loaded
   *
   * At contact the arm and blade are one straight line: the hand sits at 5.95
   * rig units forward and the point at 11.28, against `BODY_REACH = 6.0` and
   * `TIP_REACH = 11.0`. The two hitboxes land on the hilt and on the point
   * respectively, which is the geometry the whole character is about.
   *
   * `upperArmR` and `forearmR` travel 227° between the coil and contact. That is
   * the difference from Fox's snap: distance, not speed.
   *
   * ## What a profile cannot draw
   *
   * The reference calls stage one a **flat horizontal slash at chest height** —
   * all three of its real hitboxes sit at y = 9.0 and sweep across his front.
   * A strict side-on view has no way to show a sweep that travels into the
   * screen, so what is drawn is the half of the motion that is in plane: the
   * blade coming from low behind, up over the rear shoulder, and out. The
   * *hitbox* honesty is intact — this repo's `sideB` puts its pair at (11, 7.5)
   * and (6, 7.5), chest height, which is where the contact key puts the point
   * and the hilt — but the horizontal component is a limitation of the view and
   * not something a better clip would fix.
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
      // The swing carries past the hitbox rather than stopping in it — and it
      // carries **across**, not up. The reference finishes stage one "leaning
      // forward with the arm carried across"; round one raised the blade to
      // vertical here, which is a different move's follow-through and, worse,
      // reads as the end of a swing rather than the middle of a string.
      {
        t: 0.43,
        pose: P({
          torso: 20, head: -12, hip: -4,
          thighR: 151, shinR: 18, footR: -77,
          thighL: 197, shinL: 41, footL: -108,
          upperArmR: 70, forearmR: -40, handR: 6,
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
   * retains the same stance and attack animation as in SSB4". The official
   * visualisation fills that in: he pivots the torso away over frames 1-4 and
   * settles by frame 6-7 into a **bent-kneed crouch, weight low**, sword arm
   * drawn across the body, blade slanting **down and back** past the leading
   * hip, cape swept forward. He holds that, breathing, for the whole 64 frames
   * if nothing triggers it.
   *
   * Round one had two of those wrong. It authored the guard standing — knees all
   * but straight — where the reference crouches; and it put the point **out low
   * and forward** where the reference rakes it down and *back*. The rig cannot
   * flip Falchion into a reverse grip, since the prop always leaves the hand
   * along `handR`, so what is built is the silhouette that grip makes: hand
   * across the body near the centreline, blade running down and behind to a
   * point near the stage at (−3.1, 0.6) world.
   *
   * ## The strike key is the guard, not the cut
   *
   * `first = 3`, `total = 64`. The single hitbox is the *returned* strike and the
   * schema has nowhere to put it but frames 4-6, three frames in — and there is
   * no counter mechanic in the engine, so a player simply sees 64 frames of a
   * defensive move. Anchoring the cut there would put a fully committed slash on
   * frame 4 and then sixty dead frames. So `strike = 0.08` names the moment the
   * **guard forms**, which lands it on actionFrame 3, and the rest stretches
   * over frames 3..63 as `f = 3 + (t − 0.08)/0.92 × 61`:
   *
   *   t 0     → f 0    still nearly his stance, blade starting back
   *   t 0.08  → f 3    the guard — the strike key, held
   *   t 0.43  → f 26   the load, one frame before the window closes
   *   t 0.578 → f 36   the counter-slash at full extension, stepping in
   *   t 0.698 → f 44   …and still there
   *   t 0.85  → f 55   only now does he rise
   *
   * `hold` on the guard keeps that pose to the exact degree from actionFrame 3
   * to 26 — move frames 4-27, the documented window — and then cuts. Easing
   * instead would rotate the blade a slow visible 16° through the window and
   * stop it being one shape.
   *
   * The other correction from the reference is the **hold after the cut**: "he
   * then holds a deep low lunge with the blade extended horizontally forward for
   * ~20 frames before standing back up". Round one had him recovered by f44.
   *
   * The honest gap remains: on the frames the hitbox is actually live the fighter
   * is in the guard, and the guard's blade does not cover the encoded hitbox at
   * (7, 7.5). The blade covers it at frame 37 instead. That is the price of the
   * move having no counter mechanic to hang its two halves on.
   */
  downB: {
    loop: false,
    strike: 0.08,
    keys: [
      // Frames 0-2. Barely out of his stance — the reference pivots the torso
      // away across frames 1-4, so this is the first degree of that, with the
      // blade already starting to rake back. `in`, so the three startup frames
      // sit still and the guard arrives as a snap; a counter that eased into
      // position would not be a counter.
      {
        t: 0,
        pose: P({
          hip: 2, torso: 0, head: -2,
          thighR: 170, shinR: 10, footR: -90,
          thighL: 190, shinL: 4, footL: -102,
          upperArmR: 176, forearmR: -12, handR: -6,
          upperArmL: 196, forearmL: -16,
        }),
        offsetX: -0.15,
        ease: "in",
      },
      // The guard. Torso turned away and leaning back, knees genuinely bent and
      // the weight down, head brought back so he is still watching; the sword
      // hand drawn across to the centreline and the blade slanting down and back
      // past the near hip, point near the stage behind him. Free arm trailing so
      // it does not cross the blade.
      {
        t: 0.08,
        pose: P({
          hip: 4, torso: -16, head: 14,
          thighR: 148, shinR: 46, footR: -82,
          thighL: 156, shinL: 42, footL: -86,
          upperArmR: 132, forearmR: 80, handR: 10,
          upperArmL: 244, forearmL: -30,
        }),
        offsetX: -0.3,
        offsetY: -1.0,
        scaleY: 0.95,
        ease: "hold",
      },
      // The load, one frame before the window closes: the hand goes back past
      // the hip and the point drops further behind, the free arm swings forward
      // to counter-rotate, the weight sinks onto the back leg.
      {
        t: 0.43,
        pose: P({
          hip: 8, torso: -26, head: 22,
          thighR: 140, shinR: 52, footR: -80,
          thighL: 150, shinL: 48, footL: -84,
          upperArmR: 150, forearmR: 74, handR: 8,
          upperArmL: 130, forearmL: -40,
        }),
        offsetX: -0.6,
        offsetY: -1.1,
        scaleX: 0.97,
        scaleY: 0.94,
        ease: "in",
      },
      // The counter-slash at full extension, and he **steps in**: a deep low
      // forward lunge with the blade swept outward and up. Counter is the one
      // move with no tipper — all four of its real hitboxes are identical, and
      // they hug the arm and the inner half of the blade — so the contact is the
      // body of the blade at mid reach with his whole weight behind it, not a
      // point poke at TIP_REACH.
      {
        t: 0.578,
        pose: P({
          hip: -6, torso: 24, head: -16,
          thighR: 138, shinR: 40, footR: -70,
          thighL: 226, shinL: 20, footL: -70,
          upperArmR: 88, forearmR: -8, handR: 2,
          upperArmL: 222, forearmL: -56,
        }),
        offsetX: 0.95,
        offsetY: -0.7,
        scaleX: 1.06,
        ease: "out",
      },
      // Move frame 44, and still out there. The reference holds this lunge for
      // about twenty frames; the blade levels off forward and nothing else
      // moves.
      {
        t: 0.698,
        pose: P({
          hip: -4, torso: 20, head: -12,
          thighR: 140, shinR: 40, footR: -72,
          thighL: 224, shinL: 22, footL: -72,
          upperArmR: 96, forearmR: -2, handR: 2,
          upperArmL: 214, forearmL: -48,
        }),
        offsetX: 0.95,
        offsetY: -0.65,
        scaleX: 1.05,
      },
      // Move frame 55. Only now does he come up out of it.
      {
        t: 0.85,
        pose: P({
          hip: -2, torso: 12, head: -6,
          thighR: 150, shinR: 30, footR: -80,
          thighL: 212, shinL: 18, footL: -78,
          upperArmR: 116, forearmR: -16, handR: 0,
          upperArmL: 200, forearmL: -38,
        }),
        offsetX: 0.6,
        offsetY: -0.35,
      },
      // Terminator, on the idle's own carry so the blend home has ten degrees to
      // travel rather than a hundred and eighty.
      {
        t: 1,
        pose: P({
          hip: 0.4, torso: 3, head: -3,
          thighR: 167, shinR: 8, footR: -84,
          thighL: 192, shinL: 2, footL: -100,
          upperArmR: 176, forearmR: -24, handR: -6,
          upperArmL: 196, forearmL: -16,
        }),
      },
    ],
  },

  /**
   * Dolphin Slash — a frame-5 rising sword, and fifty frames of hanging.
   *
   * ## The order of operations, which round one had backwards
   *
   * Stepping the official hitbox visualisation frame by frame: f1 standing with
   * the blade low and back; **f2-f3 a deep crouch with the blade swept down and
   * behind, near the ground, arm cocked**; f4 the upward whip begins; **f5 the
   * clean hit lands while he is still grounded and low**; f6 he leaves the
   * ground; f7 onward airborne with the blade already overhead. So he swings
   * *then* rises, and the strike frame is a crouched man with a sword going up,
   * not an airborne one with a sword already up. Round one drew the strike key
   * with the legs snapped straight and `offsetY: 0.8` — the apex pose, eleven
   * frames early.
   *
   * At the apex the body is **upright and straight**: legs together and slightly
   * trailing, off-hand out, blade vertical overhead, held that way through the
   * whole ascent. Not arched. From roughly f21-f27 he **tucks** — knees drawn
   * up, torso curled forward, sword arm folded down across the body — and then
   * "will slowly stall in the air until they start falling", helpless, arms out
   * and legs splayed.
   *
   * ## The wind-up goes behind, and that is not a windmill
   *
   * Round one authored the coil with the blade low and *forward*, on the
   * reasoning that a blade at 200° lerps the short way backwards through 270°
   * and produces a windmill. The reference is unambiguous that the coil is
   * behind him — and the backwards path is not a windmill, it is a shoulder. A
   * hand starting behind the hip and finishing overhead travels back and up;
   * that is the natural arc, and 228° → 26° is 158° the short way, so the
   * interpolator takes it without a breakdown key.
   *
   * `marth.ts` says of this move, "No tipper on this one", and puts both
   * hitboxes at x = 2 — directly above him. So there is nothing to gain from
   * extending forward and everything to gain from getting the point high.
   *
   * `first = 4` (frame 5) and `total = 55`:
   *
   *   t 0     → f 0-3  the coil, deep and low, blade raked down behind
   *   t 0.26  → f 4    the clean hit — **still grounded**, blade whipping up
   *   t 0.36  → f 11   the apex attitude: straight, legs together, blade vertical
   *   t 0.53  → f 24   the tuck
   *   t 0.78  → f 42   the stall
   *
   * `"linear"` on the long spans, against this file's usual `smooth`: smooth's
   * zero derivative at a key puts a freeze exactly where the move is at its most
   * helpless, and this clip has two long spans that would each get one.
   *
   * ## He does not actually rise, and that is not this file's doing
   *
   * Round one's version of this comment asserted that `momentum` holds vy at 3.5
   * to frame 16 "so he is still rising on the last drawn frame". A critic
   * measured a match capture and said flatly that he never leaves the ground; I
   * assumed a capture artefact — the sheet re-centres on the fighter every cell
   * — and checked the simulation instead. **`y` is 0.00 on every one of the 55
   * frames.** The data is right (`momentum: [{ frame: 5, y: 3.5, hold: 11 }]`)
   * and `applyMoveMomentum` does set `vy`, but `resolveCollision` in
   * `physics.ts` then runs its "already standing on something" branch, whose
   * only question is whether the fighter has walked off the *side* of the
   * platform: still over it, so `f.y = p.y; f.vy = 0`. A grounded fighter with a
   * scripted upward impulse is pinned to the floor, every frame, and Dolphin
   * Slash is the move that most obviously needs not to be.
   *
   * That is engine physics and shared, so it is reported rather than fixed here.
   * What it means for this clip is that the ascent it is drawn to accompany is
   * currently invisible: the poses still describe a rise — that is what the move
   * is — and they will read correctly the moment the fighter is allowed to move.
   * Do not "fix" this by drawing him higher with `offsetY`; the shadow and the
   * port ring are drawn at the fighter's real position and he would come apart
   * from both.
   */
  upB: {
    loop: false,
    strike: 0.26,
    keys: [
      // The coil, drawn four times: down on the balls of the feet, torso over
      // the front knee, Falchion swept down and back until the point is nearly
      // on the stage behind him. `ease: "in"` puts frames 0-2 at 0%, 1.6% and
      // 12.5% — the same held shape to the eye — and frame 3 at 42%, which is
      // one breakdown drawing with the blade already halfway up.
      {
        t: 0,
        pose: P({
          hip: 4, torso: 16, head: -14,
          thighR: 136, shinR: 78, footR: -84,
          thighL: 150, shinL: 72, footL: -80,
          upperArmR: 216, forearmR: -14, handR: 6,
          upperArmL: 130, forearmL: -30, handL: -8,
        }),
        offsetX: 0.1,
        offsetY: -1.0,
        scaleX: 1.06,
        scaleY: 0.94,
        ease: "in",
      },
      // Move frame 5, the 11% clean hit — and he is **still on the ground**.
      // Knees only half out of the crouch, torso barely past vertical, the whole
      // of the move so far in the arm: 158° of blade in four frames.
      {
        t: 0.26,
        pose: P({
          hip: -2, torso: 2, head: -8,
          thighR: 142, shinR: 56, footR: -80,
          thighL: 156, shinL: 50, footL: -78,
          upperArmR: 14, forearmR: 6, handR: 6,
          upperArmL: 238, forearmL: -26, handL: -6,
        }),
        offsetX: 0.3,
        offsetY: -0.1,
        scaleY: 1.06,
        ease: "out",
      },
      // Move frame 12, one past the late hitbox, and the shape he holds for the
      // whole ascent: upright and straight, legs together and trailing a little,
      // toes pointed, blade dead vertical overhead, free arm out. The longest
      // line in the clip, toe to point — and deliberately *not* arched, which is
      // what round one drew and what the reference does not.
      {
        t: 0.36,
        pose: P({
          hip: 0, torso: -4, head: -6,
          thighR: 186, shinR: -2, footR: -30,
          thighL: 192, shinL: -4, footL: -28,
          upperArmR: 16, forearmR: 2, handR: 0,
          upperArmL: 250, forearmL: -20, handL: -4,
        }),
        offsetX: 0.25,
        offsetY: 0.9,
        scaleX: 0.94,
        scaleY: 1.12,
        ease: "linear",
      },
      // Move frame 24 — the tuck the reference puts at f21-f27. Knees drawn up,
      // spine curled forward, the sword arm folding down across the body. It is
      // the shape a somersault passes through, and it is drawn rather than
      // rotated: `spin` tips this rig out of the screen plane, and `rotation`
      // interpolates the short way round, so neither can express a revolution.
      {
        t: 0.53,
        pose: P({
          hip: -6, torso: 24, head: -18,
          thighR: 118, shinR: 96, footR: -52,
          thighL: 126, shinL: 92, footL: -50,
          upperArmR: 44, forearmR: -58, handR: -8,
          upperArmL: 276, forearmL: 26, handL: 6,
        }),
        offsetX: 0.1,
        offsetY: 0.7,
        scaleX: 1.05,
        scaleY: 0.96,
        ease: "linear",
      },
      // Move frame 42. The stall: head down, legs hanging apart, the free arm
      // out of momentum, the blade tipped behind vertical — held up, but no
      // longer held out. `offsetX` goes negative so he trails his own momentum.
      {
        t: 0.78,
        pose: P({
          hip: 2, torso: 6, head: 10,
          thighR: 164, shinR: 40, footR: -74,
          thighL: 202, shinL: 36, footL: -70,
          upperArmR: 34, forearmR: -40, handR: -22,
          upperArmL: 268, forearmL: 30, handL: 10,
        }),
        offsetX: -0.1,
        offsetY: 0.15,
        ease: "linear",
      },
      { t: 1,
        pose: P({
          hip: 5, torso: 10, head: 14,
          thighR: 158, shinR: 48, footR: -80,
          thighL: 208, shinL: 44, footL: -76,
          upperArmR: 38, forearmR: -52, handR: -28,
          upperArmL: 254, forearmL: 36, handL: 12,
        }),
        offsetX: -0.2,
        scaleY: 0.98,
      },
    ],
  },
};
