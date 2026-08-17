import { WatchChrome } from "./watch-chrome";
import { loadChrome } from "../chrome";

/**
 * The watch page's chrome: the masthead, and deliberately not the guide.
 *
 * ## Why this route is not in the `(main)` group
 *
 * It was the obvious fix — a route group adds nothing to a URL, so moving the
 * folder would have given `/watch` the whole shell for free — and it is wrong
 * for one measured reason. Theatre mode puts the player at **1920×911 on a
 * 1920 viewport** (R8 §3.4): full-bleed, edge to edge. `AppShell` renders its
 * children inside `.yt-content`, which carries a guide inset and its own
 * padding, so a "full-bleed" stage nested in it would stop short of both
 * edges by the width of the rail. The theatre measurement and the guide rail
 * cannot both be honoured, and the measurement is the one taken from the
 * product.
 *
 * So the watch route keeps its own layout, and takes the half of the chrome
 * that does not conflict.
 *
 * ## What was actually broken
 *
 * The page rendered with **no chrome at all**: no masthead, no search, and no
 * way back to the home feed short of the browser's own back button. That is
 * not a consequence of the theatre-mode constraint that put the route outside
 * the group — only the *guide* conflicts with theatre, and the masthead never
 * did.
 *
 * (An earlier note here also blamed the missing chrome for the page painting
 * light while every other route painted dark. That was wrong and is recorded
 * because the wrong explanation is the more tempting one: `ThemeProvider` is
 * in the **root** layout, so it has always wrapped this route. Whatever the
 * screenshot showed, it was not this.)
 *
 * The 56px top padding is the masthead's measured height, which is constant at
 * every viewport width from 1920 down to 360 (R8 §3.1). It is applied here
 * rather than in the page so that theatre mode's full-bleed stage still starts
 * immediately below the masthead rather than under it.
 */
export const dynamic = "force-dynamic";

export default async function WatchLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const chrome = await loadChrome();

  return (
    <WatchChrome
      signedIn={chrome.account !== null}
      account={chrome.account ?? undefined}
    >
      {children}
    </WatchChrome>
  );
}
