import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  homeHref,
} from "@/components/auth/home";
import { SignInForm } from "@/components/auth/sign-in-form";
import { currentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `/signin`.
 *
 * A server component around a client form, for one reason: a visitor who is
 * already signed in must not see a sign-in page. Deciding that on the client
 * means rendering the form, discovering the session, and replacing it — a flash
 * of the wrong screen on every visit from a signed-in tab. The cookie is
 * `httpOnly`, so the server is the only place the question can be answered at
 * all.
 *
 * `redirect()` throws, so nothing below it runs.
 */
export default async function SignInPage() {
  const user = await currentUser();
  const home = await homeHref(user);
  if (home !== null) redirect(home);

  return (
    <AuthShell
      title="Sign in"
      subtitle="Issues, projects and teams — for people who would rather not touch the mouse."
      footer={
        <>
          No account?{" "}
          <Link href="/signup" className="text-accent-text hover:underline">
            Create one
          </Link>
          .
        </>
      }
    >
      <SignInForm
        redirectTo="/"
        demoAccounts={DEMO_ACCOUNTS}
        demoPassword={DEMO_PASSWORD}
      />
    </AuthShell>
  );
}
