/**
 * Piano-roll geometry — the pure tick/pitch ↔ pixel layer (SPEC §4.3).
 *
 * Everything here is arithmetic on plain numbers: no canvas, no DOM, no React,
 * no store. Both the renderer (`renderer.ts`) and the gesture state machine
 * (`interactions.ts`) read the SAME functions, which is what keeps "what is
 * painted" and "what is hit" from drifting apart — the classic canvas-editor
 * bug. Every measured constant traces to
 * `research/01-visual-interaction-design.md` §3.2 and SPEC §4.3.
 */

import {
  PATTERN_LENGTH_TICKS,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  TICKS_PER_STEP,
  type Note,
} from "@/domain/types";

/* ------------------------------------------------------------ constants -- */

/** Keyboard column width at 100% zoom — measured ≈104 px (lane 1 §3.2). */
export const KEYBOARD_WIDTH = 104;
/** Semitone row height — measured ≈21 px (lane 1 §3.2). */
export const ROW_HEIGHT = 21;
/** Step column width at zoom 1 — measured ≈21 px, so cells are ~square. */
export const STEP_WIDTH = 21;
/** 21 px per 24-tick step ⇒ 0.875 px per tick at zoom 1. */
export const BASE_PX_PER_TICK = STEP_WIDTH / TICKS_PER_STEP;
/** Time-ruler strip above the grid (`#2A363F`). */
export const RULER_HEIGHT = 22;
/** Event-editor / velocity lane at the bottom (lane 1 §3.7). */
export const VELOCITY_LANE_HEIGHT = 92;
/** The `····` splitter grip between grid and velocity lane. */
export const SPLITTER_HEIGHT = 6;
/** Darker right-edge resize grip — measured ~9 px (lane 1 §3.3). */
export const GRIP_WIDTH = 9;
/** A note narrower than this is all grip; keep a body to grab for moving. */
export const MIN_NOTE_WIDTH = 4;

export const MIN_PITCH = 0;
export const MAX_PITCH = 127;
export const PITCH_COUNT = MAX_PITCH - MIN_PITCH + 1;

export const MIN_ZOOM_X = 0.25;
export const MAX_ZOOM_X = 8;

/** Semitones that are black keys, `pitch % 12`. */
const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/* ------------------------------------------------------------- viewport -- */

/**
 * Everything the geometry needs to place a tick/pitch on the canvas.
 *
 * `scrollX`/`scrollY` are in **grid pixels** (not ticks/rows) so that a zoom
 * change is a single multiplication rather than a unit conversion.
 */
export interface RollViewport {
  /** Canvas CSS width, keyboard column included. */
  width: number;
  /** Canvas CSS height, ruler and velocity lane included. */
  height: number;
  zoomX: number;
  scrollX: number;
  scrollY: number;
  /** 0 hides the lane entirely. */
  velocityLaneHeight: number;
}

/**
 * Opening vertical scroll: puts C6 (MIDI 72) at the top of the grid, so middle
 * C sits mid-window exactly as the reference capture opens (`C6` above `C5`).
 * Without it the roll would open on MIDI 127 — an empty ceiling nobody plays.
 */
export const DEFAULT_SCROLL_Y = (MAX_PITCH - 72) * ROW_HEIGHT;

export const DEFAULT_VIEWPORT: RollViewport = {
  width: 900,
  height: 520,
  zoomX: 1,
  scrollX: 0,
  scrollY: DEFAULT_SCROLL_Y,
  velocityLaneHeight: VELOCITY_LANE_HEIGHT,
};

export function createViewport(patch: Partial<RollViewport> = {}): RollViewport {
  return { ...DEFAULT_VIEWPORT, ...patch };
}

/* ------------------------------------------------------------ x ↔ ticks -- */

export function pxPerTick(view: RollViewport): number {
  return BASE_PX_PER_TICK * view.zoomX;
}

/** Left edge of the grid area — the keyboard column ends here. */
export function gridLeft(): number {
  return KEYBOARD_WIDTH;
}

export function gridWidth(view: RollViewport): number {
  return Math.max(0, view.width - KEYBOARD_WIDTH);
}

export function tickToX(view: RollViewport, tick: number): number {
  return KEYBOARD_WIDTH + tick * pxPerTick(view) - view.scrollX;
}

export function xToTick(view: RollViewport, x: number): number {
  return (x - KEYBOARD_WIDTH + view.scrollX) / pxPerTick(view);
}

/** Ticks spanned by `px` at the current zoom — used by drag deltas. */
export function pxToTicks(view: RollViewport, px: number): number {
  return px / pxPerTick(view);
}

/** First and last (exclusive) tick visible in the grid — the paint window. */
export function visibleTickRange(view: RollViewport): { start: number; end: number } {
  const start = Math.max(0, Math.floor(xToTick(view, KEYBOARD_WIDTH)));
  const end = Math.ceil(xToTick(view, view.width));
  return { start, end: Math.max(start, end) };
}

/* ---------------------------------------------------------- y ↔ pitches -- */

export function gridTop(): number {
  return RULER_HEIGHT;
}

/** Bottom of the note grid — where the splitter/velocity lane begins. */
export function gridBottom(view: RollViewport): number {
  const lane = view.velocityLaneHeight > 0 ? view.velocityLaneHeight + SPLITTER_HEIGHT : 0;
  return Math.max(gridTop(), view.height - lane);
}

export function gridHeight(view: RollViewport): number {
  return gridBottom(view) - gridTop();
}

/** Total scrollable height of all 128 semitone rows. */
export function contentHeight(): number {
  return PITCH_COUNT * ROW_HEIGHT;
}

/** Y of the TOP edge of `pitch`'s row. Pitch increases upward, as on a keyboard. */
export function pitchToY(view: RollViewport, pitch: number): number {
  return gridTop() + (MAX_PITCH - pitch) * ROW_HEIGHT - view.scrollY;
}

/** The pitch whose row contains `y`; may fall outside 0–127 when out of range. */
export function yToPitch(view: RollViewport, y: number): number {
  return MAX_PITCH - Math.floor((y - gridTop() + view.scrollY) / ROW_HEIGHT);
}

/** Top and bottom (inclusive) pitch visible in the grid — the paint window. */
export function visiblePitchRange(view: RollViewport): { low: number; high: number } {
  const high = clampPitch(yToPitch(view, gridTop()));
  const low = clampPitch(yToPitch(view, gridBottom(view) - 1));
  return { low, high };
}

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch));
}

export function isBlackKey(pitch: number): boolean {
  return BLACK_KEY_CLASSES.has(((pitch % 12) + 12) % 12);
}

/** `60` → `"C5"` — FL numbers middle C (MIDI 60) as C5, one octave above the
 * scientific-pitch convention; the reference capture labels the C5 row at MIDI 60. */
export function pitchName(pitch: number): string {
  const name = NOTE_NAMES[((pitch % 12) + 12) % 12] ?? "C";
  return `${name}${Math.floor(pitch / 12)}`;
}

/* ----------------------------------------------------------- gridlines -- */

export type GridlineWeight = "bar" | "beat" | "step" | null;

/**
 * The three increasing gridline weights of lane 1 §3.2: bar (darkest) beats
 * beat, which beats step. A tick that is not on a step boundary draws nothing.
 */
export function gridlineWeight(tick: number): GridlineWeight {
  if (!Number.isInteger(tick)) return null;
  if (tick % TICKS_PER_BAR === 0) return "bar";
  if (tick % TICKS_PER_BEAT === 0) return "beat";
  if (tick % TICKS_PER_STEP === 0) return "step";
  return null;
}

/**
 * Whether the beat column starting at `tick` carries the darker beat band.
 * Columns alternate per beat, layered under the row shading (lane 1 §3.2).
 */
export function isBeatBanded(tick: number): boolean {
  return Math.floor(tick / TICKS_PER_BEAT) % 2 === 1;
}

/** Bar number (1-based, as the ruler prints it) containing `tick`. */
export function tickToBarNumber(tick: number): number {
  return Math.floor(tick / TICKS_PER_BAR) + 1;
}

/* --------------------------------------------------------------- notes -- */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The painted rectangle of a note.
 *
 * A zero-length note (a *step*, per SPEC §2's "steps ARE notes") has no
 * duration to draw, so it renders one step wide — the same cell the rack
 * shows — while its stored `lengthTicks` stays 0.
 */
export function noteRect(view: RollViewport, note: Note): Rect {
  const lengthTicks = note.lengthTicks > 0 ? note.lengthTicks : TICKS_PER_STEP;
  const x = tickToX(view, note.positionTicks);
  const width = Math.max(MIN_NOTE_WIDTH, lengthTicks * pxPerTick(view));
  return { x, y: pitchToY(view, note.pitch), width, height: ROW_HEIGHT - 1 };
}

/**
 * The darker right-edge resize grip (~9 px), never more than half the note —
 * a short note must keep a body you can grab to move it.
 */
export function gripRect(view: RollViewport, note: Note): Rect {
  const rect = noteRect(view, note);
  const width = Math.max(2, Math.min(GRIP_WIDTH, rect.width / 2));
  return { x: rect.x + rect.width - width, y: rect.y, width, height: rect.height };
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/* ------------------------------------------------------- velocity lane -- */

export function velocityLaneTop(view: RollViewport): number {
  if (view.velocityLaneHeight <= 0) return view.height;
  return view.height - view.velocityLaneHeight;
}

/** Y of a velocity stem's handle: 0 sits on the baseline, 1 at the lane top. */
export function velocityToY(view: RollViewport, velocity: number): number {
  const top = velocityLaneTop(view);
  const usable = view.velocityLaneHeight - 8;
  return top + 4 + (1 - clamp01(velocity)) * Math.max(0, usable);
}

export function yToVelocity(view: RollViewport, y: number): number {
  const top = velocityLaneTop(view);
  const usable = Math.max(1, view.velocityLaneHeight - 8);
  return clamp01(1 - (y - top - 4) / usable);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/* -------------------------------------------------------------- regions -- */

export type RollRegion = "keyboard" | "ruler" | "grid" | "splitter" | "velocity" | "outside";

/** Which strip of the canvas a point falls in — the first thing every gesture asks. */
export function regionAt(view: RollViewport, x: number, y: number): RollRegion {
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) return "outside";
  if (y >= velocityLaneTop(view) && view.velocityLaneHeight > 0) return "velocity";
  if (y >= gridBottom(view)) return "splitter";
  if (y < RULER_HEIGHT) return x < KEYBOARD_WIDTH ? "keyboard" : "ruler";
  return x < KEYBOARD_WIDTH ? "keyboard" : "grid";
}

/* ------------------------------------------------------------ scrolling -- */

/** Clamp a scroll pair to the content, so the grid can never be dragged off-screen. */
export function clampScroll(
  view: RollViewport,
  scrollX: number,
  scrollY: number,
): { scrollX: number; scrollY: number } {
  const maxX = Math.max(0, PATTERN_LENGTH_TICKS * pxPerTick(view) - gridWidth(view) + STEP_WIDTH);
  const maxY = Math.max(0, contentHeight() - gridHeight(view));
  return {
    scrollX: Math.min(maxX, Math.max(0, scrollX)),
    scrollY: Math.min(maxY, Math.max(0, scrollY)),
  };
}

export function clampZoomX(zoomX: number): number {
  return Math.min(MAX_ZOOM_X, Math.max(MIN_ZOOM_X, zoomX));
}

/**
 * Ctrl+wheel zoom-at-cursor (SPEC §4.4, non-negotiable primitive #2): the tick
 * under the pointer must stay under the pointer, so the new scroll is derived
 * from the tick, never from a scaled old scroll.
 */
export function zoomAtCursor(
  view: RollViewport,
  cursorX: number,
  nextZoomX: number,
): { zoomX: number; scrollX: number } {
  const zoomX = clampZoomX(nextZoomX);
  const anchorTick = xToTick(view, cursorX);
  const scrollX = anchorTick * BASE_PX_PER_TICK * zoomX - (cursorX - KEYBOARD_WIDTH);
  const clamped = clampScroll({ ...view, zoomX }, scrollX, view.scrollY);
  return { zoomX, scrollX: clamped.scrollX };
}
