import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { listCardsByIds } from "@/adapters/repositories/videos";
import { searchIndex } from "@/adapters/search";
import { thumbnailSrc } from "@/components/video";
import {
  PAGE_SIZE,
  SearchFilterPanel,
  SearchResults,
  parseSearchQuery,
  searchFilters,
  type SearchResultItem,
} from "@/components/search";
import type { SearchHit } from "@/ports/search-index";

/**
 * `/results` — the search results page.
 *
 * Measured layout (R8 §3.6, `extracted/search-and-breakpoints.json`):
 * `ytd-search` carries `padding: 0 24px 16px`, the two-column wrapper is
 * capped at 1280, and `#primary` is 855 wide with `max-width: 1250px`. The
 * second column in `screenshots/08-search-results-1920.png` is an ad unit and
 * a TV-series knowledge panel; neither exists here, so `#primary` is the whole
 * column and takes the measured 855px cap.
 *
 * The route group is `(main)`, whose layout is another slice's and wraps this
 * in `AppShell` — the masthead, the guide rail and the content column all come
 * from there. Nothing about the shell is repeated here.
 *
 * ## Hydration, and the order it must not lose
 *
 * The index returns `{ id, kind, score, highlight }` and nothing else, so the
 * rows have to be fetched. Two facts shape how:
 *
 * **Rank is in the hit order and nowhere else.** `listCardsByIds` preserves the
 * order of the ids it is given — it says so, and its `array_position` ordering
 * is there for exactly this caller — but the two kinds have to be fetched
 * separately and then interleaved back into one list. So the rows are collected
 * into a map and re-emitted by walking `results.hits`, which is the only
 * sequence that carries the ranking.
 *
 * **A hit can outlive its row.** The index is written on publish and on edit;
 * a video that has since been made private, or deleted without a reindex, is
 * still a hit and has no card. Those are dropped rather than rendered as a
 * placeholder — and dropping them is why the empty-page case has to be real
 * rather than theoretical, since a page of results can hydrate to nothing.
 *
 * `total` is not adjusted for the drops. It is the index's count and the port
 * documents it as an estimate; recomputing it from what survived hydration
 * would make page 2 claim a different total from page 1.
 *
 * ## The channels are fetched one at a time, deliberately
 *
 * There is no `listChannelsByIds` in `adapters/repositories/channels.ts` and
 * this slice does not own that file. The count is bounded by {@link PAGE_SIZE}
 * — 20 primary-key lookups in the worst case, issued together — and adding raw
 * SQL to a page to avoid them would put the channel projection in two places,
 * which `src/app/studio/page.tsx` already records as the worse trade.
 */

export const dynamic = "force-dynamic";

interface ResultsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  // Next hands a page a plain record; `parseSearchQuery` reads the
  // `URLSearchParams` interface, which is what the filter panel and the API
  // route both have. A repeated parameter takes its first value — the last one
  // would be equally arbitrary, and neither is a case a link this application
  // writes can produce.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) params.set(key, value[0]);
  }

  const state = parseSearchQuery(params);
  const now = new Date();
  const filters = searchFilters(state, now);

  const index = await searchIndex();
  const results = await index.query({
    text: state.text,
    ...(filters === undefined ? {} : { filters }),
    sort: state.sort,
    limit: PAGE_SIZE,
    offset: (state.page - 1) * PAGE_SIZE,
  });

  const items = await hydrate(results.hits);

  return (
    // `padding: 0 24px 16px`, measured on `ytd-search`.
    <div className="px-6 pb-4">
      <div className="mx-auto max-w-[1280px]">
        <div className="max-w-[855px]">
          <SearchFilterPanel state={state} />
          <SearchResults
            state={state}
            total={results.total}
            items={items}
            now={now}
            className="mt-4"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Hits → rows, in hit order.
 *
 * The two fetches are issued together rather than in sequence: they touch
 * different tables and neither depends on the other, so serialising them would
 * add a round trip to every search for no reason.
 */
async function hydrate(
  hits: readonly SearchHit[],
): Promise<readonly SearchResultItem[]> {
  if (hits.length === 0) return [];

  const db = await database();
  const videoIds = hits.filter((hit) => hit.kind === "video").map((hit) => hit.id);
  const channelIds = hits
    .filter((hit) => hit.kind === "channel")
    .map((hit) => hit.id);

  const channels = createChannelsRepository(db);
  const [cards, resolved] = await Promise.all([
    listCardsByIds(db, videoIds),
    Promise.all(channelIds.map((id) => channels.findById(id))),
  ]);

  const cardById = new Map(cards.map((card) => [card.id, card]));
  const channelById = new Map(
    resolved
      .filter((channel) => channel !== null)
      .map((channel) => [channel.id, channel]),
  );

  const items: SearchResultItem[] = [];
  for (const hit of hits) {
    if (hit.kind === "video") {
      const video = cardById.get(hit.id);
      // Indexed but no longer visible — see the header. Dropped, not stubbed.
      if (video === undefined) continue;
      items.push({ kind: "video", video, highlight: hit.highlight });
      continue;
    }

    if (hit.kind === "channel") {
      const channel = channelById.get(hit.id);
      if (channel === undefined) continue;
      items.push({
        kind: "channel",
        highlight: hit.highlight,
        channel: {
          id: channel.id,
          handle: channel.handle,
          name: channel.name,
          // The row takes a URL rather than a storage key: it is a plain
          // component and has no business knowing that blobs are served from
          // `/api/media`.
          avatarUrl:
            channel.avatarKey === null ? null : thumbnailSrc(channel.avatarKey),
          verified: channel.verified,
          subscriberCount: channel.subscriberCount,
          videoCount: channel.videoCount,
          description: channel.description,
        },
      });
      continue;
    }

    // `playlist` is the third `SearchDocumentKind` and nothing indexes one
    // (`scripts/seed.ts` writes videos and channels). Skipped rather than
    // rendered as an unknown row, and `RESULT_TYPES` offers no filter for it
    // for the same reason.
  }

  return items;
}
