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
//    Pikachu is about half head, not three quarters: the skull is now 2.75 on a
//    9.6-unit rig (57%), which leaves a visible torso, and the shoulders now sit
//    *below* the head circle so an arm can be seen at all.
//
// 3. **The tail was buried.** Hung at the pelvis with no backward offset, most
//    of the bolt was inside the body outline. It is the one shape nothing else
//    on the roster has, so it is now bigger, set back off the spine, and leans
//    back as it rises the way the real tail does.
//
// 4. **The cheeks were on the muzzle.** `across: 1.85` put the red pouch out
//    past the nose where it read as an open mouth. They are the third thing a
//    player names him by and they belong on the lower cheek.
/** The ear tips and the nose. Near-black rather than the palette's brown. */ const INK = "#26262E";
/** The brown at the tail's root and along the back stripes. */ const MARK = "#9A6B2E";
/** Feet: a darker brown than the stripes, so the two never merge. */ const PAW = "#6B4A18";
function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
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
 */ function drawEars(b: Brush, p: PropDef) {
    const ctx = b.ctx;
    // [base x, tip x, length, half-width at the base]
    const EARS = [
        [
            -0.40,
            -1.68,
            2.02,
            0.34
        ],
        [
            0.16,
            -1.00,
            2.42,
            0.40
        ]
    ];
    const band = (bx: number, tx: number, len: number, w: number, s0: number, s1: number) => {
        const pt = (s: number) =>{
            const x = lerp(bx, tx, s);
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
    for (const [bx, tx, len, w] of EARS){
        band(bx, tx, len, w, 0, 1);
        b.fill(p.colour);
    }
    // The black tips, body pass only: inflated by the rim width they would swallow
    // the point of the ear they are supposed to cap.
    if (b.mode !== "body") return;
    for (const [bx, tx, len, w] of EARS){
        band(bx, tx, len, w, 0.66, 1);
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
 * because a prop cannot be posed.
 */ function drawTail(b: Brush, p: PropDef) {
    const ctx = b.ctx;
    // An axis running back and up at about thirty degrees, and three bars laid
    // along it, each stepped across the axis and wider than the last. Three
    // overlapping quads rather than one twelve-point outline for the reason Fox's
    // tail is a chain of discs: the rim pass inflates whatever it is handed, and
    // the union of inflated convex pieces is still a clean silhouette where an
    // inflated zigzag pinches its own notches shut. The alternating step across
    // the axis is what makes the outline a bolt.
    const UX = -0.87;
    const UY = 0.5;
    const VX = 0.5;
    const VY = 0.87;
    const bar = (a0: number, a1: number, off: number, w: number) => {
        const pt = (a: number, s: number): [number, number] => [
                a * UX + (off + s * w) * VX,
                a * UY + (off + s * w) * VY
            ];
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
            3.15,
            -0.04,
            0.64
        ]
    ];
    for (const [a0, a1, off, w] of BARS){
        bar(a0, a1, off, w);
        b.fill(p.colour);
    }
    // The brown patch the tail grows out of. Body pass only — it is a marking,
    // and in the rim pass it would only thicken an outline that is already there.
    if (b.mode !== "body" || !p.detail) return;
    bar(-0.15, 0.4, 0.0, 0.34);
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
            0.6,
            0.17
        ],
        [
            -0.06,
            0.66,
            0.19
        ]
    ]){
        ellipse(ctx, -0.34, y, w, h, 0.26);
        b.fill(p.colour);
    }
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
            lenAbs: 1.3,
            thickAbs: 1.75
        }),
        ...group(FEET, {
            lenAbs: 1.15,
            thickAbs: 1.7
        }),
        ...group(ARMS, {
            lenAbs: 0.95,
            thickAbs: 1.5
        }),
        ...group(HANDS, {
            lenAbs: 0.35,
            thickAbs: 1.7
        })
    }),
    // Wider than the 4.0 torso, so the skull actually overhangs the body: on a
    // fighter with no neck that overhang is the only thing separating them.
    headRadius: 2.6,
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
        footL: PAW,
        footR: PAW
    },
    props: [
        {
            kind: "custom",
            bone: "hip",
            at: 0.3,
            size: 1.6,
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
            at: 0.55,
            size: 1.5,
            across: -0.5,
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
            size: 1.1,
            across: 1.0,
            along: -0.95,
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
        // difference between his face and a cartoon human's.
        {
            kind: "face",
            bone: "head",
            at: 1,
            size: 0.9,
            across: 0.5,
            along: 0.5,
            colour: INK,
            detail: "#FFFFFF"
        }
    ]
};
