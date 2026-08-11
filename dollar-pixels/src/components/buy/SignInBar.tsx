"use client";

/**
 * Sign-in, such as it is: a display name and nothing else.
 *
 * The copy says so plainly. There is no password, no email and no verification
 * anywhere in this product, so a bar that looked like a real login would be
 * lying about what it does — anyone can sign in as any name, including yours.
 */

import { useState } from "react";
import type { User } from "@/domain/entities";
import { api } from "@/lib/api-client";
import { Button, Callout, Field } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface SignInBarProps {
  readonly user: User | null;
  readonly onChange: (user: User | null) => void;
  readonly className?: string;
}

export function SignInBar({ user, onChange, className }: SignInBarProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(): Promise<void> {
    setError(null);
    const displayName = name.trim();
    if (!displayName) {
      setError("Type a name first.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.signIn(displayName);
      setName("");
      onChange(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await api.signOut();
      onChange(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 border border-(--rule) bg-(--panel-2) px-3 py-2 text-sm",
          className,
        )}
      >
        <span>
          Signed in as <strong>{user.displayName}</strong>{" "}
          <span className="text-(--ink-3)">@{user.handle}</span>
        </span>
        <Button size="sm" variant="secondary" onClick={() => void signOut()} loading={busy}>
          Sign out
        </Button>
        {error ? <Callout tone="danger">{error}</Callout> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border border-(--rule) bg-(--panel-2) px-3 py-2",
        className,
      )}
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void signIn();
        }}
      >
        <Field
          label="Display name"
          value={name}
          maxLength={128}
          autoComplete="off"
          placeholder="Anything you like"
          onChange={(event) => setName(event.target.value)}
          className="min-w-48 flex-1"
        />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="text-xs text-(--ink-2)">
        No password, no email, no check of any kind: anyone can sign in as any name, and
        the name is only there so your claims have something to be under.
      </p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  );
}
