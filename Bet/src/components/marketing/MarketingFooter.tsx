import Link from "next/link";

/**
 * Minimal footer. Carries the required play-money disclosure plainly and
 * unavoidably (G10, DECISIONS D1) — not buried in fine print.
 */
export function MarketingFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1320px] border-t border-(--border) px-6 py-10 sm:px-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-lg text-sm text-(--text-2)">
          Bet is a demo running entirely on play-money credits.{" "}
          <span className="text-(--text-1)">No real money ever changes hands.</span>
        </p>
        <nav className="flex items-center gap-5 text-sm text-(--text-2)">
          <Link
            href="/explore"
            className="rounded-(--radius-input) transition-colors hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
          >
            Explore
          </Link>
          <Link
            href="/signin"
            className="rounded-(--radius-input) transition-colors hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
          >
            Sign in
          </Link>
        </nav>
      </div>
      <p className="mt-6 text-xs text-(--text-3)">© {new Date().getFullYear()} Bet. Not a real financial product.</p>
    </footer>
  );
}
