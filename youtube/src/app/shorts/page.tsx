import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { database } from "@/adapters/db";
import { shortsFeed } from "@/adapters/repositories/recommendations";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";

/**
 * `/shorts` — which is not a page so much as an entry point.
 *
 * The product's `youtube.com/shorts` lands on a *specific* short and the
 * address bar says so immediately; there is no URL that means "the Shorts feed
 * in general". That is not cosmetic. Every short has to be a shareable link,
 * Back has to walk the feed, and a reload has to return to the same video —
 * all three of which need an id in the path, so this route resolves one and
 * redirects rather than rendering a second copy of the feed at a second URL.
 *
 * The redirect is to the **first item of the personalised feed**, which is what
 * `shortsFeed` is for. `src/app/shorts/[id]/page.tsx` then re-reads that same
 * feed and puts the requested id at its head; the duplicated query is one
 * indexed read on a page that renders nothing, and the alternative — passing
 * the resolved feed forward — would mean either a session-scoped cache or a
 * query string carrying twenty ids.
 *
 * The one case that does not redirect is an empty corpus. Research §5's
 * cold-start note applies here more than anywhere: the Shorts feed backfills
 * newest-first precisely because a young corpus has no co-visits yet, so an
 * empty result means there are genuinely no shorts, not that the graph is thin.
 */

export default async function ShortsIndexPage() {
  const db = await database();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
  const session = await resolveSession(token);

  const feed = await shortsFeed(
    // `sessionKey` has no issuer in this application yet — the watch page
    // documents the same gap. The token is a stable per-viewer value where
    // there is one; the literal is an honest single shared bucket for everyone
    // else, and it only feeds an exclusion that is a no-op on an empty graph.
    { userId: session?.userId ?? null, sessionKey: token ?? "anonymous" },
    db,
  );

  const first = feed[0];
  if (first === undefined) {
    return (
      <div
        data-shorts-empty=""
        className="grid h-full place-items-center px-4 text-center text-secondary"
      >
        <div>
          <p className="text-shelf text-primary">No Shorts yet</p>
          <p className="mt-2 text-body">
            A video becomes a Short when it is square or taller and no longer than
            three minutes.
          </p>
        </div>
      </div>
    );
  }

  // Kept literal rather than importing `shortHref`: that helper lives in a
  // `"use client"` module, and a redirect-only route has no reason to pull the
  // pager's bundle into its client reference manifest. The two must agree, and
  // the pager's copy is the definition.
  redirect(`/shorts/${encodeURIComponent(first.id)}`);
}
