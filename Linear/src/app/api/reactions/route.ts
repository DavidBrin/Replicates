/**
 * `POST /api/reactions` and `DELETE /api/reactions?id=…`
 *
 * Add or remove an emoji reaction on a comment or on an issue description.
 *
 * ## Not a toggle
 *
 * Two methods rather than one `POST` that flips. A toggle has to read the
 * current state to decide what it is doing, which makes a double-tap on a phone
 * — two requests, one round trip apart — resolve to "add" twice or "remove"
 * twice depending on ordering. Explicit verbs are idempotent: `POST` of a
 * reaction you already hold returns the one you have (the repository's
 * `on conflict do nothing` path), and `DELETE` of one that is gone is a no-op.
 *
 * ## Authorization
 *
 * Reacting is commenting-adjacent, so it takes `comment.create` on the issue:
 * anyone who may join the discussion may react to it, and nobody who cannot see
 * the issue can probe for it. Removing takes nothing further — the repository
 * scopes the delete to `user_id = $2`, so a reaction that is not yours is simply
 * not found.
 */

import { z } from "zod";

import {
  jsonError,
  loadIssueContext,
  requireAction,
} from "@/app/api/_lib/issue-access";
import { getDb } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";

const Body = z
  .object({
    commentId: z.string().min(1).max(64).nullish(),
    issueId: z.string().min(1).max(64).nullish(),
    /**
     * An emoji, not arbitrary text. The cap is characters rather than bytes
     * because a single emoji can be five code points (a family, a flag, a
     * skin-tone modifier), and a length in bytes would reject them.
     */
    emoji: z.string().min(1).max(16),
  })
  .refine(
    (input) =>
      (input.commentId === null || input.commentId === undefined) !==
      (input.issueId === null || input.issueId === undefined),
    { message: "A reaction targets exactly one of a comment or an issue" },
  );

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "A reaction needs one target and an emoji.");
  }

  const repos = getRepositories();
  const { commentId, issueId, emoji } = parsed.data;

  // Whichever end was named, the *issue* is what authorization is about.
  let targetIssueId = issueId ?? null;
  if (commentId !== null && commentId !== undefined) {
    const comment = await repos.comments.byId(commentId);
    if (!comment) return jsonError(404, "Not found.");
    targetIssueId = comment.issueId;
  }
  if (targetIssueId === null) return jsonError(400, "A reaction needs a target.");

  const context = await loadIssueContext(request, targetIssueId);
  if (context instanceof Response) return context;

  const denied = requireAction(context, "comment.create");
  if (denied) return denied;

  const reaction = await context.repos.comments.addReaction(
    commentId !== null && commentId !== undefined
      ? { commentId }
      : { issueId: targetIssueId },
    context.userId,
    emoji,
  );

  return Response.json(
    {
      id: reaction.id,
      emoji: reaction.emoji,
      userId: reaction.userId,
      commentId: reaction.commentId,
      issueId: reaction.issueId,
    },
    { status: 201, headers: context.headers },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (id === null || id === "") return jsonError(400, "A reaction id is required.");

  const reaction = await findReaction(id);
  if (reaction === null) {
    // Already gone, or never existed, or not visible. One answer for all three.
    return Response.json({ id }, { status: 200 });
  }

  const context = await loadIssueContext(request, reaction.issueId);
  if (context instanceof Response) return context;

  await context.repos.comments.removeReaction(id, context.userId);
  return Response.json({ id }, { status: 200, headers: context.headers });
}

/**
 * The reaction's issue, resolved through its comment when it has one.
 *
 * There is no `reactions.byId` on the port — reactions are only ever read as
 * part of a comment — so this is a direct read. It returns the issue id and
 * nothing else, which is all authorization needs.
 */
async function findReaction(id: string): Promise<{ issueId: string } | null> {
  const rows = await getDb().query<{ issue_id: string | null }>(
    `select coalesce(r.issue_id, c.issue_id) as issue_id
       from reactions r
       left join comments c on c.id = r.comment_id
      where r.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row || row.issue_id === null) return null;
  return { issueId: row.issue_id };
}
