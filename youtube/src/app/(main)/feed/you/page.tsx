import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";

import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { listHistory } from "@/adapters/repositories/history";
import {
  ensureSystemPlaylist,
  listPlaylistItems,
  listPlaylists,
} from "@/adapters/repositories/playlists";
import { Avatar, ButtonLink } from "@/components/primitives";
import { NewPlaylistButton, PlaylistCard } from "@/components/playlist";
import { Shelf, thumbnailSrc } from "@/components/video";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";
import { formatRelativeTime } from "@/domain/format";
import type { Playlist, VideoCard } from "@/domain/types";

/**
 * The "You" page — `/feed/you`.
 *
 * A profile header and four horizontal shelves. **No feed and no chips**
 * (R9 §7):
 *
 * ```
 * yt-page-header-view-model        1224 × 124
 *   avatar                          120 × 120        (avatar-size-legend)
 *   h1 «display name»               36px / 50px w700  @ avatar + 16px
 *   yt-content-metadata             «@handle • View channel»  14/20 #aaa
 *   two buttons  SizeS Tonal Mono   122.3 × 32  r16  «Switch account» ·
 *                                                    «Google Account»
 *
 * shelves, elements-per-row = 4:
 *   1 History        369.4   video lockups (Shorts mixed in, badged SHORTS)
 *   2 Playlists      369.4   playlist lockups (collection stack)
 *   3 Watch later    375.4   video lockups   + subtitle «N videos»
 *   4 Liked videos   375.4   video lockups   + subtitle «N videos»
 *
 * shelf header:
 *   #title       20 / 28  w700
 *   subtitle     «N videos»                (a second line, shelves 3–4)
 *   «View all»   80.7 × 40  r20  padding 0 15px  border 1px rgba(255,255,255,.2)
 *   prev / next  40 × 40    r20  same border, disabled colour #717171
 *   Playlists shelf only: a «+» icon button left of «View all»
 * ```
 *
 * ## Two divergences from that, both in the shelf header
 *
 * `components/video/shelf.tsx` renders its heading at the **15px/700** measured
 * on the *home* shelf, and its own comment records that the signed-in
 * `/feed/you` and `/feed/subscriptions` headings measure 20/28/700 instead —
 * two shelf headings at two sizes in one product. Its API is frozen and takes
 * `title: string`, so this page gets the 15px heading. The measured
 * **subtitle** («N videos» on a second line under the title) has nowhere to go
 * for the same reason, and is rendered beside "View all" instead of under the
 * title. Both are recorded rather than worked around by forking the shelf.
 *
 * ## The two account buttons are not built
 *
 * «Switch account» and «Google Account» are measured, and both name surfaces
 * that do not exist here: this application has one identity per session and no
 * external account page. A control that opens nothing is worse than an absent
 * one. «View channel» *is* built, because `/@handle` exists.
 *
 * ## `ensureSystemPlaylist` writes during a render, on purpose
 *
 * Watch later and Liked videos are created lazily — `repositories/playlists.ts`
 * explains why: sign-up belongs to another module, and "a rule enforced in two
 * places is a rule enforced in neither". The statement is
 * `insert … on conflict do nothing` guarded by a partial unique index, so two
 * requests racing to create the same one produce a conflict rather than a
 * second playlist. This page is the first surface that needs both, so it is
 * where they come into existence.
 */

export const metadata: Metadata = {
  title: "You",
};

/** Four visible per shelf; a few more so the arrows have somewhere to go. */
const SHELF_SIZE = 12;

export default async function YouPage() {
  const db = await database();
  const jar = await cookies();
  const session = await resolveSession(jar.get(SESSION_COOKIE)?.value ?? null);
  const viewerId = session?.userId ?? null;

  if (viewerId === null) {
    return (
      <div className="px-[var(--yt-page-inset)] pt-6 pb-16">
        <h1 className="m-0 text-[36px] leading-[50px] font-[var(--yt-weight-bold)] text-primary">
          You
        </h1>
        <p data-you-empty="signed-out" className="mt-6 text-body text-secondary">
          Sign in to see your history, your playlists and the videos you have
          liked.
        </p>
      </div>
    );
  }

  const channels = createChannelsRepository(db);
  const now = new Date();

  // The same identity resolution the watch page's comment composer uses: a
  // person's presence in this product is a *channel*, and the oldest one is the
  // one every other surface addresses them by.
  const channel = (await channels.listForOwner(viewerId))[0] ?? null;

  const [watchLaterId, likedId] = await Promise.all([
    ensureSystemPlaylist(db, viewerId, "watch_later"),
    ensureSystemPlaylist(db, viewerId, "liked"),
  ]);

  const [days, playlists, watchLater, liked] = await Promise.all([
    listHistory(db, viewerId, { limit: 60, now }),
    listPlaylists(db, viewerId),
    listPlaylistItems(db, watchLaterId, { viewerId, limit: SHELF_SIZE }),
    listPlaylistItems(db, likedId, { viewerId, limit: SHELF_SIZE }),
  ]);

  // The History shelf is a flat run of the most recent watches — the day
  // grouping is `/feed/history`'s, and R9 §7 shows no headings inside the
  // shelf.
  const history: VideoCard[] = days
    .flatMap((day) => day.items)
    .slice(0, SHELF_SIZE);

  const watchLaterCount =
    playlists.find((playlist) => playlist.id === watchLaterId)?.itemCount ?? 0;
  const likedCount =
    playlists.find((playlist) => playlist.id === likedId)?.itemCount ?? 0;

  return (
    <div className="px-[var(--yt-page-inset)] pt-6 pb-16">
      <header className="flex items-center">
        <Avatar
          size="legend"
          name={channel?.name ?? "You"}
          src={
            channel?.avatarKey == null ? null : thumbnailSrc(channel.avatarKey)
          }
          decorative={false}
        />
        {/* Avatar 120 + the measured 16px to the text column. */}
        <div className="ml-4 min-w-0">
          <h1 className="m-0 truncate text-[36px] leading-[50px] font-[var(--yt-weight-bold)] text-primary">
            {channel?.name ?? "You"}
          </h1>
          {channel === null ? null : (
            <p className="m-0 mt-0.5 text-body text-secondary">
              <span>@{channel.handle}</span>
              <span className="mx-1">•</span>
              <Link
                href={`/@${encodeURIComponent(channel.handle)}`}
                className="hover:text-primary"
              >
                View channel
              </Link>
            </p>
          )}
        </div>
      </header>

      <div className="mt-8 flex flex-col gap-8">
        <Shelf
          title="History"
          videos={history}
          itemsPerRow={4}
          now={now}
          action={<ShelfActions href="/feed/history" />}
        />

        <Shelf
          title="Playlists"
          itemsPerRow={4}
          action={
            <div className="flex items-center gap-2">
              {/* The «+» the Playlists shelf alone carries, left of «View all». */}
              <NewPlaylistButton>+ New</NewPlaylistButton>
              <ShelfActions href="/feed/playlists" />
            </div>
          }
        >
          {playlists.slice(0, SHELF_SIZE).map((playlist: Playlist) => (
            <PlaylistCard
              key={playlist.id}
              href={`/playlist?list=${encodeURIComponent(playlist.id)}`}
              title={playlist.title}
              itemCount={playlist.itemCount}
              visibility={playlist.visibility}
              kind={playlist.kind}
              updatedLabel={`Updated ${formatRelativeTime(playlist.updatedAt, now)}`}
              coverUrl={
                playlist.thumbnailKey === null
                  ? null
                  : thumbnailSrc(playlist.thumbnailKey)
              }
            />
          ))}
        </Shelf>

        <Shelf
          title="Watch later"
          videos={watchLater}
          itemsPerRow={4}
          now={now}
          action={<ShelfActions href="/playlist?list=WL" count={watchLaterCount} />}
        />

        <Shelf
          title="Liked videos"
          videos={liked}
          itemsPerRow={4}
          now={now}
          action={<ShelfActions href="/playlist?list=LL" count={likedCount} />}
        />
      </div>
    </div>
  );
}

/**
 * A shelf's trailing controls.
 *
 * «View all» is measured as an **outlined** button — a Text button plus
 * `border: 1px solid rgba(255,255,255,0.2)` and `padding: 0 15px`, the 15 being
 * a real measurement rather than a rounding: the border eats a pixel and the
 * product compensates. `Button`'s `outline` variant already carries both.
 *
 * The prev/next pair R9 lists beside it belongs to `Shelf`, which renders its
 * own arrows with the same outline variant.
 *
 * The «N videos» count is the measured *subtitle* of shelves 3 and 4, which the
 * frozen `Shelf` API has no slot for — see the page comment.
 */
function ShelfActions({ href, count }: { href: string; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      {count === undefined ? null : (
        <span className="text-body text-secondary">
          {`${count} ${count === 1 ? "video" : "videos"}`}
        </span>
      )}
      <ButtonLink variant="outline" size="m" href={href}>
        View all
      </ButtonLink>
    </div>
  );
}
