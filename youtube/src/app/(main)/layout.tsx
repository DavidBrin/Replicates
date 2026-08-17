import { MainChrome } from "./main-chrome";
import { loadChrome } from "../chrome";

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
 * ## The rail's active row
 *
 * `AppShell` takes an `activePath` and highlights the matching guide entry. A
 * **server** layout has no pathname, so this passed the empty string and the
 * rail highlighted nothing — a missing affordance, chosen over the actively
 * wrong one of a rail insisting you are on Home while you read
 * `/feed/subscriptions`.
 *
 * The note here called the fix "one line in the wrong file", and it is:
 * `./main-chrome.tsx`, a client wrapper that reads `usePathname()`. Written
 * now, because "the directory this slice was told not to modify" stopped
 * being a constraint once the slices were done.
 *
 * The masthead's search box had the same shape of gap and no longer does.
 * `onSubmitQuery` is a callback, which a server layout genuinely cannot hand
 * across the RSC boundary — but the answer is a thin client wrapper, not an
 * omission, and leaving it out meant pressing Enter in the search field did
 * nothing on every route in this group. `MainChrome` supplies it.
 */

export const dynamic = "force-dynamic";

export default async function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const chrome = await loadChrome();

  return (
    <MainChrome
      signedIn={chrome.account !== null}
      subscriptions={chrome.subscriptions}
      account={chrome.account ?? undefined}
    >
      {children}
    </MainChrome>
  );
}
