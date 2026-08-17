import { Suspense } from "react";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Metadata } from "next";

import { database } from "@/adapters/db";
import {
  listSubscriptions,
  unsubscribe,
} from "@/adapters/repositories/subscriptions";
import { BellIcon } from "@/components/icons";
import { Avatar, Button, ButtonLink } from "@/components/primitives";
import { FeedEmptyState, FeedSkeleton } from "@/components/feed";
import { thumbnailSrc } from "@/components/video";
import { formatSubscriberCount } from "@/domain/format";
import type { Channel } from "@/domain/types";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth";

/**
 * `/feed/channels` — All subscriptions.
 *
 * The destination of the `All subscriptions` pill on `/feed/subscriptions`.
 * R9 §5 records that this replaced the old "Manage" button, so this page is
 * the manage surface: it is where a subscription is ended.
 *
 * ## Measured (R9 §5.2)
 *
 * ```
 * yt-page-header-view-model    928 × 78   padding 24px 0 4px
 *   h1                         36px / 50px  w700
 * sort chip (chip-cloud)       32px  r8  padding 0 0 0 12px + trailing chevron
 * ytd-section-list-renderer    1024 wide  padding 0 48px  → content column 928
 *
 * ytd-channel-renderer         928 × 136   margin-bottom 16px
 *   #avatar-section            136 × 136   margin-right 16px, border-radius 50%
 *   #info-section              776 wide
 *     #title        «channel name»              18 / 26  w400  #f1f1f1
 *     #subscribers  «@handle • N subscribers»   12 / 18  w400  #aaa
 *     #description                              12 / 18  w400  #aaa, 2 lines
 *   Subscribed button          102.4 × 40  r20  Tonal Mono SizeM (bell + label)
 * ```
 *
 * `36px / 50px` has no role in this project's type scale — `--yt-type-heading`
 * tops out at the watch page's 20/28 — so the heading is written as the
 * measured literal rather than pushed into the nearest role, which at 20px
 * would be a third of the size the capture shows.
 *
 * **The avatar is 120px, not the measured 136.** `--yt-sys-measurement--avatar-size-*`
 * is a closed ladder of eleven steps (R9 §1.1) and 136 is not one of them —
 * `legend` is 120 and `huge` is 144. Overriding the box would leave the letter
 * fallback drawn at 120 inside it, so the nearest ladder step is used and the
 * 16px is recorded here.
 *
 * ## Two measured things this page does not have
 *
 * **The sort chip.** It is a *menu* chip — 8px radius with a trailing chevron,
 * reading `Most relevant` in the capture — and its menu was never opened, so
 * the options are unknown. `listSubscriptions` returns exactly one order
 * (`lower(name)`, so the list is alphabetical). A control offering one option,
 * or two options invented to fill a menu nobody saw, is worse than the
 * absence; the absence is written down here instead.
 *
 * **The rest of the Subscribed menu.** R9 §5.2 notes that "unsubscribing is a
 * menu inside it". The other entries are notification levels, which
 * `setNotifications` supports and which belong to a subscribe-button component
 * this slice does not own. The button here does the one thing this page exists
 * for, and does it as a form post rather than a client callback — see
 * {@link SubscribedButton}.
 */

export const metadata: Metadata = {
  title: "All subscriptions",
};

export const dynamic = "force-dynamic";

export default function AllSubscriptionsPage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <AllSubscriptions />
    </Suspense>
  );
}

async function AllSubscriptions() {
  const viewerId = await currentUserId();

  /**
   * Unsubscribe.
   *
   * A Server Action rather than a route, and it re-reads the session itself.
   * An action is a public endpoint however it is rendered, and the fact that
   * the form beside it is only drawn for a signed-in viewer is not an
   * authorisation check — `unsubscribe` is scoped to `(subscriber_id,
   * channel_id)`, so the id resolved *inside* the action is the only thing
   * standing between this and "any signed-in account may unsubscribe anyone".
   */
  async function unsubscribeFrom(channelId: string): Promise<void> {
    "use server";
    const subscriberId = await currentUserId();
    if (subscriberId === null) return;

    const db = await database();
    await unsubscribe(db, subscriberId, channelId);
    // Both surfaces change: this list loses a row, and the subscriptions feed
    // loses that channel's videos and the guide loses its rail entry.
    revalidatePath("/feed/channels");
    revalidatePath("/feed/subscriptions");
  }

  if (viewerId === null) {
    return (
      <Surface>
        <PageHeading />
        <FeedEmptyState
          title="Sign in to see your subscriptions"
          body="The channels you subscribe to are kept with your account."
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
  const channels = await listSubscriptions(db, viewerId);

  return (
    <Surface>
      <PageHeading />
      {channels.length === 0 ? (
        <FeedEmptyState
          title="No subscriptions yet"
          body="Subscribe to a channel and it will be listed here."
          action={
            <ButtonLink href="/" variant="tonal" size="m">
              Browse videos
            </ButtonLink>
          }
        />
      ) : (
        <ul className="m-0 list-none p-0">
          {channels.map((channel) => (
            <li key={channel.id} className="mb-4">
              <ChannelRow channel={channel} onUnsubscribe={unsubscribeFrom} />
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

/**
 * `ytd-section-list-renderer`: 1024 wide with 48px of side padding, giving the
 * measured 928px content column. Capped rather than full-bleed — this is the
 * one browse surface in the capture that does not use the whole content width.
 */
function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1024px] px-12 pt-6 pb-16">{children}</div>
  );
}

/** `padding: 24px 0 4px`, `36px / 50px` weight 700 (R9 §5.2). */
function PageHeading() {
  return (
    <h1 className="mt-0 mb-6 pt-6 pb-1 text-[36px] leading-[50px] font-[var(--yt-weight-bold)] text-primary">
      All subscriptions
    </h1>
  );
}

function ChannelRow({
  channel,
  onUnsubscribe,
}: {
  channel: Channel;
  onUnsubscribe: (channelId: string) => Promise<void>;
}) {
  const href = `/@${encodeURIComponent(channel.handle)}`;

  return (
    <div data-channel-row="" className="flex items-start gap-4">
      {/*
        Not wrapped in a link. The channel name beside it already points at the
        channel, and a second link to the same place with the same accessible
        name is one more tab stop per row that goes nowhere new — the exact
        duplication `video-card.tsx` collapses on the grid card.
      */}
      <Avatar
        // 120px — the nearest step on the closed avatar ladder to the measured
        // 136. See the file header.
        size="legend"
        name={channel.name}
        src={channel.avatarKey ? thumbnailSrc(channel.avatarKey) : null}
      />

      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-result font-[var(--yt-weight-regular)] text-primary">
          <a href={href}>{channel.name}</a>
        </h2>

        {/*
          `@handle • N subscribers` on one 12/18 line. The delimiter is the same
          real bullet with 4px either side the card's metadata row uses, and it
          is not `aria-hidden` for the same reason: it is the punctuation that
          stops the handle and the count being announced as one phrase.

          `formatSubscriberCount`, never `formatViewCount` — R8 §8.1's headline
          finding is that subscriber counts keep **three** significant digits
          where views keep two, so `7,060,000` is `7.06M subscribers` and
          `7M views`. One formatter cannot produce both, which is why
          `domain/format.ts` names its exports after the surface that calls
          them.
        */}
        <p className="mt-1 mb-0 text-small text-secondary">
          <span data-channel-handle="">@{channel.handle}</span>
          <span className="mx-1">•</span>
          <span data-channel-subscribers="">
            {formatSubscriberCount(channel.subscriberCount)}
          </span>
        </p>

        {channel.description ? (
          <p
            className="mt-1 mb-0 text-small text-secondary"
            // Two lines, measured at a 36px block. Inline rather than a
            // utility class because the clamp count is a per-surface
            // measurement and the DOM is the only place a test can read it —
            // the same call `video-card.tsx` makes.
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {channel.description}
          </p>
        ) : null}
      </div>

      <SubscribedButton channel={channel} onUnsubscribe={onUnsubscribe} />
    </div>
  );
}

/**
 * `Subscribed` — 40px, 20px radius, Tonal Mono, a bell glyph before the label.
 *
 * A `<form>` around a submit button rather than an `onClick`. This page is a
 * server component, so a click handler would need a client wrapper whose only
 * job is to call back into the server; the form posts the action directly,
 * works with JavaScript disabled, and keeps the whole surface server-rendered.
 * `Button` defaults its `type` to `button` precisely so that a control inside
 * a form is never an accidental submit — which makes `type="submit"` here a
 * deliberate statement rather than a default being relied on.
 *
 * The accessible name says what pressing it *does*, because "Subscribed" is a
 * state and a control announced by its state gives no clue what activating it
 * will change.
 */
function SubscribedButton({
  channel,
  onUnsubscribe,
}: {
  channel: Channel;
  onUnsubscribe: (channelId: string) => Promise<void>;
}) {
  return (
    <form action={onUnsubscribe.bind(null, channel.id)} className="shrink-0">
      <Button
        type="submit"
        variant="tonal"
        size="m"
        leading={<BellIcon size={24} />}
        aria-label={`Unsubscribe from ${channel.name}`}
      >
        Subscribed
      </Button>
    </form>
  );
}

/**
 * The signed-in user, or `null`. Repeated per page — `src/app/(main)/page.tsx`
 * records why neither the layout nor `components/feed/` can hold it.
 */
async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  return (await resolveSession(token))?.userId ?? null;
}
