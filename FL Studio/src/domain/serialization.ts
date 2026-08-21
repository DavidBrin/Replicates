/**
 * The save envelope, validation and migration (SPEC.md §2.2).
 *
 * `SaveFile { schemaVersion, project }` is the only shape that ever leaves the
 * app — localStorage and JSON export/import (D3) share it byte for byte.
 *
 * Two disciplines, both from lane 2 §9:
 *
 * 1. **A `migrate` dispatch table from day one**, even while it is a v1→v1
 *    identity, so the second schema change is not the first migration.
 * 2. **Canonical rebuild, not a cast.** `parseSaveFile` reconstructs every
 *    entity field by field, so unknown junk is dropped, missing fields are
 *    caught, and a value that survives is genuinely a `Project`.
 *
 * Repair vs. reject, resolved: structural nonsense (not an object, no
 * patterns, unknown `schemaVersion`) returns `null` and the caller falls back
 * to the default project. *Referential* damage is repaired instead — orphan
 * notes and clips are dropped, order arrays are reconciled against their
 * records, a missing Master strip is recreated and an invalid
 * `activePatternId` is pointed at the first surviving pattern. Losing a whole
 * project because one clip pointed at a deleted pattern would be the worse
 * failure.
 */

import { clampTempo, clamp } from "./tickMath";
import {
  CURRENT_SCHEMA_VERSION,
  MASTER_MIXER_TRACK_ID,
  VOICE_KINDS,
  type Channel,
  type MixerTrack,
  type Note,
  type Pattern,
  type PatternClip,
  type PlaylistTrack,
  type Project,
  type SaveFile,
  type VoiceKind,
} from "./types";

/* ------------------------------------------------------------- writing -- */

export function toSaveFile(project: Project): SaveFile {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, project };
}

/** The exact text written to localStorage and downloaded as JSON. */
export function serializeProject(project: Project): string {
  return JSON.stringify(toSaveFile(project));
}

/* ------------------------------------------------------------ reading --- */

type Unknown = Record<string, unknown>;

function isObject(value: unknown): value is Unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function voiceKind(value: unknown): VoiceKind {
  return VOICE_KINDS.includes(value as VoiceKind) ? (value as VoiceKind) : "kick";
}

function readChannel(id: string, raw: unknown, index: number): Channel {
  const source = isObject(raw) ? raw : {};
  const channel: Channel = {
    id,
    name: str(source.name, `Channel ${index + 1}`),
    color: str(source.color, "hsl(200, 52%, 55%)"),
    voice: voiceKind(source.voice),
    volume: clamp(num(source.volume, 0.8), 0, 1),
    pan: clamp(num(source.pan, 0), -1, 1),
    muted: bool(source.muted, false),
    defaultStepPitch: clamp(int(source.defaultStepPitch, 60), 0, 127),
    routedToMixerTrackId: str(source.routedToMixerTrackId, MASTER_MIXER_TRACK_ID),
  };
  // The optional field is only written when present, so a channel with no
  // choke group serializes without the key at all.
  if (typeof source.chokeGroup === "string" && source.chokeGroup.length > 0) {
    channel.chokeGroup = source.chokeGroup;
  }
  return channel;
}

function readNote(id: string, raw: unknown): Note | null {
  if (!isObject(raw)) return null;
  if (typeof raw.channelId !== "string") return null;
  return {
    id,
    channelId: raw.channelId,
    positionTicks: Math.max(0, int(raw.positionTicks, 0)),
    lengthTicks: Math.max(0, int(raw.lengthTicks, 0)),
    pitch: clamp(int(raw.pitch, 60), 0, 127),
    velocity: clamp(num(raw.velocity, 100 / 127), 0, 1),
  };
}

function readPattern(id: string, raw: unknown, index: number): Pattern {
  const source = isObject(raw) ? raw : {};
  const notes: Record<string, Note> = {};
  if (isObject(source.notes)) {
    for (const [noteId, rawNote] of Object.entries(source.notes)) {
      const note = readNote(noteId, rawNote);
      if (note !== null) notes[noteId] = note;
    }
  }
  return {
    id,
    name: str(source.name, `Pattern ${index + 1}`),
    color: str(source.color, "hsl(200, 52%, 55%)"),
    notes,
  };
}

function readPlaylistTrack(id: string, raw: unknown, index: number): PlaylistTrack {
  const source = isObject(raw) ? raw : {};
  return {
    id,
    name: str(source.name, `Track ${index + 1}`),
    color: str(source.color, "hsl(200, 52%, 55%)"),
    muted: bool(source.muted, false),
  };
}

function readClip(id: string, raw: unknown): PatternClip | null {
  if (!isObject(raw)) return null;
  if (typeof raw.trackId !== "string" || typeof raw.patternId !== "string") return null;
  return {
    id,
    trackId: raw.trackId,
    patternId: raw.patternId,
    startTick: Math.max(0, int(raw.startTick, 0)),
  };
}

function readMixerTrack(id: string, raw: unknown, index: number): MixerTrack {
  const source = isObject(raw) ? raw : {};
  return {
    id,
    name: str(source.name, id === MASTER_MIXER_TRACK_ID ? "Master" : `Insert ${index}`),
    volume: clamp(num(source.volume, 0.8), 0, 1),
    pan: clamp(num(source.pan, 0), -1, 1),
    muted: bool(source.muted, false),
  };
}

/** Order arrays are authoritative for order, records for membership. */
function reconcileOrder(order: readonly string[], records: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    if (records[id] !== undefined && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of Object.keys(records)) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Rebuild a `Project` from untrusted JSON, or `null` when it is not one.
 *
 * Exported because `migrate` uses it for every version and tests exercise it
 * directly.
 */
export function readProject(raw: unknown): Project | null {
  if (!isObject(raw)) return null;

  const channelsRaw = isObject(raw.channels) ? raw.channels : {};
  const patternsRaw = isObject(raw.patterns) ? raw.patterns : {};
  if (Object.keys(patternsRaw).length === 0) return null; // a project always has a pattern

  const channels: Record<string, Channel> = {};
  Object.entries(channelsRaw).forEach(([id, value], index) => {
    channels[id] = readChannel(id, value, index);
  });

  const patterns: Record<string, Pattern> = {};
  Object.entries(patternsRaw).forEach(([id, value], index) => {
    patterns[id] = readPattern(id, value, index);
  });

  const playlistTracksRaw = isObject(raw.playlistTracks) ? raw.playlistTracks : {};
  const playlistTracks: Record<string, PlaylistTrack> = {};
  Object.entries(playlistTracksRaw).forEach(([id, value], index) => {
    playlistTracks[id] = readPlaylistTrack(id, value, index);
  });

  const mixerTracksRaw = isObject(raw.mixerTracks) ? raw.mixerTracks : {};
  const mixerTracks: Record<string, MixerTrack> = {};
  Object.entries(mixerTracksRaw).forEach(([id, value], index) => {
    mixerTracks[id] = readMixerTrack(id, value, index);
  });
  // Master is reserved and always present (lane 2 §9).
  if (mixerTracks[MASTER_MIXER_TRACK_ID] === undefined) {
    mixerTracks[MASTER_MIXER_TRACK_ID] = {
      id: MASTER_MIXER_TRACK_ID,
      name: "Master",
      volume: 0.8,
      pan: 0,
      muted: false,
    };
  }

  // Referential repair: notes pointing at a dead channel, clips pointing at a
  // dead pattern or track, channels routed to a dead mixer strip.
  for (const pattern of Object.values(patterns)) {
    for (const [noteId, note] of Object.entries(pattern.notes)) {
      if (channels[note.channelId] === undefined) delete pattern.notes[noteId];
    }
  }
  for (const channel of Object.values(channels)) {
    if (mixerTracks[channel.routedToMixerTrackId] === undefined) {
      channel.routedToMixerTrackId = MASTER_MIXER_TRACK_ID;
    }
  }

  const clipsRaw = isObject(raw.clips) ? raw.clips : {};
  const clips: Record<string, PatternClip> = {};
  for (const [id, value] of Object.entries(clipsRaw)) {
    const clip = readClip(id, value);
    if (clip === null) continue;
    if (patterns[clip.patternId] === undefined) continue;
    if (playlistTracks[clip.trackId] === undefined) continue;
    clips[id] = clip;
  }

  const patternOrder = reconcileOrder(strArray(raw.patternOrder), patterns);
  const firstPattern = patternOrder[0] as string;
  const activeCandidate = str(raw.activePatternId, firstPattern);
  const now = str(raw.createdAt, "1970-01-01T00:00:00.000Z");

  return {
    id: str(raw.id, "prj-restored"),
    name: str(raw.name, "Untitled"),
    createdAt: now,
    updatedAt: str(raw.updatedAt, now),
    tempo: clampTempo(num(raw.tempo, 140)),
    globalSwing: clamp(num(raw.globalSwing, 0), 0, 1),
    channels,
    channelOrder: reconcileOrder(strArray(raw.channelOrder), channels),
    patterns,
    patternOrder,
    playlistTracks,
    playlistTrackOrder: reconcileOrder(strArray(raw.playlistTrackOrder), playlistTracks),
    clips,
    mixerTracks,
    mixerTrackOrder: reconcileOrder(strArray(raw.mixerTrackOrder), mixerTracks),
    playbackMode: raw.playbackMode === "song" ? "song" : "pattern",
    activePatternId: patterns[activeCandidate] !== undefined ? activeCandidate : firstPattern,
  };
}

/* ----------------------------------------------------------- migration -- */

/**
 * Version → reader. v1 is the identity migration; a future v2 adds an entry
 * here that upgrades a v1 payload rather than editing v1's reader.
 */
export const MIGRATIONS: Record<number, (project: unknown) => Project | null> = {
  1: (project) => readProject(project),
};

/** Run the dispatch table. `null` for an unknown/absent version. */
export function migrate(save: unknown): Project | null {
  if (!isObject(save)) return null;
  const version = save.schemaVersion;
  if (typeof version !== "number") return null;
  const migration = MIGRATIONS[version];
  if (migration === undefined) return null;
  return migration(save.project);
}

/** Validate an already-parsed value as a `SaveFile`. */
export function parseSaveFile(value: unknown): SaveFile | null {
  const project = migrate(value);
  if (project === null) return null;
  return { schemaVersion: CURRENT_SCHEMA_VERSION, project };
}

/**
 * Text → project, the whole load path. Returns `null` for absent, unparseable,
 * wrong-version or structurally broken input; callers fall back to
 * `createDefaultProject()`.
 */
export function deserializeProject(text: string | null | undefined): Project | null {
  if (typeof text !== "string" || text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return migrate(parsed);
}
