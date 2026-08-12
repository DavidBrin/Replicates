/**
 * Stage geometry and backgrounds.
 *
 * Geometry comes entirely from `StageDef` — nothing in this file knows how wide
 * Battlefield is. That matters more than it sounds: the stage list carries
 * measured competitive geometry (SPEC §8) and every stage also has an Ω form and
 * a Battlefield form, so hard-coding a single layout would mean three copies of
 * each stage's art and three chances to disagree with the collision the engine
 * actually uses. What the renderer supplies is the *skin*: the slab profile, the
 * ledge lip, and a parallax background chosen by `StageDef.theme`.
 *
 * The backgrounds are geometric and atmospheric rather than literal. That is
 * partly the same copyright constraint that produced the procedural fighters,
 * and partly a readability decision — a busy background is where a fighting
 * game loses its silhouettes, and gradients with a couple of parallax
 * silhouette layers sit behind four fighters without competing with them.
 */

import { toFloat } from "@/engine/fixed";
import type { Platform, StageDef } from "@/engine/types";
import { VIEW_HEIGHT, VIEW_WIDTH, worldToScreen, type Camera } from "./camera";
import { withAlpha } from "./characterArt";

export type StageTheme =
  | "battlefield"
  | "finalDestination"
  | "smashville"
  | "townAndCity"
  | "stadium"
  | "neutral";

/**
 * Map a stage's free-form `theme` string onto one of the painters.
 *
 * Substring matching rather than an exact table because `stages/` is authored
 * by a different slice and a theme could plausibly arrive as `"battlefield"`,
 * `"bf"` or `"small-battlefield"`. An unrecognised theme gets the neutral sky,
 * which is never wrong, only unremarkable.
 */
export function themeFor(theme: string | null | undefined): StageTheme {
  const t = (theme ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (t.includes("finaldestination") || t.includes("fd") || t.includes("space")) return "finalDestination";
  if (t.includes("smashville")) return "smashville";
  if (t.includes("towncity") || t.includes("townandcity") || t.includes("city")) return "townAndCity";
  if (t.includes("stadium") || t.includes("pokemon")) return "stadium";
  if (t.includes("battlefield") || t.includes("bf")) return "battlefield";
  return "neutral";
}

/* --------------------------------------------------------- moving platforms -- */

/**
 * Where a sweeping platform is on a given frame.
 *
 * Smashville's platform is the only one that moves, and its position is *not*
 * in `GameState` — it is a pure function of the frame number, which is what lets
 * it roll back for free along with everything else. The renderer therefore has
 * to recompute it with the same formula the collision uses; the coupling is
 * unavoidable and is at least confined to this one function.
 */
export function platformOffsetX(platform: Platform, frame: number): number {
  if (!platform.motion || platform.motion.kind !== "sweep") return 0;
  const period = platform.motion.periodFrames || 1;
  return toFloat(platform.motion.amplitude) * Math.sin((2 * Math.PI * frame) / period);
}

/* ---------------------------------------------------------------- painting -- */

export interface StagePaint {
  readonly top: string;
  readonly face: string;
  readonly deep: string;
  readonly edge: string;
  readonly soft: string;
  readonly softEdge: string;
}

const PAINTS: Record<StageTheme, StagePaint> = {
  battlefield: {
    top: "#6FA8D6",
    face: "#2E4A73",
    deep: "#16233A",
    edge: "#9FD2F2",
    soft: "#3A5D8C",
    softEdge: "#8FC4EA",
  },
  finalDestination: {
    top: "#8E6FD6",
    face: "#3A2A63",
    deep: "#1A1230",
    edge: "#C9A8FF",
    soft: "#463579",
    softEdge: "#C9A8FF",
  },
  smashville: {
    top: "#7ECB5A",
    face: "#4A7A38",
    deep: "#22401C",
    edge: "#CFEFA8",
    soft: "#8A6A44",
    softEdge: "#D8B98A",
  },
  townAndCity: {
    top: "#C9CEDA",
    face: "#5D6579",
    deep: "#2A2F3E",
    edge: "#F2F4FA",
    soft: "#6C7488",
    softEdge: "#E2E6F0",
  },
  stadium: {
    top: "#C8B58A",
    face: "#7A6947",
    deep: "#3A3222",
    edge: "#EFE3C2",
    soft: "#8A7A57",
    softEdge: "#E6D8B4",
  },
  neutral: {
    top: "#9AA4B2",
    face: "#4A5262",
    deep: "#232833",
    edge: "#D4DAE4",
    soft: "#5A6272",
    softEdge: "#D4DAE4",
  },
};

/** How far below its top surface a main platform's body is drawn, in units. */
const MAIN_DEPTH = 46;
const SOFT_THICKNESS = 2.6;
const LEDGE_LIP = 2.2;

export function drawPlatforms(
  ctx: CanvasRenderingContext2D,
  stage: StageDef,
  cam: Camera,
  frame: number,
): void {
  const paint = PAINTS[themeFor(stage.theme)];
  ctx.save();
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";

  for (const platform of stage.platforms) {
    const dx = platformOffsetX(platform, frame);
    const cx = toFloat(platform.x) + dx;
    const half = toFloat(platform.halfWidth);
    const top = toFloat(platform.y);

    if (platform.soft) drawSoftPlatform(ctx, cam, paint, cx, top, half);
    else drawMainPlatform(ctx, cam, paint, cx, top, half, platform.ledges);
  }
  ctx.restore();
}

function drawMainPlatform(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  paint: StagePaint,
  cx: number,
  top: number,
  half: number,
  ledges: boolean,
): void {
  const tl = worldToScreen(cam, cx - half, top);
  const tr = worldToScreen(cam, cx + half, top);
  const bl = worldToScreen(cam, cx - half * 0.62, top - MAIN_DEPTH);
  const br = worldToScreen(cam, cx + half * 0.62, top - MAIN_DEPTH);

  // Body: a trapezoid narrowing downward, which is what makes a floating
  // platform read as a solid object rather than as a line.
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  const g = ctx.createLinearGradient(tl.x, tl.y, bl.x, bl.y);
  g.addColorStop(0, paint.face);
  g.addColorStop(1, paint.deep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = paint.deep;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Top surface.
  const surfaceH = Math.max(4, 1.4 * cam.zoom);
  ctx.fillStyle = paint.top;
  ctx.fillRect(tl.x, tl.y - surfaceH, tr.x - tl.x, surfaceH);

  if (ledges) {
    // The grabbable lip, brightened. A player has to be able to see exactly
    // where the ledge is from across the stage.
    const lip = LEDGE_LIP * cam.zoom;
    ctx.fillStyle = paint.edge;
    ctx.fillRect(tl.x - lip * 0.4, tl.y - surfaceH, lip, surfaceH + lip * 1.4);
    ctx.fillRect(tr.x - lip * 0.6, tl.y - surfaceH, lip, surfaceH + lip * 1.4);
  }
}

function drawSoftPlatform(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  paint: StagePaint,
  cx: number,
  top: number,
  half: number,
): void {
  const tl = worldToScreen(cam, cx - half, top);
  const tr = worldToScreen(cam, cx + half, top);
  const h = Math.max(5, SOFT_THICKNESS * cam.zoom);

  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(tr.x - h * 0.5, tl.y + h);
  ctx.lineTo(tl.x + h * 0.5, tl.y + h);
  ctx.closePath();
  ctx.fillStyle = paint.soft;
  ctx.fill();
  ctx.strokeStyle = withAlpha(paint.softEdge, 0.6);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = paint.softEdge;
  ctx.fillRect(tl.x, tl.y - Math.max(2, h * 0.28), tr.x - tl.x, Math.max(2, h * 0.28));
}

/* ------------------------------------------------------------- backgrounds -- */

/**
 * Parallax factors.
 *
 * Zero is painted-on-the-sky and one moves with the world. Three layers is
 * enough for depth and few enough that the eye never resolves them as
 * separate planes.
 */
const FAR = 0.06;
const MID = 0.18;
const NEAR = 0.42;

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  stage: StageDef,
  cam: Camera,
  frame: number,
): void {
  const theme = themeFor(stage.theme);
  ctx.save();
  switch (theme) {
    case "battlefield":
      drawBattlefieldSky(ctx, cam, frame);
      break;
    case "finalDestination":
      drawSpace(ctx, cam, frame);
      break;
    case "smashville":
      drawTownDay(ctx, cam, frame);
      break;
    case "townAndCity":
      drawCityDusk(ctx, cam, frame);
      break;
    case "stadium":
      drawStadium(ctx, cam, frame);
      break;
    default:
      drawNeutralSky(ctx);
  }
  ctx.restore();
}

function fillSky(ctx: CanvasRenderingContext2D, stops: readonly (readonly [number, string])[]): void {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
}

/** Horizontal parallax offset, wrapped so a layer can tile forever. */
function parallax(cam: Camera, factor: number, period: number): number {
  const raw = -cam.x * cam.zoom * factor;
  return ((raw % period) + period) % period;
}

function drawBattlefieldSky(ctx: CanvasRenderingContext2D, cam: Camera, frame: number): void {
  fillSky(ctx, [
    [0, "#0B1030"],
    [0.42, "#243A72"],
    [0.72, "#4E6BA8"],
    [1, "#8FA9CE"],
  ]);

  // A low sun, sitting behind everything.
  const sun = 300;
  const g = ctx.createRadialGradient(VIEW_WIDTH * 0.68, VIEW_HEIGHT * 0.74, 0, VIEW_WIDTH * 0.68, VIEW_HEIGHT * 0.74, sun);
  g.addColorStop(0, "rgba(255,214,150,0.55)");
  g.addColorStop(1, "rgba(255,214,150,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  ridge(ctx, cam, FAR, VIEW_HEIGHT * 0.68, 250, "rgba(20,30,62,0.7)", 620, 0);
  ridge(ctx, cam, MID, VIEW_HEIGHT * 0.78, 180, "rgba(13,20,44,0.85)", 480, 140);
  clouds(ctx, cam, frame, NEAR, "rgba(180,200,235,0.14)");
  motes(ctx, frame, "rgba(255,236,190,0.5)");
}

function drawSpace(ctx: CanvasRenderingContext2D, cam: Camera, frame: number): void {
  fillSky(ctx, [
    [0, "#05030F"],
    [0.55, "#140B2C"],
    [1, "#2A1046"],
  ]);

  // Starfield. Positions come from an integer hash rather than an array, so
  // there is nothing to allocate and the field is identical every frame.
  const off = parallax(cam, FAR, VIEW_WIDTH);
  ctx.fillStyle = "#FFFFFF";
  for (let i = 0; i < 170; i++) {
    const h = (i * 2654435761) >>> 0;
    const x = ((h % VIEW_WIDTH) + off) % VIEW_WIDTH;
    const y = ((h >>> 11) % (VIEW_HEIGHT - 200)) + 10;
    const twinkle = 0.35 + 0.65 * Math.abs(Math.sin((frame + i * 13) / 40));
    ctx.globalAlpha = twinkle * (0.25 + ((h >>> 22) % 60) / 100);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;

  const neb = ctx.createRadialGradient(VIEW_WIDTH * 0.3, VIEW_HEIGHT * 0.4, 0, VIEW_WIDTH * 0.3, VIEW_HEIGHT * 0.4, 640);
  neb.addColorStop(0, "rgba(120,60,190,0.30)");
  neb.addColorStop(1, "rgba(120,60,190,0)");
  ctx.fillStyle = neb;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  // A planet limb, low and slow.
  const px = VIEW_WIDTH * 0.78 - cam.x * cam.zoom * MID * 0.4;
  ctx.beginPath();
  ctx.arc(px, VIEW_HEIGHT * 1.28, 620, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(56,26,96,0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(190,140,255,0.5)";
  ctx.lineWidth = 4;
  ctx.lineCap = "butt";
  ctx.stroke();
}

function drawTownDay(ctx: CanvasRenderingContext2D, cam: Camera, frame: number): void {
  fillSky(ctx, [
    [0, "#4FA8E8"],
    [0.6, "#9CD4F2"],
    [1, "#D9EEC4"],
  ]);
  clouds(ctx, cam, frame, MID, "rgba(255,255,255,0.72)");
  ridge(ctx, cam, MID, VIEW_HEIGHT * 0.82, 120, "rgba(96,160,88,0.9)", 700, 200);
  ridge(ctx, cam, NEAR, VIEW_HEIGHT * 0.9, 90, "rgba(64,124,62,0.95)", 520, 60);

  // The balloon, drifting on its own clock so it is not locked to the camera.
  const bx = (VIEW_WIDTH * 0.2 + frame * 0.35) % (VIEW_WIDTH + 300) - 150;
  const by = VIEW_HEIGHT * 0.24 + Math.sin(frame / 90) * 26;
  ctx.beginPath();
  ctx.arc(bx, by, 34, 0, Math.PI * 2);
  ctx.fillStyle = "#F2E15A";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx - 10, by + 30);
  ctx.lineTo(bx - 6, by + 58);
  ctx.lineTo(bx + 6, by + 58);
  ctx.lineTo(bx + 10, by + 30);
  ctx.closePath();
  ctx.fillStyle = "#8A5A2A";
  ctx.fill();
}

function drawCityDusk(ctx: CanvasRenderingContext2D, cam: Camera, frame: number): void {
  fillSky(ctx, [
    [0, "#1B1640"],
    [0.5, "#5A3266"],
    [0.78, "#C56A4E"],
    [1, "#F0A45C"],
  ]);
  skyline(ctx, cam, FAR, VIEW_HEIGHT * 0.74, 210, "rgba(24,20,52,0.75)", 137, frame, false);
  skyline(ctx, cam, MID, VIEW_HEIGHT * 0.82, 300, "rgba(14,12,34,0.9)", 91, frame, true);
  skyline(ctx, cam, NEAR, VIEW_HEIGHT * 0.94, 260, "rgba(7,6,20,0.96)", 53, frame, true);
}

function drawStadium(ctx: CanvasRenderingContext2D, cam: Camera, frame: number): void {
  fillSky(ctx, [
    [0, "#12233A"],
    [0.5, "#264062"],
    [1, "#3E6A4A"],
  ]);
  // Stands: two bands of tightly packed rectangles, which at this distance read
  // as a crowd without a single person being drawn.
  const off = parallax(cam, MID, 26);
  for (let band = 0; band < 2; band++) {
    const y = VIEW_HEIGHT * (0.42 + band * 0.1);
    for (let i = -1; i < VIEW_WIDTH / 26 + 2; i++) {
      const h = ((i * 2654435761) >>> (10 + band)) % 14;
      ctx.fillStyle = band === 0 ? "rgba(40,58,84,0.9)" : "rgba(28,42,64,0.95)";
      ctx.fillRect(i * 26 + off, y + h, 22, 60 - h);
    }
  }
  // Floodlights.
  for (const fx of [0.18, 0.82]) {
    const g = ctx.createRadialGradient(VIEW_WIDTH * fx, VIEW_HEIGHT * 0.12, 0, VIEW_WIDTH * fx, VIEW_HEIGHT * 0.12, 420);
    g.addColorStop(0, `rgba(255,250,220,${0.24 + 0.03 * Math.sin(frame / 50)})`);
    g.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  }
}

function drawNeutralSky(ctx: CanvasRenderingContext2D): void {
  fillSky(ctx, [
    [0, "#141926"],
    [0.6, "#2A3346"],
    [1, "#49556B"],
  ]);
}

/* ---------------------------------------------------------- background bits -- */

/** A silhouetted mountain ridge, tiled horizontally. */
function ridge(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  factor: number,
  baseY: number,
  height: number,
  colour: string,
  period: number,
  phase: number,
): void {
  const off = parallax(cam, factor, period);
  ctx.beginPath();
  ctx.moveTo(-period, VIEW_HEIGHT);
  for (let x = -period; x <= VIEW_WIDTH + period; x += period / 2) {
    const peak = ((x + phase) / period) % 2 === 0 ? height : height * 0.62;
    ctx.lineTo(x + off, baseY - peak);
    ctx.lineTo(x + off + period / 4, baseY - peak * 0.35);
  }
  ctx.lineTo(VIEW_WIDTH + period, VIEW_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/** A tiled city skyline, optionally with lit windows. */
function skyline(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  factor: number,
  baseY: number,
  maxHeight: number,
  colour: string,
  seed: number,
  frame: number,
  windows: boolean,
): void {
  const w = 74;
  const off = parallax(cam, factor, w);
  ctx.fillStyle = colour;
  for (let i = -1; i < VIEW_WIDTH / w + 2; i++) {
    const h = ((Math.imul(i + seed, 2654435761) >>> 8) % maxHeight) + maxHeight * 0.25;
    const x = i * w + off;
    ctx.fillRect(x, baseY - h, w - 8, h + 300);
    if (!windows) continue;
    ctx.fillStyle = "rgba(255,214,120,0.5)";
    for (let r = 0; r < Math.floor(h / 34); r++) {
      for (let c = 0; c < 3; c++) {
        const lit = (Math.imul(i * 31 + r * 7 + c, 2246822519) >>> 13) % 5;
        if (lit > 1) continue;
        // A handful of windows blink, on a long cycle.
        if (((Math.imul(i + r + c, 374761393) >>> 5) + frame) % 900 < 40) continue;
        ctx.fillRect(x + 10 + c * 18, baseY - h + 16 + r * 34, 9, 13);
      }
    }
    ctx.fillStyle = colour;
  }
}

/** Slow drifting clouds. */
function clouds(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  frame: number,
  factor: number,
  colour: string,
): void {
  const period = 760;
  const off = (parallax(cam, factor, period) + frame * 0.16) % period;
  ctx.fillStyle = colour;
  for (let i = -1; i < VIEW_WIDTH / period + 2; i++) {
    const base = i * period + off;
    const y = VIEW_HEIGHT * (0.16 + ((i * 37) % 5) * 0.06);
    for (const [dx, dy, r] of [
      [0, 0, 62],
      [60, -16, 78],
      [130, 6, 54],
      [-52, 10, 44],
    ] as const) {
      ctx.beginPath();
      ctx.arc(base + dx, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Drifting light motes — the thing that keeps a static sky from looking dead. */
function motes(ctx: CanvasRenderingContext2D, frame: number, colour: string): void {
  ctx.fillStyle = colour;
  for (let i = 0; i < 40; i++) {
    const h = (Math.imul(i + 1, 2654435761) >>> 0);
    const x = (h % VIEW_WIDTH) + Math.sin((frame + i * 21) / 70) * 24;
    const y = ((h >>> 9) % VIEW_HEIGHT) - ((frame * 0.22 + i * 17) % VIEW_HEIGHT);
    const wrapped = ((y % VIEW_HEIGHT) + VIEW_HEIGHT) % VIEW_HEIGHT;
    ctx.globalAlpha = 0.2 + 0.5 * Math.abs(Math.sin((frame + i * 9) / 55));
    ctx.beginPath();
    ctx.arc(x, wrapped, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The blast-zone boundary, drawn as a faint dashed frame.
 *
 * Off by default in a real match — it is a debug aid and a training-mode
 * feature, and the reason it lives here rather than in a debug file is that it
 * has to use exactly the same projection as everything else or it lies.
 */
export function drawBlastZone(ctx: CanvasRenderingContext2D, stage: StageDef, cam: Camera): void {
  const b = stage.blastZone;
  const tl = worldToScreen(cam, toFloat(b.left), toFloat(b.top));
  const br = worldToScreen(cam, toFloat(b.right), toFloat(b.bottom));
  ctx.save();
  ctx.setLineDash([18, 14]);
  ctx.strokeStyle = "rgba(255,90,90,0.35)";
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.setLineDash([]);
  ctx.restore();
}
