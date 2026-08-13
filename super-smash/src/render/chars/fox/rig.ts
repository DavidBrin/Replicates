// Short body, long legs, small head — the digitigrade build, which is what makes
// the ears and the tail read as animal rather than as decoration.

import {
  ARMS,
  FEET,
  LEGS,
  eyes,
  group,
  tweakRig,
  type CharacterRig,
} from "../../rigKit";

export const rig: CharacterRig = {
  id: "fox",
  scale: 0.88,
  bones: tweakRig({
    root: { len: 1.14 },
    torso: { thick: 0.88, len: 0.86 },
    ...group(LEGS, { len: 1.14, thick: 0.94 }),
    ...group(ARMS, { thick: 0.92 }),
    ...group(FEET, { len: 1.4, thick: 1.35 }),
    head: { len: 0.9 },
  }),
  headRadius: 2.15,
  boneColour: {
    torso: "primary",
    hip: "secondary",
    head: "skin",
    thighL: "secondary",
    thighR: "secondary",
    shinL: "secondary",
    shinR: "secondary",
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "skin",
    forearmR: "skin",
    handL: "#FFFFFF",
    handR: "#FFFFFF",
    footL: "#B9C2CC",
    footR: "#B9C2CC",
  },
  props: [
    { kind: "tailBushy", bone: "hip", at: 0, size: 3.4, colour: "skin", detail: "#FFFFFF", layer: "behind", angle: 2.5 },
    { kind: "vest", bone: "torso", at: 0.55, size: 2.0, colour: "primary", detail: "accent" },
    { kind: "earsPointed", bone: "head", at: 1, size: 1.6, along: 0.55, angle: 0.34, colour: "skin", detail: "#3A2A1C" },
    { kind: "snout", bone: "head", at: 1, size: 1.4, across: 1.1, along: -0.35, colour: "#FFFFFF", detail: "#2B2118" },
    eyes(0.7, "#3FA1D8"),
  ],
};
