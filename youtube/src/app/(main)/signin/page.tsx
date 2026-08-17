import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { SESSION_COOKIE, resolveSession } from "@/lib/auth";

import { SignInForm } from "./sign-in-form";

/**
 * `/signin`.
 *
 * Inside `(main)` so it wears the ordinary chrome. A dedicated full-page
 * sign-in surface is what a real identity provider does, and this is not one —
 * a visitor arriving here from the masthead's Sign in button should be able to
 * change their mind and click Home.
 *
 * ## The `next` parameter, and why it is validated
 *
 * `/studio/upload` redirects here when signed out, and the point of doing so
 * is landing back where you were trying to go. So the destination travels in
 * the query string — and a redirect target taken from a URL is an open
 * redirect unless it is checked. Only a path beginning with a single `/` is
 * accepted, which excludes `//evil.example` (a protocol-relative absolute URL
 * wearing a leading slash) and anything with a scheme.
 */
export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

function safeNext(raw: string | undefined): string {
  if (typeof raw !== "string" || raw === "") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(
    Array.isArray(params.next) ? params.next[0] : params.next,
  );

  // Already signed in: there is nothing to do here, and showing an empty form
  // to someone with a session reads as "your sign-in did not take".
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  if (await resolveSession(token)) redirect(next);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col items-center gap-6 px-6 py-16">
      <h1 className="text-heading font-[var(--yt-weight-bold)] text-primary">
        Sign in
      </h1>
      <p className="max-w-[400px] text-body text-secondary">
        Signing in lets you upload, subscribe, comment and keep a watch
        history. Accounts live in this application&apos;s own database.
      </p>
      <SignInForm next={next} />
    </div>
  );
}
