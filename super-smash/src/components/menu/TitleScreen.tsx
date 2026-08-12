"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * The title screen.
 *
 * "Press any button" is taken literally: the listener is on the window and
 * accepts any key, because on a real console it accepts any button and a
 * player who has just sat down has no reason to guess which one. A pointer
 * works too — the whole screen is one button, which is also what makes it
 * reachable by a screen reader and by Tab.
 *
 * Advancing is guarded by a ref rather than by state: a player mashing at the
 * title screen fires several keydowns inside one frame, and two `router.push`
 * calls to the same route is a visible double transition.
 */
export function TitleScreen() {
  const router = useRouter();
  const advanced = useRef(false);

  const advance = () => {
    if (advanced.current) return;
    advanced.current = true;
    router.push("/menu");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Modifier-only presses are the player reaching for a shortcut, not
      // asking to start.
      if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") {
        return;
      }
      advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `advance` closes over a ref and the router, neither of which changes in
    // a way that should re-subscribe the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="hatch relative flex h-dvh w-full flex-col items-center justify-center overflow-hidden bg-panel-bone text-panel-ink">
      {/* The ground: warm paper, with a slow radial light behind the wordmark. */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 38%, rgb(255 255 255 / 0.95) 0%, rgb(233 229 220 / 0.9) 45%, rgb(198 192 182 / 0.9) 100%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6">
        <SmashEmblem className="w-24 sm:w-32" />

        {/* The wordmark is the one place the shear is applied to the *type*
            rather than to a panel around it. Everywhere else in the app a
            sheared plate carries upright words; a logo is a drawn shape, and
            Ultimate's leans. Hence a bare transform here instead of
            `SkewPanel`, whose whole job is to cancel the lean for its
            contents. */}
        <h1 className="flex flex-col items-center">
          <span
            className="font-display text-[clamp(1.9rem,6vw,4.5rem)] leading-none tracking-[0.1em] text-smash-red uppercase drop-shadow-[0_4px_0_rgb(9_11_12/0.85)]"
            style={{ transform: "skewX(-12deg)" }}
          >
            Super
          </span>
          <span
            className="mt-1 font-display text-[clamp(3.4rem,13vw,10rem)] leading-[0.92] tracking-[0.01em] text-panel-ink uppercase drop-shadow-[0_7px_0_rgb(173_0_0/0.95)]"
            style={{ transform: "skewX(-12deg)" }}
          >
            Smash
          </span>
        </h1>

        <p className="max-w-md text-center text-sm font-bold text-panel-ink/60">
          Eight fighters, one keyboard, sixty frames a second.
        </p>
      </div>

      {/* The red band, and the prompt sitting on it. */}
      <div className="absolute inset-x-0 bottom-0 z-10">
        <div
          className="red-ground relative border-t-[4px] border-panel-ink px-6 py-7 text-center"
          style={{ clipPath: "polygon(0 18%, 100% 0, 100% 100%, 0 100%)" }}
        >
          <p className="anim-press-pulse pt-3 font-display text-xl tracking-[0.35em] text-white uppercase sm:text-2xl">
            Press any button
          </p>
        </div>
      </div>

      {/* The pointer and keyboard target, laid over the whole screen rather
          than wrapped around it: a <button> may only contain phrasing content,
          and the wordmark is a heading. */}
      <button
        type="button"
        onClick={advance}
        aria-label="Press any button to continue"
        className="absolute inset-0 z-20 cursor-pointer"
      />
    </div>
  );
}

/**
 * The series emblem: a broken ring crossed by a plus whose arms overrun it.
 * Drawn rather than traced — the shape is four rectangles and a circle, and an
 * asset file for that would be a dependency for nothing.
 */
export function SmashEmblem({
  className,
  decorative,
}: {
  className?: string;
  /** Inside an already-named control the emblem is ornament, not information. */
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Super Smash emblem"}
      aria-hidden={decorative || undefined}
    >
      <circle
        cx="50"
        cy="50"
        r="34"
        fill="none"
        stroke="var(--panel-ink)"
        strokeWidth="9"
        strokeDasharray="150 40"
        strokeDashoffset="20"
        strokeLinecap="butt"
      />
      <g fill="var(--panel-ink)">
        <rect x="43" y="2" width="14" height="40" />
        <rect x="43" y="58" width="14" height="40" />
        <rect x="2" y="43" width="40" height="14" />
        <rect x="58" y="43" width="40" height="14" />
      </g>
      <circle cx="50" cy="50" r="13" fill="var(--smash-red)" stroke="var(--panel-ink)" strokeWidth="6" />
    </svg>
  );
}
