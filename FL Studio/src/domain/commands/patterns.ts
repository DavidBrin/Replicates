/**
 * Pattern and note commands (SPEC.md §2.1).
 *
 * "Steps ARE notes": there is no step command here that a piano-roll note
 * cannot express. {@link stepToggleCommand} is a *builder* — it reads the
 * project, decides whether the cell is on or off, and hands back an
 * {@link addNotes} or {@link removeNotes} command. The step grid and the piano
 * roll therefore dispatch literally the same commands, which is the only way
 * the two views can stay two views of one note list.
 */

import {
  DEFAULT_VELOCITY,
  PATTERN_LENGTH_TICKS,
  type ChannelId,
  type Note,
  type NoteId,
  type Pattern,
  type PatternId,
  type Project,
} from "../types";
import { stepToTicks } from "../tickMath";
import {
  CommandError,
  type Command,
  insertAt,
  omit,
  pick,
  removeFrom,
  setIn,
} from "./types";

export type PatternPatch = Partial<Pick<Pattern, "name" | "color">>;
const PATTERN_PATCH_KEYS = ["name", "color"] as const;

export type NotePatch = Partial<Pick<Note, "positionTicks" | "lengthTicks" | "pitch" | "velocity" | "channelId">>;
const NOTE_PATCH_KEYS = ["positionTicks", "lengthTicks", "pitch", "velocity", "channelId"] as const;

function requirePattern(project: Project, id: PatternId): Pattern {
  const pattern = project.patterns[id];
  if (pattern === undefined) throw new CommandError(`No such pattern: ${id}`);
  return pattern;
}

function requireNote(pattern: Pattern, id: NoteId): Note {
  const note = pattern.notes[id];
  if (note === undefined) throw new CommandError(`No such note: ${id}`);
  return note;
}

function withPattern(project: Project, pattern: Pattern): Project {
  return { ...project, patterns: setIn(project.patterns, pattern.id, pattern) };
}

/* ------------------------------------------------------------ patterns -- */

export function addPattern(pattern: Pattern, index?: number): Command {
  return {
    type: "addPattern",
    label: `Add pattern ${pattern.name}`,
    apply(project) {
      if (project.patterns[pattern.id] !== undefined) {
        throw new CommandError(`Pattern already exists: ${pattern.id}`);
      }
      return {
        ...project,
        patterns: setIn(project.patterns, pattern.id, pattern),
        patternOrder: insertAt(project.patternOrder, pattern.id, index),
      };
    },
    invert() {
      return removePattern(pattern.id);
    },
  };
}

/**
 * Deleting a pattern also deletes every clip that referenced it — a clip whose
 * pattern is gone has nothing to render or play (lane 2 §4). The inverse
 * restores both.
 */
export function removePattern(id: PatternId): Command {
  return {
    type: "removePattern",
    label: "Delete pattern",
    apply(project) {
      requirePattern(project, id);
      if (project.patternOrder.length <= 1) {
        throw new CommandError("A project must keep at least one pattern");
      }
      const doomedClips = Object.values(project.clips)
        .filter((clip) => clip.patternId === id)
        .map((clip) => clip.id);
      const patternOrder = removeFrom(project.patternOrder, id);
      const activePatternId =
        project.activePatternId === id ? (patternOrder[0] as PatternId) : project.activePatternId;
      return {
        ...project,
        patterns: omit(project.patterns, [id]),
        patternOrder,
        clips: omit(project.clips, doomedClips),
        activePatternId,
      };
    },
    invert(before) {
      const pattern = requirePattern(before, id);
      const index = before.patternOrder.indexOf(id);
      const clips = Object.values(before.clips).filter((clip) => clip.patternId === id);
      const activePatternId = before.activePatternId;
      return {
        type: "restorePattern",
        label: `Restore pattern ${pattern.name}`,
        apply(project) {
          const restoredClips = { ...project.clips };
          for (const clip of clips) restoredClips[clip.id] = clip;
          return {
            ...project,
            patterns: setIn(project.patterns, pattern.id, pattern),
            patternOrder: insertAt(project.patternOrder, pattern.id, index),
            clips: restoredClips,
            activePatternId,
          };
        },
        invert() {
          return removePattern(id);
        },
      };
    },
  };
}

export function updatePattern(id: PatternId, patch: PatternPatch): Command {
  return {
    type: "updatePattern",
    label: "Change pattern",
    apply(project) {
      const pattern = requirePattern(project, id);
      return withPattern(project, { ...pattern, ...patch });
    },
    invert(before) {
      const pattern = requirePattern(before, id);
      const keys = PATTERN_PATCH_KEYS.filter((key) => key in patch);
      return updatePattern(id, pick(pattern, keys));
    },
  };
}

/* --------------------------------------------------------------- notes -- */

export function addNotes(patternId: PatternId, notes: readonly Note[]): Command {
  return {
    type: "addNotes",
    label: notes.length === 1 ? "Add note" : `Add ${notes.length} notes`,
    apply(project) {
      const pattern = requirePattern(project, patternId);
      const next: Record<NoteId, Note> = { ...pattern.notes };
      for (const note of notes) {
        if (next[note.id] !== undefined) throw new CommandError(`Note already exists: ${note.id}`);
        if (project.channels[note.channelId] === undefined) {
          throw new CommandError(`Note references missing channel: ${note.channelId}`);
        }
        next[note.id] = note;
      }
      return withPattern(project, { ...pattern, notes: next });
    },
    invert() {
      return removeNotes(
        patternId,
        notes.map((note) => note.id),
      );
    },
  };
}

export function removeNotes(patternId: PatternId, noteIds: readonly NoteId[]): Command {
  return {
    type: "removeNotes",
    label: noteIds.length === 1 ? "Delete note" : `Delete ${noteIds.length} notes`,
    apply(project) {
      const pattern = requirePattern(project, patternId);
      for (const id of noteIds) requireNote(pattern, id);
      return withPattern(project, { ...pattern, notes: omit(pattern.notes, noteIds) });
    },
    invert(before) {
      const pattern = requirePattern(before, patternId);
      const notes = noteIds.map((id) => requireNote(pattern, id));
      return addNotes(patternId, notes);
    },
  };
}

/**
 * Move / resize / re-velocity, one or many notes at once.
 *
 * A drag gesture commits exactly one of these on pointer-up (SPEC.md §2.1
 * drag coalescing), which is why it takes a list rather than a single id.
 */
export function updateNotes(
  patternId: PatternId,
  patches: readonly { id: NoteId; patch: NotePatch }[],
): Command {
  return {
    type: "updateNotes",
    label: patches.length === 1 ? "Edit note" : `Edit ${patches.length} notes`,
    apply(project) {
      const pattern = requirePattern(project, patternId);
      const next: Record<NoteId, Note> = { ...pattern.notes };
      for (const { id, patch } of patches) {
        const note = requireNote(pattern, id);
        next[id] = { ...note, ...patch };
      }
      return withPattern(project, { ...pattern, notes: next });
    },
    invert(before) {
      const pattern = requirePattern(before, patternId);
      return updateNotes(
        patternId,
        patches.map(({ id, patch }) => {
          const note = requireNote(pattern, id);
          const keys = NOTE_PATCH_KEYS.filter((key) => key in patch);
          return { id, patch: pick(note, keys) as NotePatch };
        }),
      );
    },
  };
}

/* ------------------------------------------------------ the step bridge -- */

/**
 * The zero-length note a step-grid cell stands for (lane 2 §1).
 *
 * `velocity` is {@link DEFAULT_VELOCITY} for steps *and* drawn notes — the
 * spec's own override of lane 2 §8's `velocity: 1.0` example (SPEC.md §2).
 */
export function stepNote(id: NoteId, channelId: ChannelId, step: number, pitch: number): Note {
  return {
    id,
    channelId,
    positionTicks: stepToTicks(step),
    lengthTicks: 0,
    pitch,
    velocity: DEFAULT_VELOCITY,
  };
}

/** Every note of `channelId` sitting exactly on `step`, whatever its length. */
export function notesAtStep(pattern: Pattern, channelId: ChannelId, step: number): Note[] {
  const tick = stepToTicks(step);
  return Object.values(pattern.notes).filter(
    (note) => note.channelId === channelId && note.positionTicks === tick,
  );
}

/** True when the rack should draw the cell lit. */
export function isStepOn(pattern: Pattern, channelId: ChannelId, step: number): boolean {
  return notesAtStep(pattern, channelId, step).length > 0;
}

/**
 * Build the command a step-grid click means: remove what is there, or add the
 * channel's default zero-length note.
 *
 * `mintNoteId` is injected rather than imported so callers can keep ids
 * deterministic in tests.
 */
export function stepToggleCommand(
  project: Project,
  patternId: PatternId,
  channelId: ChannelId,
  step: number,
  mintNoteId: () => NoteId,
): Command {
  const pattern = requirePattern(project, patternId);
  const channel = project.channels[channelId];
  if (channel === undefined) throw new CommandError(`No such channel: ${channelId}`);
  if (step < 0 || stepToTicks(step) >= PATTERN_LENGTH_TICKS) {
    throw new CommandError(`Step out of range: ${step}`);
  }

  const existing = notesAtStep(pattern, channelId, step);
  if (existing.length > 0) {
    return removeNotes(
      patternId,
      existing.map((note) => note.id),
    );
  }
  return addNotes(patternId, [stepNote(mintNoteId(), channelId, step, channel.defaultStepPitch)]);
}
