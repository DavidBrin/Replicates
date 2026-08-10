"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * `error.tsx` for the group dashboard (task-9-brief). Next.js requires this
 * to be a Client Component (it renders inside an error boundary that needs
 * `reset()`). Logs the underlying error for diagnosis (never shown to the
 * user — G4's "never leak internals" spirit applies to the UI too) and
 * offers a retry.
 */
export default function GroupDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GroupDashboardError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        icon={<AlertTriangle className="size-8" />}
        title="Couldn't load this group"
        description="Something went wrong loading the dashboard. Try again."
        action={
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
