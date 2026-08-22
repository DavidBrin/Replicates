/**
 * Project-level commands (SPEC.md §5).
 *
 * **The navigation rule.** `activePatternId` and `playbackMode` are persisted
 * domain state but are *not* editable by any command: switching patterns or
 * flipping `L` is navigation, not an edit, and must never enter the undo
 * stack. {@link ProjectPatch} therefore cannot name them, and the store
 * exposes them through plain non-undoable setters instead.
 *
 * The one exception is a cascade, not an edit: deleting the active pattern
 * moves `activePatternId` to a surviving pattern, and that move is captured by
 * `removePattern`'s own inverse.
 */

import { clampTempo } from "../tickMath";
import type { Project } from "../types";
import { clamp } from "../tickMath";
import { type Command, pick } from "./types";

export type ProjectPatch = Partial<Pick<Project, "name" | "tempo" | "globalSwing">>;
export const PROJECT_PATCH_KEYS = ["name", "tempo", "globalSwing"] as const;

export function updateProject(patch: ProjectPatch): Command {
  return {
    type: "updateProject",
    label: "Change project settings",
    // Nothing to write when the payload is empty — the dispatcher drops such
    // a command before it reaches history (`types.ts`'s `isEmptyCommand`).
    empty: Object.keys(patch).length === 0,
    apply(project) {
      const next = { ...project, ...patch };
      if (patch.tempo !== undefined) next.tempo = clampTempo(patch.tempo);
      if (patch.globalSwing !== undefined) next.globalSwing = clamp(patch.globalSwing, 0, 1);
      return next;
    },
    invert(before) {
      const keys = PROJECT_PATCH_KEYS.filter((key) => key in patch);
      return updateProject(pick(before, keys));
    },
  };
}

/**
 * Wholesale replacement — JSON import (D3), which SPEC.md §2.2 requires to be
 * undoable. `createdAt` comes from the imported file; `id` too, so a
 * re-import of the same file is idempotent.
 *
 * `wholesale: true` is the *declaration* the store reconciles against, and the
 * inverse carries it as well — undoing an import swaps the entity set back
 * just as thoroughly as the import did. Keeping the id (idempotent re-import)
 * is exactly why the store may not infer this from `project.id` changing.
 */
export function replaceProject(project: Project): Command {
  return {
    type: "replaceProject",
    label: "Load project",
    wholesale: true,
    apply() {
      return project;
    },
    invert(before) {
      return replaceProject(before);
    },
  };
}
