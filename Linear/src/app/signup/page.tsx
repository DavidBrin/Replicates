import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { homeHref } from "@/components/auth/home";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { currentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Create account" };

/**
 * `/signup`.
 *
 * Deliberately does **not** create a workspace. A brand-new account with no
 * membership lands back on the marketing page, because the alternative — minting
 * an empty workspace per sign-up — is how a multi-tenant demo fills with
 * single-member shells nobody asked for. Membership arrives through an
 * invitation (`/invite/[token]`), which is the flow this product is actually
 * about; `DECISIONS.md` D11 states the trade that makes those links the only
 * available channel.
 */
export default async function SignUpPage() {
  const user = await currentUser();
  const home = await homeHref(user);
  if (home !== null) redirect(home);

  return (
    <AuthShell
      title="Create your account"
      subtitle="Then accept an invitation to join a workspace."
      footer={
        <>
          Already have one?{" "}
          <Link href="/signin" className="text-accent-text hover:underline">
            Sign in
          </Link>
          .
        </>
      }
    >
      <SignUpForm redirectTo="/" />
    </AuthShell>
  );
}
