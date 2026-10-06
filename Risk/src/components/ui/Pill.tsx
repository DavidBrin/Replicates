"use client";

/**
 * The green primary button (SPEC §7.1, measured 238×48 — one of only two
 * redlined numbers in the whole screen section).
 *
 * Gradient `--go → --go-mid`, a 3 px `--go-deep` border, a 2 px lighter inner
 * top highlight, the `0 4px 0 --go-bezel` bezel, and a bold white ~24 px label
 * carrying the board's dark outline (`.on-board-text`). Pressing it scales to
 * 0.96 while the bezel collapses 4 → 1 px over 90 ms (§8 motion).
 *
 * `size="hero"` is the Home screen's ~290×72 `BATTLE` pill.
 */
import { useState } from "react";
import clsx from "clsx";

export type PillVariant = "primary" | "danger" | "disabled";
export type PillSize = "primary" | "hero";

export interface PillProps {
  readonly label: string;
  readonly onClick?: () => void;
  readonly variant?: PillVariant;
  readonly size?: PillSize;
  /** Forces the flat `--disabled` chassis and blocks the click. */
  readonly disabled?: boolean;
  readonly testId?: string;
  readonly className?: string;
  readonly type?: "button" | "submit";
  readonly ariaLabel?: string;
}

interface Chassis {
  readonly background: string;
  readonly borderColor: string;
  readonly bezel: string;
  readonly highlight: string;
}

const CHASSIS: Record<PillVariant, Chassis> = {
  primary: {
    background: "linear-gradient(var(--go), var(--go-mid))",
    borderColor: "var(--go-deep)",
    bezel: "var(--go-bezel)",
    highlight: "rgba(255,255,255,.45)",
  },
  danger: {
    background: "linear-gradient(var(--danger), var(--danger-deep))",
    borderColor: "var(--danger-deep)",
    bezel: "var(--danger-deep)",
    highlight: "rgba(255,255,255,.35)",
  },
  disabled: {
    background: "var(--disabled)",
    borderColor: "var(--disabled-line)",
    bezel: "var(--disabled-line)",
    highlight: "rgba(255,255,255,.14)",
  },
};

/** 238×48 measured; the hero is ~290×72. Both shrink rather than overflow. */
const SIZES: Record<PillSize, { readonly width: string; readonly height: number; readonly font: string }> = {
  primary: { width: "clamp(180px, 42vw, 238px)", height: 48, font: "clamp(18px, 3.2vw, 24px)" },
  hero: { width: "clamp(220px, 58vw, 290px)", height: 72, font: "clamp(26px, 5vw, 36px)" },
};

export function Pill({
  label,
  onClick,
  variant = "primary",
  size = "primary",
  disabled = false,
  testId,
  className,
  type = "button",
  ariaLabel,
}: PillProps) {
  const [pressed, setPressed] = useState(false);
  const effective: PillVariant = disabled ? "disabled" : variant;
  const chassis = CHASSIS[effective];
  const box = SIZES[size];
  const down = pressed && !disabled;

  return (
    <button
      type={type}
      data-testid={testId ?? "pill"}
      data-variant={effective}
      data-size={size}
      data-pressed={down ? "true" : "false"}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      className={clsx(
        "on-board-text relative inline-flex select-none items-center justify-center",
        "rounded-[var(--r-pill)] border-[3px] outline-none",
        "focus-visible:ring-4 focus-visible:ring-white/70",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
      style={{
        width: box.width,
        height: box.height,
        maxWidth: "100%",
        minHeight: 44,
        fontSize: box.font,
        letterSpacing: ".02em",
        background: chassis.background,
        borderColor: chassis.borderColor,
        boxShadow: `0 ${down ? 1 : 4}px 0 ${chassis.bezel}`,
        transform: down ? "scale(.96)" : "scale(1)",
        transition: "transform 90ms ease-out, box-shadow 90ms ease-out",
        opacity: disabled ? 0.85 : 1,
      }}
    >
      {/* the 2 px lighter inner top highlight */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[6%] top-[3px] h-[2px] rounded-full"
        style={{ background: chassis.highlight }}
      />
      {label}
    </button>
  );
}

export default Pill;
