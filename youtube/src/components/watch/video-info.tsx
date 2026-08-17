"use client";

import Link from "next/link";
import clsx from "clsx";
import { useState } from "react";

import {
  BellIcon,
  ChevronIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  SaveIcon,
  ShareIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from "@/components/icons";
import { Avatar, Button } from "@/components/primitives";
import {
  exactCount,
  formatLikeCount,
  formatSubscriberCount,
} from "@/domain/format";
import type { ReactionState } from "@/adapters/repositories/reactions";

/**
 * The watch page's metadata block: title, owner, subscribe, actions.
 *
 * Everything here is measured. `research/08-youtube-ui-measured.md` §3.4 and
 * §10.3 for geometry, §2.2 for type, §8.3 for copy, and
 * `research/extracted/watch-layout-1920.json` `actionButtons` for the exact
 * accessible names — which are the part that would otherwise be invented.
 *
 * | Part | Measured |
 * | --- | --- |
 * | `h1` | 1344×28, `margin: 0`, 20/28/700 |
 * | Owner avatar | 40px |
 * | Channel name / subs | 16/22/500 and 12/18/400 |
 * | Subscribe | 94.54×40, radius 20, `padding 0 16px`, filled |
 * | Like | 84.66×40, `radius 20px 0 0 20px` |
 * | Dislike | 56×40, `radius 0 20px 20px 0` — **segmented, no gap** |
 * | Share / Save | 92.13×40 and 86.29×40, radius 20, tonal |
 * | More actions | 40×40, radius 20 |
 *
 * The like/dislike pair being one segmented control with **no gap and no
 * divider** is the detail a rebuild usually misses; it is why
 * `Button`'s `segment` prop exists.
 *
 * ## The counts, which use two different formatters
 *
 * The like button shows `6.2K` (the *view* ladder, two significant digits) and
 * its accessible name carries the exact figure —
 * `like this video along with 6,259 other people`, measured verbatim. The
 * subscriber count under the channel name uses the *three*-digit ladder:
 * `222K subscribers`. `src/domain/format.ts` exists because those two roundings
 * disagree, and this component is one of the two places they sit 200px apart.
 */

export interface VideoInfoProps {
  readonly title: string;
  readonly channelName: string;
  readonly channelHandle: string;
  readonly channelAvatarUrl?: string | null;
  readonly subscriberCount: number;
  readonly likeCount: number;
  readonly viewerReaction: ReactionState;
  readonly subscribed: boolean;
  /** Whether the channel offers memberships — the measured `Join` button. */
  readonly membershipsOffered?: boolean;
  readonly onReact: (value: 1 | -1) => void;
  readonly onToggleSubscribe: () => void;
  readonly className?: string;
}

export function VideoInfo({
  title,
  channelName,
  channelHandle,
  channelAvatarUrl,
  subscriberCount,
  likeCount,
  viewerReaction,
  subscribed,
  membershipsOffered = false,
  onReact,
  onToggleSubscribe,
  className,
}: VideoInfoProps) {
  return (
    <section data-video-info="" className={clsx("flex flex-col gap-3", className)}>
      <h1
        data-watch-title=""
        // §2.2 / §10.3: 20/28/700, `margin: 0`. The margin is the parent's, via
        // the gap above, which is what §3.4's "h1 … margin: 0" is recording.
        className="m-0 text-heading font-[var(--yt-weight-bold)] text-primary"
      >
        {title}
      </h1>

      {/* §10.3's `#top-row`: owner block on the left, actions on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/@${channelHandle}`}
            data-owner-link=""
            className="flex items-center gap-3"
          >
            {/* §3.4: 40px on the watch page — larger than the card's 36. */}
            <Avatar
              size="comfortable"
              src={channelAvatarUrl ?? null}
              name={channelName}
              decorative
            />
            <span className="flex flex-col">
              <span
                data-owner-name=""
                className="text-title font-[var(--yt-weight-medium)] text-primary"
              >
                {channelName}
              </span>
              <span data-owner-subs="" className="text-small text-secondary">
                {formatSubscriberCount(subscriberCount)}
              </span>
            </span>
          </Link>

          {membershipsOffered ? (
            // §8.3: the owner row reads `Join` (membership, when offered) then
            // `Subscribe`. The measured accessible name is `Join this channel`.
            <Button variant="tonal" aria-label="Join this channel">
              Join
            </Button>
          ) : null}

          <SubscribeButton
            channelName={channelName}
            subscribed={subscribed}
            onToggle={onToggleSubscribe}
          />
        </div>

        <div
          data-watch-actions=""
          // §10.3's `#top-level-buttons-computed`.
          className="flex items-center gap-2"
        >
          <div className="flex items-center">
            <Button
              variant="tonal"
              segment="start"
              data-action="like"
              // Measured verbatim, exact figure and all. `exactCount` is the
              // comma-grouped formatter §8.1 records for aria-labels.
              aria-label={`like this video along with ${exactCount(likeCount)} other people`}
              aria-pressed={viewerReaction === 1}
              leading={<ThumbUpIcon size={24} />}
              onClick={() => onReact(1)}
            >
              {/* §8.1: `6.2K` — the *view* ladder, not the subscriber one. A
                  zero-like video shows the word `Like` and no number. */}
              {formatLikeCount(likeCount) || "Like"}
            </Button>
            <Button
              variant="tonal"
              segment="end"
              data-action="dislike"
              aria-label="Dislike this video"
              aria-pressed={viewerReaction === -1}
              iconOnly
              // Measured 56×40 rather than the 40×40 an icon-only button would
              // be: the dislike half of the pair is wider than a square.
              className="w-14"
              onClick={() => onReact(-1)}
            >
              <ThumbDownIcon size={24} />
            </Button>
          </div>

          <Button variant="tonal" aria-label="Share" leading={<ShareIcon size={24} />}>
            Share
          </Button>
          <Button
            variant="tonal"
            aria-label="Save to playlist"
            leading={<SaveIcon size={24} />}
          >
            Save
          </Button>
          <Button
            variant="tonal"
            aria-label="Download"
            leading={<DownloadIcon size={24} />}
            // Measured at 0×0 on the sampled page — the button exists in the
            // DOM and was not rendered for a logged-out viewer. Rendered here
            // because §8.3 lists it among the watch actions.
            className="max-lg:hidden"
          >
            Download
          </Button>
          <Button variant="tonal" iconOnly aria-label="More actions">
            <MoreHorizontalIcon size={24} />
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Subscribe, in both states.
 *
 * Unsubscribed is a Filled Mono button: `rgb(15,15,15)` on `rgb(241,241,241)`
 * text in light, and the inverse in dark (§1.2). Subscribed is the measured
 * `IconLeadingTrailingNoText` shape — a bell and a chevron, **no words**, 74×40
 * (R9 §9.1, and the reason `Button` has a `hideLabel` prop at all). The label
 * is still passed, because it is what the accessible name should say.
 *
 * The measured accessible name carries a trailing period:
 * `Subscribe to Captain Discovery.`
 */
function SubscribeButton({
  channelName,
  subscribed,
  onToggle,
}: {
  readonly channelName: string;
  readonly subscribed: boolean;
  readonly onToggle: () => void;
}) {
  // Local, so the button reflects the press before the round trip. The caller
  // owns the truth; this only covers the frame in between.
  const [pending, setPending] = useState(false);

  return (
    <Button
      data-action="subscribe"
      variant={subscribed ? "tonal" : "filled"}
      hideLabel={subscribed}
      leading={subscribed ? <BellIcon size={24} /> : undefined}
      trailing={subscribed ? <ChevronIcon size={24} /> : undefined}
      aria-label={
        subscribed
          ? `Unsubscribe from ${channelName}.`
          : `Subscribe to ${channelName}.`
      }
      aria-pressed={subscribed}
      disabled={pending}
      onClick={() => {
        setPending(true);
        onToggle();
        setPending(false);
      }}
    >
      {subscribed ? "Subscribed" : "Subscribe"}
    </Button>
  );
}
