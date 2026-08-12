/**
 * The damage meters, stocks, timer and end-of-match slate.
 *
 * This is the part of the screen a Smash player looks at more than any other,
 * and the one that most obviously gives away a replica that was built from
 * memory. The values here were sampled from screenshots rather than guessed
 * (SPEC §10), and the details that carry the read are, in order:
 *
 * 1. **The shear.** Every panel is a parallelogram at roughly 12°, not a
 *    rectangle. If you change one thing about a Smash-alike HUD, change this.
 * 2. **The two type sizes in one number.** The integer part is large; the
 *    tenths and the `%` are noticeably smaller and sit on the same baseline.
 *    Ultimate has always drawn the decimal this way and nobody copies it.
 * 3. **The colour ramp.** White at 0, through yellow and red, to a dark maroon
 *    approaching 300 — so a glance at hue is a read on how close somebody is to
 *    dying, without parsing a number.
 * 4. **The name bar**, dark, in white small caps, with a port-coloured rule
 *    along its top edge. The port colour appears there and in the stock icons
 *    and nowhere else on the panel.
 */

import { ONE, toFloat } from "@/engine/fixed";
import type { GameState, FighterDef, FighterState, MatchOutcome } from "@/engine/types";
import {
  FONT_DISPLAY,
  FONT_UI,
  PANEL_INK,
  PORT_COLOURS,
  SMASH_YELLOW,
  drawHeadPortrait,
  drawStockIcon,
  getCharacterRig,
  mixHex,
  resolvePalette,
  shade,
  withAlpha,
} from "./characterArt";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./camera";

/** ~12° — "the single strongest signal that this is Smash" (SPEC §10). */
export const HUD_SKEW_DEGREES = 12;
export const HUD_SHEAR = Math.tan((HUD_SKEW_DEGREES * Math.PI) / 180);

export const PANEL_WIDTH = 330;
export const PANEL_HEIGHT = 132;
export const PANEL_GAP = 26;
export const PANEL_BASELINE_Y = 896;

/* ---------------------------------------------------------- colour ramp -- */

/**
 * The percent ramp, as explicit stops rather than a formula.
 *
 * Stops sit at 0 / 50 / 100 / 200 / 300 so the ramp can be asserted exactly at
 * those points instead of approximately everywhere; a hand-fitted curve that no
 * test can pin down is a curve that quietly drifts. Interpolation between stops
 * is in sRGB, which is not perceptually uniform and does not need to be — the
 * stops themselves carry the design.
 */
export const PERCENT_STOPS: readonly (readonly [number, string])[] = [
  [0, "#FFFFFF"],
  [50, "#FFD500"],
  [100, "#C10500"],
  [200, "#AD0000"],
  [300, "#5A0000"],
];

export function percentColour(percent: number): string {
  const p = Number.isFinite(percent) ? percent : 0;
  if (p <= PERCENT_STOPS[0][0]) return PERCENT_STOPS[0][1];
  const last = PERCENT_STOPS[PERCENT_STOPS.length - 1];
  if (p >= last[0]) return last[1];
  for (let i = 0; i < PERCENT_STOPS.length - 1; i++) {
    const [a, ca] = PERCENT_STOPS[i];
    const [b, cb] = PERCENT_STOPS[i + 1];
    if (p < a || p > b) continue;
    // Landing exactly on a stop returns that stop's own literal rather than a
    // round-tripped copy of it, so the sampled values in SPEC §10 survive
    // unchanged into the frame.
    if (p === a) return ca;
    if (p === b) return cb;
    return mixHex(ca, cb, (p - a) / (b - a));
  }
  return last[1];
}

/**
 * Split a percent into the two parts the readout sets at different sizes.
 *
 * Done in tenths rather than by subtracting the integer part, because damage
 * arrives as a **Q12 fixed-point value and therefore cannot represent a tenth
 * exactly**. 99.9% is stored as 409190/4096, which is 99.89990... as a double,
 * and both `(p - floor(p)) * 10` and a plain `floor(p * 10)` truncate that to
 * **8**. The meter would read `99.8%` for a fighter the simulation has at
 * `99.9%` — a discrepancy a player reading their own percent off the screen
 * would eventually notice, and one nobody would think to look for.
 *
 * The bias is exactly one Q12 quantum expressed in tenths, so it absorbs the
 * representation error and nothing else: a value that genuinely *is* 99.89
 * still truncates to `99.8`, as Ultimate's meter does.
 */
export function splitPercent(percent: number): { whole: number; tenth: number } {
  const tenths = Math.floor(Math.max(0, percent) * 10 + 10 / ONE);
  return { whole: Math.floor(tenths / 10), tenth: tenths % 10 };
}

/* ---------------------------------------------------------------- shapes -- */

/**
 * The parallelogram every panel, tab and plate is built from.
 *
 * The top edge is offset right by `height × tan(skew)`, so the shape leans the
 * same way as Ultimate's and the *bottom* edges of a row of panels stay aligned.
 */
export function parallelogramPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  shear = HUD_SHEAR,
): void {
  const dx = h * shear;
  ctx.beginPath();
  ctx.moveTo(x + dx, y);
  ctx.lineTo(x + dx + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

/** Draw text under the HUD's italic shear, as a real transform. */
function shearedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  draw: (ctx: CanvasRenderingContext2D) => void = (c) => c.fillText(text, 0, 0),
): void {
  ctx.save();
  ctx.translate(x, y);
  // A leftward shear on the x axis leans glyph tops to the right — the same
  // direction the panels lean.
  ctx.transform(1, 0, -HUD_SHEAR, 1, 0, 0);
  draw(ctx);
  ctx.restore();
}

/* ----------------------------------------------------------------- state -- */

/**
 * Presentation state the HUD keeps between frames.
 *
 * The percent shake needs to know that damage *changed*, which a single
 * `GameState` cannot tell you. It is held here rather than in `GameState` for
 * the same reason particles are: it must not be re-derived on a rollback.
 */
export interface HudState {
  lastDamage: number[];
  shake: number[];
  frame: number;
}

export const HUD_SHAKE_FRAMES = 14;

export function createHudState(): HudState {
  return { lastDamage: [0, 0, 0, 0], shake: [0, 0, 0, 0], frame: 0 };
}

export function updateHud(hud: HudState, state: GameState): void {
  hud.frame++;
  for (const f of state.fighters) {
    const d = toFloat(f.damage);
    const prev = hud.lastDamage[f.port] ?? 0;
    if (d > prev + 0.01) hud.shake[f.port] = HUD_SHAKE_FRAMES;
    hud.lastDamage[f.port] = d;
    if (hud.shake[f.port] > 0) hud.shake[f.port]--;
  }
}

/* ------------------------------------------------------------------ scene -- */

export interface HudFighterInfo {
  readonly def: FighterDef | null;
  /** Displayed under the percent. Falls back to the fighter's name. */
  readonly label: string;
  readonly isCpu: boolean;
}

export interface HudScene {
  readonly state: GameState;
  readonly info: readonly HudFighterInfo[];
  readonly hud: HudState;
}

/* --------------------------------------------------------------- drawing -- */

export function drawHud(ctx: CanvasRenderingContext2D, scene: HudScene): void {
  const fighters = scene.state.fighters;
  const n = Math.max(1, fighters.length);
  const totalWidth = n * PANEL_WIDTH + (n - 1) * PANEL_GAP;
  const startX = (VIEW_WIDTH - totalWidth) / 2;

  for (let i = 0; i < fighters.length; i++) {
    drawDamagePanel(ctx, scene, fighters[i], startX + i * (PANEL_WIDTH + PANEL_GAP), PANEL_BASELINE_Y);
  }

  if (scene.state.rules.mode === "time") drawTimer(ctx, scene.state.timeRemaining);
  if (scene.state.outcome) drawEndSlate(ctx, scene.state.outcome);
}

export function drawDamagePanel(
  ctx: CanvasRenderingContext2D,
  scene: HudScene,
  fighter: FighterState,
  x: number,
  y: number,
): void {
  const info = scene.info[fighter.port] ?? { def: null, label: `P${fighter.port + 1}`, isCpu: false };
  const percent = Math.max(0, toFloat(fighter.damage));
  const port = PORT_COLOURS[fighter.port % PORT_COLOURS.length];
  const dead = fighter.stocks <= 0;

  ctx.save();
  if (dead) ctx.globalAlpha = 0.4;

  // Smoke, above 120%. Drawn under the panel so it rises out from behind it.
  if (percent >= 120) drawPanelSmoke(ctx, scene.hud, x, y, percent);

  // Plate.
  parallelogramPath(ctx, x, y, PANEL_WIDTH, PANEL_HEIGHT);
  const grad = ctx.createLinearGradient(x, y, x, y + PANEL_HEIGHT);
  grad.addColorStop(0, "rgba(22,25,30,0.90)");
  grad.addColorStop(1, "rgba(8,11,12,0.94)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = PANEL_INK;
  ctx.lineWidth = 3;
  ctx.lineJoin = "miter";
  ctx.lineCap = "square";
  ctx.stroke();

  // Portrait cell, clipped to its own parallelogram so the head is cropped at
  // the same angle as the panel edge.
  const portraitW = 116;
  ctx.save();
  parallelogramPath(ctx, x + 6, y + 5, portraitW, PANEL_HEIGHT - 40);
  ctx.clip();
  ctx.fillStyle = withAlpha(port, 0.14);
  ctx.fillRect(x, y, PANEL_WIDTH + 60, PANEL_HEIGHT);
  if (info.def) {
    const rig = getCharacterRig(info.def.id);
    const palette = resolvePalette(info.def, fighter.costume);
    drawHeadPortrait(ctx, rig, palette, x + 26 + portraitW / 2, y + 34, 96, 1);
  }
  ctx.restore();
  parallelogramPath(ctx, x + 6, y + 5, portraitW, PANEL_HEIGHT - 40);
  ctx.strokeStyle = withAlpha(port, 0.85);
  ctx.lineWidth = 2;
  ctx.stroke();

  drawPercent(ctx, scene.hud, fighter, percent, x + 140, y + 14, PANEL_WIDTH - 152);

  // Name bar, with the port-colour rule along its top edge.
  const barY = y + PANEL_HEIGHT - 34;
  parallelogramPath(ctx, x + 5, barY, PANEL_WIDTH - 10, 30);
  ctx.fillStyle = "rgba(9,11,12,0.96)";
  ctx.fill();
  parallelogramPath(ctx, x + 5, barY, PANEL_WIDTH - 10, 4);
  ctx.fillStyle = port;
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 17px ${FONT_UI}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const name = smallCaps(info.label || info.def?.name || `P${fighter.port + 1}`);
  shearedText(ctx, name, x + 20, barY + 17, (c) => {
    c.letterSpacing = "2px";
    c.fillText(name, 0, 0);
  });

  ctx.fillStyle = withAlpha(port, 0.9);
  ctx.font = `700 14px ${FONT_UI}`;
  ctx.textAlign = "right";
  const tag = info.isCpu ? "CPU" : `P${fighter.port + 1}`;
  shearedText(ctx, tag, x + PANEL_WIDTH - 16, barY + 17, (c) => c.fillText(tag, 0, 0));

  drawStocks(ctx, fighter, info, x + 12, y + PANEL_HEIGHT + 18);
  ctx.restore();
}

/**
 * The percent, in two type sizes.
 *
 * The integer part is set at full size; the tenths and the `%` at 52% of it, on
 * the same baseline. Both get a black outline and a drop shadow, which is what
 * keeps the number legible when a fighter is standing behind it. The whole
 * group is drawn under the same shear as the panels, so the italic is
 * geometrically the same italic and not the font's own.
 */
export function drawPercent(
  ctx: CanvasRenderingContext2D,
  hud: HudState,
  fighter: FighterState,
  percent: number,
  x: number,
  y: number,
  width: number,
): void {
  const { whole, tenth } = splitPercent(percent);
  const big = 72;
  const small = Math.round(big * 0.52);
  const colour = percentColour(percent);

  const shake = hud.shake[fighter.port] ?? 0;
  let jx = 0;
  let jy = 0;
  if (shake > 0) {
    // Decays, and alternates sign each frame so it reads as a rattle rather
    // than as a drift.
    const k = (shake / HUD_SHAKE_FRAMES) ** 2 * 9;
    jx = (hud.frame % 2 === 0 ? 1 : -1) * k;
    jy = (hud.frame % 3 === 0 ? 1 : -0.6) * k * 0.6;
  }

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const bigText = String(whole);
  const smallText = `.${tenth}%`;
  ctx.font = `900 ${big}px ${FONT_DISPLAY}`;
  const bigW = ctx.measureText(bigText).width;
  ctx.font = `900 ${small}px ${FONT_DISPLAY}`;
  const smallW = ctx.measureText(smallText).width;
  const totalW = bigW + smallW;
  const startX = x + Math.max(0, (width - totalW) / 2) + jx;
  const baseY = y + big + jy;

  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 5;

  shearedText(ctx, bigText, startX, baseY, (c) => {
    c.font = `900 ${big}px ${FONT_DISPLAY}`;
    c.lineWidth = 7;
    c.lineJoin = "round";
    c.lineCap = "square";
    c.strokeStyle = "#08090B";
    c.strokeText(bigText, 0, 0);
    c.shadowColor = "rgba(0,0,0,0)";
    c.shadowBlur = 0;
    c.fillStyle = colour;
    c.fillText(bigText, 0, 0);
    // A lighter top edge, so the numeral reads as moulded rather than flat.
    c.fillStyle = withAlpha(shade(colour, 0.35), 0.55);
    c.fillText(bigText, 0, -big * 0.06);
  });

  shearedText(ctx, smallText, startX + bigW, baseY, (c) => {
    c.font = `900 ${small}px ${FONT_DISPLAY}`;
    c.lineWidth = 5;
    c.lineJoin = "round";
    c.lineCap = "square";
    c.strokeStyle = "#08090B";
    c.strokeText(smallText, 0, 0);
    c.shadowColor = "rgba(0,0,0,0)";
    c.shadowBlur = 0;
    c.fillStyle = colour;
    c.fillText(smallText, 0, 0);
  });

  ctx.restore();
}

/** Stock icons: the fighter's own head silhouette, once per life remaining. */
export function drawStocks(
  ctx: CanvasRenderingContext2D,
  fighter: FighterState,
  info: HudFighterInfo,
  x: number,
  y: number,
): void {
  const colour = PORT_COLOURS[fighter.port % PORT_COLOURS.length];
  const rig = getCharacterRig(info.def?.id);
  const size = 30;
  const stocks = Math.max(0, Math.min(9, fighter.stocks));
  ctx.save();
  for (let i = 0; i < stocks; i++) {
    drawStockIcon(ctx, rig, x + i * (size + 6) + size / 2, y - size / 2, size, colour);
  }
  ctx.restore();
}

function drawPanelSmoke(
  ctx: CanvasRenderingContext2D,
  hud: HudState,
  x: number,
  y: number,
  percent: number,
): void {
  const intensity = Math.min(1, (percent - 120) / 120);
  ctx.save();
  for (let i = 0; i < 7; i++) {
    // Deterministic per-puff phase, so the smoke is stable across frames rather
    // than boiling.
    const phase = ((hud.frame * 0.9 + i * 41) % 130) / 130;
    const px = x + 40 + i * 42 + Math.sin((phase + i) * 4) * 12;
    const py = y + 10 - phase * 78;
    const r = 12 + phase * 30;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(60,60,72,${((1 - phase) * 0.3 * intensity).toFixed(3)})`;
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- timer -- */

export function formatTime(frames: number): string {
  const clamped = Math.max(0, frames);
  const totalSeconds = Math.floor(clamped / 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor(((clamped % 60) / 60) * 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function drawTimer(ctx: CanvasRenderingContext2D, framesRemaining: number): void {
  const text = formatTime(framesRemaining);
  const w = 300;
  const h = 66;
  const x = (VIEW_WIDTH - w) / 2;
  const y = 26;

  ctx.save();
  parallelogramPath(ctx, x, y, w, h);
  ctx.fillStyle = "rgba(9,11,12,0.86)";
  ctx.fill();
  ctx.strokeStyle = framesRemaining <= 600 ? SMASH_YELLOW : PANEL_INK;
  ctx.lineWidth = 3;
  ctx.lineJoin = "miter";
  ctx.lineCap = "square";
  ctx.stroke();

  ctx.font = `900 46px ${FONT_DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // The last ten seconds go yellow, and the last five flash.
  const urgent = framesRemaining <= 600;
  const flash = framesRemaining <= 300 && Math.floor(framesRemaining / 15) % 2 === 0;
  ctx.fillStyle = flash ? "#FFFFFF" : urgent ? SMASH_YELLOW : "#F2F4F6";
  shearedText(ctx, text, VIEW_WIDTH / 2, y + h / 2 + 2, (c) => {
    c.lineWidth = 6;
    c.lineJoin = "round";
    c.strokeStyle = "#08090B";
    c.strokeText(text, 0, 0);
    c.fillText(text, 0, 0);
  });
  ctx.restore();
}

/* ---------------------------------------------------------------- slate -- */

/** "GAME!" on a stock-out, "TIME!" when the clock runs out. */
export function drawEndSlate(ctx: CanvasRenderingContext2D, outcome: MatchOutcome): void {
  const text = outcome.kind === "timeUp" ? "TIME!" : outcome.kind === "suddenDeath" ? "SUDDEN DEATH" : "GAME!";
  const h = 200;
  const y = (VIEW_HEIGHT - h) / 2;

  ctx.save();
  parallelogramPath(ctx, -80, y, VIEW_WIDTH + 160, h);
  ctx.fillStyle = "rgba(173,0,0,0.92)";
  ctx.fill();
  parallelogramPath(ctx, -80, y, VIEW_WIDTH + 160, 10);
  ctx.fillStyle = SMASH_YELLOW;
  ctx.fill();
  parallelogramPath(ctx, -80, y + h - 10, VIEW_WIDTH + 160, 10);
  ctx.fillStyle = SMASH_YELLOW;
  ctx.fill();

  ctx.font = `900 138px ${FONT_DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  shearedText(ctx, text, VIEW_WIDTH / 2, y + h / 2 + 8, (c) => {
    c.letterSpacing = "8px";
    c.lineWidth = 12;
    c.lineJoin = "round";
    c.lineCap = "square";
    c.strokeStyle = "#08090B";
    c.strokeText(text, 0, 0);
    c.fillStyle = "#FFFFFF";
    c.fillText(text, 0, 0);
  });
  ctx.restore();
}

/**
 * Small caps by transliteration.
 *
 * Canvas has no `font-variant`, and synthesising true small caps means drawing
 * each lowercase run separately at a smaller size. Upper-casing costs one line
 * and, at 17px with letter-spacing, is visually indistinguishable from what
 * Ultimate's name bar does.
 */
export function smallCaps(text: string): string {
  return text.toUpperCase();
}
