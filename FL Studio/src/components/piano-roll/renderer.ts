/**
 * The piano-roll painter — pure draw functions (SPEC §4.2: one `<canvas>` 2D,
 * imperative, React owns only the surrounding chrome).
 *
 * Nothing here touches a real canvas, the DOM or the store: every function
 * takes a {@link DrawSurface}, a {@link RollViewport} and a plain scene
 * object, so the whole painter is unit-testable against a recording fake (see
 * `renderer.test.ts`) with no jsdom canvas and no `node-canvas`.
 *
 * `DrawSurface` is deliberately the *smallest* slice of `CanvasRenderingContext2D`
 * the painter needs — fills, text, and a linear gradient for the white keys.
 * Gridlines are 1 px `fillRect`s rather than strokes: a stroked hairline
 * straddles the pixel and blurs, while a filled 1 px rect lands crisp, which is
 * what makes lane 1 §3.2's three gridline weights readable at all.
 *
 * If §4.2's WebGL escape hatch is ever taken, this interface is the seam.
 */

import { TICKS_PER_BAR, TICKS_PER_BEAT, TICKS_PER_STEP, type Note } from "@/domain/types";

import {
  GRIP_WIDTH,
  KEYBOARD_WIDTH,
  MAX_PITCH,
  MIN_PITCH,
  RULER_HEIGHT,
  ROW_HEIGHT,
  clamp01,
  gridBottom,
  gridTop,
  gridWidth,
  gridlineWeight,
  gripRect,
  isBeatBanded,
  isBlackKey,
  noteRect,
  pitchName,
  pitchToY,
  tickToBarNumber,
  tickToX,
  velocityLaneTop,
  velocityToY,
  visiblePitchRange,
  visibleTickRange,
  type RollViewport,
} from "./geometry";

/* -------------------------------------------------------- draw surface -- */

export interface DrawGradient {
  addColorStop(offset: number, color: string): void;
}

/** The subset of `CanvasRenderingContext2D` this painter uses. */
export interface DrawSurface {
  fillStyle: string | DrawGradient;
  globalAlpha: number;
  font: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): DrawGradient;
}

/* --------------------------------------------------------------- theme -- */

/**
 * Every colour the roll paints. Values are the measured hexes of SPEC §4.3 /
 * lane 1 §3.2–3.3, but the canvas reads them from `pianoRoll.css` custom
 * properties at mount (see `readRollTheme` in `PianoRoll.tsx`) — this object is
 * the fallback and the test fixture, not a second source of truth.
 */
export interface RollTheme {
  laneWhite: string;
  laneBlack: string;
  beatBand: string;
  gridStep: string;
  gridBeat: string;
  gridBeatFlank: string;
  gridBar: string;
  ruler: string;
  rulerText: string;
  keyWhiteStart: string;
  keyWhiteEnd: string;
  keyBlack: string;
  keySeparator: string;
  keyLabel: string;
  keyPressed: string;
  noteBody: string;
  noteTop: string;
  noteShadow: string;
  noteGrip: string;
  noteLabel: string;
  noteSelected: string;
  ghostNote: string;
  velocityLane: string;
  velocityStem: string;
  velocityStemDim: string;
  velocityBaseline: string;
  playhead: string;
  chrome: string;
}

export const DEFAULT_ROLL_THEME: RollTheme = {
  laneWhite: "#42545F",
  laneBlack: "#394B56",
  beatBand: "#32444F",
  gridStep: "#394B56",
  gridBeat: "#2E404B",
  gridBeatFlank: "#3E4F5A",
  gridBar: "#1A2C37",
  ruler: "#2A363F",
  rulerText: "#BDC2C6",
  keyWhiteStart: "#D9DDE5",
  keyWhiteEnd: "#FFFFFF",
  keyBlack: "#494A4C",
  keySeparator: "#2D3438",
  keyLabel: "#3B4A55",
  keyPressed: "#BCF1C6",
  noteBody: "#BCF1C6",
  noteTop: "#C6FBD0",
  noteShadow: "#83AB89",
  noteGrip: "#4E8756",
  noteLabel: "#1A2C37",
  noteSelected: "#FFD27C",
  ghostNote: "#637580",
  velocityLane: "#2A363F",
  velocityStem: "#C7FFCF",
  velocityStemDim: "#8FA3A8",
  velocityBaseline: "#3E4F5A",
  playhead: "#FFD27C",
  chrome: "#4E585E",
};

export const ROLL_FONT_SMALL = "10px 'Barlow Semi Condensed', 'Roboto Condensed', Arial, sans-serif";

/* --------------------------------------------------------------- scene -- */

export interface RollScene {
  /** The target channel's notes — the editable ones. */
  notes: readonly Note[];
  /** Other channels' notes in the same pattern: flat grey, unlabelled (lane 1 §3.3). */
  ghostNotes?: readonly Note[];
  selectedNoteIds?: readonly string[];
  /** Playhead position in ticks, or `null` when stopped (SPEC §4.2). */
  playheadTick?: number | null;
  /** Pitch currently held on the preview keyboard, if any. */
  previewPitch?: number | null;
  theme?: RollTheme;
}

/* ------------------------------------------------------------ painters -- */

export function drawBackground(surface: DrawSurface, view: RollViewport, theme: RollTheme): void {
  surface.fillStyle = theme.chrome;
  surface.fillRect(0, 0, view.width, view.height);
}

/**
 * Row shading (per black/white key) then the per-beat column band on top —
 * "the two are layered" (lane 1 §3.2).
 */
export function drawLanes(surface: DrawSurface, view: RollViewport, theme: RollTheme): void {
  const top = gridTop();
  const bottom = gridBottom(view);
  const { low, high } = visiblePitchRange(view);
  const left = KEYBOARD_WIDTH;
  const width = gridWidth(view);

  for (let pitch = low; pitch <= high; pitch += 1) {
    const y = pitchToY(view, pitch);
    const clippedTop = Math.max(top, y);
    const clippedBottom = Math.min(bottom, y + ROW_HEIGHT);
    if (clippedBottom <= clippedTop) continue;
    surface.fillStyle = isBlackKey(pitch) ? theme.laneBlack : theme.laneWhite;
    surface.fillRect(left, clippedTop, width, clippedBottom - clippedTop);
  }

  // Beat bands, alternating, drawn translucent so the row shading survives.
  const { start, end } = visibleTickRange(view);
  const firstBeat = Math.floor(start / TICKS_PER_BEAT) * TICKS_PER_BEAT;
  surface.save();
  surface.globalAlpha = 0.45;
  surface.fillStyle = theme.beatBand;
  for (let tick = firstBeat; tick <= end; tick += TICKS_PER_BEAT) {
    if (!isBeatBanded(tick)) continue;
    const x = tickToX(view, tick);
    const w = tickToX(view, tick + TICKS_PER_BEAT) - x;
    const clippedLeft = Math.max(left, x);
    const clippedRight = Math.min(view.width, x + w);
    if (clippedRight <= clippedLeft) continue;
    surface.fillRect(clippedLeft, top, clippedRight - clippedLeft, bottom - top);
  }
  surface.restore();
}

/** The three weights of lane 1 §3.2, painted step → beat → bar so the heavier wins. */
export function drawGridlines(surface: DrawSurface, view: RollViewport, theme: RollTheme): void {
  const top = gridTop();
  const height = gridBottom(view) - top;
  const { start, end } = visibleTickRange(view);
  const first = Math.floor(start / TICKS_PER_STEP) * TICKS_PER_STEP;

  const order: Record<"step" | "beat" | "bar", number[]> = { step: [], beat: [], bar: [] };
  for (let tick = first; tick <= end; tick += TICKS_PER_STEP) {
    const weight = gridlineWeight(tick);
    if (weight !== null) order[weight].push(tick);
  }

  const paint = (ticks: number[], color: string, width: number): void => {
    surface.fillStyle = color;
    for (const tick of ticks) {
      const x = Math.round(tickToX(view, tick));
      if (x < KEYBOARD_WIDTH || x > view.width) continue;
      surface.fillRect(x, top, width, height);
    }
  };

  paint(order.step, theme.gridStep, 1);
  // A beat line is flanked by a lighter hairline on its right (lane 1 §3.2).
  surface.fillStyle = theme.gridBeatFlank;
  for (const tick of order.beat) {
    const x = Math.round(tickToX(view, tick));
    if (x < KEYBOARD_WIDTH || x > view.width) continue;
    surface.fillRect(x + 1, top, 1, height);
  }
  paint(order.beat, theme.gridBeat, 1);
  paint(order.bar, theme.gridBar, 2);
}

export function drawRuler(surface: DrawSurface, view: RollViewport, theme: RollTheme): void {
  surface.fillStyle = theme.ruler;
  surface.fillRect(KEYBOARD_WIDTH, 0, gridWidth(view), RULER_HEIGHT);

  const { start, end } = visibleTickRange(view);
  const firstBar = Math.floor(start / TICKS_PER_BAR) * TICKS_PER_BAR;
  surface.font = ROLL_FONT_SMALL;
  surface.textBaseline = "middle";
  for (let tick = firstBar; tick <= end; tick += TICKS_PER_BAR) {
    const x = tickToX(view, tick);
    if (x < KEYBOARD_WIDTH - 1 || x > view.width) continue;
    surface.fillStyle = theme.gridBar;
    surface.fillRect(Math.round(x), 0, 1, RULER_HEIGHT);
    surface.fillStyle = theme.rulerText;
    surface.fillText(String(tickToBarNumber(tick)), Math.round(x) + 4, RULER_HEIGHT / 2);
  }
}

/**
 * The preview keyboard column: white keys as a left→right gradient, black keys
 * as shorter inset bars, C labelled (lane 1 §3.2).
 */
export function drawKeyboard(
  surface: DrawSurface,
  view: RollViewport,
  theme: RollTheme,
  previewPitch: number | null = null,
): void {
  const top = gridTop();
  const bottom = gridBottom(view);
  surface.fillStyle = theme.keySeparator;
  surface.fillRect(0, 0, KEYBOARD_WIDTH, view.height);

  const gradient = surface.createLinearGradient(0, 0, KEYBOARD_WIDTH, 0);
  gradient.addColorStop(0, theme.keyWhiteStart);
  gradient.addColorStop(1, theme.keyWhiteEnd);

  const { low, high } = visiblePitchRange(view);
  // White keys first — black keys overlay them, exactly like real keys.
  for (let pitch = low; pitch <= high; pitch += 1) {
    if (isBlackKey(pitch)) continue;
    const y = pitchToY(view, pitch);
    const clippedTop = Math.max(top, y);
    const clippedBottom = Math.min(bottom, y + ROW_HEIGHT);
    if (clippedBottom <= clippedTop) continue;
    surface.fillStyle = pitch === previewPitch ? theme.keyPressed : gradient;
    surface.fillRect(0, clippedTop, KEYBOARD_WIDTH - 1, clippedBottom - clippedTop);
    surface.fillStyle = theme.keySeparator;
    surface.fillRect(0, clippedBottom - 1, KEYBOARD_WIDTH - 1, 1);
  }

  for (let pitch = low; pitch <= high; pitch += 1) {
    if (!isBlackKey(pitch)) continue;
    const y = pitchToY(view, pitch);
    const clippedTop = Math.max(top, y + 1);
    const clippedBottom = Math.min(bottom, y + ROW_HEIGHT - 1);
    if (clippedBottom <= clippedTop) continue;
    surface.fillStyle = pitch === previewPitch ? theme.keyPressed : theme.keyBlack;
    surface.fillRect(0, clippedTop, Math.round(KEYBOARD_WIDTH * 0.62), clippedBottom - clippedTop);
  }

  surface.font = ROLL_FONT_SMALL;
  surface.textBaseline = "middle";
  surface.fillStyle = theme.keyLabel;
  for (let pitch = low; pitch <= high; pitch += 1) {
    if (pitch % 12 !== 0) continue; // label the Cs only, as FL does
    const y = pitchToY(view, pitch);
    if (y < top || y + ROW_HEIGHT > bottom) continue;
    surface.fillText(pitchName(pitch), KEYBOARD_WIDTH - 26, y + ROW_HEIGHT / 2);
  }
}

/** Ghost notes: flat grey blocks, no label, behind the live notes (lane 1 §3.3). */
export function drawGhostNotes(
  surface: DrawSurface,
  view: RollViewport,
  theme: RollTheme,
  notes: readonly Note[],
): void {
  const top = gridTop();
  const bottom = gridBottom(view);
  surface.fillStyle = theme.ghostNote;
  for (const note of notes) {
    const rect = noteRect(view, note);
    if (rect.y + rect.height < top || rect.y > bottom) continue;
    if (rect.x + rect.width < KEYBOARD_WIDTH || rect.x > view.width) continue;
    surface.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
}

/**
 * Square-cornered note blocks: bright 1 px top edge, body, 1 px bottom shadow,
 * darker right-edge grip, truncating name label (lane 1 §3.3).
 */
export function drawNotes(
  surface: DrawSurface,
  view: RollViewport,
  theme: RollTheme,
  notes: readonly Note[],
  selectedNoteIds: readonly string[] = [],
): void {
  const selected = new Set(selectedNoteIds);
  const top = gridTop();
  const bottom = gridBottom(view);
  surface.font = ROLL_FONT_SMALL;
  surface.textBaseline = "middle";

  for (const note of notes) {
    const rect = noteRect(view, note);
    if (rect.y + rect.height < top || rect.y > bottom) continue;
    if (rect.x + rect.width < KEYBOARD_WIDTH || rect.x > view.width) continue;

    // Velocity reads as brightness: a quiet note is a dimmer block.
    surface.save();
    surface.globalAlpha = 0.45 + 0.55 * clamp01(note.velocity);
    surface.fillStyle = theme.noteBody;
    surface.fillRect(rect.x, rect.y, rect.width, rect.height);
    surface.restore();

    surface.fillStyle = theme.noteTop;
    surface.fillRect(rect.x, rect.y, rect.width, 1);
    surface.fillStyle = theme.noteShadow;
    surface.fillRect(rect.x, rect.y + rect.height - 1, rect.width, 1);

    const grip = gripRect(view, note);
    surface.fillStyle = theme.noteGrip;
    surface.fillRect(grip.x, grip.y, grip.width, grip.height);

    if (selected.has(note.id)) {
      surface.fillStyle = theme.noteSelected;
      surface.fillRect(rect.x, rect.y, rect.width, 2);
      surface.fillRect(rect.x, rect.y, 2, rect.height);
    }

    const label = truncateLabel(surface, pitchName(note.pitch), rect.width - grip.width - 4);
    if (label !== "") {
      surface.fillStyle = theme.noteLabel;
      surface.fillText(label, rect.x + 2, rect.y + rect.height / 2);
    }
  }
}

/**
 * `B5` → `G.` → `..` → `` as the note narrows (lane 1 §3.3). Measured, not
 * clipped, so the label never bleeds over the resize grip.
 */
export function truncateLabel(surface: DrawSurface, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (surface.measureText(text).width <= maxWidth) return text;
  for (let length = text.length - 1; length > 0; length -= 1) {
    const candidate = `${text.slice(0, length)}.`;
    if (surface.measureText(candidate).width <= maxWidth) return candidate;
  }
  return surface.measureText("..").width <= maxWidth ? ".." : "";
}

/** One vertical stem + handle per note, from the lane baseline (lane 1 §3.7). */
export function drawVelocityLane(
  surface: DrawSurface,
  view: RollViewport,
  theme: RollTheme,
  notes: readonly Note[],
  selectedNoteIds: readonly string[] = [],
): void {
  if (view.velocityLaneHeight <= 0) return;
  const top = velocityLaneTop(view);
  const selected = new Set(selectedNoteIds);

  surface.fillStyle = theme.velocityLane;
  surface.fillRect(KEYBOARD_WIDTH, top, gridWidth(view), view.velocityLaneHeight);
  surface.fillStyle = theme.velocityBaseline;
  surface.fillRect(KEYBOARD_WIDTH, view.height - 4, gridWidth(view), 1);

  for (const note of notes) {
    const x = Math.round(tickToX(view, note.positionTicks));
    if (x < KEYBOARD_WIDTH || x > view.width) continue;
    const handleY = velocityToY(view, note.velocity);
    const dim = selectedNoteIds.length > 0 && !selected.has(note.id);
    surface.fillStyle = dim ? theme.velocityStemDim : theme.velocityStem;
    surface.fillRect(x, handleY, 2, view.height - 4 - handleY);
    surface.fillRect(x - 2, handleY - 2, 6, 5); // the round-ish handle cap
  }
}

/** The playhead line — the only thing that animates continuously (SPEC §4.2). */
export function drawPlayhead(
  surface: DrawSurface,
  view: RollViewport,
  theme: RollTheme,
  tick: number | null | undefined,
): void {
  if (tick === null || tick === undefined) return;
  const x = Math.round(tickToX(view, tick));
  if (x < KEYBOARD_WIDTH || x > view.width) return;
  surface.fillStyle = theme.playhead;
  surface.fillRect(x, 0, 1, view.height);
}

/* ----------------------------------------------------------- the frame -- */

/** Paints one whole frame, back to front. The only entry point the host calls. */
export function renderPianoRoll(
  surface: DrawSurface,
  view: RollViewport,
  scene: RollScene,
): void {
  const theme = scene.theme ?? DEFAULT_ROLL_THEME;
  const selected = scene.selectedNoteIds ?? [];

  surface.clearRect(0, 0, view.width, view.height);
  drawBackground(surface, view, theme);
  drawLanes(surface, view, theme);
  drawGridlines(surface, view, theme);
  drawGhostNotes(surface, view, theme, scene.ghostNotes ?? []);
  drawNotes(surface, view, theme, scene.notes, selected);
  drawVelocityLane(surface, view, theme, scene.notes, selected);
  drawPlayhead(surface, view, theme, scene.playheadTick);
  drawRuler(surface, view, theme);
  drawKeyboard(surface, view, theme, scene.previewPitch ?? null);
}

/** Exported for the host's `pitchName`-free imports and for tests. */
export const RENDERER_PITCH_BOUNDS = { MIN_PITCH, MAX_PITCH, GRIP_WIDTH } as const;
