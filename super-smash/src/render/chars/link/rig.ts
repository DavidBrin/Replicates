// Taller and leaner than Mario, but stockier than Marth: the athletic middle of
// the three humanoids, which is the gap the cap and the shield then widen.

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
  id: "link",
  scale: 1.06,
  bones: tweakRig({
    root: { len: 1.02 },
    ...group(LEGS, { len: 1.02 }),
    ...group(ARMS, { len: 1.04, thick: 0.96 }),
    ...group(FEET, { len: 1.15, thick: 1.15 }),
  }),
  headRadius: 2.3,
  boneColour: {
    torso: "primary",
    hip: "primary",
    thighL: "#E9DCC0",
    thighR: "#E9DCC0",
    shinL: "#E9DCC0",
    shinR: "#E9DCC0",
    upperArmL: "primary",
    upperArmR: "primary",
    forearmL: "skin",
    forearmR: "skin",
    handL: "#D8CBA8",
    handR: "#D8CBA8",
    footL: "#6B4A24",
    footR: "#6B4A24",
  },
  props: [
    { kind: "cape", bone: "torso", at: 0.9, size: 2.4, colour: "#4E3A1E", layer: "behind", angle: 0.1 },
    { kind: "shield", bone: "forearmL", at: 0.55, size: 1.9, colour: "secondary", detail: "accent", layer: "behind" },
    { kind: "tunic", bone: "hip", at: 0.5, size: 2.1, colour: "primary" },
    { kind: "belt", bone: "hip", at: 0.9, size: 1.7, colour: "#5A3A18", detail: "accent" },
    { kind: "sword", bone: "handR", at: 1, size: 4.2, colour: "#DCE4EC", detail: "accent" },
    { kind: "capPointed", bone: "head", at: 1, size: 2.5, along: 0.75, colour: "primary" },
    { kind: "hairSwoop", bone: "head", at: 1, size: 1.5, across: 0.75, along: 0.5, colour: "#E8C86A" },
    { kind: "earsPointed", bone: "head", at: 1, size: 1.0, along: -0.15, angle: 0.5, colour: "skin" },
    eyes(0.66, "#2E6BB0"),
  ],
};
