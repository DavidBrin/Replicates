/**
 * Playlist commands: tracks, pattern clips, and "Make unique" (SPEC.md §1.1
 * Playlist, D4).
 *
 * A {@link PatternClip} is a *reference*. Nothing here ever copies notes —
 * except {@link makeUnique}, which is the single sanctioned fork.
 */

import {
  MAX_CLIP_START_TICK,
  type ClipId,
  type Pattern,
  type PatternClip,
  type PatternId,
  type PlaylistTrack,
  type PlaylistTrackId,
  type Project,
} from "../types";
import { addPattern, removePattern } from "./patterns";
import {
  CommandError,
  type Command,
  composite,
  insertAt,
  moveTo,
  omit,
  pick,
  removeFrom,
  setIn,
} from "./types";

export type TrackPatch = Partial<Pick<PlaylistTrack, "name" | "color" | "muted">>;
const TRACK_PATCH_KEYS = ["name", "color", "muted"] as const;

export type ClipPatch = Partial<Pick<PatternClip, "trackId" | "startTick" | "patternId">>;
const CLIP_PATCH_KEYS = ["trackId", "startTick", "patternId"] as const;

function requireTrack(project: Project, id: PlaylistTrackId): PlaylistTrack {
  const track = project.playlistTracks[id];
  if (track === undefined) throw new CommandError(`No such playlist track: ${id}`);
  return track;
}

function requireClip(project: Project, id: ClipId): PatternClip {
  const clip = project.clips[id];
  if (clip === undefined) throw new CommandError(`No such clip: ${id}`);
  return clip;
}

/**
 * The arrangement bound, enforced where clips are WRITTEN.
 *
 * `domain/serialization.ts`'s `readClip` drops an imported clip past
 * {@link MAX_CLIP_START_TICK}, which made the bound a property of *files* and
 * not of projects: a clip placed past it by any other route survived in
 * memory, rendered, played, saved — and then vanished on the next load, with
 * no report. That is silent data loss, and the only honest place for the rule
 * is here, because a command is the one way domain state ever changes
 * (SPEC §5).
 *
 * Rejected rather than clamped, matching `readClip`: a clip at bar 10^300 has
 * no meaningful home at the last bar, and stacking every out-of-range clip
 * onto bar 1000 is an unexplainable silent edit. A `CommandError` names the
 * bug at the call site instead. Nothing in the UI can reach it — the playlist
 * only paints where it draws, and its drag clamps — so this is a guard against
 * a future caller, not a user-facing path.
 */
function requireStartTick(startTick: number): number {
  if (!Number.isInteger(startTick) || startTick < 0 || startTick > MAX_CLIP_START_TICK) {
    throw new CommandError(
      `Clip startTick out of range (0..${MAX_CLIP_START_TICK}): ${startTick}`,
    );
  }
  return startTick;
}

/* -------------------------------------------------------------- tracks -- */

export function addPlaylistTrack(track: PlaylistTrack, index?: number): Command {
  return {
    type: "addPlaylistTrack",
    label: `Add track ${track.name}`,
    apply(project) {
      if (project.playlistTracks[track.id] !== undefined) {
        throw new CommandError(`Playlist track already exists: ${track.id}`);
      }
      return {
        ...project,
        playlistTracks: setIn(project.playlistTracks, track.id, track),
        playlistTrackOrder: insertAt(project.playlistTrackOrder, track.id, index),
      };
    },
    invert() {
      return removePlaylistTrack(track.id);
    },
  };
}

/** Removing a track takes its clips with it; the inverse restores both. */
export function removePlaylistTrack(id: PlaylistTrackId): Command {
  return {
    type: "removePlaylistTrack",
    label: "Delete track",
    apply(project) {
      requireTrack(project, id);
      const doomed = Object.values(project.clips)
        .filter((clip) => clip.trackId === id)
        .map((clip) => clip.id);
      return {
        ...project,
        playlistTracks: omit(project.playlistTracks, [id]),
        playlistTrackOrder: removeFrom(project.playlistTrackOrder, id),
        clips: omit(project.clips, doomed),
      };
    },
    invert(before) {
      const track = requireTrack(before, id);
      const index = before.playlistTrackOrder.indexOf(id);
      const clips = Object.values(before.clips).filter((clip) => clip.trackId === id);
      return {
        type: "restorePlaylistTrack",
        label: `Restore track ${track.name}`,
        apply(project) {
          const restored = { ...project.clips };
          for (const clip of clips) restored[clip.id] = clip;
          return {
            ...project,
            playlistTracks: setIn(project.playlistTracks, track.id, track),
            playlistTrackOrder: insertAt(project.playlistTrackOrder, track.id, index),
            clips: restored,
          };
        },
        invert() {
          return removePlaylistTrack(id);
        },
      };
    },
  };
}

export function updatePlaylistTrack(id: PlaylistTrackId, patch: TrackPatch): Command {
  return {
    type: "updatePlaylistTrack",
    label: "Change track",
    // Nothing to write when the payload is empty — the dispatcher drops such
    // a command before it reaches history (`types.ts`'s `isEmptyCommand`).
    empty: Object.keys(patch).length === 0,
    apply(project) {
      const track = requireTrack(project, id);
      return { ...project, playlistTracks: setIn(project.playlistTracks, id, { ...track, ...patch }) };
    },
    invert(before) {
      const track = requireTrack(before, id);
      const keys = TRACK_PATCH_KEYS.filter((key) => key in patch);
      return updatePlaylistTrack(id, pick(track, keys));
    },
  };
}

export function movePlaylistTrack(id: PlaylistTrackId, toIndex: number): Command {
  return {
    type: "movePlaylistTrack",
    label: "Reorder track",
    apply(project) {
      requireTrack(project, id);
      return { ...project, playlistTrackOrder: moveTo(project.playlistTrackOrder, id, toIndex) };
    },
    invert(before) {
      requireTrack(before, id);
      return movePlaylistTrack(id, before.playlistTrackOrder.indexOf(id));
    },
  };
}

/* --------------------------------------------------------------- clips -- */

export function addClip(clip: PatternClip): Command {
  return {
    type: "addClip",
    label: "Place clip",
    apply(project) {
      requireStartTick(clip.startTick);
      if (project.clips[clip.id] !== undefined) {
        throw new CommandError(`Clip already exists: ${clip.id}`);
      }
      if (project.patterns[clip.patternId] === undefined) {
        throw new CommandError(`Clip references missing pattern: ${clip.patternId}`);
      }
      requireTrack(project, clip.trackId);
      return { ...project, clips: setIn(project.clips, clip.id, clip) };
    },
    invert() {
      return removeClip(clip.id);
    },
  };
}

export function removeClip(id: ClipId): Command {
  return {
    type: "removeClip",
    label: "Delete clip",
    apply(project) {
      requireClip(project, id);
      return { ...project, clips: omit(project.clips, [id]) };
    },
    invert(before) {
      return addClip(requireClip(before, id));
    },
  };
}

/** Drag-to-move (track and/or time); also how "Make unique" repoints a clip. */
export function updateClip(id: ClipId, patch: ClipPatch): Command {
  return {
    type: "updateClip",
    label: "Move clip",
    // Nothing to write when the payload is empty — the dispatcher drops such
    // a command before it reaches history (`types.ts`'s `isEmptyCommand`).
    empty: Object.keys(patch).length === 0,
    apply(project) {
      const clip = requireClip(project, id);
      const next = { ...clip, ...patch };
      requireStartTick(next.startTick);
      if (project.patterns[next.patternId] === undefined) {
        throw new CommandError(`Clip references missing pattern: ${next.patternId}`);
      }
      requireTrack(project, next.trackId);
      return { ...project, clips: setIn(project.clips, id, next) };
    },
    invert(before) {
      const clip = requireClip(before, id);
      const keys = CLIP_PATCH_KEYS.filter((key) => key in patch);
      return updateClip(id, pick(clip, keys));
    },
  };
}

/* --------------------------------------------------------- make unique -- */

/**
 * D4 / lane 2 §8, verbatim:
 *
 *   1. deep-clone the referenced Pattern (new id, same notes, name + suffix,
 *      same color)
 *   2. repoint **only this clip's** `patternId` to the clone
 *   3. add the clone to `Project.patterns`
 *
 * No other clip referencing the original is touched, and the whole thing is
 * one undo entry whose inverse repoints the clip back and deletes the clone.
 *
 * Note ids are carried over unchanged: a `NoteId` is only ever resolved
 * within its own pattern, so the clone's notes keeping their ids costs
 * nothing and keeps the fork a literal copy.
 */
export function makeUnique(clipId: ClipId, newPatternId: PatternId, nameSuffix = " (unique)"): Command {
  return {
    type: "makeUnique",
    label: "Make unique",
    apply(project) {
      const clip = requireClip(project, clipId);
      const source = project.patterns[clip.patternId];
      if (source === undefined) {
        throw new CommandError(`Clip references missing pattern: ${clip.patternId}`);
      }
      if (project.patterns[newPatternId] !== undefined) {
        throw new CommandError(`Pattern already exists: ${newPatternId}`);
      }
      const clone: Pattern = {
        id: newPatternId,
        name: `${source.name}${nameSuffix}`,
        color: source.color,
        notes: Object.fromEntries(
          Object.entries(source.notes).map(([id, note]) => [id, { ...note }]),
        ),
      };
      const index = project.patternOrder.indexOf(source.id) + 1;
      return updateClip(clipId, { patternId: newPatternId }).apply(
        addPattern(clone, index).apply(project),
      );
    },
    invert(before) {
      const clip = requireClip(before, clipId);
      return composite(
        [updateClip(clipId, { patternId: clip.patternId }), removePattern(newPatternId)],
        "Undo make unique",
      );
    },
  };
}
