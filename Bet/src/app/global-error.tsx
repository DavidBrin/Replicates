"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
// `global-error.tsx` REPLACES the root layout when it renders, so
// `src/app/layout.tsx`'s `import "./globals.css"` never runs and the design
// tokens would be absent. Importing the stylesheet here is what keeps the
// last-resort screen on-brand instead of unstyled black-on-white.
import "./globals.css";

/**
 * The root error boundary: the last thing standing when a throw escapes the
 * root layout itself (or any route without a closer `error.tsx`).
 *
 * Next.js requires it to render its own `<html>` and `<body>`, because it
 * substitutes for the root layout rather than nesting inside it. The
 * `--font-inter` variable is set by that layout, so the font stack falls
 * back to `globals.css`'s system fonts here — deliberate: pulling
 * `next/font` into this file would make the error page depend on the same
 * machinery that may have just failed.
 *
 * The underlying error is logged, never rendered — G4's "never leak
 * internals" applies to the UI too. `digest` is shown because it is an
 * opaque server-generated id, not error content, and it is the only thing
 * that lets a user's screenshot be matched to a server log line.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center px-6">
          <div className="flex w-full max-w-md flex-col items-center gap-6">
            <p className="text-lg font-semibold tracking-tight text-(--text-1)">
              Bet
            </p>
            <EmptyState
              className="w-full"
              icon={<AlertTriangle className="size-8" />}
              title="Something went badly wrong"
              description="The page couldn't be rendered at all. Reloading usually clears it."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="secondary" onClick={reset}>
                    Try again
                  </Button>
                  {/* A plain anchor, not `useRouter()`: this boundary stands
                      in for the root layout, so the client router it would
                      push through is exactly the thing that may have just
                      failed. A full document load is the reliable escape. */}
                  <a
                    href="/"
                    className="inline-flex h-10 items-center justify-center rounded-(--radius-input) px-4 text-sm font-medium text-(--text-1) transition-colors hover:bg-(--surface-3) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
                  >
                    Go home
                  </a>
                </div>
              }
            />
            {error.digest ? (
              <p className="tnum text-xs text-(--text-3)">Reference: {error.digest}</p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
