"use client";

/**
 * The broadcast chrome: the top row and the bottom row.
 *
 * Layout follows research/instagram-live-ui.md §1 and §2, which is the
 * *category* pattern shared by every live product — a red LIVE pill and a
 * viewer count top-left, a dismiss control top-right, a comment field and an
 * icon row along the bottom. §9 is the boundary: none of it carries a
 * wordmark, a brand glyph or a brand gradient, and no string on this screen
 * names any platform.
 *
 * Numbers below (radii, paddings, opacities) are the research's own
 * LOW/INFERRED defaults — nobody publishes pixel specs for this screen — so
 * they are sensible values chosen to read correctly at a glance, not measured
 * ones.
 */

import { formatViewerCount, initialsFor } from "@/domain/format";

import { CloseIcon, EyeIcon, FlipCameraIcon, MoreIcon, SparkleIcon } from "./icons";

/**
 * The badge red.
 *
 * research §1a: no hex is documented for any platform's live badge; the two
 * candidates it offers are `#ED4956` and `#FF3040`, which are near-identical
 * and both read simply as "broadcast red" — a category-wide convention (§9)
 * rather than anyone's brand asset.
 */
const LIVE_RED = "#ed4956";

export function LiveTopBar({
  username,
  avatar,
  viewers,
  onClose,
}: {
  readonly username: string;
  /** Data URL, or empty for the monogram. */
  readonly avatar: string;
  readonly viewers: number;
  readonly onClose: () => void;
}) {
  return (
    // `pad-safe-top` (the notch inset) and the layout's own padding are on
    // separate elements on purpose: both set `padding-top`, and putting them on
    // one element makes which of them wins a stylesheet-ordering accident.
    <div className="pad-safe-top pointer-events-none absolute inset-x-0 top-0 z-20">
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          <Broadcaster username={username} avatar={avatar} />

          {/* The badge and the count sit adjacent, effectively one capsule — §1a.
            They keep their own tighter gap, and never shrink: a long username
            gives up its characters before the strongest live signal on the
            screen gives up a pixel. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              data-testid="live-badge"
              className="rounded-[5px] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] leading-none text-white"
              style={{ backgroundColor: LIVE_RED }}
            >
              Live
            </span>
            <span
              data-testid="viewer-count"
              className="tabular flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-[13px] font-semibold leading-none text-white"
            >
              <EyeIcon className="h-3.5 w-3.5" />
              {/* §7: exact under 1,000, then K, then M — shared with the rest of
                the app through `domain/format`, never re-implemented here. */}
              {formatViewerCount(viewers)}
            </span>
          </div>
        </div>

        <button
          type="button"
          data-testid="live-close"
          onClick={onClose}
          aria-label="End live"
          // §1c: a plain white glyph with no chip behind it, but a 44px tap
          // target — the negative margin keeps the glyph optically in the corner
          // while the target stays reachable. `shrink-0` because flex would
          // otherwise let a long username shave pixels off the tap target, and
          // this is the control that ends the broadcast.
          className="pointer-events-auto -m-2.5 flex h-11 w-11 shrink-0 items-center justify-center text-white"
        >
          <CloseIcon className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}

/**
 * Who is broadcasting: the configured avatar and username, top-left.
 *
 * A deliberate departure from research §1d, which observes that the real app
 * does *not* show broadcasters their own avatar and handle (on a viewer's
 * screen it does — a viewer needs telling whose stream this is; the broadcaster
 * already knows) and suggests skipping it. Two reasons to show it anyway:
 *
 *   - the audience for this screen is not the user, it is whoever is looking
 *     over their shoulder, and to that person a stream with no name attached is
 *     the one detail that does not add up;
 *   - settings collect a live username and avatar (SPEC §5.5). A field that
 *     changes nothing anywhere reads as a broken setting, and someone who
 *     cannot see their own configuration take effect has no reason to trust
 *     that the rest of it did either.
 *
 * Generic by construction, per §9: a plain circle, a hairline white ring and
 * the user's own text. No wordmark, no brand glyph, no brand gradient — the
 * avatar is the user's own image or their initials, and nothing else.
 */
function Broadcaster({ username, avatar }: { readonly username: string; readonly avatar: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        data-testid="live-avatar"
        aria-hidden="true"
        // The photo goes on as a background rather than an <img>: it is a data
        // URL out of settings, so there is nothing to size, lazy-load or fetch,
        // and `cover` crops it to the circle instead of squashing it.
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 bg-cover bg-center text-[11px] font-semibold text-white ring-1 ring-white/70"
        style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}
      >
        {avatar ? "" : initialsFor(username)}
      </span>
      <span
        data-testid="live-username"
        // Truncated, not wrapped: usernames run to 30 characters and a second
        // line would push the chrome down over the video.
        className="truncate text-[13px] font-semibold leading-none text-white"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
      >
        {username}
      </span>
    </div>
  );
}

export function LiveBottomBar({ onFlip }: { readonly onFlip: () => void }) {
  return (
    // Same split as the top bar: the home-indicator inset and the row's own
    // bottom padding must not fight over one `padding-bottom`.
    <div className="pad-safe-bottom absolute inset-x-0 bottom-0 z-50">
      <div className="flex items-center gap-2 px-3 pb-3">
        {/*
        A div, not an <input>. Tapping a real field would raise the iOS
        keyboard over the whole lower half of the screen — the part carrying
        the comment stream that sells this — and nothing typed here could ever
        be sent anywhere. The placeholder is the copy research §2 confirms
        (HIGH): "Add a comment…", sentence case, real ellipsis character.
      */}
        <div
          aria-hidden="true"
          className="h-10 flex-1 rounded-full border border-white/25 px-4 text-[15px] leading-10 text-white/70"
        >
          Add a comment…
        </div>

        {/* §2: plain white glyphs, no chip backgrounds. Only the flip control
          does anything — the rest are set dressing, so they are not buttons
          and cannot be tabbed to or tapped into a dead end. */}
        <div aria-hidden="true" className="flex items-center gap-3 px-1 text-white">
          <MoreIcon className="h-6 w-6" />
          <SparkleIcon className="h-6 w-6" />
        </div>
        <button
          type="button"
          onClick={onFlip}
          aria-label="Flip camera"
          className="flex h-11 w-11 items-center justify-center text-white"
        >
          <FlipCameraIcon className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
