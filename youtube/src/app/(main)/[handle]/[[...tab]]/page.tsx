import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import clsx from "clsx";

import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { listPlaylists } from "@/adapters/repositories/playlists";
import { getSubscription } from "@/adapters/repositories/subscriptions";
import { listChannelVideos } from "@/adapters/repositories/videos";
import {
  ChannelHeader,
  ChannelTabs,
  SubscribeButton,
  channelTabFromSegment,
  type ChannelTab,
} from "@/components/channel";
import { PlaylistCard } from "@/components/playlist";
import { Shelf, VideoGrid, thumbnailSrc } from "@/components/video";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";
import {
  formatAbsoluteDate,
  formatRelativeTime,
  formatSubscriberCount,
  formatVideoCount,
} from "@/domain/format";
import type { Channel, Playlist, VideoCard } from "@/domain/types";

/**
 * The channel page — `/@handle`, `/@handle/videos`, `/@handle/shorts`,
 * `/@handle/playlists`, `/@handle/about`.
 *
 * ## Why this is not `app/(main)/@[handle]/page.tsx`
 *
 * **Next.js owns the `@` prefix.** A directory whose name begins with `@` is a
 * *parallel route slot*, not a path segment — `app/(main)/@[handle]` would
 * declare a slot called `[handle]` that renders into a layout prop and matches
 * no URL at all. There is no escape syntax for a literal leading `@` in a
 * folder name.
 *
 * A dynamic segment captures the whole segment including its punctuation, so
 * `[handle]` matching `/@veritasium` gives `params.handle === "@veritasium"` —
 * the product's URL, exactly, with no rewrite and no redirect. The `@` is then
 * required and stripped below: `/notahandle` is a 404 rather than a channel
 * lookup, which keeps a root-level dynamic segment from quietly becoming a
 * catch-all for every mistyped path.
 *
 * The tab is `[[...tab]]`, an optional catch-all, because the product's tabs
 * are path segments (`/@veritasium/videos`) rather than a query string. One
 * page file serves both shapes; `channelTabFromSegment` is the allow-list, and
 * anything not in it is a 404 rather than a silent fall back to Home.
 *
 * Static routes beat dynamic ones in Next's matcher, so `/watch`, `/playlist`
 * and `/feed/*` are unaffected by a dynamic segment sitting at the root.
 *
 * ## What each tab reads
 *
 * `listChannelVideos` returns Shorts **and** long-form — unlike `listHomeFeed`,
 * which filters `not v.is_short` in SQL — so the two tabs partition one read
 * rather than issuing two. `Channel.videoCount` is public-and-ready only, which
 * is the number the header shows and the reason the Videos grid can be shorter
 * than the count for a signed-in owner looking at their own drafts.
 */

export const metadata: Metadata = {
  title: "Channel",
};

/** One screen of cards. The product loads more on scroll; that is another slice. */
const PAGE_SIZE = 30;

/** How many cards a Home-tab shelf carries before its arrows do the work. */
const SHELF_SIZE = 12;

interface ChannelPageProps {
  params: Promise<{ handle: string; tab?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ChannelPage({
  params,
  searchParams,
}: ChannelPageProps) {
  const { handle: rawHandle, tab: tabSegments } = await params;

  /**
   * `__at` is the marker `next.config.ts` rewrites `/@handle` onto.
   *
   * The `@` cannot reach this component: Next does not match a leading `@` in
   * a URL to a dynamic segment any more than it does in a folder name, so
   * `/@fieldnotes` never routed here at all — a silent 404 with no error and
   * no log line, which is exactly why a route probe checking for 500s missed
   * it. The rewrite turns the product's URL into a segment the router matches
   * while leaving the address bar untouched.
   *
   * Requiring the marker is what stops `[handle]` from becoming a catch-all:
   * `/fieldnotes` has no marker and stays a 404 rather than becoming a second
   * address for the same channel.
   */
  const [marker, ...rest] = tabSegments ?? [];
  if (marker !== "__at") notFound();

  const handle = rawHandle;
  if (handle.length === 0) notFound();

  // More than one segment after the handle is not a tab — `/@x/videos/extra`
  // names nothing.
  if (rest.length > 1) notFound();
  const tab = channelTabFromSegment(rest[0]);
  if (tab === null) notFound();

  const db = await database();
  const jar = await cookies();
  const session = await resolveSession(jar.get(SESSION_COOKIE)?.value ?? null);
  const viewerId = session?.userId ?? null;

  const channel = await createChannelsRepository(db).findByHandle(handle);
  if (channel === null) notFound();

  const owned = viewerId !== null && channel.ownerId === viewerId;
  const now = new Date();
  // Resolved before the fan-out below, so all three reads genuinely start
  // together rather than queueing behind an `await` inside the array literal.
  const sort = sortFrom(await searchParams);

  const [videos, playlists, subscription] = await Promise.all([
    listChannelVideos(db, channel.id, {
      viewerId,
      limit: PAGE_SIZE,
      sort,
      // The owner's own view carries drafts and private uploads; a visitor's
      // does not. `listChannelVideos` defaults this off for the reason its
      // comment gives — a repository whose default is "show everything" leaks
      // the first time a caller forgets an argument.
      includeUnlisted: owned,
    }),
    listPlaylists(db, channel.ownerId),
    viewerId === null ? null : getSubscription(db, viewerId, channel.id),
  ]);

  const shorts = videos.filter((video) => video.isShort);
  const longForm = videos.filter((video) => !video.isShort);
  // A stranger sees only what is public. `listPlaylists` has no visibility
  // filter — it is the owner's own list — so the filter belongs here.
  const visiblePlaylists = owned
    ? playlists
    : playlists.filter((playlist) => playlist.visibility === "public");

  return (
    <div className="px-[var(--yt-page-inset)] pb-16">
      <ChannelHeader
        name={channel.name}
        handle={channel.handle}
        verified={channel.verified}
        avatarUrl={channel.avatarKey === null ? null : thumbnailSrc(channel.avatarKey)}
        bannerUrl={channel.bannerKey === null ? null : thumbnailSrc(channel.bannerKey)}
        subscriberCount={channel.subscriberCount}
        videoCount={channel.videoCount}
        description={channel.description}
        action={
          <SubscribeButton
            channelId={channel.id}
            channelName={channel.name}
            level={subscription?.notifications ?? null}
            signedIn={viewerId !== null}
            ownedByViewer={owned}
          />
        }
      />

      <ChannelTabs handle={channel.handle} active={tab} className="mt-6" />

      <div className="mt-6">
        <TabPanel
          tab={tab}
          channel={channel}
          longForm={longForm}
          shorts={shorts}
          playlists={visiblePlaylists}
          now={now}
        />
      </div>
    </div>
  );
}

/** `?sort=` on the Videos tab. Anything unrecognised falls back to newest. */
function sortFrom(
  search: Record<string, string | string[] | undefined>,
): "newest" | "popular" | "oldest" {
  const raw = search.sort;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "popular" || value === "oldest" ? value : "newest";
}

function TabPanel({
  tab,
  channel,
  longForm,
  shorts,
  playlists,
  now,
}: {
  tab: ChannelTab;
  channel: Channel;
  longForm: readonly VideoCard[];
  shorts: readonly VideoCard[];
  playlists: readonly Playlist[];
  now: Date;
}) {
  switch (tab) {
    case "home":
      return (
        <div className="flex flex-col gap-8">
          {/*
            `screenshots/17-channel-home-1920.png` opens the Home tab with a
            featured video: a large thumbnail beside its title, counts and the
            first paragraph of its **description**. `VideoCard` deliberately
            carries no description — see its doc comment — so building that
            block would mean a second query per channel page for text that only
            appears once. The shelves below it are what the tab is for, and they
            are built.
          */}
          {longForm.length === 0 ? null : (
            <Shelf
              title="Videos"
              videos={longForm.slice(0, SHELF_SIZE)}
              itemsPerRow={4}
              showAvatar={false}
              showChannel={false}
              now={now}
            />
          )}
          {shorts.length === 0 ? null : (
            <Shelf
              title="Shorts"
              videos={shorts.slice(0, SHELF_SIZE)}
              itemsPerRow={5}
              showAvatar={false}
              showChannel={false}
              now={now}
            />
          )}
          {playlists.length === 0 ? null : (
            <section>
              <h2 className="m-0 text-shelf font-[var(--yt-weight-bold)] text-primary">
                Playlists
              </h2>
              <PlaylistGrid playlists={playlists.slice(0, 4)} now={now} />
            </section>
          )}
          {longForm.length === 0 && shorts.length === 0 ? (
            <p className="text-body text-secondary">
              This channel has not published anything yet.
            </p>
          ) : null}
        </div>
      );

    case "videos":
      return (
        <>
          <SortChips handle={channel.handle} />
          {longForm.length === 0 ? (
            <p className="mt-6 text-body text-secondary">No videos yet.</p>
          ) : (
            <VideoGrid
              videos={longForm}
              // R8 §3.7: "**no avatar** (channel context)". Repeating one
              // channel's picture forty times on its own page is noise, and the
              // card family already takes the flag.
              showAvatar={false}
              showChannel={false}
              now={now}
              className="mt-6"
            />
          )}
        </>
      );

    case "shorts":
      return shorts.length === 0 ? (
        <p className="text-body text-secondary">No Shorts yet.</p>
      ) : (
        // R9 §5.1 measures a Shorts card as **2 : 3**, not 9 : 16, on a
        // `ytm-shorts-lockup-view-model-v2` with no duration badge. The card
        // family renders 16:9, and forking it for one aspect ratio is what
        // `components/video/index.ts` exists to prevent — so these are ordinary
        // cards, and the ratio is a known, visible divergence.
        <VideoGrid videos={shorts} showAvatar={false} showChannel={false} now={now} />
      );

    case "playlists":
      return playlists.length === 0 ? (
        <p className="text-body text-secondary">No playlists yet.</p>
      ) : (
        <PlaylistGrid playlists={playlists} now={now} />
      );

    case "about":
      return (
        <section className="max-w-[720px]">
          <h2 className="m-0 text-heading font-[var(--yt-weight-bold)] text-primary">
            About
          </h2>
          {channel.description.length === 0 ? null : (
            <p className="mt-4 whitespace-pre-line text-body text-primary">
              {channel.description}
            </p>
          )}
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body text-secondary">
            <dt>Handle</dt>
            <dd className="m-0 text-primary">@{channel.handle}</dd>
            <dt>Subscribers</dt>
            <dd className="m-0 text-primary">
              {formatSubscriberCount(channel.subscriberCount)}
            </dd>
            <dt>Videos</dt>
            <dd className="m-0 text-primary">
              {formatVideoCount(channel.videoCount)}
            </dd>
            <dt>Joined</dt>
            <dd className="m-0 text-primary">
              {formatAbsoluteDate(channel.createdAt)}
            </dd>
          </dl>
        </section>
      );
  }
}

/**
 * `Latest · Popular · Oldest` on the Videos tab.
 *
 * Anchors rather than the `Chip` primitive, and the reason is in that file:
 * `Chip` is a `<button role="tab" aria-selected>`, which is correct for the
 * home feed's filter bar, where selecting a chip swaps the contents of a panel
 * already on the page. These navigate — each one is a different server render
 * at a different URL — and a button that navigates loses middle-click, "open in
 * new tab" and the status bar. The 32px height, 8px radius, `0 12px` padding
 * and 8px chip-cloud gap are the same measurements `Chip` carries (R9 §2.2).
 *
 * The set is read off `screenshots/18-channel-videos-1920.png`; R8 §3.7 records
 * the channel page's tabs and grid but not these three chips, so the labels are
 * from the screenshot and the geometry is from the chip spec.
 */
function SortChips({ handle }: { handle: string }) {
  const options = [
    { value: "newest", label: "Latest" },
    { value: "popular", label: "Popular" },
    { value: "oldest", label: "Oldest" },
  ] as const;

  return (
    <div className="flex items-center gap-2">
      {options.map((option) => (
        <a
          key={option.value}
          href={`/@${encodeURIComponent(handle)}/videos?sort=${option.value}`}
          data-sort-chip={option.value}
          className={clsx(
            "inline-flex h-8 shrink-0 items-center rounded-compact px-3",
            "text-body font-[var(--yt-weight-medium)] whitespace-nowrap",
            "bg-additive text-primary",
          )}
        >
          {option.label}
        </a>
      ))}
    </div>
  );
}

function PlaylistGrid({
  playlists,
  now,
}: {
  playlists: readonly Playlist[];
  now: Date;
}) {
  return (
    <div
      className="mt-4 grid gap-4"
      // R9 §8.1 measures the playlists index at a hard 4 per row rather than at
      // the container-derived count the video grid uses.
      style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
    >
      {playlists.map((playlist) => (
        <PlaylistCard
          key={playlist.id}
          href={`/playlist?list=${encodeURIComponent(playlist.id)}`}
          title={playlist.title}
          itemCount={playlist.itemCount}
          visibility={playlist.visibility}
          kind={playlist.kind}
          updatedLabel={`Updated ${formatRelativeTime(playlist.updatedAt, now)}`}
          coverUrl={
            playlist.thumbnailKey === null ? null : thumbnailSrc(playlist.thumbnailKey)
          }
        />
      ))}
    </div>
  );
}
