"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CloseIcon, PlayIcon, VolumeIcon, VolumeMutedIcon } from "@/components/icons";
import { Avatar, Button, buttonClassName } from "@/components/primitives";
import { Comments, type CommentThread, type CommentsViewer } from "@/components/watch/comments";
import {
  createPlayer,
  type CreatePlayerOptions,
  type PlayerEngine,
  type ProgressiveSource,
} from "@/media/player";
import type { Pipeline } from "@/domain/types";
import type { ReactionState } from "@/adapters/repositories/reactions";

import { ActionRail } from "./action-rail";

/**
 * One reel: a 9:16 `<video>`, the engine feeding it, the metapanel over it and
 * the action rail beside it.
 *
 * ## What this component is responsible for, and what it is not
 *
 * `src/media/player/` owns what bytes reach the element and says so — *"the
 * engine never calls `play()`/`pause()`/seeks"*. So **playback is this file's**:
 * the autoplay attempt, the mute state, the rejected-promise branch. What is
 * different here from the landscape player is that a Shorts feed holds several
 * of these at once, so this component also owns **when an engine exists at
 * all** — see {@link ShortsPlayerProps.hot}.
 *
 * ## The two lifecycle flags, and why they are two
 *
 * `hot` is "should this item have an engine attached and its first segments
 * appended". `active` is "should it be playing and showing its chrome".
 * `research/03-mse-player-abr.md` §10 is the reason they are separate: buffer
 * preparation is **never** gated by autoplay policy — constructing a
 * `MediaSource`, adding `SourceBuffer`s and appending are all allowed with no
 * gesture — while only the `play()` call is gated. Conflating the two is the
 * mistake §10 names outright, and it produces a feed that either shows a
 * spinner on every swipe (prepare only when active) or plays several videos at
 * once (play whenever prepared).
 *
 * So exactly one item in a feed is `active`, and a small window around it is
 * `hot`. The window is `shorts-feed.tsx`'s to compute.
 *
 * ## Teardown
 *
 * The engine's own `destroy()` already implements §10's teardown list — abort
 * in-flight appends and fetches, `removeAttribute('src')`, `srcObject = null`,
 * revoke the object URL, drop the `MediaSource`, and deliberately *not*
 * `endOfStream()`. What this component owes is to **call it the moment the item
 * leaves the hot window**, which is why the engine's lifetime is bound to `hot`
 * rather than to the component being mounted. The element stays in the DOM so
 * the pager's snap points do not move; the `MediaSource` does not.
 *
 * ## Autoplay
 *
 * `muted`, `playsinline`, `loop` and `autoplay` are authored as attributes, per
 * §10 — Safari's heuristics are most reliable when the element is
 * autoplaying-muted from the moment it is created, and without `playsinline`
 * iOS forces fullscreen, which breaks the whole vertical layout rather than
 * just the sound. `autoplay` is on the **active** element only, or every
 * preloaded item would start playing the instant its buffer filled.
 *
 * The `play()` promise is awaited and its rejection is a state, not a
 * swallowed error. There are two branches and they are different facts:
 *
 *  - **Rejected while unmuted** — the viewer's unmute preference has been
 *    carried to a freshly created element, which does not inherit the gesture
 *    that unlocked the previous one. §10: re-apply muted and retry, because
 *    muted autoplay is the one path guaranteed across engines. The mute control
 *    flips back, so the UI states what actually happened.
 *  - **Rejected while muted** — nothing else to try. The item enters
 *    `blocked` and renders a tap-to-play affordance. Leaving the chrome looking
 *    live when it is paused is worse than the pause.
 */

/* ---------------------------------------------------------- read model --- */

/**
 * The channel, as a reel shows it.
 *
 * No subscriber count, and that is a deliberate omission rather than a gap:
 * R9 §11 measures the metapanel's channel bar as avatar + `@handle` +
 * Subscribe, with no count anywhere on the surface. Carrying one would mean a
 * `channels` read per item on a feed of twenty for a number nothing renders.
 */
export interface ShortsChannelView {
  readonly id: string;
  readonly name: string;
  /** Without the leading `@`, as `Channel.handle` stores it. */
  readonly handle: string;
  readonly avatarUrl: string | null;
}

/**
 * The four fields that decide **what** is played, split out from the rest.
 *
 * They are a type of their own because they are exactly the fields the engine's
 * lifetime keys on. Everything else about a short — its like count, the
 * viewer's reaction, whether they are subscribed — changes while the same bytes
 * go on playing, and an engine that was rebuilt because somebody pressed Like
 * would be a rebuffer per tap.
 */
export interface ShortMediaSource {
  /** `videos.pipeline`. The field the whole playback path branches on. */
  readonly pipeline: Pipeline;
  readonly masterPlaylistUrl: string | null;
  readonly progressiveSources: readonly ProgressiveSource[];
  readonly renditionCodecs: readonly string[];
}

/**
 * One short, as the feed renders it.
 *
 * Every field is serialisable: this crosses the RSC boundary from
 * `src/app/shorts/[id]/page.tsx`. It is deliberately *not* `Video` — a short
 * needs its channel's avatar and the two media URLs, and does not need the
 * description, the licence triple or the upload status.
 */
export interface ShortItem extends ShortMediaSource {
  readonly id: string;
  readonly title: string;
  readonly channel: ShortsChannelView;
  readonly posterUrl: string | null;
  readonly durationSeconds: number;
  readonly viewCount: number;
  readonly likeCount: number;
  readonly dislikeCount: number;
  readonly commentCount: number;
  readonly commentsEnabled: boolean;
  readonly viewerReaction: ReactionState;
  readonly subscribed: boolean;
}

/**
 * A short's `CreatePlayerOptions`, minus the element.
 *
 * Pure and exported so the routing decision can be asserted without rendering
 * anything. The progressive branch is the one worth stating: a progressive
 * upload has one rendition and no ladder, so `masterPlaylistUrl` is absent and
 * `renditionCodecs` is empty — and `createPlayer` reads `pipeline` *first*, so
 * it never probes for a `MediaSource` it would have no playlist to feed.
 *
 * A laddered short still carries its progressive source, for the reason
 * `CreatePlayerOptions.progressiveSources` gives: it is what research §9's
 * detection order falls back *to* on a browser with neither a usable
 * `MediaSource` nor native HLS. Omitting it turns that browser's fallback into
 * a thrown error.
 */
export function playerOptionsFor(
  source: ShortMediaSource,
): Omit<CreatePlayerOptions, "media"> {
  if (source.pipeline === "progressive") {
    return {
      pipeline: "progressive",
      progressiveSources: source.progressiveSources,
    };
  }
  return {
    pipeline: "laddered",
    masterPlaylistUrl: source.masterPlaylistUrl ?? undefined,
    progressiveSources: source.progressiveSources,
    renditionCodecs: source.renditionCodecs,
  };
}

/* ------------------------------------------------------------- autoplay -- */

/**
 * What the last `play()` attempt actually did.
 *
 * `muted-fallback` is a distinct value from `playing` on purpose: both are
 * playing, but only one of them is playing *because the viewer's unmute
 * preference was refused*, and the mute button has to say so rather than
 * silently showing a muted icon the viewer did not choose.
 */
export type ShortsAutoplayState = "idle" | "playing" | "muted-fallback" | "blocked";

/* ---------------------------------------------------------------- props -- */

export interface ShortsPlayerProps {
  readonly short: ShortItem;
  /**
   * Hold a live engine.
   *
   * Must be stable per item: the engine is created when this becomes true and
   * destroyed when it becomes false. See the header.
   */
  readonly hot: boolean;
  /** Play, and render the rail, the metapanel and the comments panel. */
  readonly active: boolean;
  readonly muted: boolean;
  /**
   * Report a mute change the *player* made — currently only the policy
   * fallback. Must be referentially stable; it is a dependency of the effect
   * that drives playback.
   */
  readonly onMutedChange: (muted: boolean) => void;
  readonly commentsOpen: boolean;
  readonly onToggleComments: () => void;
  readonly onReact: (value: 1 | -1) => void;
  readonly onToggleSubscribe: () => void;
  readonly onShare: () => void;
  readonly onRemix: () => void;
  /** Fetches the thread on first open. Absent → the panel says so. */
  readonly loadComments?: ((videoId: string) => Promise<readonly CommentThread[]>) | undefined;
  readonly commentsViewer?: CommentsViewer | null;
  readonly now?: Date | undefined;
  readonly menuItems?: ReactNode;
  /**
   * Test seam, for the same reason the landscape player has one: `MediaSource`
   * does not exist in jsdom, so `createPlayer` on a laddered video resolves to
   * the progressive path and throws when no progressive source was supplied.
   * Must be referentially stable.
   */
  readonly createEngine?: ((options: CreatePlayerOptions) => PlayerEngine) | undefined;
  readonly className?: string;
}

/* --------------------------------------------------------- the component - */

export function ShortsPlayer({
  short,
  hot,
  active,
  muted,
  onMutedChange,
  commentsOpen,
  onToggleComments,
  onReact,
  onToggleSubscribe,
  onShare,
  onRemix,
  loadComments,
  commentsViewer = null,
  now,
  menuItems,
  createEngine,
  className,
}: ShortsPlayerProps) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState<"idle" | "playing" | "blocked">("idle");
  /**
   * Did the policy fallback fire for this item?
   *
   * Separate state rather than a fourth value of `attempt`, because the
   * fallback's own `setMuted` re-runs the playback effect and the *second*
   * attempt is an ordinary muted play. Folded into one variable, the fact that
   * the viewer's unmute preference was refused would be overwritten by the
   * success that followed it, and the control would show a plain muted icon
   * with no explanation.
   */
  const [fellBack, setFellBack] = useState(false);
  const autoplay: ShortsAutoplayState =
    attempt === "playing" && fellBack ? "muted-fallback" : attempt;

  /**
   * The engine's options, memoised on the media fields alone.
   *
   * This is what keeps a Like from rebuilding a `MediaSource`. The feed hands
   * down a fresh `ShortItem` whenever a count or a reaction changes — a spread
   * copy, so the two arrays keep their identity — and the four dependencies
   * below are the only ones that decide what is played.
   */
  const { pipeline, masterPlaylistUrl, progressiveSources, renditionCodecs } = short;
  const options = useMemo(
    () =>
      playerOptionsFor({
        pipeline,
        masterPlaylistUrl,
        progressiveSources,
        renditionCodecs,
      }),
    [pipeline, masterPlaylistUrl, progressiveSources, renditionCodecs],
  );

  /** The engine's lifetime is `hot`, not the component's. See the header. */
  useEffect(() => {
    if (!hot) return;
    const media = mediaRef.current;
    if (media === null) return;

    const construct = createEngine ?? createPlayer;
    const engine = construct({ ...options, media });
    void engine.load();

    return () => {
      // research §10's teardown, delegated: the engine aborts its appends and
      // fetches, detaches the element, revokes the object URL and drops the
      // `MediaSource`. Calling it here — rather than letting an unmount do it —
      // is what bounds the number of live `MediaSource`s to the hot window
      // however long the session runs.
      engine.destroy();
    };
  }, [hot, options, createEngine]);

  /**
   * The element is the authority on mute, and both halves of it are set.
   *
   * The *property* is what silences the audio. The *attribute* is what §10
   * asks for — "author `muted`, `playsinline` and `autoplay` directly as HTML
   * attributes … Safari's heuristics are most reliable when the element is
   * autoplaying-muted from the moment it's created" — and React does not
   * render it: `muted` is one of the handful of props React sets as a property
   * only, so it is absent from server-rendered markup even when the prop is
   * true. `playsinline` and `autoplay` are ordinary attributes and do appear.
   *
   * The window that leaves open is between the HTML being parsed and React
   * hydrating, where an `<video autoplay>` with no `muted` attribute will have
   * its implicit autoplay refused. That refusal is a no-op — it does not
   * poison the muted `play()` this component makes a moment later — but it is a
   * real difference from the product and it cannot be closed from here without
   * hand-writing the element's markup. Stated rather than hidden.
   */
  const mutedRef = useRef(muted);

  const attachMedia = useCallback((node: HTMLVideoElement | null): void => {
    mediaRef.current = node;
    if (node === null) return;
    // A callback ref runs at commit, before either kind of effect, so the
    // attribute is right on the first client frame rather than one paint late.
    // The ref is written by the effect below rather than during render, so on
    // any later re-attach it can be one render stale — which the effect then
    // corrects in the same commit.
    node.muted = mutedRef.current;
    node.toggleAttribute("muted", mutedRef.current);
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    const media = mediaRef.current;
    if (media === null) return;
    media.muted = muted;
    media.toggleAttribute("muted", muted);
  }, [muted]);

  /**
   * Play the active item, and be honest about a refusal.
   *
   * Re-runs on `muted` because the fallback below changes it: the second pass
   * is the muted retry, and it terminates because a muted attempt has nothing
   * left to fall back to.
   */
  useEffect(() => {
    const media = mediaRef.current;
    if (media === null || !hot) return;

    if (!active) {
      media.pause();
      setAttempt("idle");
      setFellBack(false);
      return;
    }

    let cancelled = false;
    const play = async (): Promise<void> => {
      try {
        await media.play();
        if (!cancelled) setAttempt("playing");
        return;
      } catch {
        if (cancelled) return;
      }

      if (!media.muted) {
        // §10: a fresh element does not inherit the gesture that unlocked the
        // previous one, and muted autoplay is the only universally-allowed
        // path. Report the change so the control and the stored preference
        // agree with what is actually happening.
        media.muted = true;
        setFellBack(true);
        onMutedChange(true);
        try {
          await media.play();
          if (!cancelled) setAttempt("playing");
          return;
        } catch {
          if (cancelled) return;
        }
      }

      if (!cancelled) setAttempt("blocked");
    };

    void play();
    return () => {
      cancelled = true;
    };
  }, [active, hot, muted, onMutedChange]);

  /** The tap-to-play affordance: a real gesture, so this one is allowed. */
  const resume = useCallback((): void => {
    const media = mediaRef.current;
    if (media === null) return;
    void media
      .play()
      .then(() => setAttempt("playing"))
      .catch(() => setAttempt("blocked"));
  }, []);

  const toggleMuted = useCallback((): void => {
    // A deliberate press ends the fallback, whichever way it goes: the hint
    // exists to explain a refusal, and the viewer has just overruled it.
    setFellBack(false);
    onMutedChange(!muted);
  }, [muted, onMutedChange]);

  return (
    <div
      data-shorts-player={short.id}
      data-pipeline={short.pipeline}
      data-hot={hot ? "" : undefined}
      data-active={active ? "" : undefined}
      data-autoplay={autoplay}
      className={clsx("flex h-full items-stretch justify-center gap-[34px]", className)}
    >
      {/* §11: `#player-container` radius 12px. Height-driven at 9:16 — the
          measured player is 553.5 × 984, which is 0.5625 exactly. */}
      <div
        data-shorts-stage=""
        className="relative h-full max-w-full shrink-0 overflow-hidden rounded-cozy bg-black"
        style={{ aspectRatio: "9 / 16" }}
      >
        <video
          ref={attachMedia}
          data-shorts-video=""
          // §10: authored as attributes, not only set from script. `muted` is
          // set through the ref above as well, because React will not render
          // the attribute — see the note there.
          muted={muted}
          loop
          playsInline
          autoPlay={active}
          poster={short.posterUrl ?? undefined}
          aria-label={short.title}
          /**
           * `contain`, where the product measures `ytp-fit-cover-video`.
           *
           * A true 9:16 short is identical either way, which is every short in
           * the captures. `videos.is_short` admits **square-or-taller**
           * (`src/adapters/repositories/videos.ts`), and `cover` on a square
           * source in a 9:16 box crops roughly 44% of its width away. Cropping
           * the subject out of a square short is a worse divergence than the
           * pillarbox, so this is a deliberate departure from the measurement
           * rather than an oversight.
           */
          className="h-full w-full object-contain"
        />

        {active ? (
          <>
            {/* Not measured: no shorts capture exposes a metapanel scrim. The
                metapanel is white-on-artwork (§11's Overlay palette) and white
                on a bright frame is unreadable, so a bottom wash is added at
                the same 60% black the duration badge uses. */}
            <div
              aria-hidden="true"
              data-shorts-scrim=""
              className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent"
            />

            <MuteControl
              muted={muted}
              fellBack={autoplay === "muted-fallback"}
              onToggle={toggleMuted}
            />

            {autoplay === "blocked" ? <TapToPlay onResume={resume} /> : null}

            <MetaPanel
              short={short}
              onToggleSubscribe={onToggleSubscribe}
            />
          </>
        ) : null}
      </div>

      {active ? (
        <ActionRail
          title={short.title}
          likeCount={short.likeCount}
          dislikeCount={short.dislikeCount}
          commentCount={short.commentCount}
          commentsEnabled={short.commentsEnabled}
          commentsOpen={commentsOpen}
          viewerReaction={short.viewerReaction}
          channel={{
            name: short.channel.name,
            handle: short.channel.handle,
            avatarUrl: short.channel.avatarUrl,
          }}
          subscribed={short.subscribed}
          onReact={onReact}
          onToggleComments={onToggleComments}
          onShare={onShare}
          onRemix={onRemix}
          onToggleSubscribe={onToggleSubscribe}
          menuItems={menuItems}
          className="self-center"
        />
      ) : null}

      {active && commentsOpen ? (
        <CommentsPanel
          short={short}
          loadComments={loadComments}
          viewer={commentsViewer}
          now={now}
          onClose={onToggleComments}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- the metapanel - */

/**
 * The bottom-left overlay: channel bar, then title.
 *
 * §11, measured at 480 × 60 with a 16px inset:
 *
 * ```
 * yt-reel-channel-bar-view-model    211.7 × 32
 *   yt-avatar-shape                 32 × 32
 *   a  «@handle»                    14/20 w400 #fff   (span padding 0 8px)
 *   Subscribe                       77.6 × 32  radius 16
 *                                   Filled Overlay SizeS, #fff on #000,
 *                                   padding 0 12px, 12/32 w500
 * yt-shorts-video-title-view-model  386.5 × 20
 *   span «title #hashtags»          14/20 w400 #fff
 * ```
 *
 * Every one of those Subscribe values falls out of
 * `buttonClassName({ variant: "filled", palette: "overlay", size: "s" })`
 * unchanged, which is the point of §11's note that the metapanel flips to the
 * Overlay palette: it is the same button primitive, on artwork.
 */
function MetaPanel({
  short,
  onToggleSubscribe,
}: {
  short: ShortItem;
  onToggleSubscribe: () => void;
}) {
  return (
    <div
      data-shorts-metapanel=""
      className="absolute inset-x-4 bottom-4 max-w-[480px] text-overlay-primary"
    >
      <div data-shorts-channel-bar="" className="flex h-8 items-center">
        <a
          href={`/@${encodeURIComponent(short.channel.handle)}`}
          className="flex items-center"
          data-shorts-channel-link=""
        >
          <Avatar
            size="compact"
            name={short.channel.name}
            src={short.channel.avatarUrl}
            decorative={false}
          />
          {/* The measured `span` carries `padding: 0 8px`, not a margin. */}
          <span className="px-2 text-[14px] leading-5 text-overlay-primary">
            @{short.channel.handle}
          </span>
        </a>
        <Button
          variant="filled"
          palette="overlay"
          size="s"
          aria-pressed={short.subscribed}
          onClick={onToggleSubscribe}
          data-shorts-subscribe=""
        >
          {short.subscribed ? "Subscribed" : "Subscribe"}
        </Button>
      </div>

      <div
        data-shorts-title=""
        className="mt-1 text-[14px] leading-5 text-overlay-primary"
      >
        {short.title}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- playback chrome - */

/**
 * Mute, and the one place the policy fallback is visible.
 *
 * The product's copy for the pre-gesture state is literally «Tap to unmute» —
 * it is in the captured player text in
 * `research/extracted/channel-and-shorts.json`. That string is used for the
 * case it describes: playing, muted, and muted because the browser refused
 * sound rather than because the viewer asked for it.
 */
function MuteControl({
  muted,
  fellBack,
  onToggle,
}: {
  muted: boolean;
  fellBack: boolean;
  onToggle: () => void;
}) {
  const label = muted ? (fellBack ? "Tap to unmute" : "Unmute") : "Mute";
  return (
    <div className="absolute top-4 right-4 flex items-center gap-2">
      {fellBack ? (
        <span
          data-shorts-unmute-hint=""
          className="rounded-compact bg-overlay-medium px-2 py-1 text-small text-overlay-primary"
        >
          Tap to unmute
        </span>
      ) : null}
      <button
        type="button"
        data-shorts-mute=""
        aria-label={label}
        aria-pressed={muted}
        onClick={onToggle}
        className={buttonClassName({
          variant: "tonal",
          palette: "overlay",
          size: "m",
          iconOnly: true,
        })}
      >
        {muted ? <VolumeMutedIcon size={24} /> : <VolumeIcon size={24} />}
      </button>
    </div>
  );
}

/**
 * The honest end of the rejected-autoplay branch.
 *
 * A click is a fresh user gesture, which is what every engine's policy asks
 * for, so this button's `play()` is the one that is allowed to succeed.
 */
function TapToPlay({ onResume }: { onResume: () => void }) {
  return (
    <button
      type="button"
      data-shorts-tap-to-play=""
      aria-label="Play"
      onClick={onResume}
      className="absolute inset-0 grid place-items-center bg-black/30 text-overlay-primary"
    >
      <span className="grid size-16 place-items-center rounded-full bg-overlay-medium">
        <PlayIcon size={36} />
      </span>
    </button>
  );
}

/* ------------------------------------------------------- comments panel -- */

/**
 * Comments as a panel beside the reel, never a page.
 *
 * The thread is fetched on first open rather than shipped with the feed. Twenty
 * shorts times twenty threads is a payload nobody reads, and
 * `src/app/api/videos/[id]/comments/route.ts` deliberately has **no `GET`** —
 * its own comment explains that the watch page already holds every thread it
 * will show. Shorts is the surface that does not, so the fetch is supplied from
 * the server component as a function prop (a server action) rather than by
 * adding a route this slice does not own.
 *
 * The list itself is `@/components/watch/comments`, unchanged. It is the same
 * data with the same rules — one level of replies, the same two sort orders —
 * and a second implementation of it would be a second place for those rules to
 * drift.
 */
function CommentsPanel({
  short,
  loadComments,
  viewer,
  now,
  onClose,
}: {
  short: ShortItem;
  loadComments: ((videoId: string) => Promise<readonly CommentThread[]>) | undefined;
  viewer: CommentsViewer | null;
  now: Date | undefined;
  onClose: () => void;
}) {
  const [threads, setThreads] = useState<readonly CommentThread[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (loadComments === undefined) return;
    let cancelled = false;
    setThreads(null);
    setFailed(false);
    void loadComments(short.id)
      .then((loaded) => {
        if (!cancelled) setThreads(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadComments, short.id]);

  return (
    <aside
      data-shorts-comments=""
      role="dialog"
      aria-label={`Comments on ${short.title}`}
      // Width is **assumed** — no capture in `research/` contains an opened
      // Shorts comment panel. 400px is the width at which the measured comment
      // row (36px avatar, 14/20 body) reads at the same line length it does on
      // the watch page.
      className="flex h-full w-[400px] shrink-0 flex-col overflow-hidden rounded-cozy bg-raised"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="m-0 text-shelf font-[var(--yt-weight-medium)]">Comments</h2>
        <button
          type="button"
          data-shorts-comments-close=""
          aria-label="Close comments"
          onClick={onClose}
          className={buttonClassName({ variant: "text", size: "m", iconOnly: true })}
        >
          <CloseIcon size={24} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {failed ? (
          <p data-shorts-comments-error="" className="text-body text-secondary">
            Comments could not be loaded.
          </p>
        ) : loadComments === undefined ? (
          <p data-shorts-comments-unavailable="" className="text-body text-secondary">
            Comments are not available on this surface.
          </p>
        ) : threads === null ? (
          <p data-shorts-comments-loading="" className="text-body text-secondary">
            Loading comments…
          </p>
        ) : (
          <Comments
            videoId={short.id}
            commentCount={short.commentCount}
            commentsEnabled={short.commentsEnabled}
            threads={threads}
            viewer={viewer}
            now={now}
          />
        )}
      </div>
    </aside>
  );
}
