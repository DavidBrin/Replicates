/**
 * The command/undo stack (SPEC.md §2.1).
 *
 * Pure data: no store, no React. `src/lib/store.ts` holds one {@link History}
 * beside the project and drives it through these functions, which keeps the
 * whole undo model unit-testable without mounting anything.
 *
 * The stack lives **outside** the persisted `Project` — reloading a save
 * starts with an empty history, by design.
 */

import { composite, isComposite, type Command } from "./commands/types";
import { UNDO_STACK_LIMIT, type Project } from "./types";

export interface HistoryEntry {
  /** What was applied (a composite, once a gesture coalesces into it). */
  command: Command;
  /** The inverse captured against the project as it was before `command`. */
  inverse: Command;
  /**
   * Gesture identity for drag coalescing — e.g. `"knob:ch-1:volume"`. Two
   * consecutive dispatches sharing a key fold into one undo entry.
   */
  coalesceKey?: string;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export interface DispatchOptions {
  /**
   * When set and equal to the top entry's key, the new command extends that
   * entry instead of pushing a new one — this is how a knob drag, a note
   * move, or a clip drag becomes exactly one Ctrl+Z (SPEC.md §2.1).
   */
  coalesceKey?: string;
}

export interface HistoryResult {
  project: Project;
  history: History;
}

export function createHistory(): History {
  return { past: [], future: [] };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/**
 * A command's parts, so a coalesced entry stays one flat composite instead of
 * a tree that deepens by one level per dispatch. Flattening is semantically
 * free: a composite's `apply` is exactly its parts applied in order.
 */
function parts(command: Command): readonly Command[] {
  return isComposite(command) ? command.commands : [command];
}

/** Apply `command` and record it, coalescing into the previous entry if asked. */
export function dispatchCommand(
  project: Project,
  history: History,
  command: Command,
  options: DispatchOptions = {},
): HistoryResult {
  const inverse = command.invert(project);
  const next = command.apply(project);

  const top = history.past[history.past.length - 1];
  const { coalesceKey } = options;
  if (coalesceKey !== undefined && top !== undefined && top.coalesceKey === coalesceKey) {
    // BOTH sides of the entry grow, and the inverse side grows in REVERSE.
    //
    // Keeping `top.inverse` verbatim (what this did before) is only correct
    // when every coalesced command overwrites the SAME field, so that the
    // first inverse's "put the old value back" subsumes the later ones — a
    // knob drag. It silently loses work the moment a gesture touches
    // different entities: four coalesced note-adds undid to three notes,
    // because the entry's only inverse removed the first note.
    //
    // `inverse` was captured against `project`, i.e. the state just before
    // `command` — so applying it first lands exactly on the state `top.inverse`
    // was itself captured against. That is the general rule: fold inverses in
    // the reverse of the order their commands were applied. For a same-field
    // knob drag it still collapses (set back to v2, then back to v0 ≡ v0) and
    // still yields exactly one entry.
    const merged: HistoryEntry = {
      command: composite([...parts(top.command), command], top.command.label),
      inverse: composite([inverse, ...parts(top.inverse)], top.inverse.label),
      coalesceKey,
    };
    return {
      project: next,
      history: { past: [...history.past.slice(0, -1), merged], future: [] },
    };
  }

  const past = [...history.past, { command, inverse, coalesceKey }];
  if (past.length > UNDO_STACK_LIMIT) past.splice(0, past.length - UNDO_STACK_LIMIT);
  return { project: next, history: { past, future: [] } };
}

/** One step back. A no-op (same objects) when there is nothing to undo. */
export function undo(project: Project, history: History): HistoryResult {
  const entry = history.past[history.past.length - 1];
  if (entry === undefined) return { project, history };
  return {
    project: entry.inverse.apply(project),
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
  };
}

/** One step forward. A no-op when there is nothing to redo. */
export function redo(project: Project, history: History): HistoryResult {
  const entry = history.future[0];
  if (entry === undefined) return { project, history };
  return {
    project: entry.command.apply(project),
    history: { past: [...history.past, entry], future: history.future.slice(1) },
  };
}

/** Label of the entry `Ctrl+Z` would take back, for an undo tooltip. */
export function undoLabel(history: History): string | null {
  return history.past[history.past.length - 1]?.command.label ?? null;
}

export function redoLabel(history: History): string | null {
  return history.future[0]?.command.label ?? null;
}
