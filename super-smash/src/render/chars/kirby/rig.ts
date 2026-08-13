// The sphere.
//
// The torso is vestigial and the head circle *is* the body, so almost the whole
// figure is one shape. The legs are full length but spend most of themselves
// inside that shape; only the oversized feet emerge at the bottom, which is
// exactly the read — a ball balanced on two red boots. Kirby is the one fighter
// with no prop that leaves his outline, because his outline is the prop.

import {
  ARMS,
  FEET,
  HANDS,
  LEGS,
  group,
  tweakRig,
  type CharacterRig,
} from "../../rigKit";

export const rig: CharacterRig = {
  id: "kirby",
  scale: 0.78,
  bones: tweakRig({
    root: { lenAbs: 4.2 },
    hip: { lenAbs: 0.18, thickAbs: 1.2 },
    torso: { lenAbs: 0.35, thickAbs: 2.4 },
    head: { lenAbs: 0.55, thickAbs: 1.0 },
    ...group(LEGS, { lenAbs: 2.0, thickAbs: 1.75 }),
    ...group(FEET, { lenAbs: 1.6, thickAbs: 2.0 }),
    ...group(ARMS, { lenAbs: 0.9, thickAbs: 1.5 }),
    ...group(HANDS, { lenAbs: 0.35, thickAbs: 1.95 }),
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
  props: [
    { kind: "cheeks", bone: "head", at: 1, size: 0.95, across: 1.9, along: -0.9, colour: "accent" },
    { kind: "face", bone: "head", at: 1, size: 1.25, across: 0.95, along: 0.35, colour: "#FFFFFF", detail: "#20202C" },
  ],
};
