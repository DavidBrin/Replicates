import Link from "next/link";
import { Panel } from "@/components/ui";

/**
 * The 404. Says what is missing and where the two useful places are, because
 * most arrivals here are a mistyped page name rather than a broken link — the
 * site has no outbound links to break (DECISIONS D6).
 */
export default function NotFound() {
  return (
    <Panel title="Nothing here">
      <div className="flex flex-col gap-2 text-sm">
        <p>
          There is no page at that address. Page names are lowercase letters, numbers and
          hyphens, and they live under <code>/p/</code>.
        </p>
        <p>
          <Link href="/p/the-wall">The wall</Link> is the main grid, and{" "}
          <Link href="/pages">the directory</Link> lists every page that is listed.
          Unlisted pages are only reachable by their exact link.
        </p>
        <p>
          <Link href="/new">Make a page</Link> if the name you wanted is still free.
        </p>
      </div>
    </Panel>
  );
}
