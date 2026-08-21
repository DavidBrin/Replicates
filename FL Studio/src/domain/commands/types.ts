/**
 * The command contract (SPEC.md §2.1).
 *
 * Every mutation of a `Project` is a {@link Command}: a pure `apply` plus an
 * `invert` that, given the project *as it was before* `apply` ran, returns the
 * command that undoes it. Nothing else is allowed to write domain state — the
 * store dispatches commands, components dispatch through the store.
 *
 *     const before = project;
 *     const after = cmd.apply(before);
 *     cmd.invert(before).apply(after)   // ≡ before
 *
 * That identity is the property every command test asserts.
 */

import type { Project } from "../types";

export interface Command {
  /** Stable discriminator, used in tests and debugging. */
  readonly type: string;
  /** Human-readable label for an undo-history UI. */
  readonly label: string;
  apply(project: Project): Project;
  invert(before: Project): Command;
}

/** Thrown when a command targets something that is not there. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

/**
 * A composite's parts, kept readable so a consumer can re-compose without
 * nesting. `src/domain/undo.ts` uses this to keep a coalesced gesture's entry
 * FLAT: a 500-move drag folds into one composite of 500 commands rather than a
 * 500-deep tree of two-element composites (whose `apply` would recurse 500
 * frames deep).
 */
export interface CompositeCommand extends Command {
  readonly type: "composite";
  readonly commands: readonly Command[];
}

export function isComposite(command: Command): command is CompositeCommand {
  return (
    command.type === "composite" &&
    Array.isArray((command as Partial<CompositeCommand>).commands)
  );
}

/**
 * One undoable entry made of several commands, applied in order.
 *
 * This is how cross-cutting atomicity is expressed: "Make unique" repoints a
 * clip *and* adds a pattern, and one Ctrl+Z has to take back both.
 */
export function composite(commands: readonly Command[], label = "Multiple changes"): CompositeCommand {
  return {
    type: "composite",
    label,
    commands,
    apply(project) {
      return commands.reduce((acc, cmd) => cmd.apply(acc), project);
    },
    invert(before) {
      // Each inverse needs the project as it looked just before *its* command
      // ran, so replay forward collecting intermediate states, then invert in
      // reverse order.
      const inverses: Command[] = [];
      let state = before;
      for (const cmd of commands) {
        inverses.push(cmd.invert(state));
        state = cmd.apply(state);
      }
      inverses.reverse();
      return composite(inverses, label);
    },
  };
}

/** A no-op command — the inverse of anything that turned out to change nothing. */
export function noop(label = "No change"): Command {
  return {
    type: "noop",
    label,
    apply: (project) => project,
    invert: () => noop(label),
  };
}

/* ------------------------------------------------------- record helpers -- */

/** Immutably set one key of a record. */
export function setIn<T>(record: Record<string, T>, id: string, value: T): Record<string, T> {
  return { ...record, [id]: value };
}

/** Immutably remove keys from a record. */
export function omit<T>(record: Record<string, T>, ids: readonly string[]): Record<string, T> {
  const next: Record<string, T> = {};
  const drop = new Set(ids);
  for (const [key, value] of Object.entries(record)) {
    if (!drop.has(key)) next[key] = value;
  }
  return next;
}

/** Insert `id` into an order array at `index` (append when out of range). */
export function insertAt(order: readonly string[], id: string, index?: number): string[] {
  const next = [...order];
  if (index === undefined || index < 0 || index > next.length) next.push(id);
  else next.splice(index, 0, id);
  return next;
}

export function removeFrom(order: readonly string[], id: string): string[] {
  return order.filter((entry) => entry !== id);
}

/** Move `id` to `index`, preserving the relative order of everything else. */
export function moveTo(order: readonly string[], id: string, index: number): string[] {
  const without = removeFrom(order, id);
  const clamped = Math.min(Math.max(index, 0), without.length);
  without.splice(clamped, 0, id);
  return without;
}

/** The subset of `source` named by `keys` — how a patch's inverse is captured. */
export function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}
