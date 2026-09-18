import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { DemoSignIn } from "@/components/auth/demo-sign-in";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  homeHref,
} from "@/components/auth/home";
import { currentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `/signin` — pick a seeded demo account.
 *
 * A server component around a client chooser, for one reason: a visitor who is
 * already signed in must not see a sign-in page. Deciding that on the client
 * means rendering the screen, discovering the session, and replacing it — a
 * flash of the wrong page on every visit from a signed-in tab. The cookie is
 * `httpOnly`, so the server is the only place the question can be answered at
 * all. `redirect()` throws, so nothing below it runs.
 *
 * ## Why there is no form and no "create one" link
 *
 * This is a portfolio demo. The only honest way in is to become one of the four
 * seeded accounts, so that is all this page offers — the typable email/password
 * form is archived (`components/auth/sign-in-form.tsx`, mounted nowhere) and the
 * open sign-up page is gone (`/signup` redirects here; see `next.config.ts`),
 * because a self-serve account had no workspace to land in and nowhere to go.
 * Real membership still arrives the way the product intends — an invitation, at
 * `/invite/[token]`, which is untouched.
 */
export default async function SignInPage() {
  const user = await currentUser();
  const home = await homeHref(user);
  if (home !== null) redirect(home);

  return (
    <AuthShell
      title="Sign in"
      subtitle="A live demo — pick a seeded account to open the workspace. No password to type."
    >
      <DemoSignIn
        redirectTo="/"
        demoAccounts={DEMO_ACCOUNTS}
        demoPassword={DEMO_PASSWORD}
      />
    </AuthShell>
  );
}
