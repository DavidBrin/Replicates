"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { randomSlug } from "@/lib/registry";
import { Greyed } from "./Greyed";

/**
 * The main-menu sidebar panel: "Main page" and "Random article" are real
 * navigation (D-nothing — these are the two functional sidebar links per
 * SPEC §5); the Contribute group is greyed like every other non-functional
 * control (D5).
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

      <div>
        <h3 className="mb-1 px-2 text-[12px] font-bold uppercase tracking-wide text-[color:var(--text)]/60">
          Contribute
        </h3>
        <ul className="m-0 list-none p-0">
          {["Help", "Community portal", "Recent changes", "Upload file"].map((item) => (
            <li key={item}>
              <Greyed
                as="span"
                className="block px-2 py-1"
                title="Contribution tools are not functional in this replica"
              >
                {item}
              </Greyed>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
