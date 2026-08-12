import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { SHEAR_DEG, SkewPanel } from "./SkewPanel";

type Tone = "dark" | "light" | "red";

const TONES: Record<Tone, string> = {
  dark: "bg-[#16181c] text-white",
  light: "bg-panel-bone text-panel-ink",
  red: "red-ground text-white",
};

const HEADERS: Record<Tone, string> = {
  dark: "bg-smash-yellow text-panel-ink",
  light: "bg-panel-ink text-white",
  red: "bg-smash-yellow text-panel-ink",
};

interface PanelProps {
  title?: ReactNode;
  tone?: Tone;
  angle?: number;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

/**
 * The workhorse: a sheared plate with a heavy ink rule around it and an
 * optional title bar sitting slightly proud of the top-left corner, the way
 * Ultimate hangs its section headings off the panel rather than inside it.
 */
export function Panel({
  title,
  tone = "dark",
  angle = SHEAR_DEG,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  return (
    <div className={cn("relative", className)}>
      {title ? (
        <SkewPanel
          angle={angle}
          className="mb-[-2px] ml-6 inline-block border-[3px] border-panel-ink px-1"
          innerClassName={cn(
            "px-4 py-1 font-display text-lg tracking-[0.14em] uppercase",
            HEADERS[tone],
          )}
          style={{ backgroundColor: "transparent" }}
        >
          {title}
        </SkewPanel>
      ) : null}
      <SkewPanel
        angle={angle}
        className={cn("border-[3px] border-panel-ink shadow-[0_10px_0_rgb(0_0_0/0.35)]", TONES[tone])}
        innerClassName={cn("p-5", bodyClassName)}
      >
        {children}
      </SkewPanel>
    </div>
  );
}

/**
 * The red banner that runs across the top of every in-flow screen: back arrow
 * on the left, a yellow parallelogram tab naming the mode, and whatever the
 * screen wants on the right. Reproduced from the character select header,
 * which is where Ultimate establishes the pattern.
 */
export function ScreenBanner({
  onBack,
  backLabel = "Back",
  tab,
  children,
}: {
  onBack?: () => void;
  backLabel?: string;
  tab: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="relative isolate">
      {/* The banner is a shallow parallelogram in its own right: its bottom
          edge runs down to the right, which is what puts the mode tab on a
          slope rather than on a shelf. */}
      <div
        className="red-ground absolute inset-0 -z-10 border-b-[3px] border-panel-ink"
        style={{ clipPath: "polygon(0 0, 100% 0, 100% 82%, 0 100%)" }}
        aria-hidden
      />
      <div className="flex items-center gap-4 px-5 pt-4 pb-8 sm:gap-6 sm:px-8">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="grid size-11 shrink-0 place-items-center rounded-full border-[3px] border-panel-ink bg-panel-bone text-panel-ink transition hover:bg-smash-yellow"
          >
            <svg viewBox="0 0 24 24" className="size-6" aria-hidden focusable="false">
              <path
                d="M15 4 7 12l8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        {tab}
        <div className="ml-auto flex items-center gap-3">{children}</div>
      </div>
    </header>
  );
}

/** The yellow mode tab with its dropdown caret, as on the character select. */
export function ModeTab({ label, caret = true }: { label: string; caret?: boolean }) {
  return (
    <SkewPanel
      className="border-[3px] border-panel-ink bg-smash-yellow shadow-[0_6px_0_rgb(0_0_0/0.4)]"
      innerClassName="flex items-center gap-3 px-6 py-2 text-panel-ink"
    >
      <span className="font-display text-xl tracking-[0.16em] uppercase sm:text-2xl">{label}</span>
      {caret ? (
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden focusable="false">
          <path d="M3 6.5 10 14l7-7.5" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </SkewPanel>
  );
}
