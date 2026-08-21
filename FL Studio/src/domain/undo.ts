/**
 * The command/undo stack (SPEC.md §2.1).
 *
 * Pure data: no store, no React. `src/lib/store.ts` holds one {@link History}
 * beside the project and drives it through these functions, which keeps the
 * whole undo model unit-testable without mounting anything.
 *
 * The stack lives **outside** the persisted `Project` — reloading a save
 * starts with an empty history, by design.
 *
 * ## Coalescing: the canonical pattern
 *
 * A `coalesceKey` alone identifies *the control*, not *the gesture*. Two
 * separate drags of the same knob, or two separate BPM edits, share the key —
 * so with nothing else to separate them they folded into one undo entry no
 * matter how much time or how many other actions sat between them. (Only
 * "some other command in between" broke the chain, because coalescing checks
 * the top entry.)
 *
 * There are exactly two supported ways to say "this is a new gesture", and
 * they compose freely:
 *
 * 1. **Preferred — pass a `gestureId`.** Mint one per gesture (pointer-down /
 *    focus / first keystroke) and pass it with every dispatch of that gesture:
 *
 *    ```ts
 *    const gestureId = `bpm:${Date.now()}`;              // on pointerdown
 *    dispatch(updateProject({ tempo }), { coalesceKey: "transport:tempo", gestureId });
 *    ```
 *
 *    Two dispatches coalesce only when **both** the key and the gesture id
 *    match, so a stable key stays readable in the history while separate
 *    gestures stay separate entries.
 *
 * 2. **Also valid — a unique `coalesceKey` per gesture** (`knob:ch-1:volume:7`).
 *    Surfaces that already do this need no change: a key that is unique per
 *    gesture can never match a previous gesture's entry.
 *
 * When neither is convenient — a gesture with no natural id, e.g. one that
 * ends on blur — call {@link endGesture} (the store exposes it under the same
 * name) at the boundary. It seals the top entry so the next dispatch cannot
 * extend it, whatever key it carries.
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
   * consecutive dispatches sharing a key **and** a {@link HistoryEntry.gestureId}
   * fold into one undo entry.
   */
  coalesceKey?: string;
  /**
   * Which run of that control this entry belongs to. `undefined` means the
   * caller identifies gestures by minting a unique `coalesceKey` instead —
   * both are supported, see this module's header.
   */
  gestureId?: string;
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
  /**
   * Gesture boundary. When supplied it must ALSO match the top entry's, so a
   * fixed `coalesceKey` (`"transport:tempo"`) no longer welds yesterday's drag
   * to today's. See this module's header for the canonical pattern.
   */
  gestureId?: string;
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
  const { coalesceKey, gestureId } = options;
  if (
    coalesceKey !== undefined &&
    top !== undefined &&
    top.coalesceKey === coalesceKey &&
    top.gestureId === gestureId
  ) {
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
      gestureId,
    };
    return {
      project: next,
      history: { past: [...history.past.slice(0, -1), merged], future: [] },
    };
  }

  const past = [...history.past, { command, inverse, coalesceKey, gestureId }];
  if (past.length > UNDO_STACK_LIMIT) past.splice(0, past.length - UNDO_STACK_LIMIT);
  return { project: next, history: { past, future: [] } };
}

/**
 * Close the current gesture: seal the top entry so nothing can extend it.
 *
 * The escape hatch for callers whose gesture has no natural id — a blur, a
 * debounce settling, a keyboard nudge run. Returns the same object when there
 * is nothing to seal, so a store may `set()` it unconditionally without
 * inventing a render.
 */
export function endGesture(history: History): History {
  const top = history.past[history.past.length - 1];
  if (top === undefined || (top.coalesceKey === undefined && top.gestureId === undefined)) {
    return history;
  }
  const sealed: HistoryEntry = { command: top.command, inverse: top.inverse };
  return { past: [...history.past.slice(0, -1), sealed], future: history.future };
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
