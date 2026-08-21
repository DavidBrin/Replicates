/**
 * Id minting for domain entities.
 *
 * Deliberately *not* `crypto.randomUUID()`: `src/domain` may not touch a
 * browser/Node global (SPEC.md §6, enforced by `layering.test.ts`), and a
 * counter is reproducible, which makes every command test readable. Ids only
 * have to be unique inside one `Project`, so a monotonic counter with a
 * per-kind prefix is enough — as long as a project loaded from disk reseeds
 * the counter past whatever it already contains, which is what
 * {@link reseedIds} is for.
 */

import type { Project } from "./types";

const PREFIXES = {
  project: "prj",
  channel: "ch",
  pattern: "pat",
  note: "n",
  track: "trk",
  clip: "clip",
  mixer: "mix",
} as const;

export type IdKind = keyof typeof PREFIXES;

let counter = 0;

/** Mint a fresh id, e.g. `note-42`. */
export function nextId(kind: IdKind): string {
  counter += 1;
  return `${PREFIXES[kind]}-${counter}`;
}

/** Test seam: reset the counter to a known value. */
export function resetIds(value = 0): void {
  counter = value;
}

/** Current counter value — exported for tests and {@link reseedIds}. */
export function peekIdCounter(): number {
  return counter;
}

const SUFFIX = /-(\d+)$/;

/**
 * Push the counter past every numeric id already present in `project`, so ids
 * minted after a load can never collide with ids minted before the save.
 */
export function reseedIds(project: Project): void {
  let max = counter;
  const consider = (id: string): void => {
    const match = SUFFIX.exec(id);
    if (match === null) return;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  };

  consider(project.id);
  for (const id of Object.keys(project.channels)) consider(id);
  for (const id of Object.keys(project.patterns)) consider(id);
  for (const pattern of Object.values(project.patterns)) {
    for (const id of Object.keys(pattern.notes)) consider(id);
  }
  for (const id of Object.keys(project.playlistTracks)) consider(id);
  for (const id of Object.keys(project.clips)) consider(id);
  for (const id of Object.keys(project.mixerTracks)) consider(id);

  counter = max;
}
