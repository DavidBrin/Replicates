import type { VideoCard } from "@/domain/types";

/**
 * URL builders — server-safe by construction.
 *
 * These are pure string functions, and they lived in `thumbnail.tsx` and
 * `video-card.tsx`, both of which carry `"use client"`. Next turns **every**
 * export of a client module into a client *reference*, so a server component
 * calling one threw:
 *
 *   Attempted to call thumbnailSrc() from the server but thumbnailSrc is on
 *   the client.
 *
 * That single function broke ten server routes — the watch page, search
 * results, playlists, the channel page, the You page, the shorts pages, and
 * the shared `(main)` layout — because building a media URL is exactly the
 * kind of thing a server component does while assembling props.
 *
 * This was the fifth instance of the same shape in this project, after
 * `THEME_ATTRIBUTE`, `chipsForFeed`, `historyRowMenu` and the barrel that
 * re-exported `chipsForFeed` *through* a client module. Together they make the
 * rule and its corollary:
 *
 *   1. A value or plain function a server component needs must not live in a
 *      `"use client"` module, however naturally it belongs there by topic.
 *   2. A barrel must forward it from the module that *defines* it, not from
 *      whichever module happens to re-export it — forwarding through a client
 *      module does not launder the boundary.
 *
 * None of this is visible to unit tests, which import modules directly and
 * never cross the boundary, and the first four hid behind `<Suspense>`
 * fallbacks in development. Only a production build with real data surfaced
 * them.
 */

/**
 * A blob key as a URL the browser can fetch.
 *
 * Each path segment is encoded separately so the slashes that structure the key
 * survive: `encodeURIComponent` on the whole string would turn
 * `videos/abc/thumb.jpg` into one escaped segment that matches no route.
 */
export function thumbnailSrc(key: string): string {
  return `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function watchHref(video: VideoCard): string {
  return `/watch?v=${encodeURIComponent(video.id)}`;
}

/** `/@handle` — `Channel.handle` is stored without the `@` (`domain/types.ts`). */
export function channelHrefFor(video: VideoCard): string {
  return `/@${encodeURIComponent(video.channelHandle)}`;
}

export function shortHref(id: string): string {
  return `/shorts/${encodeURIComponent(id)}`;
}
