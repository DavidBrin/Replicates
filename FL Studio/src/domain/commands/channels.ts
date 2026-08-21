/**
 * Channel commands (SPEC.md §1.1 Channel Rack, §2.1).
 *
 * The load-bearing one is {@link removeChannel}: a channel is project-scoped,
 * so deleting it cascades note deletion across *every* pattern, and its
 * inverse has to restore all of them — one Ctrl+Z, everything back (lane 2 §2,
 * §9 "cross-cutting undo scope").
 */

import type { Channel, ChannelId, Note, NoteId, PatternId, Project } from "../types";
import {
  CommandError,
  type Command,
  insertAt,
  moveTo,
  omit,
  pick,
  removeFrom,
  setIn,
} from "./types";

/** Fields a knob/LED/routing edit may change. */
export type ChannelPatch = Partial<
  Pick<
    Channel,
    "name" | "color" | "voice" | "volume" | "pan" | "muted" | "defaultStepPitch" | "chokeGroup" | "routedToMixerTrackId"
  >
>;

const CHANNEL_PATCH_KEYS = [
  "name",
  "color",
  "voice",
  "volume",
  "pan",
  "muted",
  "defaultStepPitch",
  "chokeGroup",
  "routedToMixerTrackId",
] as const;

function requireChannel(project: Project, id: ChannelId): Channel {
  const channel = project.channels[id];
  if (channel === undefined) throw new CommandError(`No such channel: ${id}`);
  return channel;
}

/** Drop an explicitly-undefined optional key so entities stay JSON-canonical. */
function normalizeChannel(channel: Channel): Channel {
  if (channel.chokeGroup !== undefined) return channel;
  const { chokeGroup: _chokeGroup, ...rest } = channel;
  return rest;
}

export function addChannel(channel: Channel, index?: number): Command {
  return {
    type: "addChannel",
    label: `Add channel ${channel.name}`,
    apply(project) {
      if (project.channels[channel.id] !== undefined) {
        throw new CommandError(`Channel already exists: ${channel.id}`);
      }
      return {
        ...project,
        channels: setIn(project.channels, channel.id, normalizeChannel(channel)),
        channelOrder: insertAt(project.channelOrder, channel.id, index),
      };
    },
    invert() {
      return removeChannel(channel.id);
    },
  };
}

export function removeChannel(id: ChannelId): Command {
  return {
    type: "removeChannel",
    label: "Delete channel",
    apply(project) {
      requireChannel(project, id);
      const patterns: Record<PatternId, typeof project.patterns[string]> = { ...project.patterns };
      for (const [patternId, pattern] of Object.entries(project.patterns)) {
        const doomed = Object.values(pattern.notes)
          .filter((note) => note.channelId === id)
          .map((note) => note.id);
        if (doomed.length === 0) continue;
        patterns[patternId] = { ...pattern, notes: omit(pattern.notes, doomed) };
      }
      return {
        ...project,
        channels: omit(project.channels, [id]),
        channelOrder: removeFrom(project.channelOrder, id),
        patterns,
      };
    },
    invert(before) {
      const channel = requireChannel(before, id);
      const index = before.channelOrder.indexOf(id);
      const notesByPattern: Record<PatternId, Note[]> = {};
      for (const [patternId, pattern] of Object.entries(before.patterns)) {
        const mine = Object.values(pattern.notes).filter((note) => note.channelId === id);
        if (mine.length > 0) notesByPattern[patternId] = mine;
      }
      return restoreChannel(channel, index, notesByPattern);
    },
  };
}

/**
 * The inverse of {@link removeChannel} — public because a composite may need
 * to name it, never dispatched directly by the UI.
 */
export function restoreChannel(
  channel: Channel,
  index: number,
  notesByPattern: Record<PatternId, readonly Note[]>,
): Command {
  return {
    type: "restoreChannel",
    label: `Restore channel ${channel.name}`,
    apply(project) {
      const patterns = { ...project.patterns };
      for (const [patternId, notes] of Object.entries(notesByPattern)) {
        const pattern = project.patterns[patternId];
        if (pattern === undefined) continue; // the pattern itself is gone; nothing to restore into
        const restored: Record<NoteId, Note> = { ...pattern.notes };
        for (const note of notes) restored[note.id] = note;
        patterns[patternId] = { ...pattern, notes: restored };
      }
      return {
        ...project,
        channels: setIn(project.channels, channel.id, normalizeChannel(channel)),
        channelOrder: insertAt(project.channelOrder, channel.id, index),
        patterns,
      };
    },
    invert() {
      return removeChannel(channel.id);
    },
  };
}

/** Rename, recolor, knob-drag, mute, re-route — every scalar channel edit. */
export function updateChannel(id: ChannelId, patch: ChannelPatch): Command {
  return {
    type: "updateChannel",
    label: "Change channel",
    apply(project) {
      const channel = requireChannel(project, id);
      return {
        ...project,
        channels: setIn(project.channels, id, normalizeChannel({ ...channel, ...patch })),
      };
    },
    invert(before) {
      const channel = requireChannel(before, id);
      const keys = CHANNEL_PATCH_KEYS.filter((key) => key in patch);
      return updateChannel(id, pick(channel, keys));
    },
  };
}

/** Channel Rack row reorder. */
export function moveChannel(id: ChannelId, toIndex: number): Command {
  return {
    type: "moveChannel",
    label: "Reorder channel",
    apply(project) {
      requireChannel(project, id);
      return { ...project, channelOrder: moveTo(project.channelOrder, id, toIndex) };
    },
    invert(before) {
      requireChannel(before, id);
      return moveChannel(id, before.channelOrder.indexOf(id));
    },
  };
}
