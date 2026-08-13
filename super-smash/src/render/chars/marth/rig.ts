// The tallest and by some distance the thinnest, with the smallest head — the
// elongated build that lets the cape and Falchion read as elegant rather than
// as clutter.

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
  id: "marth",
  scale: 1.14,
  bones: tweakRig({
    root: { len: 1.16 },
    torso: { thick: 0.8, len: 1.06 },
    hip: { thick: 0.84 },
    ...group(LEGS, { len: 1.16, thick: 0.8 }),
    ...group(ARMS, { len: 1.08, thick: 0.8 }),
    ...group(FEET, { len: 1.2, thick: 1.0 }),
    ...group(HANDS, { thick: 0.88 }),
  }),
  headRadius: 1.9,
  boneColour: {
    torso: "primary",
    hip: "secondary",
    thighL: "#22262E",
    thighR: "#22262E",
    shinL: "secondary",
    shinR: "secondary",
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "#22262E",
    forearmR: "#22262E",
    handL: "#E6E2D8",
    handR: "#E6E2D8",
    footL: "secondary",
    footR: "secondary",
  },
  props: [
    { kind: "cape", bone: "torso", at: 0.95, size: 3.2, colour: "secondary", detail: "accent", layer: "behind" },
    { kind: "belt", bone: "hip", at: 0.85, size: 1.5, colour: "accent" },
    { kind: "swordLong", bone: "handR", at: 1, size: 5.4, colour: "#E6EEF6", detail: "accent" },
    { kind: "hairSwoop", bone: "head", at: 1, size: 1.8, across: 0.55, along: 0.55, colour: "secondary" },
    { kind: "tiara", bone: "head", at: 1, size: 1.5, along: 0.72, colour: "accent", detail: "#5FC8E8" },
    eyes(0.62, "#2E4C8F"),
  ],
};
