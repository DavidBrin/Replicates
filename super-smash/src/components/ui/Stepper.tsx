"use client";

import { cn } from "@/lib/cn";
import { clamp } from "@/lib/matchConfig";
import { SHEAR_DEG } from "./SkewPanel";

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  label: string;
  /** How the number reads to a human — "2:30" for a time, "3" for stocks. */
  format?: (value: number) => string;
  className?: string;
  /** `red` is the character select's CPU-level plate: red numerals on bone. */
  tone?: "yellow" | "red";
  size?: "sm" | "md";
  /**
   * Set inside an already-sheared card. The parts then take the card's lean by
   * inheritance instead of adding a second one on top of it — two shears
   * compound into a 24° lurch that looks like a rendering fault.
   */
  inheritShear?: boolean;
}

const SIZES = {
  sm: { button: "size-7 text-lg", value: "min-w-[2.6rem] px-2 text-2xl", gap: "gap-1" },
  md: { button: "size-11 text-2xl", value: "min-w-[5.5rem] px-4 text-3xl", gap: "gap-2" },
} as const;

/**
 * A number with a minus and a plus, which is how Ultimate edits every count it
 * owns.
 *
 * Clamping lives in the component as well as in the store: the buttons go
 * disabled at the bounds so the player can see where the range ends, and the
 * store clamps again because the CPU-level row is also driven by the arrow
 * keys and by tests, neither of which goes through these buttons.
 */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format = String,
  className,
  tone = "yellow",
  size = "md",
  inheritShear = false,
}: StepperProps) {
  const atMin = value <= min;
  const atMax = value >= max;
  const commit = (next: number) => onChange(clamp(next, min, max));
  const s = SIZES[size];
  const lean = inheritShear ? undefined : `skewX(${-SHEAR_DEG}deg)`;

  // No group label: the two buttons and the readout already name themselves,
  // and a third element answering to the same name makes the value ambiguous
  // to anything looking it up by label.
  return (
    <div className={cn("inline-flex items-stretch", s.gap, className)}>
      <StepButton
        label={`Decrease ${label}`}
        sign="−"
        size={size}
        lean={lean}
        disabled={atMin}
        onClick={() => commit(value - step)}
      />
      <output
        aria-label={label}
        aria-live="polite"
        className={cn(
          "grid place-items-center border-[3px] border-panel-ink font-display leading-none",
          s.value,
          tone === "yellow" ? "bg-panel-bone text-panel-ink" : "bg-panel-bone text-smash-red",
        )}
        style={{ transform: lean }}
      >
        <span className="pt-1 tabular-nums" style={{ transform: `skewX(${SHEAR_DEG}deg)` }}>
          {format(value)}
        </span>
      </output>
      <StepButton
        label={`Increase ${label}`}
        sign="+"
        size={size}
        lean={lean}
        disabled={atMax}
        onClick={() => commit(value + step)}
      />
    </div>
  );
}

function StepButton({
  label,
  sign,
  size,
  lean,
  disabled,
  onClick,
}: {
  label: string;
  sign: string;
  size: "sm" | "md";
  lean: string | undefined;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid place-items-center border-[3px] border-panel-ink font-display leading-none transition-colors",
        SIZES[size].button,
        disabled
          ? "cursor-not-allowed bg-[#2a2d33] text-white/25"
          : "bg-smash-yellow text-panel-ink hover:bg-smash-yellow-lit",
      )}
      style={{ transform: lean }}
    >
      <span style={{ transform: `skewX(${SHEAR_DEG}deg)` }}>{sign}</span>
    </button>
  );
}
