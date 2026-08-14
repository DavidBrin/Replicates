/**
 * `POST /api/issues/reorder` — a drag, as one write.
 *
 * ## Why it takes the neighbours and not an index
 *
 * `ports/repositories.ts` states the reason: the client knows what the list
 * looks like, the server does not, and an index would have to be resolved
 * against a snapshot that may already have moved. The request carries the order
 * keys either side of the drop, and the key is derived from those with
 * `keyBetween` — the same function the client called to place the card
 * optimistically. `generateKeyBetween` is deterministic, so both sides compute
 * the *same* string and the reconcile is a no-op with nothing to animate.
 *
 * **The server does not trust the client's key.** It recomputes from the
 * neighbours rather than accepting `sortOrder` from the body, so a client that
 * got its arithmetic wrong cannot write a key that contradicts the order it
 * claims to have observed. `keyBetween` also rejects swapped neighbours
 * outright (`domain/ordering.ts`, D5) — a drag handler that passed them the
 * wrong way round would otherwise write a plausible key in the wrong place.
 *
 * ## One request, two meanings
 *
 * Dropping into another board column sets the grouped field *and* positions the
 * card. Splitting that into two requests would let the first land without the
 * second, leaving an issue in the right column at an arbitrary position; here
 * both are one `update`, one row, one activity trail.
 */

import { z } from "zod";

import { getRepositories } from "@/adapters/repositories";
import { isPriority, type Priority } from "@/domain/entities";
import { keyBetween, OrderKeyError } from "@/domain/ordering";
import type { Action } from "@/domain/policy";
import {
  authenticate,
  authorize,
  failure,
  loadIssueContext,
  respond,
  validateReferences,
} from "../authorize";

/**
 * Priority, validated through the domain's own guard.
 *
 * `z.enum` cannot express a numeric literal union and `z.number()` would let
 * `7` through to a `smallint` column with a check constraint, where it fails at
 * execution rather than here — with an error that names the statement instead
 * of the field. Reusing `isPriority` keeps one definition of what the five
 * legal values are.
 */
const priority = z.custom<Priority>((value) => isPriority(value), {
  message: "Invalid priority.",
});

const ReorderBody = z.object({
  id: z.string().min(1).max(64),
  beforeKey: z.string().min(1).max(256).nullable(),
  afterKey: z.string().min(1).max(256).nullable(),
  /**
   * The grouped field the drop implies. `sortOrder` is accepted in the shape
   * for symmetry with the client's patch and is then ignored — see above.
   */
  patch: z
    .object({
      stateId: z.string().min(1).max(64).optional(),
      priority: priority.optional(),
      assigneeId: z.string().min(1).max(64).nullable().optional(),
      projectId: z.string().min(1).max(64).nullable().optional(),
      labelIds: z.array(z.string().min(1).max(64)).max(50).optional(),
      sortOrder: z.string().min(1).max(256).optional(),
    })
    .strict()
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticate(request);
  if (!authenticated.ok) return authenticated.response;
  const viewer = authenticated.value;

  const parsed = ReorderBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return failure(400, "That move could not be read.", viewer);
  }
  const { id, beforeKey, afterKey, patch = {} } = parsed.data;

  // `null` covers "no such issue" *and* "an issue you may not view", so a drag
  // aimed at a stranger's id cannot tell the two apart — see `../authorize.ts`.
  const loaded = await loadIssueContext(id, viewer.user.id);
  if (!loaded) return failure(404, "No such issue.", viewer);
  const { issue, team, actor, resource } = loaded;

  // Listed field by field rather than destructured with a rest, so that
  // dropping the client's `sortOrder` is a visible decision rather than an
  // unused binding a reader has to notice.
  const { labelIds } = patch;
  const fields = {
    ...(patch.stateId !== undefined ? { stateId: patch.stateId } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
    ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
  };
  const changesFields = Object.keys(fields).length > 0 || labelIds !== undefined;
  const actions: readonly Action[] = changesFields
    ? ["issue.update_any", "issue.update_own"]
    : ["issue.reorder"];

  const allowed = authorize(actor, actions, resource, viewer);
  if (!allowed.ok) return allowed.response;

  const invalid = await validateReferences(patch, team, actor);
  if (invalid) return failure(400, invalid, viewer);

  let sortOrder: string;
  try {
    sortOrder = keyBetween(beforeKey, afterKey);
  } catch (error) {
    if (error instanceof OrderKeyError) {
      // The client's view of the order disagrees with what is stored — a stale
      // list, or neighbours passed the wrong way round. Loud beats a key
      // written somewhere arbitrary.
      return failure(409, "The list has moved on. Try again.", viewer);
    }
    throw error;
  }

  const repositories = getRepositories();
  if (labelIds !== undefined) {
    await repositories.issues.setLabels(issue.id, labelIds, viewer.user.id);
  }

  const updated = await repositories.issues.update(
    issue.id,
    { ...fields, sortOrder },
    viewer.user.id,
  );

  return respond({ issue: updated }, 200, viewer);
}
