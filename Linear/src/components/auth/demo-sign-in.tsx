"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";

import { AuthMessage } from "./auth-shell";

/**
 * Sign in by picking a seeded demo account — the only way in.
 *
 * ## Why there is no email-and-password form
 *
 * This is a portfolio demo, not a tenant anyone signs up for, so "sign in"
 * means "become one of the four seeded people and look around". That is the
 * whole screen: four buttons, one click each, nothing to type and nothing to
 * remember. The typable sign-in form and the open sign-up page it used to sit
 * beside are archived — `sign-in-form.tsx` is kept in the tree for reference but
 * mounted nowhere, and `/signup` now redirects here (`next.config.ts`) — because
 * a self-serve account on a single-workspace demo only ever landed on a
 * marketing page it could not leave: an account with no membership, and no UI to
 * create a workspace, has nowhere to go (`components/auth/home.ts`). The one
 * real path onto a workspace, an invitation, is untouched (`/invite/[token]`).
 *
 * ## Each button is an honest sign-in, not a shortcut
 *
 * A click fills the credentials and POSTs them to `/api/auth/signin` exactly as
 * a human would — the seeded password is public and printed below — so the
 * session cookie is set the way every other request expects it (`httpOnly`,
 * `SameSite=Lax`), and nothing here forges a session the deployment would not.
 * The four permission levels (owner / admin / member / guest) are what this
 * product is about, and this makes them explorable in the first ten seconds,
 * which is the only moment anyone is guaranteed to spend on it.
 *
 * `router.replace` then `router.refresh`: the cookie is `httpOnly`, so the
 * client cannot see the session it was just handed, and only a refresh makes
 * the server re-decide who is asking. `replace`, not `push`, keeps this page out
 * of the back stack, where Back would show a sign-in screen for a live session.
 */

export interface DemoAccount {
  readonly email: string;
  readonly label: string;
  /** What this account is for — "all three teams", "Engineering only". */
  readonly role: string;
}

export interface DemoSignInProps {
  /** Where to land afterwards. `/` sends a signed-in visitor into the app. */
  redirectTo?: string;
  /** The seeded accounts, offered as one-click sign-ins. */
  readonly demoAccounts: readonly DemoAccount[];
  /** The seeded password, filled on the caller's behalf and shown as a hint. */
  readonly demoPassword: string;
}

export function DemoSignIn({
  redirectTo = "/",
  demoAccounts,
  demoPassword,
}: DemoSignInProps) {
  const router = useRouter();
  // The email of the account currently signing in, or null. Doubles as the
  // "any request in flight" guard, so a second button cannot race the first.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enter(email: string): Promise<void> {
    if (pending !== null) return;
    setPending(email);
    setError(null);

    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: demoPassword }),
      });

      if (!response.ok) {
        const payload: { error?: string } = await response
          .json()
          .catch(() => ({}));
        setError(payload.error ?? "Could not sign in. Try again.");
        setPending(null);
        return;
      }

      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError(
        "Could not reach the server. Check your connection and try again.",
      );
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="demo-accounts">
      <div className="flex flex-col gap-1.5">
        {demoAccounts.map((account) => {
          const busy = pending === account.email;
          return (
            <button
              key={account.email}
              type="button"
              data-testid={`demo-signin-${account.label.toLowerCase()}`}
              disabled={pending !== null}
              onClick={() => void enter(account.email)}
              className={cn(
                "group flex items-center gap-3 rounded-[var(--radius-lg)] border border-subtle px-3 py-2.5 text-left",
                "hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-50",
                "[transition:background-color_var(--speed-quick)_var(--ease-out-quad)]",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-small text-primary [font-weight:var(--weight-medium)]">
                  {account.label}
                </span>
                <span className="truncate text-micro text-quaternary">
                  {account.role}
                </span>
              </span>
              <span className="shrink-0 text-mini text-quaternary group-hover:text-tertiary">
                {busy ? "Signing in…" : "Sign in →"}
              </span>
            </button>
          );
        })}
      </div>

      {error !== null ? (
        <AuthMessage testId="signin-error">{error}</AuthMessage>
      ) : null}

      <p className="text-micro text-quaternary">
        Each account opens the same seeded Demo Workspace at a different
        permission level. Password{" "}
        <code className="font-mono text-tertiary">{demoPassword}</code>, filled
        for you.
      </p>
    </div>
  );
}
