"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

import { CommentComposer } from "./comment-composer";
import { Markdown } from "./markdown";
import { Reactions } from "./reactions";
import { RelativeTime } from "./relative-time";
import type { DetailComment, DetailUser } from "./types";

/**
 * A discussion: root comments, each with its replies.
 *
 * ## One level, and the flattening happens twice on purpose
 *
 * Linear's threads are two levels — a root and its replies — and a reply to a
 * reply joins the same thread rather than starting a third level
 * (`research/02-features.md` §12.1). The repository enforces that on write
 * (`SqlCommentRepository#threadRoot` resolves a reply's parent to its own
 * parent), and {@link buildThreads} enforces it again on read.
 *
 * The duplication is deliberate. The server rule guarantees the *stored* shape;
 * the read rule guarantees the *rendered* shape even for rows that predate the
 * rule, arrived from an import, or were written by a client that got it wrong.
 * A renderer that trusts `parentId` to name a root would drop such a comment
 * out of the feed entirely — the worst possible failure for a comment, because
 * nobody can tell that it is missing.
 */

export interface CommentThread {
  readonly root: DetailComment;
  readonly replies: readonly DetailComment[];
}

/**
 * Flat list → threads, oldest first.
 *
 * A reply whose parent is itself a reply is attached to that reply's root. A
 * reply whose parent is missing entirely (a deleted root that did not cascade,
 * or a bad id) is promoted to a root, because showing it in the wrong place
 * beats not showing it at all.
 */
export function buildThreads(
  comments: readonly DetailComment[],
): readonly CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));

  const rootIdOf = (comment: DetailComment): string => {
    let current = comment;
    // Bounded by the list length, so a cycle in the data cannot hang the render.
    for (let hops = 0; hops < comments.length; hops += 1) {
      if (current.parentId === null) return current.id;
      const parent = byId.get(current.parentId);
      if (parent === undefined) return current.id;
      current = parent;
    }
    return current.id;
  };

  const threads = new Map<string, { root: DetailComment; replies: DetailComment[] }>();
  const order: string[] = [];

  for (const comment of comments) {
    const rootId = rootIdOf(comment);
    if (rootId === comment.id) {
      const existing = threads.get(rootId);
      if (existing) existing.root = comment;
      else {
        threads.set(rootId, { root: comment, replies: [] });
        order.push(rootId);
      }
      continue;
    }
    let thread = threads.get(rootId);
    if (thread === undefined) {
      // The reply arrived before its root — possible when the caller sorts by
      // something other than creation time. Hold the slot; the root fills it.
      thread = { root: comment, replies: [] };
      threads.set(rootId, thread);
      order.push(rootId);
      continue;
    }
    thread.replies.push(comment);
  }

  return order.flatMap((id) => {
    const thread = threads.get(id);
    return thread ? [{ root: thread.root, replies: thread.replies }] : [];
  });
}

export interface CommentThreadListProps {
  comments: readonly DetailComment[];
  viewer: DetailUser;
  mentions: Readonly<Record<string, string>>;
  issueHref?: (identifier: string) => string | null;
  canComment: boolean;
  /** `rootId` is always a thread root, never a reply. */
  onReply: (rootId: string, body: string) => void | Promise<void>;
  onEdit: (commentId: string, body: string) => void | Promise<void>;
  onDelete: (commentId: string) => void;
  onToggleReaction: (
    commentId: string,
    emoji: string,
    existingId: string | null,
  ) => void;
}

export type CommentThreadCardProps = Omit<CommentThreadListProps, "comments"> & {
  thread: CommentThread;
};

/**
 * One thread: a root, its replies, and the reply box.
 *
 * Separate from the list because the activity feed interleaves threads with
 * property changes in one chronological timeline — the layout
 * `research/02-features.md` §1.6 describes — so the unit that gets placed is a
 * single thread, not the whole discussion.
 */
export function CommentThreadCard({
  thread,
  viewer,
  mentions,
  issueHref,
  canComment,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
}: CommentThreadCardProps) {
  const [replying, setReplying] = useState(false);

  return (
    <div
      data-testid={`comment-thread-${thread.root.id}`}
      className="rounded-[var(--radius-lg)] border border-subtle bg-panel"
    >
      <CommentCard
        comment={thread.root}
        viewer={viewer}
        mentions={mentions}
        issueHref={issueHref}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleReaction={onToggleReaction}
        onReply={canComment ? () => setReplying(true) : undefined}
      />

      {thread.replies.length > 0 ? (
        <div className="border-t border-subtle pl-6">
          {thread.replies.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              viewer={viewer}
              mentions={mentions}
              issueHref={issueHref}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleReaction={onToggleReaction}
              // A reply's "Reply" targets the thread *root*. This is the client
              // half of the one-level rule: the id that goes to the server is
              // already the root's, so the flattening on write has nothing to do.
              onReply={canComment ? () => setReplying(true) : undefined}
            />
          ))}
        </div>
      ) : null}

      {replying ? (
        <div className="border-t border-subtle p-2 pl-6">
          <CommentComposer
            compact
            autoFocus
            placeholder="Reply…"
            submitLabel="Reply"
            testId={`comment-reply-composer-${thread.root.id}`}
            submitTestId={`comment-reply-submit-${thread.root.id}`}
            onCancel={() => setReplying(false)}
            onSubmit={async (body) => {
              await onReply(thread.root.id, body);
              setReplying(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function CommentThreadList({ comments, ...rest }: CommentThreadListProps) {
  return (
    <div data-testid="comment-threads" className="flex flex-col gap-4">
      {buildThreads(comments).map((thread) => (
        <CommentThreadCard key={thread.root.id} thread={thread} {...rest} />
      ))}
    </div>
  );
}

function CommentCard({
  comment,
  viewer,
  mentions,
  issueHref,
  onEdit,
  onDelete,
  onToggleReaction,
  onReply,
}: {
  comment: DetailComment;
  viewer: DetailUser;
  mentions: Readonly<Record<string, string>>;
  issueHref?: (identifier: string) => string | null;
  onEdit: (commentId: string, body: string) => void | Promise<void>;
  onDelete: (commentId: string) => void;
  onToggleReaction: (
    commentId: string,
    emoji: string,
    existingId: string | null,
  ) => void;
  onReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // Whose comment it is decides which controls render. The *authority* is
  // `comment.update_delete` on the server — this is which buttons to draw, not
  // whether the action is permitted.
  const isOwn = comment.user.id === viewer.id;

  return (
    <article data-testid={`comment-${comment.id}`} className="group p-3">
      <header className="flex items-center gap-2">
        <Avatar
          id={comment.user.id}
          name={comment.user.name}
          src={comment.user.avatarUrl}
          color={comment.user.avatarColor}
          size={20}
          decorative
        />
        <span className="text-small text-primary [font-weight:var(--weight-medium)]">
          {comment.user.name}
        </span>
        <RelativeTime value={comment.createdAt} className="text-micro text-tertiary" />
        {comment.editedAt !== null ? (
          <span
            data-testid={`comment-edited-${comment.id}`}
            title={`Edited ${comment.editedAt}`}
            className="text-micro text-tertiary"
          >
            (edited)
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {onReply ? (
            <Button
              size="sm"
              variant="ghost"
              data-testid={`comment-reply-${comment.id}`}
              onClick={onReply}
            >
              Reply
            </Button>
          ) : null}
          {isOwn ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`comment-edit-${comment.id}`}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`comment-delete-${comment.id}`}
                onClick={() => onDelete(comment.id)}
              >
                Delete
              </Button>
            </>
          ) : null}
        </span>
      </header>

      <div className={cn("mt-1", "pl-7")}>
        {editing ? (
          <CommentComposer
            compact
            autoFocus
            initialValue={comment.body}
            submitLabel="Save"
            placeholder="Edit comment…"
            testId={`comment-edit-composer-${comment.id}`}
            submitTestId={`comment-edit-submit-${comment.id}`}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await onEdit(comment.id, body);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <Markdown
              source={comment.body}
              mentions={mentions}
              issueHref={issueHref}
              data-testid={`comment-body-${comment.id}`}
              className="text-small"
            />
            <div className="mt-2">
              <Reactions
                reactions={comment.reactions}
                viewerId={viewer.id}
                testId={`comment-reactions-${comment.id}`}
                alwaysShowAdd
                onToggle={(emoji, existingId) =>
                  onToggleReaction(comment.id, emoji, existingId)
                }
              />
            </div>
          </>
        )}
      </div>
    </article>
  );
}
