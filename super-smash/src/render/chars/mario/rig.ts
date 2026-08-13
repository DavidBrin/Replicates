// Short, round and big-headed. Mario is the roster's baseline and the shape
// everyone else is read against, so he is drawn as squarely "average person,
// slightly cartooned" — which in a cast containing DK and Kirby is itself
// distinct.

import {
  FEET,
  HANDS,
  LEGS,
  SMASH_YELLOW,
  eyes,
  group,
  tweakRig,
  type CharacterRig,
} from "../../rigKit";

export const rig: CharacterRig = {
  id: "mario",
  scale: 0.96,
  bones: tweakRig({
    // The root strut is the leg's length: scale one without the other and the
    // feet float above the stage or sink through it.
    root: { len: 0.86 },
    ...group(LEGS, { len: 0.86, thick: 1.14 }),
    ...group(HANDS, { thick: 1.26 }),
    ...group(FEET, { thick: 1.24, len: 1.2 }),
    hip: { thick: 1.1 },
    torso: { thick: 1.14, len: 0.96 },
  }),
  headRadius: 2.5,
  boneColour: {
    torso: "primary",
    hip: "secondary",
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
    footL: "#5A2E12",
    footR: "#5A2E12",
  },
  props: [
    { kind: "bib", bone: "torso", at: 0.55, size: 1.9, colour: "secondary", detail: SMASH_YELLOW },
    { kind: "cap", bone: "head", at: 1, size: 2.6, along: 0.95, colour: "primary", detail: "#FFFFFF" },
    { kind: "nose", bone: "head", at: 1, size: 0.78, across: 1.05, along: -0.1, colour: "skin" },
    { kind: "moustache", bone: "head", at: 1, size: 1.1, across: 0.62, along: -0.62, colour: "#3A1F10" },
    eyes(0.72),
  ],
};
