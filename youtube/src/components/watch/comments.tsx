"use client";

import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";

import { SortIcon, ThumbDownIcon, ThumbUpIcon } from "@/components/icons";
import { Avatar, Button, Menu, MenuItem } from "@/components/primitives";
import {
  formatCommentCount,
  formatCompactCount,
  formatRelativeTime,
} from "@/domain/format";
import type { Comment } from "@/domain/types";
import type { CommentSort } from "@/adapters/repositories/comments";

/**
 * The comment thread.
 *
 * ## One level deep, which is YouTube's real model
 *
 * A reply to a reply is filed under the same top-level comment, with the person
 * being answered turned into an `@mention` in the body. That is not this
 * component's simplification — `src/adapters/repositories/comments.ts` already
 * enforces it in `resolveParent` (`parent.parent_id ?? parent.id`), and this UI
 * renders what the schema stores. So there are exactly two levels here and no
 * recursion, and the reply composer under a *reply* posts to the same thread.
 *
 * ## Measurements
 *
 * `research/08-youtube-ui-measured.md` §3.5 for geometry, §2.2 for type, §8.3
 * for copy, and `research/extracted/watch-layout-1920.json` `commentSamples`
 * for the shape of a real row.
 *
 * | Part | Measured |
 * | --- | --- |
 * | Top-level avatar | 36×36, text 16px after it |
 * | **Reply indent** | **48px**, from the reply renderer's own left offset |
 * | Reply avatar | 24×24 |
 * | Toolbar | 32px tall; like/dislike 32×32; `Reply` 53.66×32 |
 * | Author / timestamp | 12/18/500 and 12/18/400 |
 * | Body | 14/20/400 |
 * | Header | `233 Comments` at 15/700, then `Sort by` |
 *
 * ## One honest divergence
 *
 * The measured rows show the author as **`@handle`** (`@CaptainDiscover`,
 * `@FireSwan16t`). The `Comment` read model carries `authorName`, which
 * `commentSelect` resolves to the author's *channel name* and not their handle
 * — there is no handle on the projection. Rendering the name is what the data
 * supports; adding a handle is a change to a repository this slice does not
 * own, and inventing one from the name would be worse than either.
 */

export interface CommentThread {
  readonly comment: Comment;
  /** Already fetched. The expander shows and hides them; it does not fetch. */
  readonly replies: readonly Comment[];
}

export interface CommentsViewer {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string | null;
}

export interface CommentsProps {
  readonly videoId: string;
  readonly commentCount: number;
  readonly commentsEnabled: boolean;
  readonly threads: readonly CommentThread[];
  readonly viewer: CommentsViewer | null;
  readonly now?: Date;
  readonly className?: string;
  /**
   * Post a comment. Defaults to `POST /api/videos/:id/comments`.
   *
   * Injectable for the same reason the player's engine is: a component whose
   * only way to be exercised is a live `fetch` is a component whose behaviour
   * is asserted in an end-to-end test or not at all.
   */
  readonly onPost?: (input: {
    readonly body: string;
    readonly parentId: string | null;
  }) => Promise<Comment>;
  /** React to a comment. Defaults to `POST /api/videos/:id/reactions`. */
  readonly onReact?: (
    commentId: string,
    value: 1 | -1,
  ) => Promise<{ readonly likeCount: number; readonly viewerReaction: 1 | -1 | null }>;
}

/**
 * The two orders the UI offers, and the order within each.
 *
 * **Pinned first in both**, which matches `listComments`' own SQL
 * (`cm.is_pinned desc, …`) — a pinned comment that sorted to page four would
 * not be pinned to anything. `top` is by likes and `newest` by time.
 *
 * Sorting happens here rather than by refetching because the page already holds
 * every thread it is going to show: a round trip to reorder twenty rows the
 * client is already holding is latency spent on nothing. The tie-breakers
 * mirror the repository's exactly so that the two orders cannot disagree about
 * two comments with the same like count.
 */
export function sortThreads(
  threads: readonly CommentThread[],
  sort: CommentSort,
): readonly CommentThread[] {
  return [...threads].sort((a, b) => {
    if (a.comment.isPinned !== b.comment.isPinned) return a.comment.isPinned ? -1 : 1;
    if (sort === "newest") {
      return (
        b.comment.createdAt.getTime() - a.comment.createdAt.getTime() ||
        compareIds(a.comment.id, b.comment.id)
      );
    }
    return (
      b.comment.likeCount - a.comment.likeCount ||
      b.comment.createdAt.getTime() - a.comment.createdAt.getTime() ||
      compareIds(a.comment.id, b.comment.id)
    );
  });
}

function compareIds(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

export function Comments({
  videoId,
  commentCount,
  commentsEnabled,
  threads,
  viewer,
  now,
  className,
  onPost,
  onReact,
}: CommentsProps) {
  const [sort, setSort] = useState<CommentSort>("top");
  const [local, setLocal] = useState<readonly CommentThread[]>(threads);
  const [openReplies, setOpenReplies] = useState<ReadonlySet<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const sorted = useMemo(() => sortThreads(local, sort), [local, sort]);

  const post = useCallback(
    async (body: string, parentId: string | null): Promise<void> => {
      const send =
        onPost ??
        (async (input: { body: string; parentId: string | null }) => {
          const response = await fetch(`/api/videos/${videoId}/comments`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          });
          if (!response.ok) throw new Error(`Posting the comment answered ${response.status}`);
          return reviveComment((await response.json()) as unknown);
        });

      const created = await send({ body, parentId });
      setLocal((current) => {
        if (parentId === null) return [{ comment: created, replies: [] }, ...current];
        return current.map((thread) =>
          thread.comment.id === parentId
            ? {
                comment: { ...thread.comment, replyCount: thread.comment.replyCount + 1 },
                replies: [...thread.replies, created],
              }
            : thread,
        );
      });
      // A reply the viewer just wrote must be visible, or the composer looks
      // like it silently failed.
      if (parentId !== null) {
        setOpenReplies((open) => new Set(open).add(parentId));
        setReplyingTo(null);
      }
    },
    [onPost, videoId],
  );

  const react = useCallback(
    async (commentId: string, value: 1 | -1): Promise<void> => {
      // Optimistic, and reconciled below. A like that waits for a round trip
      // before lighting up reads as a dropped click.
      setLocal((current) => current.map((thread) => applyReaction(thread, commentId, value)));

      const send =
        onReact ??
        (async (id: string, next: 1 | -1) => {
          const response = await fetch(`/api/videos/${videoId}/reactions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ target: "comment", commentId: id, value: next }),
          });
          if (!response.ok) throw new Error(`Reacting answered ${response.status}`);
          return (await response.json()) as {
            likeCount: number;
            viewerReaction: 1 | -1 | null;
          };
        });

      try {
        const settled = await send(commentId, value);
        setLocal((current) =>
          current.map((thread) => settleReaction(thread, commentId, settled)),
        );
      } catch {
        // Put the optimistic change back. Toggling the same value again is the
        // inverse of what was applied, which is why this is a second call
        // rather than a saved snapshot.
        setLocal((current) => current.map((thread) => applyReaction(thread, commentId, value)));
      }
    },
    [onReact, videoId],
  );

  if (!commentsEnabled) {
    return (
      <section data-comments="" className={className}>
        <p className="text-body text-secondary">Comments are turned off.</p>
      </section>
    );
  }

  return (
    <section data-comments="" className={clsx("flex flex-col gap-6", className)}>
      <header data-comments-header="" className="flex items-center gap-8">
        <h2
          data-comment-count=""
          // §2.2: 15px / 700, `line-height: normal` — the same role as the
          // "Shorts" shelf heading and the only other 15px text in the product.
          className="m-0 text-shelf font-[var(--yt-weight-bold)]"
        >
          {/* §8.1: exact and comma-grouped, with a capital `C`. */}
          {formatCommentCount(commentCount)}
        </h2>

        <Menu
          label="Sort comments by"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              data-comment-sort=""
              className="flex items-center gap-2 text-body font-[var(--yt-weight-medium)]"
            >
              <SortIcon size={24} />
              {/* §8.3, verbatim: the trigger reads `Sort by`, not the current
                  order. The current order is the checked row inside. */}
              Sort by
            </button>
          )}
        >
          <MenuItem
            role="menuitemradio"
            checked={sort === "top"}
            onSelect={() => setSort("top")}
          >
            Top comments
          </MenuItem>
          <MenuItem
            role="menuitemradio"
            checked={sort === "newest"}
            onSelect={() => setSort("newest")}
          >
            Newest first
          </MenuItem>
        </Menu>
      </header>

      <Composer
        viewer={viewer}
        // §8.3, verbatim — three periods, not an ellipsis.
        placeholder="Add a comment..."
        submitLabel="Comment"
        onSubmit={(body) => post(body, null)}
      />

      <ol data-comment-list="" className="m-0 flex list-none flex-col gap-4 p-0">
        {sorted.map((thread) => (
          <li key={thread.comment.id} data-comment-thread={thread.comment.id}>
            <CommentRow
              comment={thread.comment}
              now={now}
              onReact={react}
              onReply={() =>
                setReplyingTo((current) =>
                  current === thread.comment.id ? null : thread.comment.id,
                )
              }
            />

            {replyingTo === thread.comment.id ? (
              <div style={{ marginLeft: `${REPLY_INDENT}px` }} className="mt-2">
                <Composer
                  viewer={viewer}
                  placeholder="Add a reply..."
                  submitLabel="Reply"
                  compact
                  onCancel={() => setReplyingTo(null)}
                  onSubmit={(body) => post(body, thread.comment.id)}
                />
              </div>
            ) : null}

            {thread.comment.replyCount > 0 ? (
              <div style={{ marginLeft: `${REPLY_INDENT}px` }} className="mt-2">
                <button
                  type="button"
                  data-reply-expander={thread.comment.id}
                  aria-expanded={openReplies.has(thread.comment.id)}
                  // §1.1: `call-to-action` is "every 'N replies' expander".
                  className="text-body font-[var(--yt-weight-medium)] text-cta"
                  onClick={() =>
                    setOpenReplies((open) => {
                      const next = new Set(open);
                      if (next.has(thread.comment.id)) next.delete(thread.comment.id);
                      else next.add(thread.comment.id);
                      return next;
                    })
                  }
                >
                  {/* §8.3: `16 replies`. The singular is measured too —
                      `commentSamples` carries `1 reply`. */}
                  {thread.comment.replyCount === 1
                    ? "1 reply"
                    : `${thread.comment.replyCount} replies`}
                </button>

                {openReplies.has(thread.comment.id) ? (
                  <ol className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
                    {thread.replies.map((reply) => (
                      <li key={reply.id} data-comment-reply={reply.id}>
                        <CommentRow
                          comment={reply}
                          now={now}
                          reply
                          onReact={react}
                          onReply={() => setReplyingTo(thread.comment.id)}
                        />
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** §3.5: the reply block starts at x=64 against a top level at x=16. */
const REPLY_INDENT = 48;

function CommentRow({
  comment,
  now,
  reply = false,
  onReact,
  onReply,
}: {
  readonly comment: Comment;
  readonly now?: Date | undefined;
  readonly reply?: boolean;
  readonly onReact: (commentId: string, value: 1 | -1) => void;
  readonly onReply: () => void;
}) {
  return (
    <article data-comment={comment.id} className="flex gap-4">
      {/* §3.5: 36px at top level, 24px on a reply, and 16px of gap in both. */}
      <Avatar
        size={reply ? "condensed" : "cozy"}
        src={null}
        name={comment.authorName}
        decorative
      />

      <div className="min-w-0 flex-1">
        {comment.isPinned ? (
          <div data-comment-pinned="" className="text-small text-secondary">
            {/* Measured verbatim in `commentSamples`: the badge names the
                pinner, who is the channel rather than the comment's author. */}
            Pinned by {comment.authorName}
          </div>
        ) : null}

        <div className="flex items-center gap-1">
          <span
            data-comment-author=""
            // §2.2: 12/18/500.
            className="text-small font-[var(--yt-weight-medium)] text-primary"
          >
            {comment.authorName}
          </span>
          <span data-comment-time="" className="text-small text-secondary">
            {formatRelativeTime(comment.createdAt, now)}
            {comment.editedAt === null ? null : " (edited)"}
          </span>
        </div>

        <p
          data-comment-body=""
          // §2.2: 14/20/400.
          className="m-0 mt-1 text-body whitespace-pre-wrap text-primary"
        >
          {comment.body}
        </p>

        <div
          data-comment-toolbar=""
          // §3.5: the toolbar is 32px tall.
          className="mt-1 flex h-8 items-center gap-2"
        >
          <Button
            size="s"
            variant="text"
            iconOnly
            data-action="like"
            aria-label={`Like this comment by ${comment.authorName}`}
            aria-pressed={comment.viewerReaction === 1}
            onClick={() => onReact(comment.id, 1)}
          >
            <ThumbUpIcon size={18} />
          </Button>
          {comment.likeCount > 0 ? (
            <span data-comment-likes="" className="text-small text-secondary">
              {formatCompactCount(comment.likeCount)}
            </span>
          ) : null}
          <Button
            size="s"
            variant="text"
            iconOnly
            data-action="dislike"
            aria-label={`Dislike this comment by ${comment.authorName}`}
            aria-pressed={comment.viewerReaction === -1}
            onClick={() => onReact(comment.id, -1)}
          >
            <ThumbDownIcon size={18} />
          </Button>
          <Button size="s" variant="text" data-action="reply" onClick={onReply}>
            {/* §8.3: the toolbar's word is `Reply`. */}
            Reply
          </Button>

          {comment.hearted ? (
            <span
              data-comment-hearted=""
              // The creator's heart. Rendered as the brand red because it is
              // the one place besides the scrubber and the play badge that
              // colour appears (§0, §1.3).
              title="Loved by the creator"
              aria-label="Loved by the creator"
              role="img"
              className="text-small"
              style={{ color: "var(--yt-static-brand-red)" }}
            >
              ♥
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Composer({
  viewer,
  placeholder,
  submitLabel,
  compact = false,
  onSubmit,
  onCancel,
}: {
  readonly viewer: CommentsViewer | null;
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly compact?: boolean;
  readonly onSubmit: (body: string) => Promise<void> | void;
  readonly onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  if (viewer === null) {
    return (
      <p data-composer-signed-out="" className="text-body text-secondary">
        Sign in to comment.
      </p>
    );
  }

  return (
    <form
      data-comment-composer=""
      className="flex gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = body.trim();
        if (trimmed.length === 0 || busy) return;
        setBusy(true);
        void Promise.resolve(onSubmit(trimmed))
          .then(() => setBody(""))
          .finally(() => setBusy(false));
      }}
    >
      <Avatar
        size={compact ? "condensed" : "cozy"}
        src={viewer.avatarUrl ?? null}
        name={viewer.name}
        decorative
      />
      <div className="flex flex-1 flex-col gap-2">
        <textarea
          data-composer-input=""
          aria-label={placeholder}
          placeholder={placeholder}
          value={body}
          rows={1}
          // The field the shortcut layer must not steal from
          // (research/07 §6.1) — `isTypingContext` matches it by tag name.
          className="w-full resize-none border-0 border-b border-outline bg-transparent pb-1 text-body text-primary outline-none"
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="flex items-center justify-end gap-2">
          {onCancel === undefined ? null : (
            <Button variant="text" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="filled"
            data-composer-submit=""
            disabled={body.trim().length === 0 || busy}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------- helpers -- */

function applyReaction(
  thread: CommentThread,
  commentId: string,
  value: 1 | -1,
): CommentThread {
  const toggle = (comment: Comment): Comment => {
    if (comment.id !== commentId) return comment;
    // The repository's own rule: pressing the value you already hold clears it.
    const next = comment.viewerReaction === value ? null : value;
    const likeDelta =
      (next === 1 ? 1 : 0) - (comment.viewerReaction === 1 ? 1 : 0);
    return {
      ...comment,
      viewerReaction: next,
      likeCount: Math.max(comment.likeCount + likeDelta, 0),
    };
  };
  return {
    comment: toggle(thread.comment),
    replies: thread.replies.map(toggle),
  };
}

function settleReaction(
  thread: CommentThread,
  commentId: string,
  settled: { readonly likeCount: number; readonly viewerReaction: 1 | -1 | null },
): CommentThread {
  const settle = (comment: Comment): Comment =>
    comment.id === commentId
      ? { ...comment, likeCount: settled.likeCount, viewerReaction: settled.viewerReaction }
      : comment;
  return { comment: settle(thread.comment), replies: thread.replies.map(settle) };
}

/**
 * JSON has no `Date`, so the two timestamps come back as strings.
 *
 * Reviving them here rather than at the call site is what keeps a freshly
 * posted comment from rendering `Invalid Date` beside every other row's
 * `2 minutes ago`.
 */
function reviveComment(value: unknown): Comment {
  const raw = value as Comment & { createdAt: string; editedAt: string | null };
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    editedAt: raw.editedAt === null ? null : new Date(raw.editedAt),
  };
}
