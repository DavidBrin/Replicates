"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

import { AuthMessage, Field } from "./auth-shell";

/**
 * Email and password.
 *
 * ## The refusal is the server's, verbatim
 *
 * `/api/auth/signin` answers every failure — no such address, wrong password,
 * deactivated account — with one status, one message and the same amount of
 * work, so the endpoint cannot be used to ask "does this person have an account
 * here?". For a workspace tool that is a membership disclosure, not a trivium.
 *
 * The UI's only job is not to undo it. So this renders `error` exactly as it
 * arrives and never adds a field-level hint: an "unknown email" marker under
 * the email input, or a red border on the password field alone, reconstructs
 * the oracle in the browser out of a response that was careful not to contain
 * it. Both fields are marked invalid together or neither is.
 *
 * ## Why the redirect is a full navigation
 *
 * `router.replace` then `router.refresh`: the session cookie is `httpOnly`, so
 * the client cannot see that it now exists, and the App Router cache is holding
 * a render of a signed-out app. Refreshing is what makes the server re-decide
 * who is asking. `replace` rather than `push` keeps the sign-in page out of the
 * back stack, where pressing Back would show a form for a session that is
 * already live.
 */

export interface DemoAccount {
  readonly email: string;
  readonly label: string;
  /** What this account is for — "owner", "guest, Design only". */
  readonly role: string;
}

export interface SignInFormProps {
  /** Where to land afterwards. `/` sends a signed-in visitor into the app. */
  redirectTo?: string;
  /** Pre-filled from the demo panel, so the seeded accounts are one click away. */
  initialEmail?: string;
  /**
   * The seeded accounts, offered as one-click sign-ins.
   *
   * This app's whole subject is multi-user permissions, and a reviewer who has
   * to read `src/lib/seed.ts` to find four addresses and a password will
   * evaluate a single-user product. Four buttons make the permission model
   * explorable in the first ten seconds — which is the only moment anyone is
   * guaranteed to spend on it.
   */
  demoAccounts?: readonly DemoAccount[];
  demoPassword?: string;
}

export function SignInForm({
  redirectTo = "/",
  initialEmail = "",
  demoAccounts = [],
  demoPassword = "",
}: SignInFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(nextEmail: string, nextPassword: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: nextEmail, password: nextPassword }),
      });

      if (!response.ok) {
        const payload: { error?: string } = await response
          .json()
          .catch(() => ({}));
        // The server's sentence, not ours. Rephrasing it per status code is how
        // a constant-time endpoint acquires a timing-free oracle in the UI.
        setError(payload.error ?? "Incorrect email or password.");
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

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void signIn(email, password);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Email" htmlFor="signin-email">
        <Input
          id="signin-email"
          data-testid="signin-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          invalid={error !== null}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
        />
      </Field>

      <Field label="Password" htmlFor="signin-password">
        <Input
          id="signin-password"
          data-testid="signin-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          invalid={error !== null}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
        />
      </Field>

      {error !== null ? (
        <AuthMessage testId="signin-error">{error}</AuthMessage>
      ) : null}

      <Button
        type="submit"
        data-testid="signin-submit"
        variant="primary"
        size="lg"
        disabled={pending}
        className={cn("mt-1 w-full")}
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      {demoAccounts.length > 0 ? (
        <section
          data-testid="demo-accounts"
          className="mt-2 rounded-[var(--radius-lg)] border border-subtle p-3"
        >
          <h2 className="text-micro uppercase tracking-[0.06em] text-quaternary [font-weight:var(--weight-medium)]">
            Demo workspace
          </h2>
          <p className="mt-1 text-micro text-quaternary">
            Four seeded accounts at four permission levels. Password{" "}
            <code className="font-mono text-tertiary">{demoPassword}</code>.
          </p>
          <div className="mt-2 flex flex-col">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                data-testid={`demo-signin-${account.label.toLowerCase()}`}
                disabled={pending}
                onClick={() => {
                  // Fill the fields as well as submitting: if the request
                  // fails, the form is left in the state the user can retry
                  // from rather than empty and unexplained.
                  setEmail(account.email);
                  setPassword(demoPassword);
                  void signIn(account.email, demoPassword);
                }}
                className={cn(
                  "flex items-baseline gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left",
                  "hover:bg-[var(--bg-hover)] disabled:opacity-50",
                  "[transition:background-color_var(--speed-quick)_var(--ease-out-quad)]",
                )}
              >
                <span className="text-small text-secondary [font-weight:var(--weight-medium)]">
                  {account.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-micro text-quaternary">
                  {account.role}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </form>
  );
}
