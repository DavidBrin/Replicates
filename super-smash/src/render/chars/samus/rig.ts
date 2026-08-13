// Round shoulders and a forearm twice the thickness of the other one. The
// asymmetry is the whole read: no other fighter has one fat arm.

import {
  ARMS,
  FEET,
  LEGS,
  group,
  tweakRig,
  type CharacterRig,
} from "../../rigKit";

export const rig: CharacterRig = {
  id: "samus",
  scale: 1.1,
  bones: tweakRig({
    torso: { thick: 1.2 },
    hip: { thick: 1.15 },
    ...group(LEGS, { thick: 1.3 }),
    ...group(FEET, { thick: 1.4, len: 1.2 }),
    ...group(ARMS, { thick: 1.12 }),
    forearmR: { thick: 1.55, len: 1.05 },
    handR: { thickAbs: 0, lenAbs: 0.2 },
    head: { len: 0.92 },
  }),
  headRadius: 2.45,
  boneColour: {
    torso: "primary",
    hip: "secondary",
    head: "primary",
    thighL: "secondary",
    thighR: "secondary",
    shinL: "primary",
    shinR: "primary",
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "secondary",
    forearmR: "accent",
    handL: "secondary",
    footL: "accent",
    footR: "accent",
  },
  props: [
    { kind: "helmet", bone: "head", at: 1, size: 2.6, colour: "primary", detail: "accent" },
    { kind: "visor", bone: "head", at: 1, size: 1.25, across: 0.85, along: 0.05, colour: "#38E08A" },
    { kind: "shoulderPad", bone: "upperArmL", at: 0.05, size: 1.9, colour: "primary", detail: "secondary", flip: true },
    { kind: "shoulderPad", bone: "upperArmR", at: 0.05, size: 2.05, colour: "primary", detail: "secondary" },
    { kind: "cannon", bone: "forearmR", at: 0.75, size: 1.6, colour: "accent", detail: "#2B3138" },
    { kind: "belt", bone: "hip", at: 0.8, size: 1.6, colour: "accent", detail: "#2B3138" },
  ],
};
