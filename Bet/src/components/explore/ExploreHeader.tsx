"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

const CATEGORY_TABS: { id: string; label: string }[] = [
  { id: "", label: "Trending" },
  { id: "politics", label: "Politics" },
  { id: "sports", label: "Sports" },
  { id: "crypto", label: "Crypto" },
  { id: "culture", label: "Culture" },
  { id: "economics", label: "Economics" },
  { id: "climate", label: "Climate" },
  { id: "tech", label: "Tech" },
  { id: "mentions", label: "Mentions" },
];

function categoryHref(id: string): string {
  return id ? `/explore?category=${id}` : "/explore";
}

/**
 * Explore's two-row Kalshi chrome (SPEC §7.3, research/kalshi.md §1.1: a
 * fixed `--top-navbar-height: 107px` header — a ~64px primary bar plus a
 * ~43px category row). Row 1: mint wordmark, "Trade on anything" search
 * (research/kalshi.md §1.3 / brief's ambiguity resolution), a `Sign up`
 * pill, a hamburger. Row 2: the category strip, active item underlined,
 * horizontally scrollable. Client component: category-tab active state and
 * search both read/drive the URL.
 */
export function ExploreHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeCategory = pathname === "/explore" ? (searchParams.get("category") ?? "") : null;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-(--border) bg-(--surface-1)/95 backdrop-blur">
      {/* Row 1 — ~64px */}
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-4 px-4 sm:px-6">
        <Link href="/explore" className="flex shrink-0 items-center gap-1.5">
          <span className="text-lg font-bold tracking-tight text-(--accent)">Bet</span>
          <span className="hidden text-xs text-(--text-3) sm:inline">Explore</span>
        </Link>

        <form action="/explore" method="get" className="hidden max-w-md flex-1 sm:block">
          <label className="relative block">
            <span className="sr-only">Search markets</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-(--text-3)"
              aria-hidden="true"
            />
            <input
              type="search"
              name="q"
              defaultValue={searchParams.get("q") ?? ""}
              placeholder="Trade on anything"
              className="w-full rounded-(--radius-pill) border border-(--border) bg-(--surface-2) py-2 pr-3 pl-9 text-sm text-(--text-1) placeholder:text-(--text-3) focus-visible:border-(--border-2) focus-visible:outline-none"
            />
          </label>
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link
            href="/signin"
            className="inline-flex h-9 items-center justify-center rounded-(--radius-pill) bg-(--accent) px-4 text-sm font-medium text-(--surface-0) transition-colors hover:bg-(--accent-2)"
          >
            Sign up
          </Link>
          <div className="relative">
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex size-9 items-center justify-center rounded-(--radius-input) text-(--text-1) transition-colors hover:bg-(--surface-3) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
            >
              {menuOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute top-full right-0 z-40 mt-2 w-48 rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-1 shadow-lg"
              >
                <Link
                  role="menuitem"
                  href="/"
                  className="block rounded-(--radius-input) px-3 py-2 text-sm text-(--text-1) hover:bg-(--surface-3)"
                  onClick={() => setMenuOpen(false)}
                >
                  Bet home
                </Link>
                <Link
                  role="menuitem"
                  href="/signin"
                  className="block rounded-(--radius-input) px-3 py-2 text-sm text-(--text-1) hover:bg-(--surface-3)"
                  onClick={() => setMenuOpen(false)}
                >
                  Sign in
                </Link>
                <Link
                  role="menuitem"
                  href="/app"
                  className="block rounded-(--radius-input) px-3 py-2 text-sm text-(--text-1) hover:bg-(--surface-3)"
                  onClick={() => setMenuOpen(false)}
                >
                  Your groups
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Row 2 — ~43px category strip */}
      <nav aria-label="Categories" className="scrollbar-none overflow-x-auto border-t border-(--border)">
        <ul className="mx-auto flex h-[43px] max-w-[1320px] min-w-max items-center gap-5 px-4 sm:px-6">
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeCategory === tab.id;
            return (
              <li key={tab.id || "trending"}>
                <Link
                  href={categoryHref(tab.id)}
                  className={cn(
                    "relative inline-flex h-[43px] items-center text-sm font-medium whitespace-nowrap transition-colors",
                    isActive ? "text-(--text-1)" : "text-(--text-2) hover:text-(--text-1)",
                  )}
                >
                  {tab.label}
                  {isActive ? (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-(--accent)" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
