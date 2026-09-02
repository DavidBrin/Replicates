/**
 * Shared helpers for the domain test suites.
 *
 * Deliberately free of any `vitest` import so it stays plain domain code: it
 * computes the round-trip, the test files do the asserting.
 */

import type { Command } from "./commands/types";
import { createDefaultProject } from "./defaultProject";
import type { Project } from "./types";

/**
 * Apply a command and undo it, returning both states.
 *
 * `invert` is captured against `before` exactly as the undo stack does it, so
 * this is the same code path the app runs — not a re-derivation of it.
 */
export function roundTrip(
  before: Project,
  command: Command,
): { before: Project; after: Project; restored: Project } {
  const inverse = command.invert(before);
  const after = command.apply(before);
  const restored = inverse.apply(after);
  return { before, after, restored };
}

/** A default project with deterministic timestamps, for test fixtures. */
export function fixtureProject(): Project {
  return createDefaultProject({ now: "2026-01-01T00:00:00.000Z" });
}

/** Deterministic id minting inside a test. */
export function idSeq(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}
