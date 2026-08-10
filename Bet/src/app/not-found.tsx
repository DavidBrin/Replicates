import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * App-wide 404 (Task 14 polish pass). Every route segment that needs
 * *specific* 404 copy already ships its own local `not-found.tsx`
 * (`/explore/[id]`, `/app/g/[slug]/m/[id]`) — this is the fallback for
 * everything else (an arbitrary bad URL, `/app/g/does-not-exist`, etc.),
 * styled to match the rest of the marketing/auth surface rather than
 * falling through to Next's unstyled default.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-(--surface-0) px-6 py-16 text-(--text-1)">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium tracking-wide text-(--accent-2)">Bet</p>
        <h1 className="text-3xl font-semibold tracking-tight text-(--text-1)">wanna bet?</h1>
      </div>
      <EmptyState
        title="Page not found"
        description="That page doesn't exist, or it moved."
        action={
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-(--radius-input) bg-(--accent) px-4 text-sm font-medium text-(--surface-0) transition-colors hover:bg-(--accent-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
          >
            Back home
          </Link>
        }
        className="max-w-md"
      />
    </main>
  );
}
