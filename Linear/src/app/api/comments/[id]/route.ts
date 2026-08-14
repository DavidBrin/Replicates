/**
 * `PATCH /api/comments/[id]` and `DELETE /api/comments/[id]`
 *
 * Edit or delete one comment.
 *
 * ## The authorization here is the interesting part
 *
 * Both methods check `comment.update_delete` against a resource whose
 * `authorId` is **the comment's author**, not the issue's creator. That single
 * substitution is what makes the `isAuthor` predicate in the matrix mean what it
 * says: a workspace member or team member may edit *their own* comment, and an
 * admin may edit anyone's.
 *
 * Getting it wrong is invisible in the happy path — you are usually editing your
 * own comment on your own issue, so both ids are yours — and lets anyone edit
 * every comment on any issue they filed. The suite asserts the negative case
 * directly.
 *
 * A comment on an issue the actor cannot see is a 404 rather than a 403, for the
 * same reason the issue itself is.
 */

import { z } from "zod";

import {
  commentResource,
  jsonError,
  loadIssueContext,
  requireAction,
  type IssueContext,
} from "@/app/api/_lib/issue-access";
import { getRepositories } from "@/adapters/repositories";
import type { CommentWithAuthor } from "@/ports/repositories";

const Body = z.object({ body: z.string().min(1).max(50_000) });

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Resolve the comment first, then its issue.
 *
 * The comment is read outside {@link loadIssueContext} because the request
 * names a comment and the policy needs an issue; reading it first is also what
 * turns "no such comment" into a 404 before any permission is evaluated.
 */
type LoadedComment =
  | { readonly ok: false; readonly response: Response }
  | {
      readonly ok: true;
      readonly comment: CommentWithAuthor;
      readonly context: IssueContext;
    };

async function loadComment(
  request: Request,
  commentId: string,
): Promise<LoadedComment> {
  const repos = getRepositories();
  const comment = await repos.comments.byId(commentId);
  if (!comment) return { ok: false, response: jsonError(404, "Not found.") };

  const context = await loadIssueContext(request, comment.issueId);
  if (context instanceof Response) return { ok: false, response: context };

  return { ok: true, comment, context };
}

export async function PATCH(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "A comment needs a body.");

  const loaded = await loadComment(request, id);
  if (!loaded.ok) return loaded.response;
  const { comment, context } = loaded;

  const denied = requireAction(
    context,
    "comment.update_delete",
    commentResource(context.resource, comment.userId),
  );
  if (denied) return denied;

  const updated = await context.repos.comments.update(
    id,
    parsed.data.body,
    context.userId,
  );

  return Response.json(
    {
      id: updated.id,
      parentId: updated.parentId,
      body: updated.body,
      createdAt: updated.createdAt,
      editedAt: updated.editedAt,
    },
    { status: 200, headers: context.headers },
  );
}

export async function DELETE(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;

  const loaded = await loadComment(request, id);
  if (!loaded.ok) return loaded.response;
  const { comment, context } = loaded;

  const denied = requireAction(
    context,
    "comment.update_delete",
    commentResource(context.resource, comment.userId),
  );
  if (denied) return denied;

  await context.repos.comments.delete(id, context.userId);
  return Response.json({ id }, { status: 200, headers: context.headers });
}
