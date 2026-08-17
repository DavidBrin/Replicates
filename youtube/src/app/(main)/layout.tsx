import { cookies } from "next/headers";

import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { listSubscriptions } from "@/adapters/repositories/subscriptions";
import { createUsersRepository } from "@/adapters/repositories/users";
import { AppShell } from "@/components/layout/app-shell";
import type { GuideSubscription } from "@/components/layout/guide";
import { thumbnailSrc } from "@/components/video";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth";

/**
 * The shell every browse surface renders inside.
 *
 * `(main)` is a route group, so it adds nothing to any URL: `/`,
 * `/feed/subscriptions`, `/feed/channels` and every later surface — search,
 * channel pages, playlists — are what they were, and they get the masthead,
 * the guide rail and the content column for free. `/watch` and `/studio` sit
 * outside it deliberately: the watch page's own layout is two columns that
 * theatre mode rearranges, and Studio is a different application with a 64px
 * masthead and a 248px rail (R9 §12).
 *
 * ## What this layout is for
 *
 * `AppShell` is a client component — the rail's mode depends on the viewport
 * and on the user's toggle — so it cannot read a cookie or a database. This is
 * the server half: it resolves the session and loads the two things the chrome
 * needs per viewer, the guide's subscription list and the account's name and
 * picture. Everything it hands over is a plain value.
 *
 * ## The rail's active row is missing, and it is worth saying why
 *
 * `AppShell` takes an `activePath` and highlights the matching guide entry.
 * A **server** layout has no pathname: `usePathname` is a client hook, and
 * Next's client router preserves a shared layout across navigations rather
 * than re-rendering it, so even a header read on the first request would go
 * stale the moment anyone clicked `Subscriptions`.
 *
 * The fix is one line in the wrong file — a `"use client"` wrapper that calls
 * `usePathname()` and passes it down, which belongs beside `AppShell` in
 * `src/components/layout/`, a directory this slice was told not to modify.
 * Until then the empty string is passed rather than the default `/`: nothing
 * matches it, so the rail highlights nothing. That is a missing affordance,
 * where the default would be an actively wrong one — a rail insisting you are
 * on Home while you read `/feed/subscriptions`.
 *
 * The masthead's search box has the same shape of gap: `onSubmitQuery` is a
 * callback, so a server layout cannot supply it, and the search slice owns
 * where a query goes.
 */

export const dynamic = "force-dynamic";

/** See the header. Empty rather than `/`, deliberately. */
const NO_ACTIVE_PATH = "";

export default async function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const chrome = await loadChrome();

  return (
    <AppShell
      signedIn={chrome.account !== null}
      activePath={NO_ACTIVE_PATH}
      subscriptions={chrome.subscriptions}
      account={chrome.account ?? undefined}
    >
      {children}
    </AppShell>
  );
}

interface Chrome {
  readonly account: { readonly name: string; readonly avatarUrl: string | null } | null;
  readonly subscriptions: readonly GuideSubscription[];
}

/**
 * Everything the chrome needs, or the signed-out shape of it.
 *
 * A signed-out viewer costs one session lookup and nothing else:
 * `listSubscriptions` short-circuits on a null subscriber rather than running a
 * query that matches nothing, so the branch below is about not asking for a
 * user record and a channel that cannot exist.
 *
 * The account's picture comes from the viewer's **channel**, not from the user
 * row — `users` has no avatar column, because in this schema a picture belongs
 * to a channel and a user may own more than one. The first is used, which is
 * the same choice Studio's `studioContext` makes and the same one the product
 * makes when it puts a single avatar in the masthead.
 */
async function loadChrome(): Promise<Chrome> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  const session = await resolveSession(token);
  if (!session) return { account: null, subscriptions: [] };

  const db = await database();
  const [user, channels, subscriptions] = await Promise.all([
    createUsersRepository(db).findById(session.userId),
    createChannelsRepository(db).listForOwner(session.userId),
    listSubscriptions(db, session.userId),
  ]);

  const own = channels[0];

  return {
    account: {
      // A session whose user row has been deleted resolves — the `sessions`
      // row is the grant, and nothing cascades it — so the name has a
      // fallback rather than an assertion. "You" is what the watch page uses
      // for the same case.
      name: user?.displayName ?? own?.name ?? "You",
      avatarUrl: own?.avatarKey ? thumbnailSrc(own.avatarKey) : null,
    },
    subscriptions: subscriptions.map(
      (channel): GuideSubscription => ({
        id: channel.id,
        name: channel.name,
        // `Channel.handle` is stored without the `@`, and `/@handle` is the
        // URL the card family already builds (`video-card.tsx`).
        href: `/@${encodeURIComponent(channel.handle)}`,
        avatarUrl: channel.avatarKey ? thumbnailSrc(channel.avatarKey) : null,
      }),
    ),
  };
}
