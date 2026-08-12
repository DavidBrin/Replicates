"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { SHEAR_DEG } from "./SkewPanel";

interface TileProps {
  label: string;
  sublabel?: string;
  /** Any CSS colour. The tile derives its slash and its shadow from it. */
  colour: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown on hover and focus when the tile is disabled. */
  tooltip?: string;
  onActivate?: () => void;
  className?: string;
  /** Roving tabindex: only the tile the menu cursor is on is tabbable. */
  tabIndex?: number;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocus?: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}

/**
 * One of the five mode tiles on the main menu.
 *
 * Two shears, not one. The tile itself leans twelve degrees like everything
 * else; the pale band across its face leans a further twelve, so the band cuts
 * the tile at an angle instead of running parallel to its edges. That crossing
 * is the "diagonal slash" — parallel bands read as a stripe, crossed ones read
 * as Smash.
 *
 * Out-of-scope modes stay on the screen and go grey rather than disappearing.
 * They are `aria-disabled` rather than `disabled` so they keep focus and can
 * explain themselves; a menu that silently omits four of its five entries
 * looks like an unfinished build rather than a deliberate scope (SPEC §12).
 */
export function Tile({
  label,
  sublabel,
  colour,
  icon,
  disabled = false,
  tooltip,
  onActivate,
  className,
  tabIndex,
  onKeyDown,
  onFocus,
  buttonRef,
}: TileProps) {
  const tipId = useId();

  return (
    <button
      ref={buttonRef}
      type="button"
      // Named explicitly rather than from its contents: the tile holds an
      // emblem and a two-line label, and the name computed from all of that
      // reads as a paragraph before it reaches the word the player wants.
      aria-label={sublabel ? `${label}. ${sublabel}` : label}
      aria-disabled={disabled || undefined}
      aria-describedby={disabled && tooltip ? tipId : undefined}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (!disabled) onActivate?.();
      }}
      className={cn(
        "group relative isolate overflow-visible border-[4px] border-panel-ink transition-transform duration-200",
        disabled ? "cursor-not-allowed" : "cursor-pointer hover:-translate-y-2 focus-visible:-translate-y-2",
        className,
      )}
      style={{
        transform: `skewX(${-SHEAR_DEG}deg)`,
        backgroundColor: disabled ? "#4a4d53" : colour,
        boxShadow: disabled ? "0 8px 0 rgb(0 0 0 / 0.35)" : `0 10px 0 rgb(0 0 0 / 0.45)`,
      }}
    >
      {/* The decoration is clipped by its own wrapper rather than by the
          button, because the button must stay `overflow-visible` for the
          tooltip to escape it. Without this the crossing band paints straight
          across the page behind the neighbouring tiles. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* the crossing band */}
        <span
          className="absolute inset-y-[-20%] left-[8%] w-[38%] opacity-70 mix-blend-screen"
          style={{
            transform: `skewX(${-SHEAR_DEG * 2}deg)`,
            background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.28) 45%, transparent)",
          }}
        />
        {/* the deeper wedge along the bottom, which is what gives the tiles
            their sense of being cut out of one continuous sheet */}
        <span
          className="absolute inset-x-0 bottom-0 h-1/2"
          style={{ background: "linear-gradient(180deg, transparent, rgb(0 0 0 / 0.45))" }}
        />
      </span>

      {/* `px-8`, not `px-4`: un-skewing the content makes its box wider than
          the parallelogram at the top and bottom edges, so anything flush to a
          corner hangs outside the shape. The extra padding is the shear's
          horizontal reach at this height. */}
      <span
        className="relative z-10 flex h-full w-full flex-col items-start justify-end gap-1 px-8 py-4 text-left"
        style={{ transform: `skewX(${SHEAR_DEG}deg)` }}
      >
        {icon ? <span className={cn("mb-2", disabled && "opacity-40")}>{icon}</span> : null}
        <span
          className={cn(
            "font-display text-2xl leading-none tracking-[0.06em] uppercase sm:text-3xl",
            disabled ? "text-white/45" : "text-white drop-shadow-[0_3px_0_rgb(0_0_0/0.55)]",
          )}
        >
          {label}
        </span>
        {sublabel ? (
          <span className={cn("text-xs font-bold tracking-wide", disabled ? "text-white/35" : "text-white/80")}>
            {sublabel}
          </span>
        ) : null}
      </span>

      {disabled && tooltip ? (
        <span
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute -bottom-3 left-1/2 z-30 w-56 -translate-x-1/2 translate-y-full border-[3px] border-panel-ink bg-panel-bone px-3 py-2 text-xs leading-snug font-bold text-panel-ink opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ transform: `translate(-50%, 100%) skewX(${SHEAR_DEG}deg)` }}
        >
          {tooltip}
        </span>
      ) : null}
    </button>
  );
}
