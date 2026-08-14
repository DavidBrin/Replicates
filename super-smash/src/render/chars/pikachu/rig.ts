import {
  ARMS,
  FEET,
  HANDS,
  LEGS,
  ellipse,
  group,
  poly,
  tweakRig,
  type Brush,
  type CharacterRig,
  type PropAnim,
  type PropDef,
} from "../../rigKit";

// Head nearly as wide as the body, limbs almost too short to see, and the two
// shapes that leave the outline — the ears and the bolt tail — carry the read.
//
// Four things were wrong and all four were silhouette:
//
// 1. **The ears pointed down.** The shared `earsBolt` painter puts its tips at
//    *negative* y, and the prop frame's +y runs along the bone toward its tip —
//    so both ears grew downward into the skull and what showed was a dark nub
//    on the jaw. Fox's rig hit the same bug in `earsPointed` and worked round it
//    the same way; the shared fix is named in the report. Drawn here as a custom
//    prop with the tips at +y, long enough to clear the head by two thirds of
//    its own diameter, because on a fighter this round the ears *are* the
//    silhouette.
//
// 2. **He was one circle.** A head radius of 3.5 on a 9.7-unit rig put the skull
//    across 72% of his height and swallowed the torso, both arms and the top of
//    the legs — there was no body, and no limb could ever leave the outline.
//    Pikachu is about half head, not three quarters: the skull is 2.6 on a
//    9.65-unit rig, so the diameter is 54% of his height, which leaves a visible
//    torso and puts the shoulders where an arm can be seen at all.
//
// 3. **The tail was buried.** Hung at the pelvis with no backward offset, most
//    of the bolt was inside the body outline. It is the one shape nothing else
//    on the roster has, so it is now bigger, set back off the spine, and leans
//    back as it rises the way the real tail does.
//
// 4. **The cheeks were on the muzzle.** `across: 1.85` put the red pouch out
//    past the nose where it read as an open mouth. They are the third thing a
//    player names him by and they belong on the lower cheek.
//
// Round two closed three more, and every one of them was a thing that was drawn
// and could not be *seen*:
//
// 5. **The paws were the outline colour.** `#6B4A18` inside a `#4A3208` rim. The
//    forward tilt fires both feet clear of the head circle and rendered as a
//    shadow. They are a shaded yellow now, and so are the forepaws, which had
//    the opposite problem — `primary` in front of a `primary` torso is a bulge.
//
// 6. **The eyes were googly.** The shared `face` prop's pupil is over half the
//    width of its eye, so Pikachu's black-bead-with-a-glint came out as a white
//    eye in a thin black ring. Painted here instead, at a quarter.
//
// 7. **The tail could not move.** It is a prop, props are bolted to bones, and
//    no clip that is not a tail swipe moves the hip. It now sways, streams and
//    lifts on the `PropAnim` argument — see `drawTail`.
/** The ear tips and the nose. Near-black rather than the palette's brown. */ const INK = "#241D18";
/** The brown at the tail's root and along the back stripes. */ const MARK = "#9A6B2E";
/**
 * The hind paws.
 *
 * **Not brown.** They were `#6B4A18`, which is four shades off the palette's own
 * outline (`#4A3208`), and the figure is drawn twice — once inflated in the
 * outline colour for the rim, once in body colours — so a dark brown foot was
 * painted into the middle of its own dark brown rim and disappeared. That is the
 * documented "a shape painted in the outline colour disappears" failure, and it
 * cost him the one move where the legs are supposed to be the whole read: the
 * forward tilt shot both feet a third of his height clear of the head circle and
 * what showed on screen was a shadow.
 *
 * A shaded yellow instead. It separates from the body (`#F5D547`) because it is
 * two stops darker, and from the rim because it is not brown at all — which is
 * also how the real model reads, where nothing about the paw is a different
 * *colour*, only a different amount of light.
 */ const PAW = "#D9A32B";
function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}
/**
 * `anim.vx`, clamped to a speed a tail can be dragged by.
 *
 * A **range** guard, not a unit one. For most of this pass the renderer handed
 * every prop painter the fighter's `vx` in the simulation's raw Q12 fixed point,
 * where a full run is 9839 rather than 2.4, while `PropAnim` and
 * `docs/character-art.md` both promised world units — so this function carried a
 * local correction and the tail was calibrated through it. That was the wrong
 * place for it: a wrong unit gets a different correction from every author who
 * notices and nothing at all from the ones who don't. It is fixed at source now
 * (`renderer.ts` applies `toFloat`), and the correction is gone from here rather
 * than left in to divide by 4096 a second time.
 *
 * What is left is real: a walk is about 1, a full run 2 to 3, and a fighter
 * launched off the top of the screen is a good deal more than that. The bend
 * below is an angle, and a tail folded back through its own root is not a tail,
 * so the input to it is bounded a little above a run.
 */ function speed(vx: number): number {
    return Math.max(-3.2, Math.min(3.2, vx));
}
/** Rotate a point in the prop's own frame: `+x` forward, `+y` along the bone. */ function turn(x: number, y: number, a: number): [number, number] {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
        x * c - y * s,
        x * s + y * c
    ];
}
/**
 * The ears.
 *
 * Two long tapered blades rising clear of the skull and swept back, black over
 * the last third. Sized against a head circle of radius 2.75: at `size` 2.4 the
 * skull is 1.15 units in this frame, so a tip at 2.55 puts well over a unit of
 * ear — 3.4 rig units, two thirds of a head diameter — outside the circle where
 * the rim pass will find it.
 *
 * The near ear is longer, more upright and drawn second so it overlaps; that
 * overlap is the only thing that says there are two of them rather than one
 * forked one.
 *
 * ## Why they move
 *
 * SmashWiki's account of Pikachu's idle poses has him "twitching its ears", and
 * an ear is soft — it is one of the two things on this fighter that cannot be
 * welded to a bone without looking welded. The sway is deliberately tiny (a
 * couple of degrees at the tip) because the ears *are* the silhouette and a
 * silhouette that wobbles reads as a rendering fault; what it buys is that two
 * frames of a standing Pikachu are never quite the same picture. The two ears
 * are given different phases, so they never arrive together, and both sweep
 * back with speed, which is the one ear motion a player would notice missing.
 */ function drawEars(b: Brush, p: PropDef, anim: PropAnim) {
    const ctx = b.ctx;
    // [base x, tip x, length, half-width at the base, phase]
    const EARS = [
        [
            -0.34,
            -1.62,
            2.06,
            0.25,
            0
        ],
        [
            0.24,
            -0.94,
            2.46,
            0.30,
            2.1
        ]
    ];
    const drag = speed(anim.vx) * 0.075;
    const band = (bx: number, tx: number, len: number, w: number, ph: number, s0: number, s1: number) => {
        // A shear rather than a rotation: the ear bends along its length, which
        // is what a long soft ear does, and the base stays welded to the skull.
        const lean = Math.sin(anim.frame * 0.041 + ph) * 0.06 - drag;
        const pt = (s: number) =>{
            const x = lerp(bx, tx, s) + lean * s * s * len;
            const y = lerp(0.2, len, s);
            const hw = lerp(w, w * 0.3, s);
            return [
                x,
                y,
                hw
            ];
        };
        const [x0, y0, w0] = pt(s0);
        const [x1, y1, w1] = pt(s1);
        poly(ctx, [
            [
                x0 - w0,
                y0
            ],
            [
                x1 - w1,
                y1
            ],
            [
                x1 + w1,
                y1
            ],
            [
                x0 + w0,
                y0
            ]
        ]);
    };
    for (const [bx, tx, len, w, ph] of EARS){
        band(bx, tx, len, w, ph, 0, 1);
        b.fill(p.colour);
    }
    // The black tips, body pass only: inflated by the rim width they would swallow
    // the point of the ear they are supposed to cap.
    if (b.mode !== "body") return;
    for (const [bx, tx, len, w, ph] of EARS){
        band(bx, tx, len, w, ph, 0.66, 1);
        b.fill(p.detail ?? INK);
    }
}
/**
 * The tail.
 *
 * The zigzag, and nothing else on the roster is shaped like it. Authored
 * pointing up and *sheared backward* as it rises, which is the line the real
 * tail takes, and widening to the flat flag at the end — a bolt that keeps a
 * constant width reads as a crack rather than as a tail.
 *
 * Hung off `hip` so it turns with the body: five of his attacks are tail
 * swipes and every one of them is written as the body rotation that carries it,
 * because a prop cannot be *posed*.
 *
 * ## But it can move
 *
 * It could not, until the third `anim` argument existed, and that mattered more
 * here than on any other fighter: the bolt tail is one of the two or three
 * shapes that make Pikachu unmistakable, and for a whole round it was a decal.
 * A tail reads as a tail precisely because it does not track the body — it lags
 * it, streams behind it, and lifts when the animal leaves the ground — and none
 * of that is a property of the skeleton, so no pose could ever have said it.
 *
 * The bend is applied as a **rotation proportional to distance along the tail's
 * own axis**, which curls it rather than swinging it rigidly: the root stays
 * welded to the hip and the flag at the end travels the whole amount. Rotating
 * each point about the root also preserves its distance from the root, so the
 * tail bends without stretching — a shear would have lengthened it at the
 * extremes and the flag would have breathed.
 *
 * Three inputs, and each is a thing a player would notice was missing:
 *
 * | Input | What it does |
 * |---|---|
 * | `frame` | Two drifts at unrelated rates, so the sway never repeats on a beat |
 * | `vx` | Streams flat behind him in a dash, in both directions, with no sign |
 * | `airborne` | Stands up off the ground — a tail hangs differently in a jump |
 */ function drawTail(b: Brush, p: PropDef, anim: PropAnim) {
    const ctx = b.ctx;
    // An axis running back and up at about thirty-five degrees, and three bars
    // laid along it, each stepped across the axis and wider than the last. Three
    // overlapping quads rather than one twelve-point outline for the reason Fox's
    // tail is a chain of discs: the rim pass inflates whatever it is handed, and
    // the union of inflated convex pieces is still a clean silhouette where an
    // inflated zigzag pinches its own notches shut. The alternating step across
    // the axis is what makes the outline a bolt.
    const UX = -0.82;
    const UY = 0.57;
    const VX = 0.57;
    const VY = 0.82;
    /** Where the flag ends, in axis units — the lever the bend is scaled by. */ const TIP = 3.15;
    // Positive lays the bolt back toward horizontal; negative stands it up.
    // Clamped because a dash reaches the fast end of `speed` and a tail folded
    // through its own root is not a tail.
    const bend = Math.max(-0.62, Math.min(0.62, Math.sin(anim.frame * 0.055) * 0.10 + Math.sin(anim.frame * 0.019 + 1.7) * 0.055 + speed(anim.vx) * 0.15 + (anim.airborne ? -0.20 : 0)));
    const bar = (a0: number, a1: number, off: number, w: number) => {
        const pt = (a: number, s: number): [number, number] => turn(a * UX + (off + s * w) * VX, a * UY + (off + s * w) * VY, bend * (a / TIP));
        poly(ctx, [
            pt(a0, -1),
            pt(a1, -1),
            pt(a1, 1),
            pt(a0, 1)
        ]);
    };
    const BARS = [
        [
            -0.15,
            1.05,
            0.0,
            0.34
        ],
        [
            0.85,
            2.0,
            0.44,
            0.4
        ],
        [
            1.8,
            TIP,
            -0.04,
            0.68
        ]
    ];
    for (const [a0, a1, off, w] of BARS){
        bar(a0, a1, off, w);
        b.fill(p.colour);
    }
    // The brown patch the tail grows out of. Body pass only — it is a marking,
    // and in the rim pass it would only thicken an outline that is already there.
    if (b.mode !== "body" || !p.detail) return;
    bar(-0.15, 0.82, 0.0, 0.34);
    b.fill(p.detail);
}
/**
 * The two brown stripes across his back, and the tail patch's continuation.
 *
 * Small, and they are the reason the body reads as an animal with markings
 * rather than as a yellow capsule. Body pass only, and kept behind the midline
 * so they never crawl round onto his chest, which is plain yellow.
 */ function drawStripes(b: Brush, p: PropDef) {
    if (b.mode !== "body") return;
    const ctx = b.ctx;
    for (const [y, w, h] of [
        [
            0.42,
            0.52,
            0.17
        ],
        [
            -0.10,
            0.58,
            0.19
        ]
    ]){
        ellipse(ctx, -0.62, y, w, h, 0.34);
        b.fill(p.colour);
    }
}
/**
 * The eyes.
 *
 * Drawn here rather than with the shared `face` prop, which paints a large oval
 * in `colour` and a pupil in `detail` at better than half its width. Handed
 * Pikachu's black-eye-white-glint inversion that comes out as a **white eye in a
 * thin black ring** — a googly cartoon eye, and at match scale the single most
 * wrong thing on his face. His eye is a black bead with a small highlight near
 * the top of it, and the ratio between the two is the whole read: a quarter, not
 * a half.
 *
 * The far eye is smaller and set well back, because a head this round shows both
 * from a three-quarter view and two identical eyes side by side flatten it.
 */ function drawEyes(b: Brush, p: PropDef) {
    if (b.mode !== "body") return;
    const ctx = b.ctx;
    ellipse(ctx, 0.58, 0, 0.50, 0.62);
    b.fill(p.colour);
    ellipse(ctx, -0.66, 0.05, 0.40, 0.52);
    b.fill(p.colour);
    const glint = p.detail ?? "#FFFFFF";
    ellipse(ctx, 0.74, 0.27, 0.15, 0.18);
    b.fill(glint);
    ellipse(ctx, -0.54, 0.29, 0.12, 0.14);
    b.fill(glint);
}
/**
 * Nose and mouth.
 *
 * A dot and an open smile — Pikachu has no muzzle to speak of, and the shared
 * `snout` painter's forward ellipse gave him one. Two marks on a flat face is
 * what the character actually is.
 */ function drawFaceMarks(b: Brush, p: PropDef) {
    if (b.mode !== "body") return;
    const ctx = b.ctx;
    ellipse(ctx, 1.02, 0.34, 0.19, 0.15);
    b.fill(p.colour);
    ctx.beginPath();
    ctx.moveTo(0.5, -0.28);
    ctx.quadraticCurveTo(1.0, -0.78, 1.36, -0.12);
    ctx.quadraticCurveTo(0.96, -0.42, 0.5, -0.28);
    ctx.closePath();
    b.fill(p.detail ?? INK);
}
export const rig: CharacterRig = {
    id: "pikachu",
    scale: 0.72,
    bones: tweakRig({
        // 2.9 + 0.75 + 1.6 + 1.8 + 2.6 = 9.65 rig units, which at `scale` 0.72 is the
        // 6.9-unit fighter `fighters/pikachu.ts` declares — deliberately the
        // smallest hurtbox on the roster, and the whole point of the character.
        //
        // `root` carries most of the change. It is the strut from the feet to the
        // pelvis, so lengthening it lifts the whole body off the floor and opens the
        // gap the legs live in: with the hip capsule 3.4 thick its underside sits at
        // 1.2, and a 2.6-unit leg chain below a 2.9-unit pelvis leaves a unit of
        // visible shin. At the old 2.5/3.6 the hip's own capsule reached the ground
        // and he had no legs at all, only feet.
        root: {
            lenAbs: 2.9
        },
        hip: {
            lenAbs: 0.75,
            thickAbs: 3.4
        },
        torso: {
            lenAbs: 1.6,
            thickAbs: 4.0
        },
        head: {
            lenAbs: 1.8,
            thickAbs: 2.0
        },
        ...group(LEGS, {
            lenAbs: 1.38,
            thickAbs: 1.75
        }),
        // The hind paw. A fifth longer and an eighth wider than it was, and
        // that is as far as it can go.
        //
        // The forward tilt fires both feet at a hitbox centred 6.1 units out and
        // the striking foot reached 4.5, so reach was worth buying — and the
        // foot is the only bone that sells it cheaply, because it lies *along*
        // the ground rather than down it and so adds no sink at rest. What it
        // does add is sink in the shared **brake**, where the paw rotates
        // toe-down: `poses.test.ts` requires every rig to plant within 0.6 units
        // of every other and Pikachu is already the deepest of the five, so the
        // roster's tolerance for a bigger paw on this fighter is about two
        // tenths of a unit and it is now spent. Anything past 1.4 fails a shared
        // test that is not this fighter's to relax.
        //
        // Which is worth being honest about: most of what fixed the forward tilt
        // was `PAW` no longer being the outline colour. The bone is 0.19 units
        // of it.
        ...group(FEET, {
            lenAbs: 1.34,
            thickAbs: 1.9
        }),
        // Long enough to have forepaws.
        //
        // At 0.95 + 0.95 + 0.35 the whole arm was 2.25 units from a shoulder at
        // 5.25, and the torso capsule alone is 2.0 across its radius — so a paw
        // held in front of the chest, which is where Pikachu's forepaws live in
        // every frame of his standing loop, finished up *inside his own body* and
        // no pose could get it out. At 1.12 + 1.12 + 0.44 a paw brought forward
        // clears the torso by a third of a unit and the head circle by a unit and
        // a half, and the standing pose finally has hands in it.
        ...group(ARMS, {
            lenAbs: 1.12,
            thickAbs: 1.5
        }),
        ...group(HANDS, {
            lenAbs: 0.52,
            thickAbs: 1.9
        })
    }),
    // Wider than the 4.0 torso, so the skull actually overhangs the body: on a
    // fighter with no neck that overhang is the only thing separating them.
    headRadius: 2.6,
    // The ears leave the head by more than the head's own radius, and they are
    // the shape that names him at sixty pixels. Without this the port tag sits
    // across them in every in-match frame — reported from a capture, not
    // derived: the ear bands run to 2.46 of a 2.25-unit prop frame, anchored
    // 0.7 above a head tip that `rigHeight` already counts 2.6 past, and they
    // rake back rather than standing straight up, so the vertical reach is less
    // than that arithmetic suggests. This number was set by looking.
    tagClearance: 3.2,
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
        // The forepaws take the same shaded yellow as the hind ones. On the real
        // model they are not a different colour at all — what separates a paw
        // from the belly it is held against is shading, and this rig has no
        // shading, only flat fills and one outline around the whole figure. So a
        // `primary` hand in front of a `primary` torso is not a hand, it is a
        // bulge, which is exactly what the standing pose drew until the paws
        // were given a value of their own.
        handL: PAW,
        handR: PAW,
        footL: PAW,
        footR: PAW
    },
    props: [
        {
            kind: "custom",
            bone: "hip",
            at: 0.3,
            size: 1.74,
            across: -1.4,
            along: 0,
            colour: "primary",
            detail: MARK,
            layer: "behind",
            draw: drawTail
        },
        {
            kind: "custom",
            bone: "torso",
            at: 0.46,
            size: 1.15,
            across: -0.6,
            colour: MARK,
            draw: drawStripes
        },
        {
            kind: "custom",
            bone: "head",
            at: 1,
            size: 2.25,
            along: 0.7,
            across: -0.3,
            colour: "primary",
            detail: INK,
            draw: drawEars
        },
        {
            kind: "cheeks",
            bone: "head",
            at: 1,
            size: 1.05,
            across: 0.62,
            along: -0.9,
            colour: "accent"
        },
        {
            kind: "custom",
            bone: "head",
            at: 1,
            size: 1.2,
            across: 0.6,
            along: -0.1,
            colour: INK,
            detail: INK,
            draw: drawFaceMarks
        },
        // Black eye with a white glint rather than the roster's white-with-a-pupil:
        // Pikachu's eye is a dark bead, and inverting the two colours is the whole
        // difference between his face and a cartoon human's. Painted by `drawEyes`
        // rather than by the shared `face` kind, whose pupil is half the width of
        // the eye and turned the inversion into a white eye in a black ring.
        {
            kind: "custom",
            bone: "head",
            at: 1,
            size: 0.98,
            across: 0.5,
            along: 0.5,
            colour: INK,
            detail: "#FFFFFF",
            draw: drawEyes
        }
    ]
};
