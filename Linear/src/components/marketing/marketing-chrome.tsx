import type { ReactNode } from "react";
import Link from "next/link";

import { Mark } from "@/components/auth/auth-shell";
import { cn } from "@/lib/cn";

/**
 * The marketing page's frame: header, footer, and the two button shapes.
 *
 * ## The buttons are pills and the app's are not
 *
 * `research/01-visual-design.md` §6.6 measures both and they disagree on
 * purpose: marketing CTAs are `border-radius: 9999px`, 40px tall, 15px text at
 * weight 510; the *application*'s controls resolve `--control-border-radius` to
 * **8px** at 32px tall. Building the app from marketing screenshots is how a
 * clone ends up with pills in its toolbar, which is instantly wrong. So the
 * marketing pill lives here, in the marketing directory, and `ui/button.tsx`
 * stays 8px.
 *
 * ## The inverted button, without a hard-coded hex
 *
 * The measured primary is `#e5e5e6` on `#08090a` — near-white fill, near-black
 * text. Rather than paste those, this paints `--text-primary` as the background
 * and `--bg-sidebar` as the text: in dark that resolves to `#f7f8f8` on
 * `#09090a`, within a point of the measurement, and in light it inverts
 * correctly instead of turning into a white button on a white page. The rule in
 * this project is tokens only, and an inverted control is exactly where a
 * literal would have been easiest and worst.
 *
 * ## The glass button's edge
 *
 * §6.6 gives the secondary's shadow stack verbatim: an inset hairline, an inset
 * top highlight, an outer ring and a soft drop. Reproduced here with
 * `--bg-translucent` (which *is* `#ffffff0d`, the measured value) so the whole
 * stack follows the theme.
 */

export function MarketingHeader({ signedInHref }: { signedInHref: string | null }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-[var(--bg-translucent)]",
        // 72px and a 20px blur, both measured (§6.4, `marketing-components.json`).
        "h-[72px] backdrop-blur-[20px]",
        "[background:color-mix(in_oklab,var(--bg-sidebar)_72%,transparent)]",
      )}
    >
      <div className="mx-auto flex h-full max-w-[1024px] items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2">
          <Mark size={18} />
          <span className="text-small text-primary [font-weight:var(--weight-title)]">
            Linear
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Sections">
          <HeaderLink href="#features">Features</HeaderLink>
          <HeaderLink href="#keyboard">Keyboard</HeaderLink>
          <HeaderLink href="#permissions">Permissions</HeaderLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {signedInHref === null ? (
            <>
              <Link href="/signin" className="hidden sm:block">
                <GlassButton>Sign in</GlassButton>
              </Link>
              <Link href="/signup">
                <InvertedButton size="sm">Get started</InvertedButton>
              </Link>
            </>
          ) : (
            <Link href={signedInHref} data-testid="open-app">
              <InvertedButton size="sm">Open app</InvertedButton>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        "text-small text-tertiary hover:text-primary",
        "[transition:color_0.16s_var(--ease-out-quad)]",
      )}
    >
      {children}
    </a>
  );
}

const PILL =
  "inline-flex shrink-0 select-none items-center justify-center rounded-full " +
  "[font-weight:510] [transition:all_0.16s_var(--ease-out-quad)]";

export function InvertedButton({
  children,
  size = "lg",
}: {
  children: ReactNode;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        PILL,
        size === "lg" ? "h-10 px-4 text-regular" : "h-8 px-3 text-small",
        "bg-[var(--text-primary)] text-[var(--bg-sidebar)]",
        "shadow-[var(--shadow-low)] hover:opacity-90",
      )}
    >
      {children}
    </span>
  );
}

export function GlassButton({
  children,
  size = "sm",
}: {
  children: ReactNode;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        PILL,
        size === "lg" ? "h-10 px-4 text-regular" : "h-8 px-3 text-small",
        "bg-[var(--bg-translucent)] text-primary",
        "shadow-[inset_0_0_0_1px_var(--bg-translucent),inset_0_1px_0_0_var(--bg-translucent),var(--shadow-low)]",
        "hover:bg-[var(--bg-hover)]",
      )}
    >
      {children}
    </span>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--bg-translucent)] py-10">
      <div className="mx-auto flex max-w-[1024px] flex-col gap-4 px-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Mark size={16} />
          <span className="text-mini text-tertiary">
            A rebuild of Linear&rsquo;s core, for study.
          </span>
        </div>
        <p className="text-micro text-quaternary sm:ml-auto">
          Not affiliated with Linear. No Linear marks are used —{" "}
          <span className="text-tertiary">linear.app/brand</span> forbids it, and
          the glyphs here are drawn rather than borrowed.
        </p>
      </div>
    </footer>
  );
}
