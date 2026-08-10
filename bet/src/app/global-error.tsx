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
                  {/* A hard document load, not `next/link` or
                      `useRouter()`: this boundary stands in for the root
                      layout, so the client router it would navigate
                      through is part of the tree that just failed to
                      render. Reloading from the server is the escape that
                      cannot itself be broken by the same fault. */}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see comment above: a client-router navigation is exactly what must not be relied on here.
                      window.location.href = "/";
                    }}
                  >
                    Go home
                  </Button>
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
