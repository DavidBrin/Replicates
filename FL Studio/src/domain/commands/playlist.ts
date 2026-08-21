/**
 * Playlist commands: tracks, pattern clips, and "Make unique" (SPEC.md §1.1
 * Playlist, D4).
 *
 * A {@link PatternClip} is a *reference*. Nothing here ever copies notes —
 * except {@link makeUnique}, which is the single sanctioned fork.
 */

import type {
  ClipId,
  Pattern,
  PatternClip,
  PatternId,
  PlaylistTrack,
  PlaylistTrackId,
  Project,
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
    apply(project) {
      const clip = requireClip(project, id);
      const next = { ...clip, ...patch };
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
