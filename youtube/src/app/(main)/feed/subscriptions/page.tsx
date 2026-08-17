import { Suspense } from "react";
import { cookies } from "next/headers";
import type { Metadata } from "next";

import { database } from "@/adapters/db";
import { listSubscriptionFeed } from "@/adapters/repositories/subscriptions";
import { ShortsIcon } from "@/components/icons";
import { ButtonLink } from "@/components/primitives";
import { FeedEmptyState, FeedSkeleton } from "@/components/feed";
import { Shelf, VideoGrid } from "@/components/video";
import type { VideoCard } from "@/domain/types";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth";

/**
 * `/feed/subscriptions`.
 *
 * ## Two things everybody remembers about this page are no longer true
 *
 * R9 §5 opens with them, and both were in the brief this build started from:
 *
 * 1. **There are no per-day section headers.** No `Today` / `This week` /
 *    `This month` grouping anywhere. It is one flat rich grid with
 *    continuation loading.
 * 2. **There is no grid/list view toggle, and no "Manage" button.** The manage
 *    affordance is a pill reading **`All subscriptions`** at the top right,
 *    linking to `/feed/channels`.
 *
 * Neither is implemented here, which is the point of writing them down: a
 * later reader looking for the day headings should find the reason they are
 * absent rather than assume they were forgotten.
 *
 * ## Measured composition (R9 §5)
 *
 * ```
 * ytd-rich-section-renderer > ytd-shelf-renderer      #title "Latest" 20/28 w700
 *     grid-subheader → a  136.8 × 40  r20  padding 0 16px
 *                         bg rgba(255,255,255,0.1)  14/40 w500  → /feed/channels
 * ytd-rich-section-renderer > ytd-rich-shelf-renderer #title "Most relevant"
 *     elements-per-row = 3, "Show more" expander
 * ytd-rich-section-renderer > ytd-rich-shelf-renderer[is-shorts]
 *     Shorts glyph 24 × 24, "View all" link #3ea6ff, elements-per-row = 5
 * ytd-rich-item-renderer × N                          flat chronological grid
 * ytd-continuation-item-renderer
 * ```
 *
 * The pill is `Tonal Mono SizeM` — 40px tall, 20px radius, 16px of padding, on
 * `additive-background` — which is exactly what `Button`'s `tonal` variant
 * produces, so it is a variant rather than a bespoke control.
 *
 * **The shelf headings here are 20/28/700, not 15/700.** Two shelf headings at
 * two sizes in one product: `Shelf` is built to the *home* shelf's measured
 * 15px, because home is where a shelf of video cards appears, and its own
 * documentation says a surface needing the larger one may bring it. That is
 * the `[&_h2]:text-heading` below — an override at the call site rather than a
 * prop on a frozen component.
 *
 * ## What is ours rather than measured
 *
 * * **The "Most relevant" ranking.** The shelf is measured; the signal behind
 *   it is not knowable from a screenshot, and this application computes no
 *   relevance score for a subscription feed. View count stands in, which is
 *   the same proxy `recommendations.ts` uses for its cold-start pool and is
 *   labelled a proxy there too. The items also appear again in the grid below,
 *   which is what the product does — the shelf re-surfaces, it does not
 *   remove.
 * * **`Show more`.** The measured expander is replaced by `Shelf`'s own arrows,
 *   which are the same affordance — more of a row that does not fit — reached
 *   by keyboard as well as by pointer.
 * * **The signed-out and empty copy.** R9 captured neither.
 */

export const metadata: Metadata = {
  title: "Subscriptions",
};

export const dynamic = "force-dynamic";

/**
 * One page of the feed.
 *
 * Fetched with shorts included and partitioned here, because
 * `listSubscriptionFeed` offers `includeShorts` and no `shortsOnly` — so the
 * alternative is two queries where the second re-reads most of the first's
 * rows to throw them away. The cost is that the limit is spent on both kinds
 * at once: sixty rows yield sixty *videos*, of which the grid gets whatever is
 * not vertical. Sixty rather than the repository's default forty for that
 * reason.
 */
const FEED_PAGE = 60;

/** `elements-per-row` on the measured shelves (R9 §5). */
const MOST_RELEVANT_PER_ROW = 3;
const SHORTS_PER_ROW = 5;

/** Three scrollable pages of a 3-up shelf. Ours; no count was captured. */
const MOST_RELEVANT_SIZE = MOST_RELEVANT_PER_ROW * 3;

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <SubscriptionsFeed />
    </Suspense>
  );
}

async function SubscriptionsFeed() {
  const viewerId = await currentUserId();

  if (viewerId === null) {
    return (
      <Surface>
        <FeedEmptyState
          title="Don't miss new videos"
          body="Sign in to see updates from the channels you subscribe to."
          action={
            <ButtonLink
              href="/signin"
              variant="outline"
              palette="callToAction"
              size="m"
            >
              Sign in
            </ButtonLink>
          }
        />
      </Surface>
    );
  }

  const db = await database();
  const feed = await listSubscriptionFeed(db, viewerId, {
    limit: FEED_PAGE,
    includeShorts: true,
  });

  const shorts = feed.filter((video) => video.isShort);
  const chronological = feed.filter((video) => !video.isShort);
  const now = new Date();

  if (feed.length === 0) {
    return (
      <Surface>
        <LatestHeader />
        <FeedEmptyState
          title="No new videos"
          body="When the channels you subscribe to publish something, it turns up here."
          className="mt-6"
        />
      </Surface>
    );
  }

  return (
    <Surface>
      <LatestHeader />

      {/* Only when the shelf would say something the grid below does not
          already say in its first row — a "Most relevant" of three items above
          a grid of three is the same three videos twice. */}
      {chronological.length > MOST_RELEVANT_PER_ROW ? (
        <Shelf
          title="Most relevant"
          itemsPerRow={MOST_RELEVANT_PER_ROW}
          videos={mostRelevant(chronological)}
          now={now}
          className="mt-6 [&_h2]:text-heading"
        />
      ) : null}

      {shorts.length > 0 ? (
        <Shelf
          title="Shorts"
          titleIcon={<ShortsIcon size={24} />}
          itemsPerRow={SHORTS_PER_ROW}
          videos={shorts}
          // R9 §5.1: the Shorts lockup is a title and a view count. The lockup
          // itself is a component the frozen card family does not ship — a 2:3
          // thumbnail, no channel row — so this is the closest the available
          // one gets, with its 16:9 thumbnail as the visible difference.
          showAvatar={false}
          showChannel={false}
          now={now}
          action={
            <ButtonLink
              href="/shorts"
              variant="text"
              palette="callToAction"
              size="m"
            >
              View all
            </ButtonLink>
          }
          className="mt-8 [&_h2]:text-heading"
        />
      ) : null}

      {/* The flat chronological grid. No day headers — see the header. */}
      <VideoGrid videos={chronological} now={now} className="mt-8" />
    </Surface>
  );
}

/**
 * The 24px page inset, the same `--yt-page-inset` the grid's measured x-origin
 * of 264 implies inside a content column starting at 240.
 */
function Surface({ children }: { children: React.ReactNode }) {
  return <div className="px-[var(--yt-page-inset)] pt-6 pb-8">{children}</div>;
}

/** `Latest` at 20/28/700, with the `All subscriptions` pill at the row's end. */
function LatestHeader() {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className="m-0 text-heading font-[var(--yt-weight-bold)] text-primary">
        Latest
      </h1>
      <ButtonLink href="/feed/channels" variant="tonal" size="m">
        All subscriptions
      </ButtonLink>
    </div>
  );
}

/**
 * The shelf's ordering. See the header for why this is a proxy.
 *
 * Sorted on a copy — `listSubscriptionFeed` returns a readonly array and the
 * grid below shows the same rows in publication order, so sorting in place
 * would silently reorder the page's main content.
 */
function mostRelevant(videos: readonly VideoCard[]): VideoCard[] {
  return [...videos]
    .sort((a, b) =>
      // Terminated on the id, like every other ordering in this project: two
      // videos on equal view counts must not swap between renders.
      a.viewCount === b.viewCount
        ? a.id < b.id
          ? -1
          : 1
        : b.viewCount - a.viewCount,
    )
    .slice(0, MOST_RELEVANT_SIZE);
}

/**
 * The signed-in user, or `null`.
 *
 * Repeated per page rather than shared; `src/app/(main)/page.tsx` records why
 * neither the layout nor `components/feed/` can hold it. This surface needs
 * only the user id — `listSubscriptionFeed` takes the viewer and the
 * subscriber as one parameter by design, so there is no session key to thread
 * and no way to ask for somebody else's subscriptions carrying your own
 * resume positions.
 */
async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  return (await resolveSession(token))?.userId ?? null;
}
