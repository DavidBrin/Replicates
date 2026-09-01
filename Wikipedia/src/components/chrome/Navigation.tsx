"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { randomSlug } from "@/lib/registry";

/**
 * The main-menu sidebar panel: "Main page", a live link back to David's
 * Internet, and "Random article". The Contribute group (Help, Community
 * portal, Recent changes, Upload file, ...) had no honest behavior in a
 * static replica, so per DECISIONS D5 (superseded 2026-08-18) it is removed
 * outright rather than greyed.
 */
export function Navigation() {
  const router = useRouter();

  return (
    <nav aria-label="Main menu" className="flex flex-col gap-4 text-[14px]">
      <div>
        <h3 className="mb-1 px-2 text-[12px] font-bold uppercase tracking-wide text-[color:var(--text)]/60">
          Navigation
        </h3>
        <ul className="m-0 list-none p-0">
          <li>
            <Link href="/" className="block rounded-[2px] px-2 py-1 hover:bg-[color:var(--subtle-bg)]">
              Main page
            </Link>
          </li>
          <li>
            <a
              href="https://david-internet.vercel.app"
              className="block rounded-[2px] px-2 py-1 hover:bg-[color:var(--subtle-bg)]"
            >
              David&apos;s Internet
            </a>
          </li>
          <li>
            <button
              type="button"
              className="block w-full cursor-pointer rounded-[2px] border-0 bg-transparent px-2 py-1 text-left text-[color:var(--link)] hover:bg-[color:var(--subtle-bg)]"
              onClick={() => router.push(`/wiki/${encodeURIComponent(randomSlug())}`)}
            >
              Random article
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}
