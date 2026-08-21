/**
 * Step↔tick, snap, swing-delay and arrangement-length math (SPEC.md §2, §3.2).
 *
 * Everything here is integer-tick arithmetic at PPQ 96. Nothing in the app may
 * store or reason about a step *index* — steps are a derived alignment of
 * ticks (lane 2 §8.1), and these functions are the only sanctioned bridge.
 */

import {
  MAX_TEMPO,
  MIN_TEMPO,
  PATTERN_LENGTH_TICKS,
  PPQ,
  STEPS_PER_BAR,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  TICKS_PER_STEP,
  type Project,
} from "./types";

/** Snap units offered by the piano roll's snap selector (lane 1 §3.4). */
export type SnapUnit = "bar" | "beat" | "halfBeat" | "quarterBeat" | "off";

export const SNAP_UNITS: readonly SnapUnit[] = ["bar", "beat", "halfBeat", "quarterBeat", "off"];

/** Tick size of each snap unit; `off` has none — it snaps to a whole tick. */
export const SNAP_TICKS: Record<Exclude<SnapUnit, "off">, number> = {
  bar: TICKS_PER_BAR,
  beat: TICKS_PER_BEAT,
  halfBeat: TICKS_PER_BEAT / 2,
  quarterBeat: TICKS_PER_BEAT / 4, // === TICKS_PER_STEP, a 16th
};

export const SNAP_LABELS: Record<SnapUnit, string> = {
  bar: "Bar",
  beat: "Beat",
  halfBeat: "1/2 Beat",
  quarterBeat: "1/4 Beat",
  off: "Off",
};

/** Ticks at the start of `step` (0-based) within a pattern. */
export function stepToTicks(step: number): number {
  return step * TICKS_PER_STEP;
}

/** The step a tick falls in — floored, so a tick between steps belongs to the earlier one. */
export function ticksToStep(ticks: number): number {
  return Math.floor(ticks / TICKS_PER_STEP);
}

/**
 * The ticks a note actually occupies — the stored length, except for a step.
 *
 * `lengthTicks: 0` means "a step" (SPEC §2's `Note`), and a step is not a
 * zero-width event: the scheduler gives it a one-cell blip
 * (`audio/scheduler.ts`'s `STEP_BLIP_TICKS`) and the rack draws it as a whole
 * cell. Every bound that asks "where does this note end" wants this, which is
 * why it lives *here* rather than beside one of them: the piano roll's move
 * clamp and the save file's import validation disagreeing about a step's
 * extent is exactly how an imported step at tick 361 reached the editor and
 * then produced a negative maximum move delta on the first drag.
 */
export function effectiveLengthTicks(lengthTicks: number): number {
  return lengthTicks > 0 ? lengthTicks : TICKS_PER_STEP;
}

/** First tick after a note stops sounding — position plus its effective length. */
export function noteEndTicks(positionTicks: number, lengthTicks: number): number {
  return positionTicks + effectiveLengthTicks(lengthTicks);
}

/** True when `ticks` sits exactly on a 16th-note step boundary. */
export function isStepAligned(ticks: number): boolean {
  return Number.isInteger(ticks) && ticks % TICKS_PER_STEP === 0;
}

/** Snap to the nearest boundary of `unit`; `off` still rounds to a whole tick. */
export function snapTicks(ticks: number, unit: SnapUnit): number {
  if (unit === "off") return Math.round(ticks);
  const size = SNAP_TICKS[unit];
  return Math.round(ticks / size) * size;
}

/** Snap down to the boundary of `unit` at or before `ticks` (painting/placement). */
export function snapTicksFloor(ticks: number, unit: SnapUnit): number {
  if (unit === "off") return Math.floor(ticks);
  const size = SNAP_TICKS[unit];
  return Math.floor(ticks / size) * size;
}

/** Nearest 16th-note step boundary — what a step-grid toggle quantizes to. */
export function quantizeToStep(ticks: number): number {
  return snapTicks(ticks, "quarterBeat");
}

/**
 * Off-beat 16ths are the swung ones — steps 2, 4, 6 … in FL's 1-based
 * numbering, i.e. odd 0-based step indices (lane 2 §6).
 */
export function isOffBeatStep(ticks: number): boolean {
  if (!isStepAligned(ticks)) return false;
  return ticksToStep(ticks) % 2 === 1;
}

/**
 * Scheduling-time swing delay for a note at `positionTicks` (SPEC.md §3.2).
 *
 * Stored ticks are never rewritten — this is added when the note is queued.
 * Spec ambiguity resolved: notes that are *not* step-aligned (a piano-roll
 * note drawn between steps with snap off) are never swung, because "off-beat
 * 16th positions" is defined on the 16th grid and nudging free-timed notes
 * would silently move material the user placed by hand.
 */
export function swingDelayTicks(positionTicks: number, globalSwing: number): number {
  if (!isOffBeatStep(positionTicks)) return 0;
  const swing = clamp(globalSwing, 0, 1);
  return TICKS_PER_STEP * 0.5 * swing;
}

/** Seconds one tick lasts at `bpm`. */
export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return (seconds * bpm * PPQ) / 60;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** BPM clamp of lane 1 §1.2. */
export function clampTempo(bpm: number): number {
  return clamp(bpm, MIN_TEMPO, MAX_TEMPO);
}

/** Round a tick position up to the next whole bar (song-length rounding). */
export function ceilToBar(ticks: number): number {
  if (ticks <= 0) return 0;
  return Math.ceil(ticks / TICKS_PER_BAR) * TICKS_PER_BAR;
}

/** Bar/step coordinates of a tick, for rulers and readouts. */
export function tickToBarStep(ticks: number): { bar: number; step: number } {
  const bar = Math.floor(ticks / TICKS_PER_BAR);
  const step = Math.floor((ticks - bar * TICKS_PER_BAR) / TICKS_PER_STEP);
  return { bar, step };
}

export function barStepToTick(bar: number, step: number): number {
  return bar * TICKS_PER_BAR + step * TICKS_PER_STEP;
}

/**
 * Length of the song-mode arrangement: the end of the last clip, rounded up to
 * a bar, with a one-bar floor so an empty playlist still has a loop.
 *
 * Muted tracks still occupy time — muting silences a track, it does not
 * shorten the song.
 */
export function arrangementLengthTicks(project: Project): number {
  let end = 0;
  for (const clip of Object.values(project.clips)) {
    const clipEnd = clip.startTick + PATTERN_LENGTH_TICKS;
    if (clipEnd > end) end = clipEnd;
  }
  return Math.max(TICKS_PER_BAR, ceilToBar(end));
}

/** Every step index of a pattern, `[0 … 15]` — for grid rendering. */
export function stepIndices(): number[] {
  return Array.from({ length: STEPS_PER_BAR }, (_, i) => i);
}
