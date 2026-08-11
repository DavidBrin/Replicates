"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

interface NavItem {
  readonly href: string;
  readonly label: string;
}

const ITEMS: readonly NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/p/the-wall", label: "The Wall" },
  { href: "/pages", label: "Pages" },
  { href: "/new", label: "Make a page" },
  { href: "/dashboard", label: "Dashboard" },
];

/**
 * `/` matches only itself — every route starts with it — while the rest also
 * match their descendants, so `/p/the-wall` stays current while a claim detail
 * is open beneath it.
 */
function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The gold bar. A client component because it needs `usePathname` to know
 * which route is current, and the root layout that renders it sits above every
 * dynamic segment and so never sees one.
 */
export function SiteNav({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Site"
      className={cn("border-b border-(--rule) bg-(--gold)", className)}
    >
      <ul className="mx-auto flex w-full max-w-(--layout-max) flex-wrap items-center px-4">
        {ITEMS.map((item, index) => {
          const current = isCurrent(pathname, item.href);
          return (
            <li
              key={item.href}
              className={cn(index > 0 && "border-l border-(--gold-dim)")}
            >
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block px-3 py-1.5 text-sm font-bold text-(--ink) no-underline hover:underline",
                  current && "bg-(--gold-dim) underline",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
