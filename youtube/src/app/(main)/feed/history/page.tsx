import { cookies } from "next/headers";
import type { Metadata } from "next";

import { database } from "@/adapters/db";
import { listHistory } from "@/adapters/repositories/history";
import { HistoryControls, HistoryList, historyRowMenu } from "@/components/history";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";

/**
 * Watch history — `/feed/history`.
 *
 * ## The two-column shape is this page's alone
 *
 * R9 §6: `/feed/history` is the only browse page with a **persistent right
 * rail** — `#primary` at 1070 wide with `padding-right: 441px`, and
 * `#secondary` 441 wide holding the search field and the three history
 * actions. Every other browse surface is a single column.
 *
 * ## Grouping, and the time zone it depends on
 *
 * `listHistory` groups in TypeScript rather than with `date_trunc`, and its
 * header explains why: a watch at 23:30 in New York is 03:30 the next day in
 * UTC, so SQL-side truncation files half of everyone's evening under tomorrow.
 * Doing it correctly in SQL would need `at time zone` with an IANA name and the
 * full tz database, which Neon has and PGlite's base bundle does not promise.
 *
 * **The zone this page passes is `UTC`, and that is a known gap.** The viewer's
 * real zone is a client fact — `Intl.DateTimeFormat().resolvedOptions()` — and
 * there is no cookie carrying it. Reading it on the client and re-grouping
 * would mean shipping the ungrouped list and regrouping after hydration, which
 * is a second implementation of the rule the repository owns. Passing UTC is
 * wrong by up to a day boundary for viewers far from Greenwich and is at least
 * *consistently* wrong, which is the failure mode that can be fixed in one
 * place once something issues a zone.
 *
 * ## Signed out
 *
 * `listHistory` returns `[]` rather than throwing — its header calls that "the
 * honest answer", because the page is reachable while signed out.
 * {@link HistoryList} renders a sign-in prompt for that case, which is a
 * different empty state from "you have watched nothing".
 */

export const metadata: Metadata = {
  title: "Watch history",
};

/**
 * How many *events* to read — not how many cards come back.
 *
 * A video watched three times in a day is three events and one card, so the
 * repository over-reads deliberately; 200 is its own default and is roughly a
 * fortnight of ordinary use.
 */
const EVENT_LIMIT = 200;

export default async function HistoryPage() {
  const db = await database();
  const jar = await cookies();
  const session = await resolveSession(jar.get(SESSION_COOKIE)?.value ?? null);
  const viewerId = session?.userId ?? null;

  const now = new Date();
  const days = await listHistory(db, viewerId, {
    limit: EVENT_LIMIT,
    timeZone: "UTC",
    now,
  });

  return (
    <div className="flex gap-6 px-[var(--yt-page-inset)] pt-6 pb-16">
      <div className="min-w-0 flex-1">
        {/* `yt-page-header-view-model > h1` — 36/50 w700 (R9 §6). */}
        <h1 className="m-0 text-[36px] leading-[50px] font-[var(--yt-weight-bold)] text-primary">
          Watch history
        </h1>

        {/*
          The 5-chip cloud — `All · Videos · Shorts · Podcasts · Music` at 32px
          with an 8px gap — is measured but not built: `Podcasts` and `Music`
          need a category this schema does not record on a watch event, and
          `Videos`/`Shorts` would be two working chips beside two that lie. The
          reel shelf R9 describes inside each day section is absent for the
          same reason the Shorts card is on the channel page: it is a 2:3 card
          the shared lockup does not render.
        */}

        <HistoryList
          days={days}
          signedIn={viewerId !== null}
          now={now}
          rowMenu={historyRowMenu()}
        />
      </div>

      <HistoryControls signedIn={viewerId !== null} />
    </div>
  );
}
