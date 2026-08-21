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
 * 3. **Prototype-safe record handling.** Untrusted JSON can carry a
 *    `"__proto__"`, `"constructor"` or `"prototype"` key, and both halves of
 *    the naive form are wrong: `records[id] !== undefined` answers *true* for
 *    `"toString"` (inherited from `Object.prototype`, so a bogus id survives
 *    order reconciliation and referential repair), and `records[id] = value`
 *    for `"__proto__"` runs the inherited *setter* rather than defining a key,
 *    polluting every object in the realm. Membership is therefore always
 *    {@link owns} (`Object.hasOwn`), and every id read out of raw JSON is
 *    filtered through {@link safeEntries}, which drops the three dangerous
 *    keys outright — an entity may not be named `__proto__`. The same filter
 *    drops the empty string, which the UI reserves as "no entity" (see
 *    {@link safeEntries}).
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

import { clampTempo, clamp, effectiveLengthTicks } from "./tickMath";
import {
  CURRENT_SCHEMA_VERSION,
  MASTER_MIXER_TRACK_ID,
  PATTERN_LENGTH_TICKS,
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

/**
 * Keys that may not name an entity. `__proto__` is the pollution vector;
 * `constructor` and `prototype` are here because they are the other two names
 * whose presence on a record makes "does this id exist" ambiguous, and no
 * legitimate minted id (`ch-1`, `pat-3`, `n-17`) is ever one of them.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/**
 * `Object.entries`, minus the keys of {@link FORBIDDEN_KEYS} — and minus the
 * empty string.
 *
 * `""` is never a legitimate id: every id is minted by `domain/ids.ts` as
 * `<prefix>-<counter>`. It is, however, the value the UI uses for *absence* —
 * the piano roll's target channel is `ui.channelId ?? channelOrder[0] ?? ""`,
 * and its "is there a channel to write to at all" guard reads `channelId !==
 * ""`. Letting a file define an entity actually keyed `""` would make that
 * guard lie: a real channel the roll could show ghost notes for, could select
 * in its dropdown, and would refuse to draw into or audition. Absence has one
 * spelling, so an entity may not take it — such an entry is dropped here, and
 * the referential repair below then drops whatever pointed at it.
 */
function safeEntries(record: Unknown): [string, unknown][] {
  return Object.entries(record).filter(([key]) => key !== "" && !FORBIDDEN_KEYS.has(key));
}

/**
 * Own-key membership. The whole file asks "is there a record under this id?",
 * and `record[id] !== undefined` gets that wrong for every inherited member.
 */
function owns(record: object, id: string): boolean {
  return Object.hasOwn(record, id);
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

/**
 * Position and length are clamped **jointly**, against the one-bar pattern.
 *
 * Clamping each at `>= 0` alone (what this did) let an imported note sit at
 * `positionTicks: 5000`, or start at 360 and run 900 ticks long. Nothing
 * downstream rejects that — the editor's own clamps only apply to edits the
 * user makes — so the note survived validation, rendered outside the grid,
 * and never sounded: the scheduler skips every event at or past the loop
 * length (`audio/scheduler.ts`). A note that cannot be seen or heard, in a
 * file that claims to have loaded cleanly, is the worst of the three
 * outcomes; a note at or past the bar is therefore *dropped* (the same
 * "referential damage is repaired" rule the file header states), and one that
 * merely overruns is shortened to end exactly at the bar.
 *
 * Steps (`lengthTicks: 0`) keep their zero — it is a marker, not a length —
 * and are judged by their **effective** extent, `effectiveLengthTicks` in
 * `tickMath.ts`, the same rule the piano roll's move clamp uses. A stored 0 is
 * not zero ticks wide: the scheduler blips a step for a whole cell. Measuring
 * an imported step against its literal 0 let one land at tick 361, inside the
 * bar by the raw arithmetic but sounding past it — and the roll's first drag
 * on it then computed a *negative* maximum move delta, pinning the note to a
 * position it could never leave. There is no shortening a step (its length is
 * a marker), so a step that does not fit is dropped, exactly as a note at or
 * past the bar is. Every legal step position (`step * 24`, at most 360) fits.
 */
function readNote(id: string, raw: unknown): Note | null {
  if (!isObject(raw)) return null;
  if (typeof raw.channelId !== "string") return null;
  const positionTicks = Math.max(0, int(raw.positionTicks, 0));
  if (positionTicks >= PATTERN_LENGTH_TICKS) return null;
  const lengthTicks = Math.max(0, int(raw.lengthTicks, 0));
  const available = PATTERN_LENGTH_TICKS - positionTicks;
  if (lengthTicks === 0 && effectiveLengthTicks(0) > available) return null;
  return {
    id,
    channelId: raw.channelId,
    positionTicks,
    lengthTicks: Math.min(lengthTicks, available),
    pitch: clamp(int(raw.pitch, 60), 0, 127),
    velocity: clamp(num(raw.velocity, 100 / 127), 0, 1),
  };
}

function readPattern(id: string, raw: unknown, index: number): Pattern {
  const source = isObject(raw) ? raw : {};
  const notes: Record<string, Note> = {};
  if (isObject(source.notes)) {
    for (const [noteId, rawNote] of safeEntries(source.notes)) {
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
    if (owns(records, id) && !seen.has(id)) {
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
  // Counted AFTER the forbidden keys are dropped: `{"patterns":{"__proto__":{}}}`
  // is not a project with a pattern in it.
  if (safeEntries(patternsRaw).length === 0) return null; // a project always has a pattern

  const channels: Record<string, Channel> = {};
  safeEntries(channelsRaw).forEach(([id, value], index) => {
    channels[id] = readChannel(id, value, index);
  });

  const patterns: Record<string, Pattern> = {};
  safeEntries(patternsRaw).forEach(([id, value], index) => {
    patterns[id] = readPattern(id, value, index);
  });

  const playlistTracksRaw = isObject(raw.playlistTracks) ? raw.playlistTracks : {};
  const playlistTracks: Record<string, PlaylistTrack> = {};
  safeEntries(playlistTracksRaw).forEach(([id, value], index) => {
    playlistTracks[id] = readPlaylistTrack(id, value, index);
  });

  const mixerTracksRaw = isObject(raw.mixerTracks) ? raw.mixerTracks : {};
  const mixerTracks: Record<string, MixerTrack> = {};
  safeEntries(mixerTracksRaw).forEach(([id, value], index) => {
    mixerTracks[id] = readMixerTrack(id, value, index);
  });
  // Master is reserved and always present (lane 2 §9).
  if (!owns(mixerTracks, MASTER_MIXER_TRACK_ID)) {
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
      if (!owns(channels, note.channelId)) delete pattern.notes[noteId];
    }
  }
  for (const channel of Object.values(channels)) {
    if (!owns(mixerTracks, channel.routedToMixerTrackId)) {
      channel.routedToMixerTrackId = MASTER_MIXER_TRACK_ID;
    }
  }

  const clipsRaw = isObject(raw.clips) ? raw.clips : {};
  const clips: Record<string, PatternClip> = {};
  for (const [id, value] of safeEntries(clipsRaw)) {
    const clip = readClip(id, value);
    if (clip === null) continue;
    if (!owns(patterns, clip.patternId)) continue;
    if (!owns(playlistTracks, clip.trackId)) continue;
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
    activePatternId: owns(patterns, activeCandidate) ? activeCandidate : firstPattern,
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
  const migration = Object.hasOwn(MIGRATIONS, version) ? MIGRATIONS[version] : undefined;
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
