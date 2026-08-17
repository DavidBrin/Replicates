"use client";

import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import { Masthead } from "@/components/layout/masthead";

/**
 * The client half of the watch route's chrome.
 *
 * `Masthead` takes `onToggleGuide` and `onSubmitQuery` — callbacks, which a
 * server layout cannot hand across the RSC boundary. `(main)/layout.tsx` hits
 * the same wall and its header says so: "the masthead's search box has the
 * same shape of gap: `onSubmitQuery` is a callback, so a server layout cannot
 * supply it". That gap is closed here rather than described, because a search
 * field that swallows Enter is worse than no search field.
 *
 * There is no guide toggle. The watch route has no guide — see the layout —
 * and a hamburger that opens nothing is exactly the kind of live-looking inert
 * control this pass is removing, so the prop is left off and `Masthead`
 * renders the button without one.
 */
export function WatchChrome({
  signedIn,
  account,
  children,
}: {
  signedIn: boolean;
  account?: { readonly name: string; readonly avatarUrl?: string | null };
  children: ReactNode;
}) {
  const router = useRouter();

  const onSubmitQuery = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (trimmed === "") return;
      // `search_query` is the product's own parameter name and the one
      // `/results` reads; `results-page` links are built with it everywhere
      // else in this app.
      router.push(`/results?search_query=${encodeURIComponent(trimmed)}`);
    },
    [router],
  );

  return (
    <>
      <Masthead signedIn={signedIn} account={account} onSubmitQuery={onSubmitQuery} />
      {/*
        56px, the masthead's measured height — constant at every viewport width
        from 1920 down to 360 (R8 §3.1). Applied to a wrapper rather than to
        the page so theatre mode's full-bleed stage begins directly under the
        masthead instead of behind it.
      */}
      <div className="pt-14">{children}</div>
    </>
  );
}
