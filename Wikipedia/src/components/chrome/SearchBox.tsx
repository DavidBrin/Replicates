"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchTitles } from "@/lib/registry";

/** Stable id for a suggestion row, so `aria-activedescendant` can target it. */
function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

/**
 * Codex-style search-suggest box: client-side prefix/substring match via
 * `searchTitles()`, a typeahead dropdown of thumbnail/title/description rows,
 * full keyboard support, Enter/click navigates to `/wiki/<slug>`.
 */
export function SearchBox() {
  const router = useRouter();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchTitles(query), [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function navigateTo(slug: string) {
    setOpen(false);
    setQuery("");
    router.push(`/wiki/${encodeURIComponent(slug)}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (event.key === "ArrowDown" && results.length > 0) {
        setOpen(true);
        setActiveIndex(0);
        event.preventDefault();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          navigateTo(results[activeIndex].slug);
        } else if (results.length > 0) {
          navigateTo(results[0].slug);
        }
        break;
      case "Escape":
        setOpen(false);
        break;
    }
  }

  const showDropdown = open && query.trim().length > 0 && results.length > 0;

  return (
    <div ref={containerRef} className="relative w-full">
      {/*
        The served control is a 32px-tall input with a 34px icon inset plus a
        separate 70px "Search" submit button butted against it (Codex's
        `.cdx-search-input` with an end button) — the replica used to render
        the input alone, which reads as a generic site search rather than
        Wikipedia's. The button does what Enter does: go to the top match.
      */}
      <div className="flex items-stretch">
        <div className="relative flex h-8 min-w-0 flex-1 items-center rounded-l-[2px] border border-[color:var(--rule)] bg-white focus-within:border-[color:var(--link)]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="pointer-events-none absolute left-[9px] shrink-0 text-[color:var(--text)]/60"
          >
            <circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <line x1="13" y1="13" x2="18" y2="18" stroke="currentColor" strokeWidth="2" />
          </svg>
          <input
            type="search"
            value={query}
            placeholder="Search Wikipedia"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              showDropdown && activeIndex >= 0 ? optionId(listboxId, activeIndex) : undefined
            }
            className="h-full w-full border-0 bg-transparent py-1 pl-[34px] pr-2 text-[14px] leading-[22px] text-[color:var(--text)] outline-none"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(-1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        {/*
          The served suggestion menu is flush under the input (no gap), stops
          at the input's right edge rather than running under the Search
          button, is 1px #a2a9b1 with a soft double shadow, and each 60px row
          is [40px thumbnail frame] [bold #202122 title] over [grey
          description]. The titles are *not* blue — a menu of blue links is the
          giveaway that a replica styled this from memory. Articles with no
          picture get Wikipedia's own grey placeholder frame, which is what the
          live menu shows for them too.
        */}
        {showDropdown && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute inset-x-0 top-full z-50 max-h-[70vh] overflow-y-auto border border-[color:var(--rule)] bg-white shadow-[0_4px_4px_rgba(0,0,0,0.06),0_0_8px_rgba(0,0,0,0.06)]"
          >
            {results.map((meta, i) => (
              <li
                key={meta.slug}
                id={optionId(listboxId, i)}
                role="option"
                aria-selected={i === activeIndex}
              >
                <button
                  type="button"
                  className={`flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2 text-left ${
                    i === activeIndex ? "bg-[color:var(--subtle-bg)]" : ""
                  }`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => navigateTo(meta.slug)}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center border border-[color:var(--toolbar-rule)] bg-[color:var(--subtle-bg)] text-[color:var(--text)]/40"
                  >
                    <svg width="18" height="18" viewBox="0 0 20 20">
                      <rect
                        x="1.5"
                        y="3.5"
                        width="17"
                        height="13"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path d="M3 14l4.5-5 3 3.5L13.5 9l3.5 5z" fill="currentColor" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-bold text-[color:var(--text)]">
                      {meta.title}
                    </span>
                    <span className="block truncate text-[13px] text-[color:var(--text)]/70">
                      {meta.shortDescription}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
        <button
          type="button"
          className="-ml-px h-8 shrink-0 cursor-pointer rounded-r-[2px] border border-[color:var(--rule)] bg-[color:var(--subtle-bg)] px-3 text-[14px] text-[color:var(--text)] hover:bg-white"
          onClick={() => {
            if (results.length > 0) {
              navigateTo(results[Math.max(activeIndex, 0)].slug);
            }
          }}
        >
          Search
        </button>
      </div>

    </div>
  );
}
