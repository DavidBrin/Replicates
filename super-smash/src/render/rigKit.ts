/**
 * The kit a character's rig is authored with.
 *
 * Split out of `characterArt.ts` so that a fighter's own art file can import
 * the vocabulary — proportions, palette roles, prop shapes — without importing
 * the renderer that consumes it. Eight people working on eight characters at
 * once is only safe if each one has a file nobody else opens, and that is only
 * possible if the shared parts are somewhere neither of them has to edit.
 *
 * Nothing here imports anything from `render/`, deliberately. It is the bottom
 * of the graph.
 */

import { toFloat } from "@/engine/fixed";
import type { FighterDef, FighterPalette, FighterState } from "@/engine/types";
import { BASE_RIG, type Bone, type BoneName, type Rig } from "./skeleton";

/* --------------------------------------------------------------- colours -- */

/** Sampled from Ultimate's HUD (SPEC §10). Port order is P1..P4. */
export const PORT_COLOURS: readonly string[] = ["#FE3636", "#3B7BFE", "#FFC61E", "#35C759"];

export const SMASH_RED = "#AD0000";
export const SMASH_RED_LIT = "#C10500";
export const SMASH_YELLOW = "#FFD500";
export const PANEL_INK = "#090B0C";

/**
 * A colour's channels, from `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)`.
 *
 * The `rgb()` forms are here because leaving them out was a silent wrong
 * answer, not a missing feature. Every helper below routes through this
 * function, and an unparseable colour used to come back as **black** — so
 * `withAlpha(withAlpha(c, 0.4), 0.2)` was black, and so was any colour that had
 * been through `withAlpha` once before being handed to `glow`, `mixHex` or
 * `shade`. That is not a rare shape: `glow` takes an `inner` colour that
 * naturally arrives carrying its own alpha, and re-alphas it for the mid stop.
 * Two characters' effects hit it independently, and the symptom is a black ring
 * where a glow should be, or — under `lighter` compositing, where black is the
 * identity — nothing at all, which reads as the effect simply not working.
 */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim();

  const fn = /^rgba?\(([^)]+)\)$/i.exec(h);
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter((p) => p !== "");
    const channel = (raw: string | undefined): number => {
      if (raw === undefined) return 0;
      const v = raw.endsWith("%") ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw);
      return Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
    };
    return [channel(parts[0]), channel(parts[1]), channel(parts[2])];
  }

  let body = h.startsWith("#") ? h.slice(1) : h;
  if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  const n = Number.parseInt(body.slice(0, 6), 16);
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

/**
 * A colour's own opacity: 1 for anything that does not carry one.
 *
 * Needed because `withAlpha` *replaces* an alpha rather than scaling it, so
 * anything deriving a fainter version of a colour that is already fading has to
 * ask what it is fading from first.
 */
export function alphaOf(colour: string): number {
  const m = /^rgba\(([^)]+)\)$/i.exec(colour.trim());
  if (!m) return 1;
  const parts = m[1].split(/[,/\s]+/).filter((p) => p !== "");
  if (parts.length < 4) return 1;
  const a = Number.parseFloat(parts[3]);
  return Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
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

/**
 * Resolve a colour that may be a palette role or a literal.
 *
 * A role follows the costume; a literal does not. That distinction is the whole
 * reason both exist — Mario's gloves stay white in every costume, his overalls
 * do not.
 */
export function roleColour(role: string, palette: FighterPalette): string {
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
  | "tailBolt"
  /**
   * A shape the fighter paints themselves, via `PropDef.draw`.
   *
   * The other thirty kinds are a shared table, which means adding one is an
   * edit to a file every other fighter also lives in. That is exactly the
   * shape of change that cannot happen while eight characters are being worked
   * on at once, and the cost of not having it is worse than the collision:
   * whoever needs Link's hookshot or Samus's grapple beam either fakes it out
   * of a `patch` or does without. `custom` puts the shape in the fighter's own
   * file, where it belongs anyway — nobody else is ever going to draw a
   * hookshot.
   */
  | "custom";

/**
 * A shape hung off a bone.
 *
 * Painted in a normalised frame: `+y` runs along the bone toward its tip, `+x`
 * points at the fighter's front, and one unit is the prop's `size`. The frame
 * is mirrored for a left-facing fighter, so "forward" is forward in both
 * directions without a single sign in the shape code.
 */
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
  /**
   * Paint this prop, for `kind: "custom"`.
   *
   * Ignored by every other kind. Use `brush.fill`/`brush.line` rather than the
   * context's own fill and stroke: the figure is drawn twice, once inflated in
   * the outline colour and once in body colours, and a painter that sets
   * `ctx.fillStyle` itself paints its colour into the rim pass and punches a
   * hole in the fighter's silhouette.
   */
  readonly draw?: PropPainter;
}

/** How a prop's shape is painted, in the prop's own normalised frame. */
export type PropPainter = (brush: Brush, prop: PropDef, anim: PropAnim) => void;

/**
 * The motion a prop is allowed to have of its own.
 *
 * A prop is a shape bolted rigidly to a bone, so it can only move when the pose
 * moves the bone it hangs from. That is right for a shoulder pad and wrong for
 * everything soft: a tail, a cape, a scarf, hair. What makes those read is
 * precisely that they *don't* move with the body — they lag it, overshoot it,
 * and settle late, and none of that is expressible in a pose because it is not
 * a property of the skeleton.
 *
 * The honest fix is a second simulation, and this is not that. It is the two
 * inputs that get most of the way there for free: a clock, so a prop can idle
 * on its own cycle, and the fighter's velocity, so it can stream behind them.
 * A tail that sways on `frame` and trails on `-vx` reads as a tail, which was
 * the thing that could not be done at all.
 *
 * Every field is in the **prop's** frame, so `vx` is positive when the fighter
 * is moving the way they are facing whichever way that is. Painters never see a
 * facing and must not branch on one.
 */
export interface PropAnim {
  /** The global frame. A prop's own clock, for idle sway and flicker. */
  readonly frame: number;
  /** 0..1 through the current action, or 0 when the fighter is not in one. */
  readonly t: number;
  /**
   * Velocity in **world units per frame**, decoded: `+x` the way the fighter
   * faces, `+y` up. A walk is on the order of 1, a full run 2–3.
   *
   * Decoded matters. The simulation is Q12 fixed point and this shipped passing
   * `f.vx` through raw, so a full run arrived as 9839 instead of 2.402 — three
   * orders of magnitude, in a field whose documented example multiplied it by
   * 0.35 to get radians. The author who found it compensated in their own
   * painter with `toFloat`, which is what a wrong unit always produces: every author
   * inventing a different correction, and the ones who don't notice shipping
   * something wild. The renderer converts now, so a painter must not.
   */
  readonly vx: number;
  readonly vy: number;
  /** Off the ground — a tail hangs differently in the air than in a run. */
  readonly airborne: boolean;
}

/**
 * What a prop with no animation behind it gets.
 *
 * Stock icons, the character-select portraits and the silhouette check all draw
 * a figure with no match and no clock, and a prop that swayed there would make
 * two portraits of the same fighter differ for no reason a reader could see.
 */
export const PROP_STILL: PropAnim = { frame: 0, t: 0, vx: 0, vy: 0, airborne: false };

/**
 * Build a `PropAnim` from a fighter. The one definition, on purpose.
 *
 * The renderer and the animation lab both draw fighters, and the lab is only
 * worth looking at while it agrees with the match — an author who tunes a tail
 * against a lab that computes its inputs differently is tuning against a
 * fiction. The lab shipped not passing `anim` at all, so the tool built for
 * reviewing motion was the one place prop motion could not be seen; had it
 * instead grown its own copy of this arithmetic, the disagreement would have
 * been quieter and worse.
 *
 * `toFloat` is the whole reason this is a function rather than an object
 * literal at each call site. See `PropAnim.vx`.
 */
export function propAnimFor(
  f: Pick<FighterState, "vx" | "vy" | "facing" | "grounded" | "actionFrame">,
  frame: number,
  /** The current move's length, or 0 when the fighter is not performing one. */
  totalFrames: number,
): PropAnim {
  return {
    frame,
    t: totalFrames > 0 ? Math.min(1, f.actionFrame / totalFrames) : 0,
    vx: toFloat(f.vx) * (f.facing >= 0 ? 1 : -1),
    vy: toFloat(f.vy),
    airborne: !f.grounded,
  };
}

/** What a prop painter paints with. See `PropDef.draw`. */
export interface Brush {
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
  /** Fill the current path in a palette role or literal colour. */
  fill(colour: string): void;
  /** Stroke the current path. */
  line(colour: string, width: number): void;
}

export type DrawMode = "rim" | "body" | "silhouette";

/* ------------------------------------------------------- shape primitives -- */

export function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot, 0, Math.PI * 2);
  ctx.closePath();
}

export function poly(
  ctx: CanvasRenderingContext2D,
  pts: readonly (readonly [number, number])[],
): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
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

export type BoneTweak = {
  len?: number;
  thick?: number;
  lenAbs?: number;
  thickAbs?: number;
  angle?: number;
};

/** Build a rig by scaling the reference humanoid. */
export function tweakRig(over: Partial<Record<BoneName, BoneTweak>>): Rig {
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
export function group(
  names: readonly BoneName[],
  t: BoneTweak,
): Partial<Record<BoneName, BoneTweak>> {
  const out: Partial<Record<BoneName, BoneTweak>> = {};
  for (const n of names) out[n] = t;
  return out;
}

export const ARMS: readonly BoneName[] = ["upperArmL", "forearmL", "upperArmR", "forearmR"];
export const LEGS: readonly BoneName[] = ["thighL", "shinL", "thighR", "shinR"];
export const HANDS: readonly BoneName[] = ["handL", "handR"];
export const FEET: readonly BoneName[] = ["footL", "footR"];

/** Two eyes and a pair of pupils, forward of the head's centre. */
export function eyes(size: number, iris = "#1B1B22", across = 0.42): PropDef {
  return { kind: "face", bone: "head", at: 1, size, across, colour: "#FFFFFF", detail: iris };
}

/**
 * The reference humanoid, for an id the roster does not know.
 *
 * Ugly but it never throws — a renderer that crashes on an unrecognised
 * fighter takes the whole match with it.
 */
export const DEFAULT_RIG: CharacterRig = {
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
