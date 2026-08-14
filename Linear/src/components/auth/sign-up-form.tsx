"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { AuthMessage, Field } from "./auth-shell";

/**
 * Create an account — and, when the visitor arrived through an invite link,
 * redeem it in the same request.
 *
 * ## One request, not two
 *
 * `/api/auth/signup` takes an optional `inviteToken` and accepts the invitation
 * inside the same handler. The alternative — sign up, then POST the invite —
 * has a window in which the account exists and the membership does not, and the
 * visitor who closes the tab in that window has an account attached to no
 * workspace and no way back: the link they were sent is now spent on nothing.
 *
 * ## The password rule is stated, not enforced twice
 *
 * Twelve characters, no composition rules — the server's rule, from
 * `/api/auth/signup`. It is shown as a hint and left to the server to enforce,
 * because a client-side copy of a validation rule is a rule that drifts. The
 * `minLength` attribute is set so the browser can be helpful, not so the app
 * can be sure.
 *
 * ## Why "already exists" is said out loud here
 *
 * Sign-in refuses identically whatever went wrong, on purpose. Sign-up cannot:
 * pretending to create an account that already exists means handing the visitor
 * a session they must not have. The enumeration surface is every sign-up form's
 * and is not the one `SPEC.md` §4 guards — the handler's own comment says so.
 */

export interface SignUpFormProps {
  /** Present when this form is the invite page's acceptance step. */
  inviteToken?: string;
  /** The address the invitation named, pre-filled and still editable. */
  initialEmail?: string;
  /** Overrides the button's label and test id on the invite page. */
  submitLabel?: string;
  submitTestId?: string;
  redirectTo?: string;
}

export function SignUpForm({
  inviteToken,
  initialEmail = "",
  submitLabel = "Create account",
  submitTestId = "signup-submit",
  redirectTo = "/",
}: SignUpFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          ...(inviteToken === undefined ? {} : { inviteToken }),
        }),
      });

      const payload: { error?: string; inviteError?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        setError(payload.error ?? "Could not create the account.");
        setPending(false);
        return;
      }

      if (payload.inviteError !== undefined) {
        // A 201 with a note: the account is real and the session is live, only
        // the invitation failed. Sending the visitor onward would strand them
        // in a workspace list they are not in; telling them here lets an admin
        // send a fresh link to an account that now exists.
        setNotice(payload.inviteError);
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
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Name" htmlFor="signup-name">
        <Input
          id="signup-name"
          data-testid="signup-name"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Dana Ortega"
        />
      </Field>

      <Field label="Email" htmlFor="signup-email">
        <Input
          id="signup-email"
          data-testid="signup-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
        />
      </Field>

      <Field
        label="Password"
        htmlFor="signup-password"
        hint="At least 12 characters. Length is the only rule."
      >
        <Input
          id="signup-password"
          data-testid="signup-password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••••••"
        />
      </Field>

      {error !== null ? (
        <AuthMessage testId="signup-error">{error}</AuthMessage>
      ) : null}
      {notice !== null ? (
        <AuthMessage testId="signup-notice" tone="info">
          {notice}
        </AuthMessage>
      ) : null}

      <Button
        type="submit"
        data-testid={submitTestId}
        variant="primary"
        size="lg"
        disabled={pending}
        className="mt-1 w-full"
      >
        {pending ? "Creating…" : submitLabel}
      </Button>
    </form>
  );
}
