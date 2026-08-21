/**
 * Compiled event lists — the one thing the scheduler reads (SPEC.md §2.1,
 * §3.2; lane 5 §2's store→scheduler one-way rule).
 *
 * Playback never walks `Project` per scheduler tick. It reads a flat,
 * absolute-tick list produced here and memoized per project object, so an edit
 * (which always produces a new `Project`) invalidates the cache for free.
 *
 * Two deliberate exclusions, both spec'd:
 *  - **Muted playlist tracks are dropped** from the song compilation — a muted
 *    track contributes no events at all (SPEC.md §3.2).
 *  - **Muted channels are NOT dropped.** Channel mute is a ramped gain of 0 in
 *    the mixer graph (§3.4), so the events must still be scheduled; removing
 *    them here would make un-muting mid-bar silent until the next loop.
 *
 * Swing is likewise *not* applied here: it is a scheduling-time delay
 * (`swingDelayTicks`), never baked into stored or compiled ticks (lane 2 §6).
 */

import { arrangementLengthTicks } from "./tickMath";
import {
  PATTERN_LENGTH_TICKS,
  type ChannelId,
  type NoteId,
  type PatternId,
  type Project,
} from "./types";

export interface CompiledEvent {
  /** Absolute tick on the timeline being played (pattern-relative in pattern mode). */
  tick: number;
  channelId: ChannelId;
  pitch: number;
  velocity: number;
  /** 0 for a step; the scheduler gives those its own short blip envelope. */
  lengthTicks: number;
  /** Provenance, for playhead/highlight correlation and debugging. */
  noteId: NoteId;
  patternId: PatternId;
}

export interface CompiledTimeline {
  events: CompiledEvent[];
  /** Loop length: one bar in pattern mode, the arrangement end in song mode. */
  lengthTicks: number;
  mode: "pattern" | "song";
}

function byTickThenPitch(a: CompiledEvent, b: CompiledEvent): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  if (a.pitch !== b.pitch) return a.pitch - b.pitch;
  return a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0;
}

/** Every note of one pattern, offset by `startTick`, sorted. */
export function compilePattern(project: Project, patternId: PatternId, startTick = 0): CompiledEvent[] {
  const pattern = project.patterns[patternId];
  if (pattern === undefined) return [];
  const events: CompiledEvent[] = [];
  for (const note of Object.values(pattern.notes)) {
    if (project.channels[note.channelId] === undefined) continue; // defensive: orphan note
    events.push({
      tick: startTick + note.positionTicks,
      channelId: note.channelId,
      pitch: note.pitch,
      velocity: note.velocity,
      lengthTicks: note.lengthTicks,
      noteId: note.id,
      patternId,
    });
  }
  return events.sort(byTickThenPitch);
}

/** Pattern mode: the active pattern, looping over one bar. */
export function compilePatternMode(project: Project): CompiledTimeline {
  return {
    events: compilePattern(project, project.activePatternId),
    lengthTicks: PATTERN_LENGTH_TICKS,
    mode: "pattern",
  };
}

/**
 * Song mode: every clip contributes its pattern's events offset by
 * `startTick`. A pattern placed twice is compiled twice — that is exactly what
 * reference semantics mean at playback time.
 */
export function compileSongMode(project: Project): CompiledTimeline {
  const events: CompiledEvent[] = [];
  for (const clip of Object.values(project.clips)) {
    const track = project.playlistTracks[clip.trackId];
    if (track === undefined || track.muted) continue;
    events.push(...compilePattern(project, clip.patternId, clip.startTick));
  }
  return {
    events: events.sort(byTickThenPitch),
    lengthTicks: arrangementLengthTicks(project),
    mode: "song",
  };
}

/** Compile whichever source `playbackMode` selects. */
export function compileTimeline(project: Project): CompiledTimeline {
  return project.playbackMode === "song" ? compileSongMode(project) : compilePatternMode(project);
}

/**
 * Memoized {@link compileTimeline}.
 *
 * Keyed on the `Project` object identity: commands always return a new project
 * object, so a stale entry is unreachable, and a `WeakMap` lets old projects be
 * collected with their compilations.
 */
const timelineCache = new WeakMap<Project, Map<string, CompiledTimeline>>();

export function compileTimelineCached(project: Project): CompiledTimeline {
  let perProject = timelineCache.get(project);
  if (perProject === undefined) {
    perProject = new Map();
    timelineCache.set(project, perProject);
  }
  const key = `${project.playbackMode}:${project.activePatternId}`;
  const hit = perProject.get(key);
  if (hit !== undefined) return hit;
  const compiled = compileTimeline(project);
  perProject.set(key, compiled);
  return compiled;
}

/** Notes of one channel in one pattern — the rack row and roll view source. */
export function notesForChannel(project: Project, patternId: PatternId, channelId: ChannelId) {
  const pattern = project.patterns[patternId];
  if (pattern === undefined) return [];
  return Object.values(pattern.notes)
    .filter((note) => note.channelId === channelId)
    .sort((a, b) => a.positionTicks - b.positionTicks || a.pitch - b.pitch);
}
