import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { homeHref } from "@/components/auth/home";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { Hero } from "@/components/marketing/hero";
import {
  KeyboardSection,
  PermissionsSection,
} from "@/components/marketing/keyboard-section";
import {
  GlassButton,
  InvertedButton,
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/marketing-chrome";
import { currentUser } from "@/lib/auth/current-user";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: {
    absolute: "Linear — the system for modern product development",
  },
  description:
    "Issues, projects and teams for software teams that move quickly. " +
    "Keyboard-first, with a command menu that reads your selection and an " +
    "authorization model that holds.",
};

/**
 * `/` — the marketing page, and the redirect a signed-in visitor gets.
 *
 * ## Why a signed-in visitor is sent onward
 *
 * The sign-in and sign-up forms navigate here rather than to a workspace,
 * because the session cookie is `httpOnly`: the client cannot read the session
 * it was just given, and the workspace to land in is a property of the account
 * rather than of the page the visitor came from. `/` is the one route that is
 * guaranteed to exist and is always rendered on the server, so it is where the
 * question "which workspace is this?" can actually be answered. See
 * `components/auth/home.ts`.
 *
 * The cost is that a signed-in visitor cannot read the marketing page, which is
 * why `?preview` exists — one parameter, so a reviewer with a live session can
 * still see the page a visitor sees. Without it, the only way to look at this
 * page after signing in once is to sign out.
 *
 * ## Everything here is a server component
 *
 * There is no `"use client"` anywhere in `components/marketing`. The page ships
 * no interactive JavaScript at all: the product shot is real components with
 * fixture data, the shortcut chips read the keyboard registry at render time,
 * and the only client work on the page is the `Kbd` component asking the
 * platform whether to draw ⌘ or Ctrl.
 */
export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ preview }, user] = await Promise.all([
    searchParams,
    currentUser(),
  ]);
  const home = await homeHref(user);

  // `redirect()` throws, so nothing below runs for a signed-in visitor without
  // `?preview`.
  if (home !== null && preview === undefined) redirect(home);

  return (
    <div className="min-h-dvh bg-[var(--bg-sidebar)] text-primary">
      <MarketingHeader signedInHref={home} />

      <main>
        <Hero />
        <FeatureGrid />
        <KeyboardSection />
        <PermissionsSection />

        <section className="px-6 pb-24">
          <div
            className={cn(
              "mx-auto flex max-w-[1024px] flex-col items-center gap-6 rounded-[var(--radius-xl)]",
              "border border-subtle bg-[var(--bg-panel)] px-6 py-14 text-center",
            )}
          >
            <h2
              className={cn(
                "max-w-[22ch] text-primary [font-weight:510]",
                "text-[clamp(1.5rem,4vw,2rem)] leading-[1.125] [letter-spacing:-0.022em]",
              )}
            >
              The demo workspace is already seeded
            </h2>
            <p className="max-w-[52ch] text-regular leading-[1.6] text-tertiary">
              Three teams, forty issues across every workflow state, three
              projects with milestones, and four accounts at four permission
              levels — so the authorization rules have something to be true
              about.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/signin" data-testid="cta-signin">
                <InvertedButton size="lg">Sign in to the demo</InvertedButton>
              </Link>
              <Link href="/signup" data-testid="cta-signup">
                <GlassButton size="lg">Create an account</GlassButton>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
