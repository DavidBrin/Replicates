import type { ReactNode } from "react";

import { SkewPanel } from "@/components/ui/SkewPanel";
import { SmashEmblem } from "./TitleScreen";

/**
 * The screen shown when the game stops for a reason that is not a result.
 *
 * Ultimate has a name for this and it is not "error": a match that ends without
 * a winner — someone quit, someone was disconnected — reports **NO CONTEST**,
 * on the same plate the results would have used. Borrowing it costs nothing and
 * means the two ways this app can stop short are already in the player's
 * vocabulary, rather than being a browser page wearing the game's colours.
 *
 * Shared by `not-found` and `error` because they differ only in their sentence
 * and their way out. What they must *not* differ in is the frame: a 404 that
 * looked like a different application would read as the app having been
 * replaced rather than as one screen being missing.
 *
 * Deliberately not used by `global-error`. That one renders in place of the
 * root layout, so the fonts and the stylesheet this depends on are exactly what
 * is not guaranteed to be there — see the note in that file.
 */
export function StopScreen({
  /** The plate. Two or three words, in the game's voice — "No contest". */
  heading,
  /** One sentence saying what happened, in the interface's voice, not a person's. */
  message,
  /** Technical detail worth keeping, shown small. Omitted when there is none. */
  detail,
  /** The way out. Always present — a stop screen with no exit is a dead end. */
  action,
}: {
  heading: string;
  message: string;
  detail?: string;
  action: ReactNode;
}) {
  return (
    <main className="hatch relative flex h-dvh w-full flex-col items-center justify-center overflow-hidden bg-panel-bone text-panel-ink">
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 38%, rgb(255 255 255 / 0.95) 0%, rgb(233 229 220 / 0.9) 45%, rgb(198 192 182 / 0.9) 100%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center gap-7 px-6">
        <SmashEmblem className="w-16 opacity-80" decorative />

        <h1
          className="font-display text-[clamp(2.6rem,10vw,5.5rem)] leading-none tracking-[0.02em] text-panel-ink uppercase drop-shadow-[0_5px_0_rgb(173_0_0/0.95)]"
          style={{ transform: "skewX(-12deg)" }}
        >
          {heading}
        </h1>

        <p className="text-center text-base font-bold text-panel-ink/70">{message}</p>

        {detail ? (
          <SkewPanel
            className="max-w-full border-[3px] border-panel-ink bg-panel-ink/5"
            innerClassName="px-5 py-3"
          >
            <code className="block overflow-x-auto text-center font-mono text-xs break-words text-panel-ink/60">
              {detail}
            </code>
          </SkewPanel>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center justify-center gap-4">{action}</div>
      </div>

      {/* The same red band the title screen ends on, so the two screens are
          plainly the same application. */}
      <div className="absolute inset-x-0 bottom-0 z-10" aria-hidden>
        <div
          className="red-ground h-24 border-t-[4px] border-panel-ink"
          style={{ clipPath: "polygon(0 34%, 100% 0, 100% 100%, 0 100%)" }}
        />
      </div>
    </main>
  );
}
