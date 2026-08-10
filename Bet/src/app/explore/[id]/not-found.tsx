import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

/** Local `not-found` boundary so a missing/private-market id under
 * `/explore/[id]` still renders inside the Explore layout (mint accent,
 * Kalshi surfaces) instead of falling through to the app-wide root
 * `not-found` and its unrelated (Bet-indigo) styling. */
export default function ExploreMarketNotFound() {
  return (
    <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6">
      <EmptyState
        title="Market not found"
        description="This market doesn't exist, or isn't part of the public Explore showcase."
        action={
          <Link
            href="/explore"
            className="inline-flex h-10 items-center justify-center rounded-(--radius-input) bg-(--accent) px-4 text-sm font-medium text-(--surface-0) hover:bg-(--accent-2)"
          >
            Back to Explore
          </Link>
        }
      />
    </div>
  );
}
