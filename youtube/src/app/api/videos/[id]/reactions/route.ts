import { z } from "zod";

import { database } from "@/adapters/db";
import {
  ReactionTargetNotFoundError,
  reactToComment,
  reactToVideo,
} from "@/adapters/repositories/reactions";
import { currentViewerId } from "@/lib/auth/guard";

/**
 * Like or dislike the video, or one of its comments.
 *
 * ## Why the comment case lives on the *video's* route
 *
 * Because a comment reaction only ever happens from a watch page, and because
 * the alternative is a second route file this slice does not own. The
 * discriminator is in the body rather than in the path, which keeps one
 * endpoint, one auth check and one error mapping for what is one interaction
 * with two targets. `reactToComment` takes only the comment id, so the video in
 * the path is context rather than a parameter — and that is worth saying out
 * loud, because it means this route does **not** verify that the comment
 * belongs to the video in the URL. It does not need to: the reaction is keyed
 * on the comment alone, and a caller who guesses another video's comment id
 * gets exactly the reaction they would have got from that video's page.
 *
 * ## Toggling is not this route's rule either
 *
 * `applyTransition` inside the repository owns it: pressing the value you
 * already hold clears it, and switching from like to dislike is a single
 * `update` rather than a delete and an insert — the two-statement version has a
 * window in which the viewer holds no opinion, and the counter update that
 * follows reads a state that never existed. The client mirrors that rule
 * optimistically and then takes the returned counts as the truth, which is why
 * the response carries both the count and the resulting `viewerReaction`.
 */

const ReactionBody = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("video"),
    value: z.union([z.literal(1), z.literal(-1)]),
  }),
  z.object({
    target: z.literal("comment"),
    commentId: z.string().min(1),
    value: z.union([z.literal(1), z.literal(-1)]),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: videoId } = await context.params;

  const viewerId = await currentViewerId(request);
  if (viewerId === null) {
    return Response.json({ error: "Sign in to like videos." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = ReactionBody.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "A reaction is 1 or -1 on a video or a comment.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = await database();
  try {
    if (parsed.data.target === "video") {
      return Response.json(await reactToVideo(db, viewerId, videoId, parsed.data.value));
    }
    return Response.json(
      await reactToComment(db, viewerId, parsed.data.commentId, parsed.data.value),
    );
  } catch (cause) {
    if (cause instanceof ReactionTargetNotFoundError) {
      // The repository throws this *inside* the transaction precisely so the
      // reaction row rolls back — `reactions` is polymorphic and so has no
      // foreign key to catch an orphan. Turning it into a 404 here is the last
      // half of that: the caller learns the id was wrong rather than seeing a
      // 500 for a request that was merely mistaken.
      return Response.json({ error: "No such video or comment." }, { status: 404 });
    }
    throw cause;
  }
}
