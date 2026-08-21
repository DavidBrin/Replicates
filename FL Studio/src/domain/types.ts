/**
 * The seam file every slice imports — entities and constants of SPEC.md §2.
 *
 * Four load-bearing facts, restated because every other module depends on
 * them staying true:
 *
 * 1. **Steps ARE notes.** There is no `Step` entity. A step-grid toggle
 *    upserts/deletes a {@link Note} with `lengthTicks: 0` at a quantized
 *    position (`research/02-data-model.md` §1, HIGH).
 * 2. **Tick-based timing, PPQ 96, fixed.** Positions and lengths are integer
 *    ticks, never step indices (lane 2 §5).
 * 3. **Pattern clips are references.** Editing a pattern updates every placed
 *    clip; "Make unique" is the only fork (lane 2 §4).
 * 4. **Two volume/pan layers.** Channel volume/pan are pre-mixer; mixer-track
 *    volume/pan are a later bus stage. Never merge them (lane 2 §2).
 *
 * This module — like everything under `src/domain` — imports nothing from
 * React, Next, Tone.js, zustand or a browser API. `layering.test.ts` enforces
 * it.
 */

export type ChannelId = string;
export type PatternId = string;
export type NoteId = string;
export type PlaylistTrackId = string;
export type ClipId = string;
export type MixerTrackId = string;

export const PPQ = 96;
export const TICKS_PER_STEP = 24; // PPQ * 4 beats / 16 steps
export const TICKS_PER_BEAT = 96;
export const TICKS_PER_BAR = 384;
export const STEPS_PER_BAR = 16;
/** v1: every pattern is one 4/4 bar (SPEC.md §1.2 D-sub). */
export const PATTERN_LENGTH_TICKS = 384;
export const MASTER_MIXER_TRACK_ID: MixerTrackId = "master";
/**
 * lane 1 §3.7 (MED); steps AND drawn notes. Spec decision: deliberately
 * overrides lane 2 §8's `velocity: 1.0` step-upsert example — one constant
 * everywhere.
 */
export const DEFAULT_VELOCITY = 100 / 127;

/** BPM clamp, lane 1 §1.2. */
export const MIN_TEMPO = 10;
export const MAX_TEMPO = 522;
export const DEFAULT_TEMPO = 140;

/** Undo-stack cap (SPEC.md §2.1, engineering default). */
export const UNDO_STACK_LIMIT = 200;

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** BPM, default 140, clamp 10–522. */
  tempo: number;
  /** 0..1 (lane 2 §6). */
  globalSwing: number;
  channels: Record<ChannelId, Channel>;
  channelOrder: ChannelId[];
  patterns: Record<PatternId, Pattern>;
  patternOrder: PatternId[];
  playlistTracks: Record<PlaylistTrackId, PlaylistTrack>;
  playlistTrackOrder: PlaylistTrackId[];
  clips: Record<ClipId, PatternClip>;
  mixerTracks: Record<MixerTrackId, MixerTrack>;
  mixerTrackOrder: MixerTrackId[];
  playbackMode: PlaybackMode;
  /** The pattern the rack/roll edit; the loop source in pattern mode. */
  activePatternId: PatternId;
}

export type PlaybackMode = "pattern" | "song";

/** lane 4 §3's synthesis-only instrument set. */
export type VoiceKind = "kick" | "clap" | "hatClosed" | "hatOpen" | "snare" | "bass" | "lead";

export const VOICE_KINDS: readonly VoiceKind[] = [
  "kick",
  "clap",
  "hatClosed",
  "hatOpen",
  "snare",
  "bass",
  "lead",
];

export interface Channel {
  id: ChannelId;
  name: string;
  color: string;
  voice: VoiceKind;
  /** 0..1 pre-mixer (lane 2 §2), default 0.8. */
  volume: number;
  /** -1..1. */
  pan: number;
  muted: boolean;
  /** MIDI note for step toggles; default 60 (lane 2 §1 PROPOSED). */
  defaultStepPitch: number;
  /** Engine choke rule, §3.3; default project: hatClosed + hatOpen in "hats". */
  chokeGroup?: string;
  /** Default `"master"` (lane 2 §7). */
  routedToMixerTrackId: MixerTrackId;
}

export interface Pattern {
  id: PatternId;
  name: string;
  color: string;
  /** ALL channels' notes for this pattern (lane 2 §1). */
  notes: Record<NoteId, Note>;
}

export interface Note {
  id: NoteId;
  channelId: ChannelId;
  /** From pattern start; NEVER a step index (lane 2 §8.1). */
  positionTicks: number;
  /** 0 = a step (FL's own definition, lane 2 §1). */
  lengthTicks: number;
  /** MIDI 0–127. */
  pitch: number;
  /** 0..1. */
  velocity: number;
}

export interface PlaylistTrack {
  id: PlaylistTrackId;
  name: string;
  color: string;
  muted: boolean;
}

export interface PatternClip {
  id: ClipId;
  trackId: PlaylistTrackId;
  /** The reference — the entire reuse mechanism (lane 2 §4). */
  patternId: PatternId;
  /** Absolute timeline position. */
  startTick: number;
}

export interface MixerTrack {
  id: MixerTrackId;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
}

export const CURRENT_SCHEMA_VERSION = 1;

export interface SaveFile {
  schemaVersion: 1;
  project: Project;
}

/** The single localStorage key (SPEC.md §1.2: namespaced, single project). */
export const STORAGE_KEY = "fl-studio:project:v1";
