"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Route-group-level error boundary for the whole signed-in app.
 *
 * Only the group subtree (`app/g/[slug]/**`) had one, so a server throw on
 * `/app`, `/app/friends`, `/app/activity` or `/app/new` fell through to
 * Next's own unstyled default error page — a jarring exit from the app's
 * chrome, and in production a bare "Application error" with no way back.
 * This boundary sits inside `(app)/layout.tsx`, so the top bar, group tabs
 * and right rail all survive the failure: the user loses the panel, not the
 * app.
 *
 * Next.js requires this to be a Client Component (it renders inside an
 * error boundary that needs `reset()`). The underlying error is logged, never
 * rendered — G4's "never leak internals" applies to the UI too.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        icon={<AlertTriangle className="size-8" />}
        title="Something went wrong"
        description="That screen didn't load. Try again — nothing you've done was lost."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" onClick={reset}>
              Try again
            </Button>
            <Button variant="ghost" onClick={() => router.push("/app")}>
              Back to your groups
            </Button>
          </div>
        }
      />
    </div>
  );
}
