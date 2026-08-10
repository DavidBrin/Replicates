import Link from "next/link";

/**
 * A deliberately minimal header for the marketing home — the wordmark and a
 * single sign-in link. This is not the app shell's `TopBar` (Task 9's file,
 * built for the signed-in `(app)` layout with group tabs); the marketing
 * home is a separate, logged-out destination and gets its own light-touch
 * nav (SPEC §3.1 doesn't call for group tabs here).
 */
export function MarketingNav() {
  return (
    <header className="mx-auto flex w-full max-w-[1320px] items-center justify-between px-6 py-6 sm:px-10">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-(--radius-input) text-sm font-semibold tracking-tight text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
      >
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-(--accent) text-xs font-bold text-(--surface-0)">
          B
        </span>
        Bet
      </Link>
      <Link
        href="/signin"
        className="rounded-(--radius-input) px-3 py-2 text-sm font-medium text-(--text-2) transition-colors hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
      >
        Sign in
      </Link>
    </header>
  );
}
