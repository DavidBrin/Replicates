"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/primitives";

/**
 * The sign-in form.
 *
 * Deliberately plain. YouTube's own sign-in is a Google account flow with
 * nothing measurable in it that belongs to this product, so there is no
 * captured geometry to reproduce and inventing a pixel-faithful imitation of
 * someone else's identity provider would be the wrong kind of fidelity. What
 * this owes is that it *works*, and that its failure states are honest.
 *
 * ## The error is not specific, on purpose
 *
 * The route answers the same way for a wrong password and for an address with
 * no account, and this shows what it says rather than elaborating. Any
 * refinement here — "no account with that address" — would reintroduce the
 * enumeration oracle the route spends a decoy hash to avoid.
 */
export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body !== null && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : "Sign in failed.";
        setError(message);
        return;
      }

      /**
       * A real navigation, not `router.push`.
       *
       * The chrome is rendered by a **server** layout that read the session
       * cookie during its last render, and the client router preserves a
       * shared layout across navigations rather than re-rendering it. So
       * `push` alone lands on the next page with the signed-out masthead
       * still on it. `router.refresh()` in front of it is the documented
       * remedy and did not do it either: the layout's cached RSC payload
       * survived, and the page went on offering a Sign in link to someone who
       * had just signed in.
       *
       * `location.assign` discards the whole client cache by leaving the
       * document. That is a heavier hammer than a client navigation and it is
       * the right one here: a sign-in happens once a session, it changes what
       * *every* server component on the page would render, and paying one full
       * page load for that is what every real application does.
       */
      window.location.assign(next);
    } catch {
      // A failed fetch is a network problem, not a credential problem, and
      // saying "that email and password do not match" would send someone to
      // check a password that was never sent.
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[400px] flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-body text-secondary">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-10 rounded-compact border border-[var(--yt-10-percent-layer)] bg-transparent px-3 text-body text-primary outline-none focus:border-[rgb(28,98,185)]"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-body text-secondary">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-10 rounded-compact border border-[var(--yt-10-percent-layer)] bg-transparent px-3 text-body text-primary outline-none focus:border-[rgb(28,98,185)]"
        />
      </label>

      {error === null ? null : (
        // `role="alert"` so the failure is announced rather than only shown:
        // a keyboard user submitting from the password field never looks at
        // the space above the button.
        <p role="alert" data-signin-error="" className="text-body text-[var(--yt-static-brand-red)]">
          {error}
        </p>
      )}

      <Button type="submit" variant="filled" palette="callToAction" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
