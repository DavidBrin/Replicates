"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";

export interface GuestSignInUser {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  avatarInitials: string;
}

export interface GuestSignInProps {
  users: GuestSignInUser[];
  /** Where to land after signing in — this exact invite URL, so the
   * visitor comes straight back to it instead of `/app` (task-12-brief:
   * "signed-out visitors get a sign-in prompt that returns them here
   * afterwards"). `/signin`'s own `SignInButton` (Task 4's file, not owned
   * by this task) always redirects to `/app` and has no `?next=` support —
   * rather than edit it, this is a self-contained local picker that posts
   * to the exact same `POST /api/session` contract and does its own
   * redirect. See this task's report for the full reasoning. */
  returnPath: string;
}

/**
 * A local demo-user picker for the invite landing page, mirroring
 * `/signin`'s own grid (same public data: id/handle/displayName/avatar —
 * nothing `/signin` doesn't already show every visitor, signed in or not)
 * but redirecting back to `returnPath` instead of `/app`.
 */
export function GuestSignIn({ users, returnPath }: GuestSignInProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signInAs(userId: string) {
    setPendingId(userId);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body: { data?: unknown; error?: { message?: string } } = await res.json();
      if (!res.ok || body.error) {
        setError(body.error?.message ?? "Sign-in failed.");
        setPendingId(null);
        return;
      }
      router.push(returnPath);
      router.refresh();
    } catch {
      setError("Sign-in failed. Try again.");
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-(--text-2)">Sign in as a demo user to accept this invite.</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => signInAs(u.id)}
            disabled={pendingId !== null}
            aria-busy={pendingId === u.id || undefined}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-(--radius-card) border border-(--border) bg-(--surface-2) px-2 py-3 text-center transition-colors hover:border-(--border-2) hover:bg-(--surface-3) disabled:cursor-not-allowed disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
            )}
          >
            <Avatar initials={u.avatarInitials} color={u.avatarColor} />
            <span className="truncate text-xs font-medium text-(--text-1)">@{u.handle}</span>
          </button>
        ))}
      </div>
      {error ? <p className="text-sm text-(--no)">{error}</p> : null}
    </div>
  );
}
