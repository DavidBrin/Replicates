"use client";

import { useState } from "react";
import { Logo } from "./Logo";
import { SearchBox } from "./SearchBox";
import { Greyed } from "./Greyed";
import { Navigation } from "./Navigation";

/**
 * The real page header (`.vector-header`): hamburger main-menu toggle +
 * logo lockup on the start side, search box + user links + Appearance
 * controls on the end side. Per research/03.
 */
export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/*
        Measured against the served header at 1440x900: 66px tall, 8px block
        padding, no bottom rule at all (the replica used to draw one), the
        hamburger nudged 6px into the container's padding, the logo lockup
        ending at x=224, and the search box starting at x=266 — i.e. the
        search is pinned just left of the content column, not floated to the
        right edge next to the user links.
      */}
      <header className="flex h-[66px] items-center py-2">
        <div className="flex w-[222px] shrink-0 items-center">
          <button
            type="button"
            aria-label="Main menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="-ml-1.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[2px] border-0 bg-transparent hover:bg-[color:var(--subtle-bg)]"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <rect y="3" width="20" height="2" fill="currentColor" />
              <rect y="9" width="20" height="2" fill="currentColor" />
              <rect y="15" width="20" height="2" fill="currentColor" />
            </svg>
          </button>
          <div className="ml-3.5">
            <Logo />
          </div>
        </div>

        <div className="w-full max-w-[474px] shrink">
          <SearchBox />
        </div>

        <nav
          aria-label="User links"
          className="ml-auto flex shrink-0 items-center gap-4 pl-4 text-[14px]"
        >
          <Greyed title="Account creation is not functional in this replica">
            Create account
          </Greyed>
          <Greyed title="Login is not functional in this replica">Log in</Greyed>
          <Greyed title="Appearance settings are not functional in this replica">
            Appearance
          </Greyed>
        </nav>
      </header>

      {menuOpen && (
        <div className="border-b border-[color:var(--rule)] bg-white py-3">
          <Navigation />
        </div>
      )}
    </>
  );
}
