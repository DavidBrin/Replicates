import { Suspense } from "react";

import { database } from "@/adapters/db";
import { homeFeed, shortsFeed } from "@/adapters/repositories/recommendations";
import { listSubscriptions } from "@/adapters/repositories/subscriptions";
import { FeedSkeleton, HomeFeed, chipsForFeed } from "@/components/feed";
import { currentViewer } from "@/lib/viewer";

/**
 * `/` — the home feed.
 *
 * ## Where the grid comes from
 *
 * `recommendations.ts`, not `videos.ts`. There are two functions that could
 * fill this page and only one of them is the product's: `listHomeFeed` is the
 * catalogue newest-first, while `homeFeed` is D11's co-visitation graph —
 * seeded from the viewer's last ten distinct watches, expanded two hops,
 * capped per channel, and **backfilled from the most-viewed pool on every
 * call**, not only when personalisation returns nothing.
 *
 * That backfill is why this page is non-empty for a viewer who has never
 * watched anything and on a database seeded five seconds ago. Research §5's
 * reframing is that on a young corpus the cold-start path *is* the path, and
 * the repository is built around it; nothing here has to detect the case or
 * branch on it. R9 §4's "the grid is a recommendation feed rather than a
 * trending fallback" therefore falls out of the same call for both viewers —
 * the seed set is empty signed out, so the fallback is what is left.
 *
 * ## Shorts
 *
 * Two calls, because the two feeds are two surfaces with different rules:
 * `shortsFeed` seeds from the last five *shorts* rather than the last ten
 * videos and backfills newest-first rather than most-viewed, which research §7
 * argues for on the grounds that a healthy Shorts corpus is disproportionately
 * new. `homeFeed` does not exclude shorts — neither its expansion nor its
 * fallback pool passes `shortsOnly` — so vertical videos can and do appear in
 * its result, and they are filtered out here.
 *
 * Filtering after the fetch is the thing `videos.ts` opens by warning about:
 * `listHomeFeed` excludes shorts in SQL precisely so a page size of forty
 * renders forty. The honest fix is a `shortsOnly: false` option on `homeFeed`,
 * which is a change in `adapters/repositories/`, a directory this slice does
 * not own. On a corpus with six shorts in twenty-four videos the shortfall is
 * small and visible; on a large one it would not be, so it is written down
 * rather than absorbed.
 *
 * ## Streaming
 *
 * The queries sit under a `<Suspense>` so the masthead, the rail and the chip
 * bar's box paint immediately. `force-dynamic` because every one of these
 * reads is per-viewer: a cached home page is somebody else's recommendations.
 */

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <HomeFeedSection />
    </Suspense>
  );
}

async function HomeFeedSection() {
  const viewer = await feedViewer();
  const db = await database();

  const [recommended, shorts, subscriptions] = await Promise.all([
    homeFeed(viewer, db),
    shortsFeed(viewer, db),
    listSubscriptions(db, viewer.userId),
  ]);

  const grid = recommended.filter((video) => !video.isShort);

  return (
    <HomeFeed
      videos={grid}
      shorts={shorts}
      chips={chipsForFeed(grid, {
        // R9 §4's "personalised topic chips derived from watch history",
        // expressed with what this application actually knows about a viewer.
        promoteChannelIds: subscriptions.map((channel) => channel.id),
      })}
      signedIn={viewer.userId !== null}
      // One clock for the whole page. Left to default, the server and the
      // client each call `new Date()` and a card straddling a "1 hour ago"
      // boundary hydrates as a mismatch.
      now={new Date()}
    />
  );
}

/**
 * Who is asking — now one function, in `src/lib/viewer/`.
 *
 * This was written out by hand in each of this slice's three pages, on the
 * argument that *"a `viewer()` helper belongs in `src/lib/auth/`, which this
 * slice does not own"*. The reasoning about ownership was fine and the
 * consequence was not: four copies of the same object, and all four carried the
 * same `sessionKey: token ?? "anonymous"` fallback — a single grouping key
 * shared by every signed-out visitor.
 *
 * That fallback existed because nothing issued a per-visitor cookie.
 * `src/proxy.ts` now does, and the alias below is kept only so that this
 * file's three call sites read as they did.
 */
const feedViewer = currentViewer;
