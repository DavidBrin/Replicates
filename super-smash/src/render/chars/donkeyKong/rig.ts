// Barrel torso, tiny legs, arms past the knees. Blacked out this is already DK
// and nobody else in the roster.

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
  id: "donkeyKong",
  scale: 1.34,
  bones: tweakRig({
    root: { len: 0.69 },
    hip: { thick: 1.42, len: 0.9 },
    torso: { thick: 1.62, len: 1.12 },
    head: { len: 0.62 },
    ...group(LEGS, { len: 0.68, thick: 1.3 }),
    ...group(FEET, { len: 1.35, thick: 1.35 }),
    ...group(ARMS, { len: 1.44, thick: 1.42 }),
    ...group(HANDS, { thick: 1.7, len: 1.3 }),
  }),
  headRadius: 2.35,
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
    handL: "skin",
    handR: "skin",
    footL: "skin",
    footR: "skin",
  },
  props: [
    { kind: "patch", bone: "torso", at: 0.55, size: 2.0, across: 0.5, colour: "skin" },
    { kind: "tie", bone: "torso", at: 0.95, size: 1.5, across: 1.35, colour: "accent", detail: "#FFF2B0" },
    { kind: "muzzle", bone: "head", at: 1, size: 1.5, across: 0.95, along: -0.5, colour: "skin" },
    { kind: "brow", bone: "head", at: 1, size: 1.5, across: 0.5, along: 0.55, colour: "#3A2412" },
    { kind: "earsRound", bone: "head", at: 1, size: 0.72, along: 0.2, colour: "skin" },
    eyes(0.66),
  ],
};
