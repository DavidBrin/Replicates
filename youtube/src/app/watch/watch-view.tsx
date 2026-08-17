"use client";

import clsx from "clsx";
import { useCallback, useState } from "react";

import { Player, type PlayerCaptionTrack } from "@/components/player";
import { Comments, type CommentThread, type CommentsViewer } from "@/components/watch/comments";
import { Description } from "@/components/watch/description";
import { WatchSidebar } from "@/components/watch/sidebar";
import { useWatchReporter } from "@/components/watch/watch-reporter";
import { VideoInfo } from "@/components/watch/video-info";
import type { SaveTarget } from "@/components/playlist";
import type { ReactionState } from "@/adapters/repositories/reactions";
import type { ProgressiveSource } from "@/media/player";
import type { Video, VideoCard } from "@/domain/types";

/**
 * The watch page's interactive shell.
 *
 * `page.tsx` is a server component and does the reading; this is the client
 * half, and it exists for one reason: **theatre mode is a property of the page,
 * not of the player.** `research/08-youtube-ui-measured.md` §3.4 measures it as
 * a change to both columns — the player goes to 1920×911 full-bleed and
 * `#secondary` moves to y=991, *below* the video rather than beside it — and
 * `t` toggles it from inside the player. So the state has to live above both,
 * which means a client boundary at the layout rather than at each leaf.
 *
 * Every prop is serialisable, because they all cross the RSC boundary.
 *
 * ## Layout, measured at 1920×1080 with theatre off (§3.4)
 *
 * | Part | Value |
 * | --- | --- |
 * | `#primary` | 1360 wide, left edge x=16 |
 * | `#secondary` | 544 wide, right edge x=1920 |
 * | Gap between columns | **0** — the separation is `#secondary`'s own padding |
 * | Sidebar list | `--ytd-watch-flexy-sidebar-width: 528px` |
 * | Theatre | player 1920×911, `#secondary` moves to y=991 |
 *
 * The zero gap is the odd one and is reproduced: the columns touch, and the
 * visual channel between them comes from the right column's inner inset. A
 * `gap-6` here would push the sidebar 24px further right than the product's.
 */

export interface WatchViewProps {
  readonly video: Video;
  readonly subscriberCount: number;
  readonly masterPlaylistUrl: string | null;
  readonly progressiveSources: readonly ProgressiveSource[];
  readonly renditionCodecs: readonly string[];
  readonly frameRate: number | null;
  readonly posterUrl: string | null;
  readonly captionTracks: readonly PlayerCaptionTrack[];
  readonly threads: readonly CommentThread[];
  readonly related: readonly VideoCard[];
  readonly viewer: CommentsViewer | null;
  readonly viewerReaction: ReactionState;
  readonly subscribed: boolean;
  /** The Save sheet's rows. Empty for a signed-out viewer. */
  readonly saveTargets: readonly SaveTarget[];
  /** The server's clock, so every relative time hydrates identically. */
  readonly now: Date;
}

export function WatchView({
  video,
  subscriberCount,
  masterPlaylistUrl,
  progressiveSources,
  renditionCodecs,
  frameRate,
  posterUrl,
  captionTracks,
  threads,
  related,
  viewer,
  viewerReaction,
  subscribed,
  saveTargets,
  now,
}: WatchViewProps) {
  const [theatre, setTheatre] = useState(false);
  const [reaction, setReaction] = useState<ReactionState>(viewerReaction);
  const [likeCount, setLikeCount] = useState(video.likeCount);
  const [following, setFollowing] = useState(subscribed);

  /**
   * The watch report — the resume position, the view count and the
   * co-visitation graph, all of which had a write path and no caller.
   *
   * Given to the player as `onTimeUpdate` rather than owned by the player,
   * because it is a property of *this page*: Shorts have their own surface and
   * the studio preview should record nothing at all. See
   * `components/watch/watch-reporter.ts`.
   */
  const reportProgress = useWatchReporter({
    videoId: video.id,
    durationSeconds: video.durationSeconds,
  });

  /**
   * The subscribe write, which this file used to say it did not own.
   *
   * The comment here read: "the subscribe write lives on a channels endpoint
   * this slice does not own, so the button reflects the press and does not
   * persist it". The endpoint is `/api/subscriptions`, it has existed the
   * whole time, and it takes exactly this. The gap was that nothing called it
   * — the same shape as the sign-in route, and it stayed in the known-gaps
   * list for as long as the comment made it look considered.
   *
   * Optimistic, then reconciled: the pill flips immediately because a
   * subscribe that waits on a round trip feels broken, and flips back if the
   * write fails. A 401 is the one failure worth treating differently — it
   * means "sign in", not "that did not work", so it sends the viewer to the
   * form with a way back to this video.
   */
  const toggleSubscribe = useCallback(() => {
    const next = !following;
    setFollowing(next);

    void fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: next ? "subscribe" : "unsubscribe",
        channelId: video.channelId,
      }),
    })
      .then((response) => {
        if (response.ok) return;
        if (response.status === 401) {
          const here = `/watch?v=${encodeURIComponent(video.id)}`;
          /**
           * A document navigation rather than `router.push`, and the lint rule
           * that objects is worth answering rather than silencing.
           *
           * The state this page is holding is stale the moment the viewer is
           * about to sign in: the like it just drew, the subscribe pill it just
           * flipped, and the comment composer's identity all belong to a
           * signed-out viewer. `router.push` would keep every one of them in
           * the Router Cache, and the sign-in form's own `location.assign` back
           * to `next` is what would eventually discard them — so the full load
           * happens either way, and doing it here means the viewer never sees
           * a page mid-way between two identities.
           *
           * `next` is built from the video id rather than from
           * `location.pathname`, so it survives theatre mode and any query the
           * page happens to be carrying.
           */
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign(`/signin?next=${encodeURIComponent(here)}`);
          return;
        }
        setFollowing(!next);
      })
      .catch(() => setFollowing(!next));
  }, [following, video.channelId, video.id]);

  const react = useCallback(
    (value: 1 | -1) => {
      // Optimistic, mirroring `applyTransition`'s rule: pressing what you
      // already hold takes it back.
      const next = reaction === value ? null : value;
      setLikeCount(
        (count) =>
          Math.max(count + ((next === 1 ? 1 : 0) - (reaction === 1 ? 1 : 0)), 0),
      );
      setReaction(next);

      void fetch(`/api/videos/${video.id}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "video", value }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const settled = (await response.json()) as {
            likeCount: number;
            viewerReaction: ReactionState;
          };
          setLikeCount(settled.likeCount);
          setReaction(settled.viewerReaction);
        })
        .catch(() => {
          // Roll back to what the server last told us. A like that stays lit
          // after a failed write is a lie the next page load contradicts.
          setReaction(reaction);
          setLikeCount(video.likeCount);
        });
    },
    [reaction, video.id, video.likeCount],
  );

  const player = (
    <Player
      videoId={video.id}
      title={video.title}
      pipeline={video.pipeline}
      durationSeconds={video.durationSeconds}
      masterPlaylistUrl={masterPlaylistUrl ?? undefined}
      progressiveSources={progressiveSources}
      renditionCodecs={renditionCodecs}
      posterUrl={posterUrl}
      captionTracks={captionTracks}
      frameRate={frameRate ?? undefined}
      theatre={theatre}
      onToggleTheatre={() => setTheatre((on) => !on)}
      onTimeUpdate={reportProgress}
    />
  );

  return (
    <div data-watch="" data-theatre={theatre ? "" : undefined}>
      {/* §3.4: in theatre the player is full-bleed at the top of the page and
          everything else moves under it. */}
      {theatre ? (
        <div data-watch-theatre-stage="" className="w-full bg-black">
          {/* §3.4, measured at 1920×1080: the theatre player is 1920×911 with
              its top edge at y=56 — the masthead — leaving 113px of page below
              it. The height is expressed against the viewport so the same
              proportions hold on a shorter screen. */}
          <div
            className="mx-auto"
            style={{ maxHeight: "calc(100vh - var(--yt-masthead-height) - 113px)" }}
          >
            {player}
          </div>
        </div>
      ) : null}

      <div
        data-watch-columns=""
        // The columns touch (§3.4's measured gap of 0); the channel between
        // them is the sidebar's own inset.
        className="mx-auto flex w-full max-w-[1904px] items-start px-4"
      >
        <div data-watch-primary="" className="min-w-0 flex-1">
          {theatre ? null : player}

          <div
            className="flex flex-col gap-3"
            // §3.4's `--ytd-watch-flexy-space-below-player: 48px` is **not**
            // this gap: it is a term in `--ytd-watch-flexy-max-player-width`'s
            // `calc((100vh − 56px − 12px − 48px) × 16/9)`, which is a height
            // budget rather than a margin. The visible gap between the player
            // and the title was not separately measured; 12px is chosen to
            // match `screenshots/09-watch-1920.png` and is **assumed**.
            style={{ marginTop: theatre ? "24px" : "12px" }}
          >
            <VideoInfo
              videoId={video.id}
              title={video.title}
              channelName={video.channelName}
              channelHandle={video.channelHandle}
              channelAvatarUrl={null}
              subscriberCount={subscriberCount}
              likeCount={likeCount}
              viewerReaction={reaction}
              subscribed={following}
              onReact={react}
              onToggleSubscribe={toggleSubscribe}
              saveTargets={saveTargets}
              signedIn={viewer !== null}
            />

            <Description
              description={video.description}
              viewCount={video.viewCount}
              publishedAt={video.publishedAt}
              now={now}
            />

            <div style={{ marginTop: "24px" }}>
              <Comments
                videoId={video.id}
                commentCount={video.commentCount}
                commentsEnabled={video.commentsEnabled}
                threads={threads}
                viewer={viewer}
                now={now}
              />
            </div>
          </div>
        </div>

        <div
          data-watch-secondary=""
          className={clsx(
            // §3.4: `#secondary` is 544 wide and the list inside is 528 — the
            // 16px difference is the inset that reads as the gap.
            "shrink-0 pl-4",
            theatre && "hidden",
          )}
        >
          <WatchSidebar videos={related} now={now} />
        </div>
      </div>

      {theatre ? (
        <div data-watch-secondary-theatre="" className="mx-auto w-full max-w-[1904px] px-4 pt-6">
          <WatchSidebar videos={related} now={now} theatre />
        </div>
      ) : null}
    </div>
  );
}
