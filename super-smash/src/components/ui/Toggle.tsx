"use client";

import { cn } from "@/lib/cn";
import { SHEAR_DEG } from "./SkewPanel";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Ultimate's rules screen puts an ON/OFF pill at the right of each row, and
 * the pill leans with everything else. It is a `role="switch"` rather than a
 * checkbox so a screen reader announces the state as on/off — which is what
 * the label says — instead of checked/unchecked.
 */
export function Toggle({
  checked,
  onChange,
  label,
  onLabel = "ON",
  offLabel = "OFF",
  disabled,
  className,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-10 w-[7.5rem] items-center border-[3px] border-panel-ink bg-[#2a2d33]",
        disabled && "opacity-40",
        className,
      )}
      style={{ transform: `skewX(${-SHEAR_DEG}deg)` }}
    >
      {/*
        The knob carries the colour, and the track stays dark whichever way it
        is thrown. Colouring the *track* yellow when on puts a bright block
        behind the word OFF, which reads as "OFF is the live one" — the exact
        opposite of what the control is saying.
      */}
      <span
        className={cn(
          "pointer-events-none absolute top-[-3px] bottom-[-3px] w-1/2 border-[3px] border-panel-ink transition-[left] duration-150",
          checked ? "left-1/2 bg-smash-yellow" : "left-[-3px] bg-cpu-grey-dim",
        )}
        aria-hidden
      />
      <span
        className="pointer-events-none relative z-10 grid w-full grid-cols-2 font-display text-sm tracking-[0.12em]"
        style={{ transform: `skewX(${SHEAR_DEG}deg)` }}
        aria-hidden
      >
        <span className={cn(checked ? "text-white/35" : "text-panel-ink")}>{offLabel}</span>
        <span className={cn(checked ? "text-panel-ink" : "text-white/35")}>{onLabel}</span>
      </span>
    </button>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
  className?: string;
}

/**
 * The Stock / Time choice. Two sheared tabs where the live one is yellow and
 * lifts, exactly as the selected mode tab does on the main menu.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-2", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "border-[3px] border-panel-ink px-6 py-2 font-display text-lg tracking-[0.14em] uppercase transition-transform",
              active
                ? "bg-smash-yellow text-panel-ink shadow-[0_6px_0_rgb(0_0_0/0.4)]"
                : "bg-[#2a2d33] text-white/70 hover:bg-[#383c44]",
            )}
            // The lift rides in the same transform as the shear rather than in
            // a utility class: an inline transform replaces the class outright,
            // so the two cannot be combined and the class would be dead code.
            style={{ transform: `skewX(${-SHEAR_DEG}deg)${active ? " translateY(-2px)" : ""}` }}
          >
            <span className="inline-block" style={{ transform: `skewX(${SHEAR_DEG}deg)` }}>
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
