import Link from "next/link";
import type { ReactNode } from "react";

export interface HeroProps {
  /** The live demo card (or a fallback), rendered beside the headline on
   * wide screens and beneath it on narrow ones — SPEC §3.1's "show, don't
   * tell" moment, positioned to land inside the three-second window. */
  demo: ReactNode;
}

/**
 * The full-bleed dark hero (SPEC §3.1): oversized "wanna bet?" display
 * type, the full slogan, and the two CTAs. A soft indigo glow behind the
 * headline gives the page its own identity (SPEC §7.1) without any hex
 * literal — it's a radial gradient built from the `--accent` token.
 */
export function Hero({ demo }: HeroProps) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-(--accent) opacity-[0.16] blur-[140px]"
      />
      <div className="relative mx-auto grid w-full max-w-[1320px] grid-cols-1 items-center gap-12 px-6 pt-6 pb-20 sm:px-10 sm:pt-10 sm:pb-28 xl:grid-cols-[1.1fr_0.9fr] xl:gap-16">
        <div className="flex flex-col items-start gap-7">
          <span className="rounded-(--radius-pill) border border-(--border-2) bg-(--surface-2) px-3 py-1 text-xs font-medium text-(--text-2)">
            A private prediction market for your people
          </span>

          <h1 className="text-[15vw] leading-[0.92] font-semibold tracking-[-0.04em] text-(--text-1) sm:text-[96px] xl:text-[104px]">
            wanna
            <br />
            bet?
          </h1>

          <p className="max-w-md text-lg leading-relaxed text-(--text-2) sm:text-xl">
            make the groupchat put their money where their mouth is.
          </p>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            {/* CTAs are navigational, so they're `<a>` (via `Link`) styled
             * to match `Button`'s primary/secondary look — `Button` itself
             * only ever renders a `<button>` (G9: "Buttons are <button>,
             * links are <a>"), so it isn't reused here. */}
            <Link
              href="/signin"
              className="inline-flex h-12 w-full items-center justify-center rounded-(--radius-input) bg-(--accent) px-6 text-base font-medium text-(--surface-0) transition-colors hover:bg-(--accent-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0) sm:w-auto"
            >
              Start betting
            </Link>
            <Link
              href="/explore"
              className="inline-flex h-12 w-full items-center justify-center rounded-(--radius-input) border border-(--border) bg-(--surface-3) px-6 text-base font-medium text-(--text-1) transition-colors hover:border-(--border-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0) sm:w-auto"
            >
              See public markets
            </Link>
          </div>
        </div>

        <div className="w-full xl:justify-self-end">{demo}</div>
      </div>
    </section>
  );
}
