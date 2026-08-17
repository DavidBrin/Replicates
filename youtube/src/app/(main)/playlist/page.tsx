import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { database } from "@/adapters/db";
import {
  ensureSystemPlaylist,
  getPlaylist,
  listPlaylistItems,
} from "@/adapters/repositories/playlists";
import { PlaylistItemList, PlaylistPanel } from "@/components/playlist";
import { thumbnailSrc } from "@/components/video";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";
import { formatRelativeTime } from "@/domain/format";

/**
 * The playlist detail page — `/playlist?list=<id>`.
 *
 * The query string is the product's URL and the one R9 §8.2 was measured
 * against (`?list=WL`), so every card and every menu row in this application
 * can point at it without a rewrite.
 *
 * ## `WL` and `LL`
 *
 * YouTube addresses the two system playlists by fixed ids rather than by the
 * owner's row id, which is what makes `?list=WL` mean "my Watch later" for
 * everyone. Both aliases are resolved here through `ensureSystemPlaylist`,
 * which creates the row on first use — lazily, because sign-up belongs to
 * another module and "a rule enforced in two places is a rule enforced in
 * neither" (`repositories/playlists.ts`). Signed out, the aliases name nothing
 * and the page is a 404 rather than an error.
 *
 * ## Layout
 *
 * R9 §8.2: the page **inverts** the usual arrangement — a sticky immersive
 * panel on the left (360 wide, `margin-left: 24px`) and the video list on the
 * right (884 wide at x=628, i.e. the two-column renderer's `padding-left` is
 * 388). It is the only browse page that puts its rail first.
 */

export const metadata: Metadata = {
  title: "Playlist",
};

/** `listPlaylistItems` caps at 200 by default; the panel's count is the truth. */
const PAGE_SIZE = 200;

/** The product's stable ids for the two playlists every account has. */
const SYSTEM_ALIASES = {
  WL: "watch_later",
  LL: "liked",
} as const;

export default async function PlaylistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const raw = search.list;
  const listParam = Array.isArray(raw) ? raw[0] : raw;
  if (listParam === undefined || listParam.length === 0) notFound();

  const db = await database();
  const jar = await cookies();
  const session = await resolveSession(jar.get(SESSION_COOKIE)?.value ?? null);
  const viewerId = session?.userId ?? null;

  const alias = SYSTEM_ALIASES[listParam as keyof typeof SYSTEM_ALIASES];
  if (alias !== undefined && viewerId === null) notFound();
  const playlistId =
    alias === undefined
      ? listParam
      : await ensureSystemPlaylist(db, viewerId as string, alias);

  const playlist = await getPlaylist(db, playlistId);
  if (playlist === null) notFound();

  const owned = viewerId !== null && playlist.ownerId === viewerId;
  // A private playlist is nobody's but its owner's. The same rule the watch
  // page applies to a private video, for the same reason: without it the
  // title, the item list and every thumbnail are readable by anyone with the
  // id.
  if (playlist.visibility === "private" && !owned) notFound();

  const items = await listPlaylistItems(db, playlist.id, {
    viewerId,
    limit: PAGE_SIZE,
  });
  const now = new Date();
  const first = items[0];

  return (
    <div className="flex gap-6 px-[var(--yt-page-inset)] pt-6 pb-16">
      <PlaylistPanel
        playlistId={playlist.id}
        title={playlist.title}
        ownerName={playlist.ownerName}
        visibility={playlist.visibility}
        kind={playlist.kind}
        itemCount={playlist.itemCount}
        // See the prop's own note: the measured line reads `No views` on a
        // playlist of heavily-viewed videos, so this is the playlist's counter
        // and this schema has none.
        viewCount={0}
        updatedLabel={`Updated ${formatRelativeTime(playlist.updatedAt, now)}`}
        artworkUrl={
          playlist.thumbnailKey === null ? null : thumbnailSrc(playlist.thumbnailKey)
        }
        playAllHref={
          first === undefined
            ? null
            : `/watch?v=${encodeURIComponent(first.id)}&list=${encodeURIComponent(playlist.id)}`
        }
        // Shuffle points at the same first item: choosing a random one on the
        // server would make the page non-deterministic between the render and
        // its own cache, and there is no client shuffle state to hand off to.
        // The affordance is measured; the randomisation is not built, which is
        // visible rather than hidden.
        shuffleHref={
          first === undefined
            ? null
            : `/watch?v=${encodeURIComponent(first.id)}&list=${encodeURIComponent(playlist.id)}&shuffle=1`
        }
        editable={owned}
      />

      <div className="min-w-0 flex-1">
        <PlaylistItemList
          playlistId={playlist.id}
          kind={playlist.kind}
          items={items}
          editable={owned}
          now={now}
        />
      </div>
    </div>
  );
}
