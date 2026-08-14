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

import type { FighterPalette, FighterState } from "@/engine/types";
import type { PoseSample } from "./poses";
import {
  FAR_BONES,
  NEAR_BONES,
  drawCapsule,
  resolve,
  rigHeight,
  type BoneName,
  type RigTransform,
  type Skeleton,
} from "./skeleton";

import {
  PANEL_INK,
  PORT_COLOURS,
  PROP_STILL,
  ellipse,
  poly,
  roleColour,
  shade,
  withAlpha,
  type Brush,
  type CharacterRig,
  type DrawMode,
  type PropAnim,
  type PropDef,
  type PropKind,
  type PropPainter,
} from "./rigKit";

/* ------------------------------------------------------------------ type -- */

/** Anton for numerals and display, M PLUS Rounded 1c for menus (SPEC §10). */
export const FONT_DISPLAY = "'Anton', 'Arial Narrow', Haettenschweiler, Impact, sans-serif";
export const FONT_UI = "'M PLUS Rounded 1c', 'Trebuchet MS', system-ui, sans-serif";

/**
 * Re-exported so the rest of the renderer keeps one import for "character art".
 *
 * The definitions themselves moved to `rigKit.ts` and `chars/`, which is what
 * lets a fighter's own file import the vocabulary without importing the
 * renderer that consumes it.
 */
export {
  PORT_COLOURS,
  SMASH_RED,
  SMASH_RED_LIT,
  SMASH_YELLOW,
  PANEL_INK,
  alphaOf,
  hexToRgb,
  rgbToHex,
  shade,
  mixHex,
  withAlpha,
  resolvePalette,
  roleColour,
  ellipse,
  poly,
  tweakRig,
  group,
  eyes,
  ARMS,
  LEGS,
  HANDS,
  FEET,
  DEFAULT_RIG,
  PROP_STILL,
  propAnimFor,
  rimWidthFor,
  type Brush,
  type DrawMode,
  type PropAnim,
  type PropDef,
  type PropKind,
  type PropPainter,
  type CharacterRig,
  type BoneTweak,
} from "./rigKit";
export { CHARACTER_RIGS, getCharacterRig } from "./chars";

/* --------------------------------------------------------------- painting -- */

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
 *
 * `custom` is the escape hatch: it paints `prop.draw`, which lives in the
 * fighter's own file. Everything below is shared, and a shared table is a file
 * eight people cannot add to at once.
 */
export const PROP_PAINTERS: Record<PropKind, PropPainter> = {
  custom(b, p, anim) {
    p.draw?.(b, p, anim);
  },

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
  /**
   * A pair of tapered ears standing up off the head.
   *
   * Both ear painters had every `y` negated, which put their tips *below* the
   * base — and a prop's local `+y` runs along its bone toward the tip, so on
   * `head` that meant both ears grew down into the skull and what showed was a
   * dark nub on the jaw. Three character agents hit it independently and two
   * routed around it with a `custom` prop before anyone fixed the painter.
   */
  earsPointed(b, p) {
    const ctx = b.ctx;
    poly(ctx, [
      [-0.75, -0.1],
      [-1.35, 1.55],
      [-0.05, 0.3],
    ]);
    b.fill(p.colour);
    if (p.detail) {
      poly(ctx, [
        [-0.78, 0.14],
        [-1.18, 1.15],
        [-0.42, 0.42],
      ]);
      b.fill(p.detail);
    }
    poly(ctx, [
      [0.5, -0.05],
      [1.1, 1.6],
      [0.0, 0.35],
    ]);
    b.fill(p.colour);
  },

  // Pikachu: long, tapered, black-tipped. Half his silhouette.
  /** Pikachu's lightning-bolt ears. Same sign fix as `earsPointed`. */
  earsBolt(b, p) {
    const ctx = b.ctx;
    for (const [dx, lean, len] of [
      [-0.32, -0.55, 1.0],
      [0.34, 0.3, 0.94],
    ] as const) {
      poly(ctx, [
        [dx - 0.24, -0.15],
        [dx + lean * 1.15 - 0.16, 1.75 * len],
        [dx + lean * 1.15 + 0.16, 1.72 * len],
        [dx + 0.26, -0.1],
      ]);
      b.fill(p.colour);
      poly(ctx, [
        [dx + lean * 0.92 - 0.2, 1.35 * len],
        [dx + lean * 1.15 - 0.16, 1.75 * len],
        [dx + lean * 1.15 + 0.16, 1.72 * len],
        [dx + lean * 0.92 + 0.22, 1.32 * len],
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
  /**
   * The clock and velocity a soft prop moves on. Omitted means still — see
   * `PROP_STILL`, which is what a stock icon or a portrait gets.
   */
  readonly anim?: PropAnim;
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

  const anim = params.anim ?? PROP_STILL;

  ctx.save();
  if (params.alpha !== undefined && params.alpha < 1) ctx.globalAlpha = params.alpha;
  paintFigure(ctx, makeBrush(ctx, mode, palette, rim, params.flat), rig, skeleton, transform, scale, anim);
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
    paintFigure(ctx, makeBrush(ctx, "silhouette", palette, 0, tint.colour), rig, skeleton, transform, scale, anim);
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
  anim: PropAnim,
): void {
  const { mode, palette, rimLocal: rim } = brush;
  const propsBehind = rig.props.filter((p) => p.layer === "behind");
  const propsFront = rig.props.filter((p) => p.layer !== "behind");

  for (const prop of propsBehind) drawProp(ctx, brush, skeleton, prop, transform, scale, anim);

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

  for (const prop of propsFront) drawProp(ctx, brush, skeleton, prop, transform, scale, anim);
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
  anim: PropAnim,
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
  PROP_PAINTERS[prop.kind](local, prop, anim);
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
/**
 * Height about which a whole-body rotation turns, in rig units.
 *
 * Exported because tests that measure what the game draws have to use the same
 * pivot, and the alternative is each of them re-deriving the expression and
 * silently drifting the day it changes.
 */
export function rotationPivot(rig: CharacterRig): number {
  return rigHeight(rig.bones, rig.headRadius) * 0.45;
}

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
