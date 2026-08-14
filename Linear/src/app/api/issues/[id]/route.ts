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
 *
 * ## One patch is one transaction
 *
 * Labels live in a join table and the rest of the fields live on the row, so a
 * patch carrying both used to be two writes — and the second one can fail. It
 * did: `dueDate` reaches a Postgres `date` column, and a string that is not a
 * date is rejected *by the driver*, after the labels had already committed. The
 * caller got a 500 and a label set they never asked for, which the optimistic
 * store then had no error to roll back from.
 *
 * Both halves are therefore fixed. The date is validated in {@link PatchBody},
 * where a bad one is a 400 that names the field rather than a 500 that names a
 * statement; and the two writes share a transaction, so any *other* failure —
 * a constraint nobody predicted, a lost connection between them — takes the
 * whole patch with it. Validation alone would only have closed the one hole
 * that was found.
 */

import { z } from "zod";

import { getDb } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import { isPriority, type Priority } from "@/domain/entities";
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

/**
 * A real calendar day, in the format the `<input type="date">` behind this
 * field already emits.
 *
 * `due_date` is a Postgres `date`. Anything else is rejected by the driver
 * rather than here, which turns a typo into a 500 that names a SQL statement —
 * and, before this patch became one transaction, into a 500 that had already
 * written the *other* half of the request.
 *
 * The round trip is the second half of the check: `2026-02-31` matches the
 * shape, and only re-serialising the parsed instant catches that February has
 * no thirty-first.
 */
function isCalendarDate(value: string): boolean {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}

const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A due date must look like 2026-03-16.")
  .refine(isCalendarDate, "That is not a real date.");

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
    dueDate: dueDate.nullable().optional(),
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

  // `null` covers "no such issue" *and* "an issue you may not view", so the two
  // are one answer — see `../authorize.ts`.
  const loaded = await loadIssueContext(id, viewer.user.id);
  if (!loaded) return failure(404, "No such issue.", viewer);
  const { issue, team, actor, resource } = loaded;

  const allowed = authorize(actor, actionsFor(patch), resource, viewer);
  if (!allowed.ok) return allowed.response;

  // `sortOrder` needs its own grant *in addition*, not instead.
  //
  // `authorize` is deliberately OR — an edit is `update_own` **or**
  // `update_any` — and `actionsFor` only asked for `issue.reorder` when
  // `sortOrder` arrived alone. Together those two facts meant the grant could
  // be downgraded by bundling: `{ title: <the title it already has>,
  // sortOrder: <anywhere> }` is authorised as an ordinary edit by the author's
  // `update_own`, and the issue moves. The position is not a field of this
  // issue the way its title is — it is this issue's place in a list everyone
  // in the workspace sees — which is exactly why it has a separate row in the
  // policy table.
  if (patch.sortOrder !== undefined) {
    const reorder = authorize(actor, ["issue.reorder"], resource, viewer);
    if (!reorder.ok) return reorder.response;
  }

  const invalid = await validateReferences(patch, team, actor);
  if (invalid) return failure(400, invalid, viewer);

  const repositories = getRepositories();
  const { labelIds, ...fields } = patch;

  // One transaction for the whole patch — see the header. Both repository
  // methods take the executor as their trailing argument and join it rather
  // than opening one of their own, so this is the only boundary.
  const updated = await getDb().transaction(async (tx) => {
    // Labels first: `setLabels` writes one activity row per difference, and
    // doing it before the field update means the returned row already carries
    // the new set rather than needing a second read.
    if (labelIds !== undefined) {
      await repositories.issues.setLabels(issue.id, labelIds, viewer.user.id, tx);
    }

    return Object.keys(fields).length > 0
      ? await repositories.issues.update(issue.id, fields, viewer.user.id, tx)
      : ((await repositories.issues.byId(issue.id, tx)) ?? issue);
  });

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
  const { issue, actor, resource } = loaded;

  const allowed = authorize(actor, ["issue.delete"], resource, viewer);
  if (!allowed.ok) return allowed.response;

  await getRepositories().issues.trash(issue.id, viewer.user.id);
  return respond({ id: issue.id }, 200, viewer);
}
