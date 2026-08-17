import { z } from "zod";

import { database } from "@/adapters/db";
import {
  CommentsDisabledError,
  CommentNotFoundError,
  VideoNotFoundError,
  addComment,
} from "@/adapters/repositories/comments";
import { authorizeVideoAccess } from "@/adapters/repositories/media-access";
import { currentViewerId } from "@/lib/auth/guard";

/**
 * Post a comment, or a reply to one.
 *
 * The watch page's comment list is server-rendered and then owned by the
 * client, so this is the one write it needs. There is deliberately **no `GET`**:
 * the page already holds every thread it will show, and sorting between "Top
 * comments" and "Newest first" happens in `src/components/watch/comments.tsx`
 * against data that is already in memory. A round trip to reorder twenty rows
 * the client is holding is latency spent on nothing, and an endpoint that
 * exists only to be called by nobody is an endpoint that rots.
 *
 * ## What this route does not decide
 *
 * Almost everything. `addComment` owns the rules and owns them *in one
 * transaction*: that comments are enabled on the video, that a reply to a reply
 * is re-parented onto the top-level comment with an `@mention` in the body, and
 * that `reply_count` or `comment_count` moves with the insert. Its own comment
 * explains why that last part cannot be a second statement — "a reply that
 * commits while its parent's `reply_count` does not is a thread whose '3
 * replies' link opens four, and there is no later pass that would find it".
 *
 * So this handler is three things: identity, shape, and the mapping from the
 * repository's errors onto status codes.
 *
 * ## Why the failure modes get different codes
 *
 * A missing video is `404` and a video with comments turned off is `403`. Those
 * are genuinely different answers — the first says "you have the wrong id", the
 * second says "the id is right and the owner said no" — and collapsing them
 * would make a client that wants to hide its composer unable to tell which.
 * Neither leaks anything: both facts are already visible on the page.
 */

const NewCommentBody = z.object({
  // A comment is a `text` column with no length cap in the schema. The ceiling
  // here is YouTube's own published limit and exists so that a runaway paste
  // fails at the edge rather than after a transaction has been opened.
  body: z.string().trim().min(1).max(10_000),
  /** Top-level, or the comment being answered. Both are accepted; see above. */
  parentId: z.string().min(1).nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: videoId } = await context.params;

  const viewerId = await currentViewerId(request);
  if (viewerId === null) {
    return Response.json({ error: "Sign in to comment." }, { status: 401 });
  }

  /**
   * Authenticated is not authorised, and this route used to stop at the first.
   *
   * `addComment` enforces every rule about the *comment* — that the thread
   * exists, that comments are enabled, that a reply to a reply gets
   * re-parented — and none about whether this caller may address this video at
   * all. It never reads `visibility`. So any signed-in account could post to a
   * private video by guessing its id, and, because a 404 and a 201 are
   * distinguishable, use the endpoint to discover which ids exist.
   *
   * The check has to be *here* rather than inside `addComment`, because the
   * repository takes no viewer identity and giving it one would put an
   * authorisation decision inside a function four other callers use for
   * different reasons.
   */
  if ((await authorizeVideoAccess(videoId, viewerId)) === null) {
    return Response.json({ error: "No such video." }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = NewCommentBody.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "A comment needs a non-empty body.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const created = await addComment(await database(), {
      videoId,
      authorId: viewerId,
      body: parsed.data.body,
      parentId: parsed.data.parentId ?? null,
    });
    // `Date`s serialise to ISO strings; `reviveComment` in the client turns
    // them back. Stated because a comment whose `createdAt` arrives as a string
    // renders "Invalid Date" beside every other row's "2 minutes ago".
    return Response.json(created, { status: 201 });
  } catch (cause) {
    if (cause instanceof VideoNotFoundError) {
      return Response.json({ error: "No such video." }, { status: 404 });
    }
    if (cause instanceof CommentNotFoundError) {
      return Response.json({ error: "No such comment to reply to." }, { status: 404 });
    }
    if (cause instanceof CommentsDisabledError) {
      return Response.json(
        { error: "Comments are turned off on this video." },
        { status: 403 },
      );
    }
    throw cause;
  }
}
