import { cookies } from "next/headers";
import type { Metadata } from "next";

import { database } from "@/adapters/db";
import { listPlaylists } from "@/adapters/repositories/playlists";
import { NewPlaylistButton, PlaylistCard } from "@/components/playlist";
import { thumbnailSrc } from "@/components/video";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";
import { formatRelativeTime } from "@/domain/format";

/**
 * The playlists index — `/feed/playlists`.
 *
 * ```
 * h1                     36px / 50px  w700
 * chip cloud, 4 chips    «Recently added» · Playlists · Music · Owned
 *      chip 0 is SELECTED but rendered inactive-styled, with a trailing
 *      chevron — it is a SORT chip, not a filter chip
 * ytd-rich-grid-renderer --ytd-rich-grid-items-per-row = 4   (a hard 4, not
 *                        the container-derived count the video feed uses)
 * ```
 *
 * (R9 §8.1.)
 *
 * ## The chips are not built, and that is the honest choice
 *
 * `Music` needs a genre classification this schema does not carry, `Owned`
 * needs playlists you follow but do not own — and there is no follow table —
 * and the sort chip's own menu was never opened in the capture, so its options
 * are unknown. Rendering four chips of which one works would be four
 * affordances and one behaviour. `listPlaylists` orders by `updated_at desc`,
 * which is the "Recently added" the selected chip names, so the default sort is
 * the measured one; the controls that change it are absent rather than fake.
 *
 * ## Signed out
 *
 * `listPlaylists` returns `[]` for a null owner rather than throwing, and the
 * page renders a sign-in prompt beside it — the same shape `listHistory` and
 * `listSubscriptionFeed` take, for the reason their headers give: these pages
 * are reachable while signed out and an error is the wrong answer to "you have
 * none".
 */

export const metadata: Metadata = {
  title: "Playlists",
};

export default async function PlaylistsIndexPage() {
  const db = await database();
  const jar = await cookies();
  const session = await resolveSession(jar.get(SESSION_COOKIE)?.value ?? null);
  const viewerId = session?.userId ?? null;

  const playlists = await listPlaylists(db, viewerId);
  const now = new Date();

  return (
    <div className="px-[var(--yt-page-inset)] pt-6 pb-16">
      <div className="flex items-center justify-between">
        {/* `yt-page-header-view-model > h1` — 36/50 w700 on every one of the
            signed-in browse pages (R9 §5.2, §6, §7, §8.1). */}
        <h1 className="m-0 text-[36px] leading-[50px] font-[var(--yt-weight-bold)] text-primary">
          Playlists
        </h1>
        {viewerId === null ? null : <NewPlaylistButton />}
      </div>

      {viewerId === null ? (
        <div data-playlists-empty="signed-out" className="mt-8">
          <p className="m-0 text-title text-primary">Save what you want to watch</p>
          <p className="m-0 mt-2 text-body text-secondary">
            Playlists are saved to your account. Sign in to see them here.
          </p>
        </div>
      ) : playlists.length === 0 ? (
        <div data-playlists-empty="none" className="mt-8">
          <p className="m-0 text-title text-primary">No playlists yet</p>
          <p className="m-0 mt-2 text-body text-secondary">
            Playlists you create will show up here.
          </p>
        </div>
      ) : (
        <div
          data-playlists-grid=""
          className="mt-6 grid gap-4"
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
              // R9 §8.1: the `Updated N days ago` row is on **owned playlists
              // only**, and every playlist on this page is the viewer's own.
              updatedLabel={`Updated ${formatRelativeTime(playlist.updatedAt, now)}`}
              coverUrl={
                playlist.thumbnailKey === null
                  ? null
                  : thumbnailSrc(playlist.thumbnailKey)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
