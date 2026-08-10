"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface InviteActionsProps {
  inviteId: string;
  targetLabel: string;
}

/**
 * The signed-in accept path (task-12-brief: "an invite link opens a
 * working preview" — this is the step that actually completes it). Posts
 * to `POST /api/invites/[id] {action:"accept"}` (David's ambiguity
 * resolution from the Task 6 report — NOT `/[id]/accept`). No
 * `ToastProvider` exists on this route (`/invite/[token]` sits outside the
 * `(app)` route group, which is the only place `ToastProvider` is mounted —
 * `src/app/layout.tsx`, a file this task doesn't own, wraps nothing),
 * so feedback is rendered inline rather than via `useToast()`.
 */
export function InviteActions({ inviteId, targetLabel }: InviteActionsProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setStatus("pending");
    setError(null);
    try {
      const res = await fetch(`/api/invites/${inviteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      const body: { data?: unknown; error?: { message?: string } } = await res.json();
      if (!res.ok || body.error) {
        setError(body.error?.message ?? "Couldn't accept this invite.");
        setStatus("idle");
        return;
      }
      setStatus("done");
    } catch {
      setError("Couldn't accept this invite. Try again.");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-start gap-3 rounded-(--radius-card) border border-(--yes-br) bg-(--yes-bg) p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-(--yes)">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          You&rsquo;re in! You joined {targetLabel}.
        </p>
        <Link
          href="/app"
          className="text-sm font-medium text-(--accent-2) underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
        >
          Go to your groups →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" loading={status === "pending"} onClick={accept}>
        Accept invite
      </Button>
      {error ? <p className="text-sm text-(--no)">{error}</p> : null}
    </div>
  );
}
