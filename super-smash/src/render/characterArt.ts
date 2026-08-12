/**
 * Turning a posed skeleton into a fighter you can name at a glance.
 *
 * ## The problem
 *
 * Sixteen capsules and a circle is a *person*. It is not Mario. Eight fighters
 * drawn from one rig and one pose library will read as eight recolours of the
 * same stick figure unless something else does the work, and "something else"
 * cannot be sprite art. Three things do it here, in descending order of how
 * much they matter:
 *
 * **1. Proportion, which is silhouette.** Kirby is a sphere with nubs; Donkey
 * Kong is a barrel with legs a third of his height and arms past his knees;
 * Pikachu's head is nearly as wide as his body; Marth is a third narrower than
 * Mario everywhere. Blacked out at thumbnail size these are already four
 * different characters, before a single colour is chosen. `debugSilhouette`
 * exists so that claim can be checked rather than asserted.
 *
 * **2. One prop that breaks the outline.** Fighting games are read at the
 * edges: Fox's ears and tail, Samus's pauldrons and arm cannon, Link's cap and
 * sword, Marth's cape, Pikachu's bolt tail, DK's tie, Mario's cap brim. Each
 * fighter gets at least one shape that leaves the body outline and that nobody
 * else has, so the silhouettes stay distinct even when two fighters overlap.
 *
 * **3. Palette last.** Colour is what confirms a read the silhouette already
 * made — and it is the least reliable of the three, because alternate costumes
 * change it. Props whose colour is costume-invariant (Mario's white gloves,
 * Pikachu's black ear tips) carry literal hex; everything else carries a role
 * name and follows the costume.
 *
 * ## Passes
 *
 * Every fighter is drawn twice: a **rim** pass that paints the entire figure in
 * the outline colour, inflated a few pixels, and a **body** pass on top. That
 * is what keeps four fighters legible against a busy stage and against each
 * other, and it is cheaper and more robust than per-shape stroking, which
 * leaves seams wherever two capsules meet.
 */

import type { FighterDef, FighterPalette, FighterState } from "@/engine/types";
import type { PoseSample } from "./poses";
import {
  BASE_RIG,
  FAR_BONES,
  NEAR_BONES,
  drawCapsule,
  resolve,
  type Bone,
  type BoneName,
  type Rig,
  type RigTransform,
  type Skeleton,
} from "./skeleton";

/* ------------------------------------------------------------------ type -- */

/** Anton for numerals and display, M PLUS Rounded 1c for menus (SPEC §10). */
export const FONT_DISPLAY = "'Anton', 'Arial Narrow', Haettenschweiler, Impact, sans-serif";
export const FONT_UI = "'M PLUS Rounded 1c', 'Trebuchet MS', system-ui, sans-serif";

/* --------------------------------------------------------------- colours -- */

/** Sampled from Ultimate's HUD (SPEC §10). Port order is P1..P4. */
export const PORT_COLOURS: readonly string[] = ["#FE3636", "#3B7BFE", "#FFC61E", "#35C759"];

export const SMASH_RED = "#AD0000";
export const SMASH_RED_LIT = "#C10500";
export const SMASH_YELLOW = "#FFD500";
export const PANEL_INK = "#090B0C";

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Lighten (`amount > 0`) or darken (`amount < 0`) toward white/black. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  return rgbToHex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k);
}

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

const FALLBACK_PALETTE: FighterPalette = {
  primary: "#C64B3A",
  secondary: "#2E4C8F",
  accent: "#E0C060",
  skin: "#F2C89A",
  outline: "#160D12",
  alts: [],
};

/** Apply a costume's remap. Costume 0 is always the default colours. */
export function resolvePalette(def: FighterDef | null, costume: number): FighterPalette {
  const base = def?.palette ?? FALLBACK_PALETTE;
  if (costume <= 0 || !base.alts || costume > base.alts.length) return base;
  const alt = base.alts[costume - 1];
  return { ...base, primary: alt.primary, secondary: alt.secondary, accent: alt.accent };
}

function roleColour(role: string, palette: FighterPalette): string {
  if (role.startsWith("#")) return role;
  switch (role) {
    case "primary":
      return palette.primary;
    case "secondary":
      return palette.secondary;
    case "accent":
      return palette.accent;
    case "skin":
      return palette.skin;
    case "outline":
      return palette.outline;
    default:
      return role;
  }
}

/* ----------------------------------------------------------------- props -- */

export type PropKind =
  | "cap"
  | "capPointed"
  | "helmet"
  | "tiara"
  | "hairSwoop"
  | "earsRound"
  | "earsPointed"
  | "earsBolt"
  | "snout"
  | "muzzle"
  | "nose"
  | "moustache"
  | "brow"
  | "face"
  | "cheeks"
  | "visor"
  | "tie"
  | "bib"
  | "vest"
  | "belt"
  | "cape"
  | "tunic"
  | "patch"
  | "shoulderPad"
  | "cannon"
  | "sword"
  | "swordLong"
  | "shield"
  | "tailBushy"
  | "tailBolt";

export interface PropDef {
  readonly kind: PropKind;
  readonly bone: BoneName;
  /** Position along the bone: 0 = base, 1 = tip. */
  readonly at: number;
  /** Half-extent in rig units. Shapes are authored in a [-1, 1] box. */
  readonly size: number;
  /** Extra offset along the bone, rig units. */
  readonly along?: number;
  /** Extra offset toward the fighter's front, rig units. */
  readonly across?: number;
  /** Extra rotation in the prop's own frame, radians. */
  readonly angle?: number;
  /** Palette role name or literal hex. */
  readonly colour: string;
  /** Second colour, for props that need one. */
  readonly detail?: string;
  /** "behind" draws before the far-side limbs — capes, tails, back-slung shields. */
  readonly layer?: "behind" | "front";
  /** Mirror the shape's forward axis, for the far-side member of a pair. */
  readonly flip?: boolean;
}

/* -------------------------------------------------------------- the rigs -- */

export interface CharacterRig {
  readonly id: string;
  /** Multiplier on the shared world-to-screen scale. */
  readonly scale: number;
  readonly bones: Rig;
  /** Head circle radius, rig units, centred on the head bone's tip. */
  readonly headRadius: number;
  readonly boneColour: Readonly<Partial<Record<BoneName, string>>>;
  readonly props: readonly PropDef[];
}

type BoneTweak = {
  len?: number;
  thick?: number;
  lenAbs?: number;
  thickAbs?: number;
  angle?: number;
};

/** Build a rig by scaling the reference humanoid. */
function tweakRig(over: Partial<Record<BoneName, BoneTweak>>): Rig {
  const out: Record<string, Bone> = {};
  for (const name of Object.keys(BASE_RIG) as BoneName[]) {
    const base = BASE_RIG[name];
    const t = over[name];
    out[name] = {
      parent: base.parent,
      attach: base.attach,
      angle: t?.angle ?? base.angle,
      length: t?.lenAbs ?? base.length * (t?.len ?? 1),
      thickness: t?.thickAbs ?? base.thickness * (t?.thick ?? 1),
    };
  }
  return out as Rig;
}

/** Apply one tweak to every bone in a group. */
function group(names: readonly BoneName[], t: BoneTweak): Partial<Record<BoneName, BoneTweak>> {
  const out: Partial<Record<BoneName, BoneTweak>> = {};
  for (const n of names) out[n] = t;
  return out;
}

const ARMS: readonly BoneName[] = ["upperArmL", "forearmL", "upperArmR", "forearmR"];
const LEGS: readonly BoneName[] = ["thighL", "shinL", "thighR", "shinR"];
const HANDS: readonly BoneName[] = ["handL", "handR"];
const FEET: readonly BoneName[] = ["footL", "footR"];

/** Two eyes and a pair of pupils, forward of the head's centre. */
function eyes(size: number, iris = "#1B1B22", across = 0.42): PropDef {
  return { kind: "face", bone: "head", at: 1, size, across, colour: "#FFFFFF", detail: iris };
}

// Short, round and big-headed. Mario is the roster's baseline and the shape
// everyone else is read against, so he is drawn as squarely "average person,
// slightly cartooned" — which in a cast containing DK and Kirby is itself
// distinct.
const MARIO: CharacterRig = {
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

// Barrel torso, tiny legs, arms past the knees. Blacked out this is already DK
// and nobody else in the roster.
const DONKEY_KONG: CharacterRig = {
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

// Taller and leaner than Mario, but stockier than Marth: the athletic middle of
// the three humanoids, which is the gap the cap and the shield then widen.
const LINK: CharacterRig = {
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

// Round shoulders and a forearm twice the thickness of the other one. The
// asymmetry is the whole read: no other fighter has one fat arm.
const SAMUS: CharacterRig = {
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

// The sphere.
//
// The torso is vestigial and the head circle *is* the body, so almost the whole
// figure is one shape. The legs are full length but spend most of themselves
// inside that shape; only the oversized feet emerge at the bottom, which is
// exactly the read — a ball balanced on two red boots. Kirby is the one fighter
// with no prop that leaves his outline, because his outline is the prop.
const KIRBY: CharacterRig = {
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

// Short body, long legs, small head — the digitigrade build, which is what makes
// the ears and the tail read as animal rather than as decoration.
const FOX: CharacterRig = {
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

// Head nearly as wide as the body, limbs almost too short to see, and the two
// shapes that leave the outline — the ears and the bolt tail — carry the read.
const PIKACHU: CharacterRig = {
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

// The tallest and by some distance the thinnest, with the smallest head — the
// elongated build that lets the cape and Falchion read as elegant rather than
// as clutter.
const MARTH: CharacterRig = {
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

const DEFAULT_RIG: CharacterRig = {
  id: "default",
  scale: 1,
  bones: BASE_RIG,
  headRadius: 2.3,
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
    handL: "skin",
    handR: "skin",
    footL: "accent",
    footR: "accent",
  },
  props: [eyes(0.7)],
};

export const CHARACTER_RIGS: Readonly<Record<string, CharacterRig>> = {
  mario: MARIO,
  donkeykong: DONKEY_KONG,
  dk: DONKEY_KONG,
  link: LINK,
  samus: SAMUS,
  kirby: KIRBY,
  fox: FOX,
  pikachu: PIKACHU,
  marth: MARTH,
};

/**
 * Look a rig up by fighter id.
 *
 * Normalised rather than exact because `fighters/` is authored independently
 * and could plausibly spell Donkey Kong `donkey-kong`, `donkeyKong` or `dk`.
 * An unknown id falls back to the reference humanoid, which is ugly but never
 * throws — a renderer that crashes on an unrecognised fighter takes the whole
 * match with it.
 */
export function getCharacterRig(id: string | null | undefined): CharacterRig {
  if (!id) return DEFAULT_RIG;
  const key = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  return CHARACTER_RIGS[key] ?? DEFAULT_RIG;
}

/* --------------------------------------------------------------- painting -- */

export type DrawMode = "rim" | "body" | "silhouette";

interface Brush {
  readonly ctx: CanvasRenderingContext2D;
  readonly mode: DrawMode;
  readonly palette: FighterPalette;
  /** Rim inflation expressed in the current local unit. */
  readonly rimLocal: number;
  readonly outline: string;
  /**
   * Paint every shape in this one colour instead of the mode's default flat
   * colour. Only meaningful for `silhouette`, and only the hit flash sets it;
   * props re-derive their own brush, so it has to travel on the brush.
   */
  readonly flat?: string;
  fill(colour: string): void;
  line(colour: string, width: number): void;
}

function makeBrush(
  ctx: CanvasRenderingContext2D,
  mode: DrawMode,
  palette: FighterPalette,
  rimLocal: number,
  flat?: string,
): Brush {
  const outline = flat ?? (mode === "silhouette" ? "#000000" : palette.outline || "#12080F");
  return {
    ctx,
    mode,
    palette,
    rimLocal,
    outline,
    flat,
    fill(colour: string) {
      if (mode === "body") {
        ctx.fillStyle = roleColour(colour, palette);
        ctx.fill();
        return;
      }
      // Rim and silhouette both paint the flat outline colour; the rim also
      // strokes so the shape grows by `rimLocal` on every side.
      ctx.fillStyle = outline;
      ctx.fill();
      if (mode === "rim" && rimLocal > 0) {
        ctx.strokeStyle = outline;
        ctx.lineWidth = rimLocal * 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "square";
        ctx.stroke();
      }
    },
    line(colour: string, width: number) {
      ctx.strokeStyle = mode === "body" ? roleColour(colour, palette) : outline;
      ctx.lineWidth = mode === "body" ? width : width + rimLocal * 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "square";
      ctx.stroke();
    },
  };
}

/* ------------------------------------------------------------ prop shapes -- */

/**
 * Prop painters work in a normalised frame: `+y` runs along the bone toward its
 * tip, `+x` points at the fighter's front, and one unit is the prop's `size`.
 * The frame is mirrored for a left-facing fighter, so "forward" is forward in
 * both directions without a single sign in the shape code.
 */
type PropPainter = (brush: Brush, prop: PropDef) => void;

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot, 0, Math.PI * 2);
  ctx.closePath();
}

function poly(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

const PROP_PAINTERS: Record<PropKind, PropPainter> = {
  // Mario's cap: a dome plus the brim that breaks the head's outline forward.
  cap(b, p) {
    const ctx = b.ctx;
    ctx.beginPath();
    ctx.arc(0, -0.1, 1.02, Math.PI, Math.PI * 2);
    ctx.closePath();
    b.fill(p.colour);
    poly(ctx, [
      [0.1, -0.22],
      [1.5, -0.36],
      [1.62, 0.02],
      [0.1, 0.12],
    ]);
    b.fill(p.colour);
    ellipse(ctx, 0.42, -0.42, 0.34, 0.3);
    b.fill(p.detail ?? "#FFFFFF");
  },

  // Link's cap trails a long way back — a shape no other fighter has.
  capPointed(b, p) {
    const ctx = b.ctx;
    ctx.beginPath();
    ctx.arc(0, -0.1, 1.0, Math.PI, Math.PI * 2);
    ctx.closePath();
    b.fill(p.colour);
    poly(ctx, [
      [-0.4, -0.5],
      [-2.35, 1.05],
      [-1.9, 1.35],
      [-0.15, 0.1],
    ]);
    b.fill(p.colour);
  },

  helmet(b, p) {
    const ctx = b.ctx;
    ellipse(ctx, 0.08, -0.12, 1.06, 1.08);
    b.fill(p.colour);
    poly(ctx, [
      [0.05, -1.0],
      [0.42, -1.9],
      [0.02, -1.05],
      [-0.34, -1.8],
    ]);
    b.fill(p.detail ?? "accent");
  },

  tiara(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.95, -0.12],
      [0.95, -0.12],
      [0.95, 0.2],
      [-0.95, 0.2],
    ]);
    b.fill(p.colour);
    poly(ctx, [
      [0.62, -0.14],
      [0.9, -0.72],
      [1.14, -0.1],
    ]);
    b.fill(p.detail ?? p.colour);
  },

  hairSwoop(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.5, -0.6],
      [1.15, -0.35],
      [1.4, 0.35],
      [0.55, 0.15],
      [0.15, 0.75],
      [-0.4, 0.2],
    ]);
    b.fill(p.colour);
  },

  earsRound(b, p) {
    const ctx = b.ctx;
    ellipse(ctx, -0.55, 0.1, 0.85, 0.95);
    b.fill(p.colour);
    ellipse(ctx, 0.75, 0.05, 0.8, 0.9);
    b.fill(p.colour);
  },

  // Fox and Link: tall triangles rising clear of the skull.
  earsPointed(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.75, 0.1],
      [-1.35, -1.55],
      [-0.05, -0.3],
    ]);
    b.fill(p.colour);
    if (p.detail) {
      poly(ctx, [
        [-0.78, -0.14],
        [-1.18, -1.15],
        [-0.42, -0.42],
      ]);
      b.fill(p.detail);
    }
    poly(ctx, [
      [0.5, 0.05],
      [1.1, -1.6],
      [0.0, -0.35],
    ]);
    b.fill(p.colour);
  },

  // Pikachu: long, tapered, black-tipped. Half his silhouette.
  earsBolt(b, p) {
    const ctx = b.ctx;
    for (const [dx, lean, len] of [
      [-0.32, -0.55, 1.0],
      [0.34, 0.3, 0.94],
    ] as const) {
      poly(ctx, [
        [dx - 0.24, 0.15],
        [dx + lean * 1.15 - 0.16, -1.75 * len],
        [dx + lean * 1.15 + 0.16, -1.72 * len],
        [dx + 0.26, 0.1],
      ]);
      b.fill(p.colour);
      poly(ctx, [
        [dx + lean * 0.92 - 0.2, -1.35 * len],
        [dx + lean * 1.15 - 0.16, -1.75 * len],
        [dx + lean * 1.15 + 0.16, -1.72 * len],
        [dx + lean * 0.92 + 0.22, -1.32 * len],
      ]);
      b.fill(p.detail ?? "#20202C");
    }
  },

  snout(b, p) {
    const ctx = b.ctx;
    ellipse(ctx, 0.55, 0.1, 1.0, 0.62, -0.15);
    b.fill(p.colour);
    ellipse(ctx, 1.3, -0.12, 0.24, 0.2);
    b.fill(p.detail ?? "#2B2118");
  },

  muzzle(b, p) {
    const ctx = b.ctx;
    ellipse(ctx, 0.42, 0.15, 0.95, 0.72);
    b.fill(p.colour);
    ellipse(ctx, 0.62, -0.28, 0.3, 0.22);
    b.fill("#2A1A0E");
  },

  nose(b, p) {
    ellipse(b.ctx, 0, 0, 1, 0.9);
    b.fill(p.colour);
  },

  moustache(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.35, -0.2],
      [0.85, -0.35],
      [1.0, 0.28],
      [0.3, 0.14],
      [-0.3, 0.3],
    ]);
    b.fill(p.colour);
  },

  brow(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.95, -0.3],
      [1.1, -0.55],
      [1.15, 0.12],
      [-0.9, 0.2],
    ]);
    b.fill(p.colour);
  },

  // Two eyes rather than one: a side-on face reads as flat, and the far eye is
  // what turns the pose into Ultimate's three-quarter presentation.
  face(b, p) {
    if (b.mode !== "body") return; // eyes must not thicken the rim silhouette
    const ctx = b.ctx;
    ellipse(ctx, 0.62, -0.05, 0.46, 0.62);
    b.fill(p.colour);
    ellipse(ctx, -0.42, -0.05, 0.38, 0.55);
    b.fill(p.colour);
    ellipse(ctx, 0.74, 0.02, 0.22, 0.34);
    b.fill(p.detail ?? "#20202C");
    ellipse(ctx, -0.34, 0.02, 0.18, 0.3);
    b.fill(p.detail ?? "#20202C");
  },

  cheeks(b, p) {
    if (b.mode !== "body") return;
    const ctx = b.ctx;
    ellipse(ctx, 0.05, 0, 0.62, 0.52);
    b.fill(p.colour);
  },

  visor(b, p) {
    if (b.mode !== "body") return;
    const ctx = b.ctx;
    poly(ctx, [
      [-0.5, -0.35],
      [0.95, -0.5],
      [1.0, 0.3],
      [-0.45, 0.25],
    ]);
    b.fill(p.colour);
  },

  // DK's tie. One small shape, and the single most-cited thing about him.
  tie(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.42, -0.35],
      [0.42, -0.35],
      [0.2, 0.1],
      [-0.2, 0.1],
    ]);
    b.fill(p.colour);
    poly(ctx, [
      [-0.35, 0.05],
      [0.35, 0.05],
      [0.5, 1.55],
      [0, 1.95],
      [-0.5, 1.55],
    ]);
    b.fill(p.colour);
    if (p.detail && b.mode === "body") {
      poly(ctx, [
        [-0.18, 0.55],
        [0.18, 0.55],
        [0.22, 0.95],
        [-0.22, 0.95],
      ]);
      b.fill(p.detail);
    }
  },

  bib(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.95, -1.0],
      [0.95, -1.0],
      [0.8, 0.75],
      [-0.8, 0.75],
    ]);
    b.fill(p.colour);
    if (b.mode === "body" && p.detail) {
      ellipse(ctx, 0.5, 0.45, 0.16, 0.16);
      b.fill(p.detail);
      ellipse(ctx, -0.5, 0.45, 0.16, 0.16);
      b.fill(p.detail);
    }
  },

  vest(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-1.0, -0.95],
      [1.0, -0.95],
      [1.15, 0.85],
      [-1.15, 0.85],
    ]);
    b.fill(p.colour);
    if (b.mode === "body" && p.detail) {
      poly(ctx, [
        [0.2, -0.95],
        [0.95, -0.95],
        [1.05, 0.85],
        [0.35, 0.85],
      ]);
      b.fill(p.detail);
    }
  },

  belt(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-1.0, -0.24],
      [1.0, -0.24],
      [1.0, 0.26],
      [-1.0, 0.26],
    ]);
    b.fill(p.colour);
    if (b.mode === "body" && p.detail) {
      poly(ctx, [
        [0.28, -0.3],
        [0.78, -0.3],
        [0.78, 0.32],
        [0.28, 0.32],
      ]);
      b.fill(p.detail);
    }
  },

  // Drawn behind everything: a big flat shape that widens the silhouette
  // backwards, which is exactly what a cape is for.
  cape(b, p) {
    const ctx = b.ctx;
    ctx.beginPath();
    ctx.moveTo(-0.25, -0.35);
    ctx.lineTo(0.3, -0.3);
    ctx.quadraticCurveTo(0.05, 1.1, -0.85, 1.95);
    ctx.quadraticCurveTo(-1.35, 2.25, -1.5, 1.7);
    ctx.quadraticCurveTo(-1.1, 0.6, -0.95, -0.2);
    ctx.closePath();
    b.fill(p.colour);
  },

  tunic(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.85, -0.9],
      [0.85, -0.9],
      [1.15, 0.9],
      [-1.15, 0.9],
    ]);
    b.fill(p.colour);
  },

  patch(b, p) {
    if (b.mode !== "body") return;
    ellipse(b.ctx, 0, 0, 0.75, 0.95);
    b.fill(p.colour);
  },

  // Samus: round pauldrons wider than her head.
  shoulderPad(b, p) {
    const ctx = b.ctx;
    ellipse(ctx, 0.1, 0.1, 1.0, 0.88, -0.2);
    b.fill(p.colour);
    if (b.mode === "body" && p.detail) {
      ellipse(ctx, 0.25, -0.1, 0.42, 0.34, -0.2);
      b.fill(p.detail);
    }
  },

  // The arm cannon: a cylinder markedly fatter than the arm it replaces.
  cannon(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-1.0, -0.9],
      [1.0, -0.9],
      [1.12, 1.15],
      [-1.12, 1.15],
    ]);
    b.fill(p.colour);
    ellipse(ctx, 0, 1.12, 1.12, 0.45);
    b.fill(p.detail ?? "#2B3138");
    if (b.mode === "body") {
      ellipse(ctx, 0, 1.12, 0.62, 0.25);
      b.fill("#0B0E11");
    }
  },

  // Link's blade: straight, broad, with a crossguard. Drawn from the hand
  // outward along the bone, so it swings with the arm for free.
  sword(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.055, 0.1],
      [0.055, 0.1],
      [0.05, 0.86],
      [0, 0.96],
      [-0.05, 0.86],
    ]);
    b.fill(p.colour);
    poly(ctx, [
      [-0.2, 0.04],
      [0.2, 0.04],
      [0.2, 0.14],
      [-0.2, 0.14],
    ]);
    b.fill(p.detail ?? "accent");
    poly(ctx, [
      [-0.045, -0.22],
      [0.045, -0.22],
      [0.045, 0.04],
      [-0.045, 0.04],
    ]);
    b.fill("#4A2D18");
  },

  // Falchion: longer, thinner, curved to a point, with a winged guard.
  swordLong(b, p) {
    const ctx = b.ctx;
    ctx.beginPath();
    ctx.moveTo(-0.042, 0.08);
    ctx.lineTo(0.042, 0.08);
    ctx.quadraticCurveTo(0.06, 0.7, 0.012, 0.99);
    ctx.quadraticCurveTo(-0.03, 0.72, -0.042, 0.08);
    ctx.closePath();
    b.fill(p.colour);
    poly(ctx, [
      [-0.24, 0.02],
      [-0.1, 0.1],
      [0.1, 0.1],
      [0.24, 0.02],
      [0.16, -0.05],
      [-0.16, -0.05],
    ]);
    b.fill(p.detail ?? "accent");
    poly(ctx, [
      [-0.038, -0.24],
      [0.038, -0.24],
      [0.038, 0.02],
      [-0.038, 0.02],
    ]);
    b.fill("#2B3348");
  },

  shield(b, p) {
    const ctx = b.ctx;
    ctx.beginPath();
    ctx.moveTo(-0.85, -0.95);
    ctx.lineTo(0.85, -0.95);
    ctx.lineTo(0.85, 0.5);
    ctx.quadraticCurveTo(0, 1.35, -0.85, 0.5);
    ctx.closePath();
    b.fill(p.colour);
    if (b.mode === "body") {
      ctx.beginPath();
      ctx.moveTo(-0.55, -0.62);
      ctx.lineTo(0.55, -0.62);
      ctx.lineTo(0.55, 0.32);
      ctx.quadraticCurveTo(0, 0.92, -0.55, 0.32);
      ctx.closePath();
      b.fill(p.detail ?? "accent");
    }
  },

  // Fox: a tapered mass hanging off the hip, the biggest single shape he has.
  tailBushy(b, p) {
    const ctx = b.ctx;
    ctx.beginPath();
    ctx.moveTo(-0.28, 0);
    ctx.quadraticCurveTo(0.55, 0.35, 0.72, 1.15);
    ctx.quadraticCurveTo(0.55, 1.75, 0.02, 1.6);
    ctx.quadraticCurveTo(-0.62, 1.3, -0.62, 0.35);
    ctx.closePath();
    b.fill(p.colour);
    if (b.mode === "body" && p.detail) {
      ellipse(ctx, 0.16, 1.42, 0.42, 0.3, -0.4);
      b.fill(p.detail);
    }
  },

  // Pikachu: the zigzag. Nothing else on the roster is shaped like this.
  tailBolt(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.16, 0],
      [0.16, 0],
      [0.5, 0.55],
      [0.12, 0.6],
      [0.72, 1.1],
      [0.22, 1.2],
      [0.9, 1.85],
      [0.36, 1.9],
      [-0.1, 1.2],
      [0.2, 1.1],
      [-0.24, 0.62],
      [0.06, 0.55],
    ]);
    b.fill(p.colour);
    if (b.mode === "body" && p.detail) {
      poly(ctx, [
        [-0.16, 0],
        [0.16, 0],
        [0.28, 0.3],
        [-0.1, 0.3],
      ]);
      b.fill(p.detail);
    }
  },
};

/* ---------------------------------------------------------- figure drawing -- */

export interface FigureParams {
  readonly rig: CharacterRig;
  readonly palette: FighterPalette;
  readonly pose: PoseSample;
  readonly transform: RigTransform;
  readonly mode: DrawMode;
  /** Rim inflation in screen pixels. */
  readonly rimWidth?: number;
  readonly alpha?: number;
  /**
   * The white flash on a hit victim: `amount` of `colour`, 0..1, painted as a
   * second flat pass over the fighter's own shapes. `body` mode only — the rim
   * stays dark so a flashed fighter keeps his outline.
   */
  readonly tint?: { readonly colour: string; readonly amount: number };
  /**
   * Paint every shape in this one colour, overriding the palette entirely.
   *
   * Distinct from `mode: "silhouette"`, which always means black — that mode
   * exists to check silhouette readability, and a readability check drawn in
   * anything but black is not a readability check. A stock icon, on the other
   * hand, is a flat figure in the *port's* colour, which is why it needs to say
   * so explicitly rather than hope silhouette mode reads its palette.
   */
  readonly flat?: string;
}

function boneColourFor(rig: CharacterRig, name: BoneName): string {
  return rig.boneColour[name] ?? "primary";
}

/** Draw one fighter in one pass. Call twice — `rim`, then `body`. */
export function drawFigure(ctx: CanvasRenderingContext2D, params: FigureParams): Skeleton {
  const { rig, pose, transform, mode } = params;
  const palette = params.palette;
  const skeleton = resolve(rig.bones, pose.angles, transform);
  const rim = mode === "rim" ? (params.rimWidth ?? 5) : 0;
  const scale = Math.abs(transform.scale * (transform.scaleX ?? 1));

  ctx.save();
  if (params.alpha !== undefined && params.alpha < 1) ctx.globalAlpha = params.alpha;
  paintFigure(ctx, makeBrush(ctx, mode, palette, rim, params.flat), rig, skeleton, transform, scale);
  ctx.restore();

  /*
   * The hit flash.
   *
   * A tint has to cover the fighter's own pixels and nothing else, and canvas
   * 2D gives you no way to say that with a composite operation: there is no
   * layer here. `save()`/`restore()` save *state*, not pixels, so
   * `source-atop` + a covering rect composites against everything already on
   * the canvas inside that rect — sky, mountains, clouds, platforms, the other
   * fighter. It shipped as a hard-edged wash over a third of the screen.
   *
   * So paint the figure a second time instead, flat, in the tint colour and at
   * the tint's alpha. Same geometry, same shapes, no compositing mode touched —
   * the flash cannot reach a pixel the fighter does not occupy, because the
   * only thing drawn is the fighter. `silhouette` is that flat pass already:
   * it skips the eyes and the detail shapes, which would otherwise punch
   * colour back through the flash.
   */
  const tint = params.tint;
  if (tint && tint.amount > 0 && mode === "body") {
    ctx.save();
    ctx.globalAlpha = (params.alpha ?? 1) * Math.min(1, tint.amount);
    paintFigure(ctx, makeBrush(ctx, "silhouette", palette, 0, tint.colour), rig, skeleton, transform, scale);
    ctx.restore();
  }

  return skeleton;
}

/**
 * Every shape of one figure, in back-to-front order, with the brush already
 * chosen. Split out of `drawFigure` so the hit flash can run the same geometry
 * twice — once in colour, once flat — rather than reaching for a composite
 * operation that would take the whole canvas with it.
 */
function paintFigure(
  ctx: CanvasRenderingContext2D,
  brush: Brush,
  rig: CharacterRig,
  skeleton: Skeleton,
  transform: RigTransform,
  scale: number,
): void {
  const { mode, palette, rimLocal: rim } = brush;
  const propsBehind = rig.props.filter((p) => p.layer === "behind");
  const propsFront = rig.props.filter((p) => p.layer !== "behind");

  for (const prop of propsBehind) drawProp(ctx, brush, skeleton, prop, transform, scale);

  // Far-side limbs, shaded down so the near side separates from them without a
  // second outline pass.
  drawLimbs(ctx, brush, rig, skeleton, FAR_BONES, mode, palette, rim, -0.24);

  for (const name of ["hip", "torso", "head"] as BoneName[]) {
    const b = skeleton[name];
    if (b.thickness <= 0) continue;
    drawCapsule(
      ctx,
      b.x0,
      b.y0,
      b.x1,
      b.y1,
      b.thickness + rim * 2,
      mode === "body" ? roleColour(boneColourFor(rig, name), palette) : brush.outline,
    );
  }

  // The head circle, centred on the head bone's tip. Skin unless the rig says
  // otherwise — Samus's helmet and DK's fur are armour and pelt, not face.
  const head = skeleton.head;
  ellipse(ctx, head.x1, head.y1, rig.headRadius * scale + rim, rig.headRadius * scale + rim);
  brush.fill(rig.boneColour.head ?? "skin");

  drawLimbs(ctx, brush, rig, skeleton, NEAR_BONES, mode, palette, rim, 0);

  for (const prop of propsFront) drawProp(ctx, brush, skeleton, prop, transform, scale);
}

function drawLimbs(
  ctx: CanvasRenderingContext2D,
  brush: Brush,
  rig: CharacterRig,
  skeleton: Skeleton,
  bones: readonly BoneName[],
  mode: DrawMode,
  palette: FighterPalette,
  rim: number,
  shadeAmount: number,
): void {
  for (const name of bones) {
    const b = skeleton[name];
    if (b.thickness <= 0) continue;
    let colour = brush.outline;
    if (mode === "body") {
      colour = roleColour(boneColourFor(rig, name), palette);
      if (shadeAmount !== 0) colour = shade(colour, shadeAmount);
    }
    drawCapsule(ctx, b.x0, b.y0, b.x1, b.y1, b.thickness + rim * 2, colour);
  }
}

function drawProp(
  ctx: CanvasRenderingContext2D,
  brush: Brush,
  skeleton: Skeleton,
  prop: PropDef,
  transform: RigTransform,
  scale: number,
): void {
  const bone = skeleton[prop.bone];
  let dx = bone.x1 - bone.x0;
  let dy = bone.y1 - bone.y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = 0;
    dy = -1;
  } else {
    dx /= len;
    dy /= len;
  }
  // Perpendicular pointing at the fighter's front before mirroring.
  const px = -dy;
  const py = dx;
  const facing = transform.facing >= 0 ? 1 : -1;
  const flip = prop.flip ? -1 : 1;

  const ax =
    bone.x0 + (bone.x1 - bone.x0) * prop.at + dx * (prop.along ?? 0) * scale + px * (prop.across ?? 0) * scale * facing;
  const ay =
    bone.y0 + (bone.y1 - bone.y0) * prop.at + dy * (prop.along ?? 0) * scale + py * (prop.across ?? 0) * scale * facing;

  const size = prop.size * scale;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.transform(px, py, dx, dy, 0, 0);
  ctx.scale(size * facing * flip, size);
  if (prop.angle) ctx.rotate(prop.angle);
  // The brush's rim is expressed in the local unit, which the scale just changed.
  const local = makeBrush(ctx, brush.mode, brush.palette, size === 0 ? 0 : brush.rimLocal / size, brush.flat);
  PROP_PAINTERS[prop.kind](local, prop);
  ctx.restore();
}

/* ------------------------------------------------------- squash & stretch -- */

/**
 * Landing and taking a hit both squash the root for a few frames.
 *
 * Ultimate does this with the model rig; here it is two numbers multiplied into
 * the transform. It is worth the eight lines: without it a landing is a
 * position change and reads as a stutter, and with it a landing is an impact.
 * Volume is roughly preserved — squashing x by k stretches y by about 1/k — so
 * the fighter does not appear to gain or lose mass.
 */
export function squashFor(fighter: Pick<FighterState, "action" | "actionFrame" | "hitlag">): {
  scaleX: number;
  scaleY: number;
} {
  if (fighter.action === "land" || fighter.action === "landingLag") {
    const k = Math.max(0, 1 - fighter.actionFrame / 6);
    return { scaleX: 1 + 0.22 * k, scaleY: 1 - 0.2 * k };
  }
  if (fighter.hitlag > 0) {
    // Hitlag is the freeze frame; stretching *into* the hit sells the crunch.
    const k = Math.min(1, fighter.hitlag / 8);
    return { scaleX: 1 - 0.14 * k, scaleY: 1 + 0.16 * k };
  }
  if (fighter.action === "jumpSquat") {
    return { scaleX: 1.1, scaleY: 0.88 };
  }
  return { scaleX: 1, scaleY: 1 };
}

/**
 * The shudder both fighters do during hitlag, in world units.
 *
 * Hitlag on a strong hit is nineteen frames — a third of a second — and it is
 * correct that it is: the crunch is Ultimate's, and the formula here matches
 * the published one. But a third of a second in which nothing at all moves does
 * not read as impact, it reads as the game hanging. The vibration is what turns
 * the freeze into a *held* moment, and it is the piece that was missing: the
 * spark is gone after nine frames and the squash is static, so the back half of
 * every heavy hit was a still image.
 *
 * Alternates every frame off the hitlag counter, so it is derived from
 * simulation state and identical on both peers of a rollback, and decays with
 * the counter so the shudder settles rather than stopping dead.
 */
export function hitlagShake(fighter: Pick<FighterState, "hitlag">): number {
  if (fighter.hitlag <= 0) return 0;
  const k = Math.min(1, fighter.hitlag / 10);
  return (fighter.hitlag % 2 === 0 ? 1 : -1) * k * 0.55;
}

/* ----------------------------------------------------- port ring & tag ---- */

/** The soft port-coloured disc under a grounded fighter. */
export function drawPortRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  port: number,
  alpha = 0.65,
): void {
  const colour = PORT_COLOURS[port % PORT_COLOURS.length];
  ctx.save();
  ellipse(ctx, x, y, radius, radius * 0.32);
  ctx.fillStyle = withAlpha(colour, alpha * 0.28);
  ctx.fill();
  ctx.strokeStyle = withAlpha(colour, alpha);
  ctx.lineWidth = Math.max(2, radius * 0.1);
  ctx.lineCap = "square";
  ctx.stroke();
  ctx.restore();
}

/** "P1" / "CPU" on a port-coloured chevron above the head. */
export function drawPortTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  port: number,
  label: string,
  scale = 1,
): void {
  const colour = PORT_COLOURS[port % PORT_COLOURS.length];
  const w = 46 * scale;
  const h = 24 * scale;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + h * 0.22, y - h);
  ctx.lineTo(x + w / 2 + h * 0.22, y - h);
  ctx.lineTo(x + w / 2 - h * 0.22, y);
  ctx.lineTo(x - w / 2 - h * 0.22, y);
  ctx.closePath();
  ctx.fillStyle = withAlpha(PANEL_INK, 0.82);
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2 * scale;
  ctx.lineCap = "square";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 7 * scale, y + 2 * scale);
  ctx.lineTo(x + 7 * scale, y + 2 * scale);
  ctx.lineTo(x, y + 11 * scale);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();

  ctx.fillStyle = colour;
  ctx.font = `italic 900 ${Math.round(15 * scale)}px ${FONT_DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y - h / 2);
  ctx.restore();
}

/* ------------------------------------------------------------- portraits -- */

export const REST_SAMPLE: PoseSample = {
  angles: {},
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

/**
 * The fighter's head, drawn from the same rig the match uses.
 *
 * The HUD portrait and the stock icons are not separate art: they call this,
 * which calls `drawFigure` on a head-only transform. One rig, one set of props,
 * three places it appears — change Pikachu's ears and the HUD changes with him.
 */
export function drawHeadPortrait(
  ctx: CanvasRenderingContext2D,
  rig: CharacterRig,
  palette: FighterPalette,
  x: number,
  y: number,
  size: number,
  facing = 1,
  mode: DrawMode = "body",
): void {
  const scale = size / (rig.headRadius * 2.6);
  const t: RigTransform = {
    x,
    // Place the feet far enough below that only the head lands in the box.
    y: y + (rig.bones.root.length + rig.bones.hip.length + rig.bones.torso.length + rig.bones.head.length) * scale,
    scale,
    facing,
  };
  ctx.save();
  if (mode !== "silhouette") {
    drawFigure(ctx, { rig, palette, pose: REST_SAMPLE, transform: t, mode: "rim", rimWidth: Math.max(2, size * 0.05) });
  }
  drawFigure(ctx, { rig, palette, pose: REST_SAMPLE, transform: t, mode });
  ctx.restore();
}

/** A flat stock icon: the head silhouette in one colour. */
export function drawStockIcon(
  ctx: CanvasRenderingContext2D,
  rig: CharacterRig,
  x: number,
  y: number,
  size: number,
  colour: string,
): void {
  const flat: FighterPalette = {
    primary: colour,
    secondary: colour,
    accent: colour,
    skin: colour,
    outline: colour,
    alts: [],
  };
  const scale = size / (rig.headRadius * 2.4);
  const t: RigTransform = {
    x,
    y: y + (rig.bones.root.length + rig.bones.hip.length + rig.bones.torso.length + rig.bones.head.length) * scale,
    scale,
    facing: 1,
  };
  drawFigure(ctx, {
    rig,
    palette: flat,
    pose: REST_SAMPLE,
    transform: t,
    mode: "silhouette",
    // Without this the icon comes out black whatever the caller asked for:
    // silhouette mode hardcodes black, so the flat palette above was dead and
    // every port's stocks looked identical.
    flat: colour,
  });
}
