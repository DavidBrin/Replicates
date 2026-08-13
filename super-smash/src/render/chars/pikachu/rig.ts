// Head nearly as wide as the body, limbs almost too short to see, and the two
// shapes that leave the outline — the ears and the bolt tail — carry the read.

import {
  ARMS,
  FEET,
  HANDS,
  LEGS,
  eyes,
  group,
  tweakRig,
  type CharacterRig,
} from "../../rigKit";

export const rig: CharacterRig = {
  id: "pikachu",
  scale: 0.72,
  bones: tweakRig({
    root: { lenAbs: 2.5 },
    hip: { lenAbs: 0.6, thickAbs: 3.6 },
    torso: { lenAbs: 1.5, thickAbs: 4.2 },
    head: { lenAbs: 1.6, thickAbs: 1.9 },
    ...group(LEGS, { lenAbs: 1.15, thickAbs: 1.7 }),
    ...group(FEET, { lenAbs: 1.25, thickAbs: 1.6 }),
    ...group(ARMS, { lenAbs: 1.0, thickAbs: 1.45 }),
    ...group(HANDS, { lenAbs: 0.35, thickAbs: 1.7 }),
  }),
  headRadius: 3.5,
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
    footL: "#6B4A18",
    footR: "#6B4A18",
  },
  props: [
    { kind: "tailBolt", bone: "hip", at: 0, size: 3.6, colour: "primary", detail: "#6B4A18", layer: "behind", angle: 2.2 },
    { kind: "earsBolt", bone: "head", at: 1, size: 2.9, along: 0.5, angle: 0.42, colour: "primary", detail: "#20202C" },
    { kind: "cheeks", bone: "head", at: 1, size: 0.85, across: 1.85, along: -0.8, colour: "accent" },
    { kind: "snout", bone: "head", at: 1, size: 0.7, across: 1.25, along: -0.55, colour: "primary", detail: "#20202C" },
    eyes(0.68),
  ],
};
