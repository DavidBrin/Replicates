/**
 * `PATCH /api/issues/{id}` — the property edit behind every picker, every
 * shortcut, and every bulk selection.
 *
 * ## Bulk is N requests, and that is the design
 *
 * Pressing `S` with five issues selected sends five PATCHes. They overlap,
 * because Route Handlers have no per-client dispatch queue (`DECISIONS.md` D6),
 * and they cannot interleave *per issue* because the client serialises writes to
 * one entity through a FIFO queue (`lib/store/issues.ts`). One round trip's
 * latency for the whole selection, and ordering guaranteed where it matters.
 *
 * ## Which policy row applies is decided by the facts, not by the caller
 *
 * `issue.update_own` and `issue.update_any` are separate rows with different
 * columns — a workspace member may edit their own issue in a public team, and
 * someone else's only with a container role. The handler attaches `authorId`
 * and `assigneeId` to the resource and asks for both; the matrix does the rest.
 * A handler that picked one row by branching on the actor's own role would be
 * the inline role comparison `SPEC.md` §4 forbids, spelled differently — and
 * `domain/__tests__/policy.test.ts` greps the tree for exactly that shape.
 *
 * ## A patch that only reorders is a different permission
 *
 * `issue.reorder` exists because manual order is **global** — one key shared by
 * every user and every view (`SPEC.md` §3) — so dragging a row is editing
 * everyone's list, and that is a heavier grant than editing your own issue's
 * title.
 */

import { z } from "zod";

import { getRepositories } from "@/adapters/repositories";
import { isPriority, type Priority } from "@/domain/entities";
import type { Action } from "@/domain/policy";
import {
  authenticate,
  authorize,
  failure,
  issueResource,
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

/**
 * `.strict()` so an unknown key is a 400 rather than a silent no-op.
 *
 * A client that misspells `assignee_id` should be told, not quietly ignored —
 * the optimistic store has already applied its own version of that patch, and a
 * server that accepts the request without honouring it produces a row that
 * reverts on the next reload with no error anywhere.
 */
const PatchBody = z
  .object({
    title: z.string().min(1).max(512).optional(),
    description: z.string().max(50_000).optional(),
    stateId: z.string().min(1).max(64).optional(),
    priority: priority.optional(),
    assigneeId: z.string().min(1).max(64).nullable().optional(),
    projectId: z.string().min(1).max(64).nullable().optional(),
    estimate: z.number().int().min(0).max(1_000).nullable().optional(),
    dueDate: z.string().max(32).nullable().optional(),
    sortOrder: z.string().min(1).max(256).optional(),
    labelIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .strict();

/** Only `sortOrder` moved ⇒ this is a reorder, which is its own grant. */
function actionsFor(patch: Record<string, unknown>): readonly Action[] {
  const keys = Object.keys(patch);
  if (keys.length === 1 && keys[0] === "sortOrder") return ["issue.reorder"];
  return ["issue.update_any", "issue.update_own"];
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authenticated = await authenticate(request);
  if (!authenticated.ok) return authenticated.response;
  const viewer = authenticated.value;

  const { id } = await context.params;
  const parsed = PatchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return failure(400, "That change could not be read.", viewer);
  }
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return failure(400, "Nothing to change.", viewer);
  }

  const loaded = await loadIssueContext(id, viewer.user.id);
  if (!loaded) return failure(404, "No such issue.", viewer);
  const { issue, team, actor } = loaded;

  const resource = issueResource(team, issue);
  const allowed = authorize(actor, actionsFor(patch), resource, viewer);
  if (!allowed.ok) return allowed.response;

  const invalid = await validateReferences(patch, team);
  if (invalid) return failure(400, invalid, viewer);

  const repositories = getRepositories();
  const { labelIds, ...fields } = patch;

  // Labels first: `setLabels` writes one activity row per difference, and doing
  // it before the field update means the returned row already carries the new
  // set rather than needing a second read.
  if (labelIds !== undefined) {
    await repositories.issues.setLabels(issue.id, labelIds, viewer.user.id);
  }

  const updated =
    Object.keys(fields).length > 0
      ? await repositories.issues.update(issue.id, fields, viewer.user.id)
      : ((await repositories.issues.byId(issue.id)) ?? issue);

  return respond({ issue: updated }, 200, viewer);
}

/**
 * `DELETE` is the 30-day trash window, not a purge.
 *
 * Deliberately not role-gated beyond viewing the issue: `SPEC.md` §4 records
 * that the recovery window *is* the safety net, matching Linear, and that a
 * confirmation dialog on a reversible action trains people to click through
 * dialogs.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authenticated = await authenticate(request);
  if (!authenticated.ok) return authenticated.response;
  const viewer = authenticated.value;

  const { id } = await context.params;
  const loaded = await loadIssueContext(id, viewer.user.id);
  if (!loaded) return failure(404, "No such issue.", viewer);
  const { issue, team, actor } = loaded;

  const allowed = authorize(
    actor,
    ["issue.delete"],
    issueResource(team, issue),
    viewer,
  );
  if (!allowed.ok) return allowed.response;

  await getRepositories().issues.trash(issue.id, viewer.user.id);
  return respond({ id: issue.id }, 200, viewer);
}
