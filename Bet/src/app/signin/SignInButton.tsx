"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

export interface SignInButtonProps {
  userId: string;
  children: ReactNode;
}

/**
 * The one interactive bit of `/signin` (SPEC: "a plain server-rendered grid
 * of seeded demo users as cards; clicking one posts to `/api/session` and
 * redirects to `/app`"). Everything else on the page is a Server Component;
 * this is pushed down to a leaf client component per research/stack.md's
 * "Server Components vs Client Components" guidance.
 */
export function SignInButton({ userId, children }: SignInButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
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
        setPending(false);
        return;
      }
      // The `bet_session` cookie is now set. A client-side navigation to
      // /app still goes through proxy.ts (it fetches the RSC payload over
      // HTTP, cookie included), so this doesn't need a hard reload.
      router.push("/app");
      router.refresh();
    } catch {
      setError("Sign-in failed. Try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending || undefined}
        className={cn(
          "w-full rounded-(--radius-card) text-left transition-opacity disabled:cursor-not-allowed",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
          pending && "opacity-60",
        )}
      >
        {children}
      </button>
      {error ? <p className="mt-2 text-sm text-(--no)">{error}</p> : null}
    </div>
  );
}
