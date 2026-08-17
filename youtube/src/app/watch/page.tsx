import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { database } from "@/adapters/db";
import { getVideoWithRenditions } from "@/adapters/repositories/videos";
import { listComments, listReplies } from "@/adapters/repositories/comments";
import { getViewerReaction } from "@/adapters/repositories/reactions";
import { watchNextSidebar } from "@/adapters/repositories/recommendations";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { getSubscription } from "@/adapters/repositories/subscriptions";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";
import { thumbnailSrc } from "@/components/video";
import type { ProgressiveSource } from "@/media/player";
import type { Comment } from "@/domain/types";

import { WatchView } from "./watch-view";
import type { CommentThread } from "@/components/watch/comments";

/**
 * `/watch?v=<id>`.
 *
 * The reading half of the watch page. Everything interactive is in
 * `./watch-view.tsx`, for the reason stated there: theatre mode changes both
 * columns, so the state has to sit above them.
 *
 * ## Why the query string and not `/watch/[id]`
 *
 * Because that is the URL the product uses, and it is the URL every other
 * surface in this application already links to —
 * `src/components/video/thumbnail.tsx`'s `watchHref` builds
 * `/watch?v=<id>`. A prettier route would mean every card in the codebase
 * pointing somewhere this page is not.
 *
 * ## What is read, and what is deliberately not
 *
 * Read: the video and its ladder, the channel (for the subscriber count, which
 * `Video` does not carry), the top-level comments and their replies, the
 * related rail, and the viewer's own reaction and subscription.
 *
 * Not read, and not written: **the watch event**. `recordWatch` needs a
 * session key, and `src/adapters/repositories/watch-events.ts` is explicit that
 * "sessionisation is upstream of this file … the boundary is whatever the
 * caller's cookie says" — and nothing in this application issues that cookie
 * yet. Recording a watch against a key invented here would poison the
 * co-visitation graph with one session per page load, which is worse than not
 * recording it. The same gap is why the sidebar's `Viewer.sessionKey` falls
 * back the way it does below.
 */

export const metadata: Metadata = {
  title: "Watch",
};

/** How many top-level comments the first render carries. */
const COMMENT_PAGE = 20;

/**
 * How many replies are fetched per thread.
 *
 * Fetched with the page rather than on expanding, because the expander is a
 * disclosure of data the page already has — `research/08` §8.3 measures it as
 * `16 replies`, a count, not a "load replies" affordance. A thread with more
 * than this shows the full count and reveals the first page, which is the
 * honest version of the same control.
 */
const REPLY_PAGE = 20;

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.v;
  const videoId = Array.isArray(raw) ? raw[0] : raw;
  if (videoId === undefined || videoId.length === 0) notFound();

  const db = await database();

  const jar = await cookies();
  const session = await resolveSession(jar.get(SESSION_COOKIE)?.value ?? null);
  const viewerId = session?.userId ?? null;

  const found = await getVideoWithRenditions(db, videoId);
  if (found === null) notFound();
  const { video, renditions } = found;

  // A private video is nobody's but its owner's. The media route enforces this
  // for the bytes (`mayViewMedia`); the page has to enforce it for the metadata
  // too, or the title, description and comment thread of a private video are
  // readable by anyone with the id.
  const channels = createChannelsRepository(db);
  const channel = await channels.findById(video.channelId);
  if (video.visibility === "private" && channel?.ownerId !== viewerId) notFound();

  /**
   * The composer's identity.
   *
   * A comment on YouTube is written by a *channel*, not by a user account —
   * which is exactly what `commentSelect` encodes when it coalesces the channel
   * name over `users.display_name` and picks the oldest channel with a
   * `lateral`. The composer has to show the same identity the posted comment
   * will carry, so it resolves it the same way rather than through the user
   * row.
   */
  const viewerChannel =
    viewerId === null ? null : ((await channels.listForOwner(viewerId))[0] ?? null);

  const [topLevel, related, reaction, subscription] = await Promise.all([
    listComments(db, videoId, { viewerId, limit: COMMENT_PAGE }),
    watchNextSidebar(
      videoId,
      // `sessionKey` has no issuer yet — see the file comment. The session
      // token is a stable per-viewer value where there is one, and the literal
      // below is honest about being a single shared bucket for everyone else.
      // It only feeds the "already watched this sitting" exclusion, which is a
      // no-op on an empty graph.
      { userId: viewerId, sessionKey: jar.get(SESSION_COOKIE)?.value ?? "anonymous" },
      db,
    ),
    getViewerReaction(db, viewerId, "video", videoId),
    viewerId === null ? null : getSubscription(db, viewerId, video.channelId),
  ]);

  // One query per thread that has replies — bounded by `COMMENT_PAGE` and run
  // in parallel. `listReplies` takes a parent id, so there is no batched form
  // to reach for; twenty parallel index scans is the shape this repository
  // offers.
  const threads: CommentThread[] = await Promise.all(
    topLevel.map(async (comment): Promise<CommentThread> => {
      if (comment.replyCount === 0) return { comment, replies: [] };
      const replies: Comment[] = await listReplies(db, comment.id, {
        viewerId,
        limit: REPLY_PAGE,
      });
      return { comment, replies };
    }),
  );

  return (
    <WatchView
      video={video}
      subscriberCount={channel?.subscriberCount ?? 0}
      masterPlaylistUrl={
        video.masterPlaylistKey === null ? null : thumbnailSrc(video.masterPlaylistKey)
      }
      progressiveSources={progressiveSourcesFor(video.progressiveKey)}
      // `video_renditions.codec` is what `createPlayer` needs *before* the
      // master playlist is fetched, so that a browser with a MediaSource but no
      // VP9 decoder routes to the progressive path instead of attaching and
      // failing (see `CreatePlayerOptions.renditionCodecs`).
      renditionCodecs={renditions.map((rendition) => rendition.codec)}
      frameRate={renditions[0]?.frameRate ?? null}
      posterUrl={video.thumbnailKey === null ? null : thumbnailSrc(video.thumbnailKey)}
      // No caption asset is stored on `videos` yet — `src/domain/captions.ts`
      // is the parser and the ASR port is the producer, but nothing writes a
      // `.vtt` key to a column. An empty list is what makes the `c` shortcut
      // inert and the control-bar button read
      // `Subtitles/closed captions unavailable`, which is the measured state
      // for a video with no track.
      captionTracks={[]}
      threads={threads}
      related={related}
      viewer={
        viewerId === null
          ? null
          : {
              id: viewerId,
              name: viewerChannel?.name ?? "You",
              avatarUrl:
                viewerChannel?.avatarKey == null
                  ? null
                  : thumbnailSrc(viewerChannel.avatarKey),
            }
      }
      viewerReaction={reaction}
      subscribed={subscription !== null}
      now={new Date()}
    />
  );
}

/**
 * The progressive rendition, as the player's fallback source.
 *
 * Supplied even for a laddered video, which is not belt-and-braces:
 * `CreatePlayerOptions.progressiveSources` documents it as what research §9's
 * detection order falls back *to* when a browser has neither a usable
 * `MediaSource` nor native HLS, and a laddered upload has one of these too
 * (`videos.progressive_key`). Omitting it turns that browser's fallback into a
 * thrown error.
 *
 * `Original` is the measured-in-spirit name for a single-rendition upload —
 * `ProgressiveSource.name`'s own documentation names it — and it is what the
 * quality menu shows on a progressive video, where there is one rung and no
 * Auto.
 */
function progressiveSourcesFor(key: string | null): readonly ProgressiveSource[] {
  if (key === null) return [];
  return [{ id: key, url: thumbnailSrc(key), name: "Original" }];
}
