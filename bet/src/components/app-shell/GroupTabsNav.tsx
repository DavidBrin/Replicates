"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface GroupTabItem {
  slug: string;
  name: string;
  emoji: string;
}

export interface GroupTabsNavProps {
  groups: GroupTabItem[];
  className?: string;
}

/**
 * The primary navigation of the whole app (task-9-brief's "ambiguity
 * resolutions": group tabs are the single most important detail — they are
 * what makes Bet feel like a group app rather than a markets app). Renders
 * one horizontally-scrolling tab per group, each with its emoji; the active
 * tab gets a 2px `--accent` underline plus higher-contrast text and is
 * scrolled into view. Client component: it needs `usePathname()` to know
 * which group is active, since the shared `(app)/layout.tsx` Server
 * Component that renders `TopBar` sits above the `/app/g/[slug]` segment
 * and never receives that dynamic param itself.
 */
export function GroupTabsNav({ groups, className }: GroupTabsNavProps) {
  const pathname = usePathname();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  const activeSlug = groups.find((g) => pathname?.startsWith(`/app/g/${g.slug}`))?.slug;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeSlug]);

  if (groups.length === 0) return null;

  return (
    <div
      ref={scrollerRef}
      className={cn(
        "flex min-w-0 items-center gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {groups.map((group) => {
        const isActive = group.slug === activeSlug;
        return (
          <Link
            key={group.slug}
            ref={isActive ? activeRef : undefined}
            href={`/app/g/${group.slug}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
              isActive ? "text-(--text-1)" : "text-(--text-2) hover:text-(--text-1)",
            )}
          >
            <span aria-hidden="true">{group.emoji}</span>
            <span>{group.name}</span>
            {isActive ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-(--accent)" />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
