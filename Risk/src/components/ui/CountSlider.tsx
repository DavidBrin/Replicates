"use client";

/**
 * The count slider (SPEC §7.2), the one dialog three phases share:
 * `Deploy Troops`, `Fortify Troops` and `Move Troops` — titles verbatim.
 *
 * A full-width dark strip (h 138, `rgba(10,45,55,.55)`) with the red ✗ at
 * r 40 on the left, the green ✓ at r 40 on the right, and five numerals at
 * the measured x positions 553/678/800/925/1050 of the 1600 px frame — here
 * as percentages so the strip is one design scaled (§8 Responsive). The
 * selected value sits inside the notched ring; its neighbours are
 * `#C9CFD2` and fade to `--text-dim` with distance.
 *
 * It is draggable horizontally (the numerals scroll through), every numeral
 * is tappable, and §9's keyboard column is wired as an **additive** path:
 * `1` `5` `0` set 1 / 5 / max, `A` = all, `Enter` confirms, `Esc` cancels.
 * `Move All` is ours and jumps to max.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

import { IconButton } from "./IconButton";
import { NotchedRing } from "./NotchedRing";
import { SETUP_TOKENS } from "./tokens";

/** The three verbatim titles of §7.2. */
export type CountSliderTitle = "Deploy Troops" | "Fortify Troops" | "Move Troops";

export interface CountSliderProps {
  readonly title: CountSliderTitle | string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Shows the `Move All` button (ours — §7.2). */
  readonly showMoveAll?: boolean;
  readonly testId?: string;
}

/** x 553/678/800/925/1050 at 1600 wide, as percentages of the strip. */
const NUMERAL_X = [34.56, 42.38, 50, 57.81, 65.63] as const;
/** Pointer travel that advances one step while dragging. */
const PX_PER_STEP = 48;

export function CountSlider({
  title,
  min,
  max,
  value,
  onChange,
  onConfirm,
  onCancel,
  showMoveAll = false,
  testId,
}: CountSliderProps) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clamp = useCallback((n: number) => Math.max(lo, Math.min(hi, Math.round(n))), [lo, hi]);
  const current = clamp(value);

  const drag = useRef<{ readonly x: number; readonly from: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (event.key) {
        case "1": onChange(clamp(1)); break;
        case "5": onChange(clamp(5)); break;
        case "0": onChange(hi); break;
        case "a": case "A": onChange(hi); break;
        case "ArrowLeft": onChange(clamp(current - 1)); break;
        case "ArrowRight": onChange(clamp(current + 1)); break;
        case "Enter": onConfirm(); break;
        case "Escape": onCancel(); break;
        default: return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clamp, current, hi, onCancel, onChange, onConfirm]);

  const id = testId ?? "count-slider";

  return (
    <div
      data-testid={id}
      data-value={current}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="relative w-full select-none"
      style={{ zIndex: "var(--z-modal)" }}
    >
      <p
        data-testid={`${id}-title`}
        className="on-board-text mb-2 text-center"
        style={{ fontSize: "clamp(22px, 3.2vw, 36px)" }}
      >
        {title}
      </p>

      <div
        data-testid={`${id}-strip`}
        className={clsx("relative flex w-full items-center justify-between px-[3%]", dragging && "cursor-grabbing")}
        style={{
          height: "clamp(104px, 15vh, 138px)",
          background: SETUP_TOKENS.sliderStrip,
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, from: current };
          setDragging(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const next = clamp(start.from + (event.clientX - start.x) / PX_PER_STEP);
          if (next !== current) onChange(next);
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        <IconButton
          icon="cross"
          label="Cancel"
          tone="danger"
          size={80}
          testId="count-cancel"
          onClick={onCancel}
        />

        {NUMERAL_X.map((pct, slot) => {
          const offset = slot - 2;
          const n = current + offset;
          if (n < lo || n > hi) return null;
          const distance = Math.abs(offset);
          return (
            <button
              key={pct}
              type="button"
              data-testid={`count-numeral-${n}`}
              data-offset={offset}
              aria-label={`Set ${n}`}
              onClick={() => onChange(n)}
              className="absolute -translate-x-1/2 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              style={{ left: `${pct}%`, minWidth: 44, minHeight: 44 }}
            >
              {offset === 0 ? (
                <NotchedRing value={n} radius={55} stroke={16} testId="count-ring" />
              ) : (
                <span
                  className="font-head font-black"
                  style={{
                    fontSize: "clamp(28px, 4vw, 52px)",
                    color: distance === 1 ? SETUP_TOKENS.sliderNumeral : "var(--text-dim)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}

        <IconButton
          icon="check"
          label="Confirm"
          tone="go"
          size={80}
          testId="count-confirm"
          onClick={onConfirm}
        />
      </div>

      {showMoveAll ? (
        <div className="mt-2 flex w-full justify-center">
          <button
            type="button"
            data-testid="count-move-all"
            onClick={() => onChange(hi)}
            className="rounded-[var(--r-pill)] px-5 font-head font-bold outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            style={{
              minHeight: 44,
              background: "var(--chrome-700)",
              border: "2px solid var(--chrome-line)",
              color: "var(--text)",
              fontSize: "clamp(16px, 2.2vw, 24px)",
            }}
          >
            Move All
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default CountSlider;
