/**
 * `POST /api/comments`
 *
 * Post a comment or a threaded reply.
 *
 * Three things happen in one transaction, and they are one transaction because
 * a comment that exists without its mention notifications is a comment the
 * person it named never hears about:
 *
 * 1. the comment row (the repository flattens a reply-to-a-reply onto its
 *    thread root — `adapters/repositories/comments.ts`),
 * 2. a subscription for every `@`-mentioned member, and
 * 3. an inbox notification for each of them.
 *
 * ## Mentions are read from the parsed body, not from a regex
 *
 * `collectMentionHandles` runs the same markdown parser the renderer does, so a
 * handle inside a code span is a code sample rather than a summons — the chip
 * and the notification agree about what a mention *is*, because they are
 * computed from the same tree.
 *
 * ## Authorization
 *
 * `comment.create` on the issue's resource, which carries the team's privacy
 * and the project's roll-up. A workspace member reaches a public team's issues
 * and nothing else (footnote 11); a guest reaches only what they were added to.
 *
 * ## `parentId` is authorized too, because it is a second issue reference
 *
 * The issue is checked and the parent is a *comment id*, which names an issue
 * of its own. Left unchecked, a reply filed against a readable issue can hang
 * itself off a thread in one the author cannot see: the reply's stored parent
 * becomes that thread's root, so deleting the unreadable issue cascades through
 * `comments.parent_id` into this one, and the thread this comment belongs to is
 * decided by a row the author was never authorized against. The resolved thread
 * root must therefore sit on the very issue `comment.create` was granted on —
 * and a parent that does not answers 404, the same as one that never existed,
 * because the ids differ only in whether they belong to something the author is
 * allowed to know about.
 */

import { z } from "zod";

import {
  jsonError,
  loadIssueContext,
  requireAction,
} from "@/app/api/_lib/issue-access";
import type { CommentId, IssueId } from "@/domain/entities";
import { collectMentionHandles } from "@/lib/markdown";
import type { Repositories } from "@/ports/repositories";

const Body = z.object({
  issueId: z.string().min(1).max(64),
  body: z.string().min(1).max(50_000),
  parentId: z.string().min(1).max(64).nullish(),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "A comment needs an issue and a body.");
  }

  const context = await loadIssueContext(request, parsed.data.issueId);
  if (context instanceof Response) return context;

  const denied = requireAction(context, "comment.create");
  if (denied) return denied;

  const { repos, db, userId, issue, workspaceId, headers } = context;

  const parentId = parsed.data.parentId ?? null;
  if (parentId !== null && !(await belongsToIssue(repos, parentId, issue.id))) {
    return jsonError(404, "Not found.", headers);
  }

  const handles = collectMentionHandles(parsed.data.body);
  const members = handles.length === 0 ? [] : await repos.workspaces.listMembers(workspaceId);
  const mentioned = members.filter((member) =>
    handles.includes(member.user.displayName.toLowerCase()),
  );

  const comment = await db.transaction(async (tx) => {
    const created = await repos.comments.create(
      {
        issueId: issue.id,
        userId,
        body: parsed.data.body,
        parentId,
      },
      tx,
    );

    for (const member of mentioned) {
      // Mentioning someone subscribes them as well as notifying them
      // (`research/02-features.md` §12.1) — otherwise they hear about being
      // named once and never about the reply to it.
      await repos.issues.subscribe(issue.id, member.userId, tx);
      await repos.notifications.create(
        {
          userId: member.userId,
          type: "comment_mentioned",
          issueId: issue.id,
          commentId: created.id,
          actorId: userId,
        },
        tx,
      );
    }

    return created;
  });

  return Response.json(
    {
      id: comment.id,
      issueId: comment.issueId,
      // The *stored* parent, which for a reply-to-a-reply is the thread root
      // rather than what the client sent. Returning it lets the client's
      // optimistic row settle into the right thread without a refetch.
      parentId: comment.parentId,
      body: comment.body,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
      mentioned: mentioned.map((member) => member.userId),
    },
    { status: 201, headers },
  );
}

/**
 * Does this parent comment — and the thread root the write will resolve it to —
 * live on the issue this request was authorized against?
 *
 * Threads are one level deep, so the root is at most one hop away
 * (`adapters/repositories/comments.ts`). The hop is followed rather than assumed
 * because the root is the row the insert actually stores in `parent_id` and the
 * row a cascading delete would travel from, and "the parent is fine, its root is
 * somewhere else" is precisely the shape this check exists to refuse.
 */
async function belongsToIssue(
  repos: Repositories,
  parentId: CommentId,
  issueId: IssueId,
): Promise<boolean> {
  const parent = await repos.comments.byId(parentId);
  if (parent === null || parent.issueId !== issueId) return false;
  if (parent.parentId === null) return true;

  const root = await repos.comments.byId(parent.parentId);
  return root !== null && root.issueId === issueId;
}
