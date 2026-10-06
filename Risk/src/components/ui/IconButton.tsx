"use client";

/**
 * The two icon chassis of SPEC §8: a **circle** for board actions and the
 * dialog ✗/✓, and a **rounded-square grey `--tray`** for utilities with a
 * radius ≈20 % of the box. The third form is the top-left utility button —
 * the same circle at r ≈ 22 with a **3 px white stroke and no fill**.
 *
 * Every chassis is at least a 44 px touch target (§9), whatever `size` says.
 */
import { useState } from "react";
import clsx from "clsx";

import { Icon, type IconName } from "./Icon";

export type IconButtonChassis = "circle" | "tray" | "outline";
export type IconButtonTone = "danger" | "go" | "neutral" | "gold";

export interface IconButtonProps {
  readonly icon: IconName;
  /** The accessible name; icon-only buttons have no visible label. */
  readonly label: string;
  readonly onClick?: () => void;
  readonly chassis?: IconButtonChassis;
  readonly tone?: IconButtonTone;
  /** Box edge in px — a circle's diameter. Clamped up to the 44 px floor. */
  readonly size?: number;
  readonly disabled?: boolean;
  readonly pressedState?: boolean;
  readonly testId?: string;
  readonly className?: string;
}

const FILL: Record<IconButtonTone, { readonly background: string; readonly rim: string; readonly glyph: string }> = {
  danger: { background: "linear-gradient(var(--danger), var(--danger-deep))", rim: "var(--danger-deep)", glyph: "var(--text)" },
  go: { background: "linear-gradient(var(--go), var(--go-mid))", rim: "var(--go-deep)", glyph: "var(--text)" },
  neutral: { background: "var(--chrome-700)", rim: "var(--chrome-line)", glyph: "var(--text)" },
  gold: { background: "var(--chrome-700)", rim: "var(--gold)", glyph: "var(--gold)" },
};

export function IconButton({
  icon,
  label,
  onClick,
  chassis = "circle",
  tone = "neutral",
  size = 44,
  disabled = false,
  pressedState,
  testId,
  className,
}: IconButtonProps) {
  const [down, setDown] = useState(false);
  const box = Math.max(44, size);
  const fill = FILL[tone];
  const outline = chassis === "outline";
  const active = down && !disabled;

  return (
    <button
      type="button"
      data-testid={testId ?? `icon-button-${icon}`}
      data-chassis={chassis}
      data-tone={tone}
      aria-label={label}
      aria-pressed={pressedState}
      title={label}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center outline-none",
        "focus-visible:ring-4 focus-visible:ring-white/70",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
      style={{
        width: box,
        height: box,
        // circles are round, the utility tray is ~20% of the box
        borderRadius: chassis === "tray" ? Math.round(box * 0.2) : "var(--r-pill)",
        background: outline ? "transparent" : chassis === "tray" ? "var(--tray)" : fill.background,
        border: outline ? "3px solid var(--text)" : chassis === "tray" ? "none" : `3px solid ${fill.rim}`,
        color: outline ? "var(--text)" : chassis === "tray" ? "var(--stroke-dark)" : fill.glyph,
        boxShadow: outline ? "none" : `0 ${active ? 1 : 4}px 0 ${chassis === "tray" ? "rgba(0,0,0,.35)" : fill.rim}`,
        transform: active ? "scale(.96)" : "scale(1)",
        transition: "transform 90ms ease-out, box-shadow 90ms ease-out",
      }}
    >
      <Icon name={icon} size={Math.round(box * 0.5)} />
    </button>
  );
}

export default IconButton;
