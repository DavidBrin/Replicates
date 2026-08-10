import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Local `not-found` boundary for the market view (Task 10's brief: "A
 * non-member hitting the URL gets the 404 page — the API already returns
 * 404, surface it as `not-found`"). `page.tsx` calls `notFound()` for a
 * missing market, a market the actor can't read (D6 — a private market's
 * existence isn't leaked to non-members), or a slug that doesn't match the
 * market's own group — all three land here rather than the generic
 * app-wide 404, so the message stays specific to "a market."
 */
export default function MarketNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        title="Market not found"
        description="This bet doesn't exist, or you don't have access to it."
        action={
          <Link
            href="/app"
            className="inline-flex h-10 items-center justify-center rounded-(--radius-input) bg-(--accent) px-4 text-sm font-medium text-(--surface-0) transition-colors hover:bg-(--accent-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
          >
            Back to your groups
          </Link>
        }
      />
    </div>
  );
}
