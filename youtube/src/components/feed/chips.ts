import type { VideoCard } from "@/domain/types";

/**
 * The chip bar's data — server-safe by construction.
 *
 * Everything here was previously exported from `chip-bar.tsx` or
 * `home-feed.tsx`, both of which carry a `"use client"` directive. Next turns
 * **every** export of a client module into a client *reference*, including
 * plain constants and pure functions, so the server-rendered home page calling
 * `chipsForFeed` threw:
 *
 *   Attempted to call chipsForFeed() from the server but chipsForFeed is on
 *   the client.
 *
 * Unit tests cannot see this — they import the module directly and never cross
 * the boundary — and in development a `<Suspense>` boundary swallowed it into
 * a fallback. It surfaced only as a 500 from a production build.
 *
 * This is the third instance of the same shape in this project, after
 * `THEME_ATTRIBUTE` and `historyRowMenu`, which is enough to state it as a
 * rule: **a value or plain function a server component needs must not live in
 * a `"use client"` module**, however naturally it belongs there by topic. The
 * client modules import these back, so nothing that already read them from
 * their old homes had to change.
 */

export interface FeedChip {
  readonly id: string;
  readonly label: string;
  readonly videoIds?: readonly string[];
}

/**
 * The always-present first chip. It carries no `videoIds`, which is what makes
 * it an ordinary chip to the filter rather than a special case: "no membership
 * list" and "matches every card" are the same thing to the consumer.
 */
export const ALL_CHIP_ID = "all";
export const ALL_CHIP_LABEL = "All";

/** Including "All". The bar scrolls, but not without limit. */
export const MAX_FEED_CHIPS = 25;

/**
 * Group a feed into filter chips.
 *
 * The product's chips are topics. These group by **channel**, because that is
 * the only taxonomy a `VideoCard` carries — `videos.category` and `video_tags`
 * both exist in the schema, and `domain/types.ts` deliberately holds a card to
 * "what a feed row needs and nothing more". The labels therefore read as
 * channel names rather than topic nouns, which is the visible difference; the
 * mechanism — a label, a membership, a filter — is the product's, and swapping
 * the derivation for categories later is a change to this function alone.
 *
 * `promoteChannelIds` is the personalisation R9 §4 describes: a viewer's own
 * subscriptions come first, everything else by how much of the feed it
 * accounts for. Signed out the set is empty and the order is purely
 * contribution — the same "trending rather than personalised" distinction the
 * grid itself makes.
 */
export function chipsForFeed(
  videos: readonly VideoCard[],
  options: { readonly promoteChannelIds?: readonly string[] } = {},
): FeedChip[] {
  const promoted = new Set(options.promoteChannelIds ?? []);

  const groups = new Map<string, { label: string; videoIds: string[] }>();
  for (const video of videos) {
    const group = groups.get(video.channelId);
    if (group) {
      group.videoIds.push(video.id);
      continue;
    }
    groups.set(video.channelId, {
      label: video.channelName,
      videoIds: [video.id],
    });
  }

  // A bar of "All" plus one chip filters nothing — every chip would show the
  // whole feed — so it is not drawn at all. `HomeFeed` reads the empty array
  // as "no bar", which is also the honest answer for an empty corpus.
  if (groups.size < 2) return [];

  const ranked = [...groups.entries()]
    .map(([channelId, group]) => ({ channelId, ...group }))
    .sort((a, b) => {
      const aPromoted = promoted.has(a.channelId);
      const bPromoted = promoted.has(b.channelId);
      if (aPromoted !== bPromoted) return aPromoted ? -1 : 1;
      if (a.videoIds.length !== b.videoIds.length) {
        return b.videoIds.length - a.videoIds.length;
      }
      // Terminated on a total key, for the reason every ordering in this
      // project is: a comparator that returns 0 for two rows leaves their
      // order to the engine's sort, and the chip bar would reshuffle itself
      // between two renders of the same feed.
      return a.channelId < b.channelId ? -1 : 1;
    });

  return [
    { id: ALL_CHIP_ID, label: ALL_CHIP_LABEL },
    ...ranked.slice(0, MAX_FEED_CHIPS - 1).map((group) => ({
      id: group.channelId,
      label: group.label,
      videoIds: group.videoIds,
    })),
  ];
}
