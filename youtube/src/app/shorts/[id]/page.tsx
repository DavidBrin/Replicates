import { notFound } from "next/navigation";

import { database } from "@/adapters/db";
import type { SqlExecutor } from "@/adapters/db";
import { listComments, listReplies } from "@/adapters/repositories/comments";
import { authorizeVideoAccess } from "@/adapters/repositories/media-access";
import { getViewerReactions } from "@/adapters/repositories/reactions";
import { shortsFeed } from "@/adapters/repositories/recommendations";
import { filterSubscribed } from "@/adapters/repositories/subscriptions";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { getVideoWithRenditions } from "@/adapters/repositories/videos";
import { ShortsFeed, type ShortItem } from "@/components/shorts";
import type { CommentThread } from "@/components/watch/comments";
import { thumbnailSrc } from "@/components/video";
import type { Comment, Rendition, Video } from "@/domain/types";
import type { ProgressiveSource } from "@/media/player";
import { currentViewer } from "@/lib/viewer";

/**
 * `/shorts/<id>` — the feed, opened on one short.
 *
 * ## Why the requested id leads the feed rather than being the whole page
 *
 * Because a Short is both a destination and a position. A link someone shares
 * has to open *that* video, and swiping down from it has to keep working — so
 * this reads the same personalised feed `/shorts` resolves, drops the requested
 * id out of it wherever it happened to land, and puts it at the head. A deep
 * link to a short the recommender did not pick still works and still has a feed
 * under it.
 *
 * ## The N+1, with eyes open
 *
 * `shortsFeed` returns `VideoCard`s, and a card carries what a *thumbnail*
 * needs: no `pipeline`, no `master_playlist_key`, no `progressive_key`, no
 * codecs. Those four are exactly what decides which of the two playback paths
 * each item takes, so every listed id is then fetched in full. That is two
 * indexed reads per item on a feed capped at {@link FEED_LIMIT}.
 *
 * It is done here rather than fixed because the query that would fix it — a
 * playback projection, or `listPlaybackByIds(ids)` — belongs in
 * `adapters/repositories/videos.ts`, which this slice does not own, and raw SQL
 * in a page would put the schema in two places. `src/app/studio/page.tsx` made
 * the same call for the same reason, and says so in the same words.
 *
 * The two *viewer-state* reads are batched, because batched forms already exist:
 * `getViewerReactions` and `filterSubscribed` each take the whole page of ids.
 *
 * ## Comments
 *
 * Not fetched here. Twenty shorts' threads is a payload almost nobody opens,
 * and `src/app/api/videos/[id]/comments/route.ts` deliberately has no `GET`.
 * The panel is handed a Server Function instead, so the thread is read when it
 * is first opened and no route this slice does not own has to grow one.
 */

/**
 * How many shorts one page load carries.
 *
 * `SHORTS_FEED_SIZE` is 20 and `shortsFeed` honours it; this bounds what the
 * per-item fetch above costs, which is the number that matters. There is no
 * continuation — the feed ends after these — and that is a stated gap rather
 * than an oversight: an infinite feed needs a cursor the recommender does not
 * expose.
 */
const FEED_LIMIT = 20;

/** What the comments panel loads on first open. Matches the watch page. */
const COMMENT_PAGE = 20;
const REPLY_PAGE = 20;

export default async function ShortPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await database();

  // One resolution for both questions: `currentViewer` reads the session and
  // the viewing key together, so the feed and the reaction lookup below cannot
  // disagree about who is asking.
  const viewer = await currentViewer();
  const viewerId = viewer.userId;

  const requested = await getVideoWithRenditions(db, id);
  // Not `notFound()` for "exists but is not a short": a 16:9 video reached
  // through a Shorts URL is a wrong *route*, and rendering it in a 9:16 box
  // would letterbox it to a third of the frame. The watch page is where it
  // belongs, and 404 is the honest answer from here.
  if (requested === null || !isPlayableShort(requested.video)) notFound();

  const feed = await shortsFeed(viewer, db);

  const orderedIds = [
    id,
    ...feed.map((card) => card.id).filter((other) => other !== id),
  ].slice(0, FEED_LIMIT);

  // Two per id, in parallel. The requested one is already in hand.
  const loaded = await Promise.all(
    orderedIds.map(async (videoId) =>
      videoId === id ? requested : getVideoWithRenditions(db, videoId),
    ),
  );

  const playable: PlayableShort[] = loaded.filter(
    (row): row is PlayableShort => row !== null && isPlayableShort(row.video),
  );

  const videoIds = playable.map((row) => row.video.id);
  const channelIds = [...new Set(playable.map((row) => row.video.channelId))];

  const [reactions, subscribed, viewerChannel] = await Promise.all([
    getViewerReactions(db, viewerId, "video", videoIds),
    filterSubscribed(db, viewerId, channelIds),
    viewerId === null
      ? null
      : createChannelsRepository(db)
          .listForOwner(viewerId)
          .then((channels) => channels[0] ?? null),
  ]);

  const items: ShortItem[] = playable.map(({ video, renditions }) => ({
    id: video.id,
    title: video.title,
    channel: {
      id: video.channelId,
      name: video.channelName,
      handle: video.channelHandle,
      avatarUrl:
        video.channelAvatarKey === null ? null : thumbnailSrc(video.channelAvatarKey),
    },
    pipeline: video.pipeline,
    masterPlaylistUrl:
      video.masterPlaylistKey === null ? null : thumbnailSrc(video.masterPlaylistKey),
    progressiveSources: progressiveSourcesFor(video.progressiveKey),
    // What `createPlayer` needs *before* the master playlist is fetched, so a
    // browser with a MediaSource but no decoder for these codecs routes to the
    // progressive path instead of attaching and failing.
    renditionCodecs: renditions.map((rendition) => rendition.codec),
    posterUrl: video.thumbnailKey === null ? null : thumbnailSrc(video.thumbnailKey),
    durationSeconds: video.durationSeconds,
    viewCount: video.viewCount,
    likeCount: video.likeCount,
    dislikeCount: video.dislikeCount,
    commentCount: video.commentCount,
    commentsEnabled: video.commentsEnabled,
    viewerReaction: reactions.get(video.id) ?? null,
    subscribed: subscribed.has(video.channelId),
  }));

  /**
   * The comments panel's read, as a Server Function.
   *
   * It re-resolves the session rather than closing over `viewerId`: a closure's
   * captured values are serialised into the action's payload, and an identity
   * that travels to the client and back is one an edited request could claim.
   * Re-reading the cookie makes the answer depend on who is actually calling.
   */
  async function loadCommentThreads(videoId: string): Promise<CommentThread[]> {
    "use server";
    const handle = await database();
    const caller = await currentViewer();

    /**
     * A Server Function is a public endpoint.
     *
     * The comment above is right that re-resolving the session is what stops a
     * caller claiming an identity — but it only fixed the *who*. The *what*
     * was still whatever `videoId` the request carried, and this page renders
     * a fixed list of shorts, so the argument reads like it could only ever be
     * one of them. It cannot: the action is addressable directly, with any id,
     * and it returned the comment thread of a private video to anyone who
     * guessed one.
     *
     * Empty rather than an error, because this is a read behind a panel that
     * opens on tap. A thrown Server Function error surfaces as a broken
     * overlay; an empty thread is what a video with no comments looks like,
     * and is the same answer an id that does not exist gives.
     */
    if ((await authorizeVideoAccess(videoId, caller.userId)) === null) {
      return [];
    }

    return readThreads(handle, videoId, caller.userId);
  }

  return (
    <ShortsFeed
      items={items}
      initialIndex={0}
      loadComments={loadCommentThreads}
      commentsViewer={
        viewerId === null
          ? null
          : {
              id: viewerId,
              // A comment is written by a *channel*, not by a user account —
              // the watch page resolves the composer's identity the same way,
              // because the composer has to show what the posted comment will
              // carry.
              name: viewerChannel?.name ?? "You",
              avatarUrl:
                viewerChannel?.avatarKey == null
                  ? null
                  : thumbnailSrc(viewerChannel.avatarKey),
            }
      }
      now={new Date()}
    />
  );
}

/* -------------------------------------------------------------- helpers -- */

/** Exactly what `getVideoWithRenditions` returns, once it is known non-null. */
interface PlayableShort {
  readonly video: Video;
  readonly renditions: Rendition[];
}

/**
 * Is this row a short this viewer may watch here?
 *
 * Three conditions, and each one has a different failure if it is skipped:
 * `is_short` keeps a 16:9 video out of a 9:16 box, `upload_status` keeps a
 * still-processing upload from rendering as a black frame with no playlist
 * behind it, and the visibility check keeps a private video's title and comment
 * thread from being readable by anyone holding the id. The media route enforces
 * the last one for the *bytes*; a page has to enforce it for the metadata.
 *
 * Unlisted is watchable: that is what unlisted means, and a Shorts URL is the
 * link it is shared through. It simply never reaches this page *from the feed*,
 * because `shortsFeed` returns public rows only.
 *
 * Private is refused outright, including for its owner, and takes no viewer
 * argument for that reason. `Video` carries no owner id — the ownership chain
 * is `videos.channel_id → channels.owner_id`, a second read per item — and the
 * surface a creator reviews their own unpublished work on is Studio, not a
 * public feed. Refusing costs no query and leaks nothing.
 */
function isPlayableShort(video: Video): boolean {
  if (!video.isShort || video.uploadStatus !== "ready") return false;
  return video.visibility !== "private";
}

/**
 * The progressive rendition, as the player's source or its fallback.
 *
 * Supplied even for a laddered short, which is not belt-and-braces:
 * `CreatePlayerOptions.progressiveSources` documents it as what research §9's
 * detection order falls back *to* when a browser has neither a usable
 * `MediaSource` nor native HLS, and a laddered upload has one of these too.
 * Omitting it turns that browser's fallback into a thrown error.
 */
function progressiveSourcesFor(key: string | null): readonly ProgressiveSource[] {
  if (key === null) return [];
  return [{ id: key, url: thumbnailSrc(key), name: "Original" }];
}

/** One video's thread, shaped the way `@/components/watch/comments` reads it. */
async function readThreads(
  sql: SqlExecutor,
  videoId: string,
  viewerId: string | null,
): Promise<CommentThread[]> {
  const topLevel = await listComments(sql, videoId, {
    viewerId,
    limit: COMMENT_PAGE,
  });
  return Promise.all(
    topLevel.map(async (comment): Promise<CommentThread> => {
      if (comment.replyCount === 0) return { comment, replies: [] };
      const replies: Comment[] = await listReplies(sql, comment.id, {
        viewerId,
        limit: REPLY_PAGE,
      });
      return { comment, replies };
    }),
  );
}
