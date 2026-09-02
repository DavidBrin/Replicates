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
  /**
   * This command swaps the **whole entity set** rather than editing inside the
   * current one — a JSON import, and every undo/redo of one.
   *
   * The store re-points its ephemeral UI references differently for such a
   * write (`lib/store.ts`'s `ReconcileOptions.wholesale`): liveness is the
   * wrong test, because ids are only unique *within* a project and an
   * unrelated file's `ch-2` resolves perfectly against this session's `ch-2`.
   *
   * It is declared **here, on the command**, because the alternative — the
   * store inferring it from `project.id` changing — is not sound. Re-importing
   * an export of the project you are already in (the common case: save, edit,
   * re-import) keeps the id, so the inference said "in-project edit" and the
   * roll, rack and playlist kept pointing at colliding ids from the project
   * that just went away. A command knows what it is; the store must not guess.
   */
  readonly wholesale?: boolean;
  /**
   * This command writes NOTHING — its payload is structurally empty (no
   * patches, no ids, an all-empty patch object). Declared by the constructor,
   * because only the constructor can answer it in O(1); see
   * {@link isEmptyCommand} for what the dispatcher does with it.
   */
  readonly empty?: boolean;
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
    // Empty when there is nothing in it that writes — `composite([])` included.
    // Computed here rather than walked at dispatch time so the check stays O(1)
    // for the 500-command composite a coalesced drag builds.
    empty: commands.every((command) => command.empty === true),
    // A composite is wholesale when any part is: folding a `replaceProject`
    // into a coalesced gesture must not launder away what it does.
    wholesale: commands.some((command) => command.wholesale === true),
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
    empty: true,
    apply: (project) => project,
    invert: () => noop(label),
  };
}

/**
 * "This command cannot write anything" — the dispatcher's last line of defence
 * against an undo entry that undoes nothing (`domain/undo.ts`'s
 * `dispatchCommand`, which drops such a command before history).
 *
 * The test is **structural and O(1)**: it reads {@link Command.empty}, a flag
 * each constructor sets when its own payload is empty (no note patches, no
 * ids, `{}` as a patch). It deliberately does NOT compare patch values against
 * the project — that is a per-field diff over a set whose size is the caller's
 * business, and `dispatch` is on the pointermove path where a note drag calls
 * it sixty times a second. Value equality is the CALL SITE's job, done where
 * the values it would overwrite are already in hand and the set is bounded:
 * see `piano-roll/interactions.ts` (the resize drag's `lastLengths`),
 * `ChannelRack`'s velocity nudge and routing cycle, and the roll's
 * `applyVelocity`. This guard catches what those miss — and every future call
 * site that forgets.
 */
export function isEmptyCommand(command: Command): boolean {
  return command.empty === true;
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
