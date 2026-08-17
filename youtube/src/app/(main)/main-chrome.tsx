"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import type { GuideSubscription } from "@/components/layout/guide";

/**
 * The client half of the browse chrome, and the two gaps it closes.
 *
 * `layout.tsx` is a server component, so it can resolve a session and read a
 * database and cannot hand `AppShell` a callback or a pathname. Its header
 * described both absences accurately and then left them absent, which is the
 * difference this file makes: the layout said "the fix is one line in the
 * wrong file — a `"use client"` wrapper that calls `usePathname()`", and this
 * is that wrapper.
 *
 * **The active rail row.** `usePathname` is a client hook, and Next preserves
 * a shared layout across navigations rather than re-rendering it, so a value
 * read on the server would go stale the moment anyone clicked Subscriptions.
 * Read here, it re-renders with the route. The layout passed an empty string
 * instead, on the reasoning that a rail highlighting nothing is better than
 * one insisting you are on Home — true, and both are worse than the rail
 * highlighting where you are.
 *
 * **Search.** Pressing Enter in the masthead field did nothing anywhere in
 * this route group: the form calls `onSubmitQuery` and nothing supplied one.
 * A search field that silently swallows a query is the single most
 * conspicuous inert control in the application, because it is the one a
 * visitor reaches for first.
 */
export function MainChrome({
  signedIn,
  subscriptions,
  account,
  children,
}: {
  signedIn: boolean;
  subscriptions: readonly GuideSubscription[];
  account?: { readonly name: string; readonly avatarUrl?: string | null };
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const onSubmitQuery = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      // An empty submit is not a search for nothing, it is a mis-press. The
      // results page would render its own empty state for it, which reads as
      // "we found nothing" rather than "you typed nothing".
      if (trimmed === "") return;
      router.push(`/results?search_query=${encodeURIComponent(trimmed)}`);
    },
    [router],
  );

  return (
    <AppShell
      signedIn={signedIn}
      activePath={pathname}
      subscriptions={subscriptions}
      account={account}
      onSubmitQuery={onSubmitQuery}
    >
      {children}
    </AppShell>
  );
}
