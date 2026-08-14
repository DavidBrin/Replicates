import Link from "next/link";

import { Shortcut } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";

import { AppPreview } from "./app-preview";
import { GlassButton, InvertedButton } from "./marketing-chrome";

/**
 * The hero.
 *
 * ## The claim is the product's own
 *
 * *"The system for modern product development"* — measured off the live
 * `linear.app` H1 at 64px / weight 510 / 67.84px line-height / −1.408px
 * tracking (`research/extracted/marketing-components.json`). −1.408 ÷ 64 is
 * −0.022em exactly, which is the display tracking rule in
 * `research/01-visual-design.md` §2.5: **body tracks −0.011 to −0.013em,
 * display tracks −0.022em.**
 *
 * That negative tracking is the single most transferable thing on this page. A
 * 64px headline at default tracking reads as a template; the same words at
 * −0.022em read as a design system. It costs one declaration.
 *
 * ## Why the type scale is arbitrary values and not tokens
 *
 * `globals.css` carries the *application*'s scale, which tops out at 36px
 * (`--text-title1`) because nothing in an issue tracker is bigger than a page
 * title. The marketing scale is a second, larger ramp (§2.5, `--title-4`
 * through `--title-9`) that no app surface uses. Rather than push five unused
 * custom properties into the shared token block — which another slice owns —
 * the display sizes are stated here, where the only page that needs them lives.
 * Colours remain tokens without exception; it is the *sizes* that are local.
 *
 * The `clamp()` is not decoration either: 64px is a 1440px-viewport
 * measurement, and the same headline at 390px needs to be 34px or it wraps to
 * six lines.
 */

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pt-20 pb-16 sm:pt-28">
      {/* A single soft brand wash behind the headline. One gradient, mixed from
          the accent token — a marketing page with three of these is a template,
          and one placed under the fold's centre of gravity is a product. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-[-30%] h-[70vh]",
          "[background:radial-gradient(60%_50%_at_50%_40%,color-mix(in_oklab,var(--accent)_18%,transparent),transparent_70%)]",
        )}
      />

      <div className="relative mx-auto flex max-w-[1024px] flex-col items-center text-center">
        <p
          className={cn(
            "mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--bg-translucent)]",
            "bg-[var(--bg-translucent)] px-3 py-1 text-mini text-tertiary",
          )}
        >
          <span className="size-1.5 rounded-full bg-[var(--accent)]" />
          Issues, projects and teams — with real permissions
        </p>

        <h1
          className={cn(
            "max-w-[15ch] text-primary [font-weight:510]",
            "text-[clamp(2.125rem,7vw,4rem)] leading-[1.06] [letter-spacing:-0.022em]",
          )}
        >
          The system for modern product development
        </h1>

        <p
          className={cn(
            "mt-6 max-w-[46ch] text-tertiary",
            "text-[clamp(1rem,2.2vw,1.0625rem)] leading-[1.6]",
          )}
        >
          Plan, build and ship without the mouse. A command menu that knows what
          you have selected, a shortcut map you learn in an afternoon, and an
          authorization model that actually holds.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" data-testid="hero-signup">
            <InvertedButton size="lg">Start free</InvertedButton>
          </Link>
          <Link href="/signin" data-testid="hero-signin">
            <GlassButton size="lg">Sign in to the demo</GlassButton>
          </Link>
        </div>

        <p className="mt-4 flex items-center gap-2 text-micro text-quaternary">
          Four seeded accounts, four permission levels. Press
          <Shortcut keys="mod+k" />
          anywhere inside.
        </p>

        <div className="mt-14 w-full max-w-[920px]">
          <AppPreview />
        </div>
      </div>
    </section>
  );
}
