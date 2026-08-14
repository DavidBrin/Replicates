"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { AuthMessage } from "./auth-shell";

/**
 * The one-click half of the invite page: a visitor who is already signed in.
 *
 * The other half — a visitor with no account — is the sign-up form with the
 * token attached, which creates the account and redeems the link in a single
 * request. Both paths end in the same place, and both put
 * `accept-invite-submit` on the button that finishes the job, because from the
 * outside they are one action with two preconditions.
 *
 * ## The failures are named
 *
 * `/api/invites/accept` distinguishes expired, already-used and revoked from
 * "no such token", and this shows the distinction. Telling someone why *their
 * own* link is dead leaks nothing — they demonstrably hold it — and it is the
 * difference between a usable product and a shrug. Only an unknown token is
 * answered generically, so the endpoint cannot be used to test guesses.
 */

export interface AcceptInviteProps {
  token: string;
  /** Where to land once the membership exists. */
  redirectTo: string;
}

export function AcceptInvite({ token, redirectTo }: AcceptInviteProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function accept(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const payload: { error?: string } = await response.json().catch(() => ({}));
        setError(payload.error ?? "This invitation could not be accepted.");
        setPending(false);
        return;
      }

      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? (
        <AuthMessage testId="accept-invite-error">{error}</AuthMessage>
      ) : null}

      <Button
        type="button"
        data-testid="accept-invite-submit"
        variant="primary"
        size="lg"
        disabled={pending}
        onClick={() => void accept()}
        className="w-full"
      >
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
