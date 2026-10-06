"use client";

/**
 * One modifier toggle from the `/new/rules` right-hand stack (SPEC §7):
 * a 68×68 radius-18 icon toggle with its label beneath. Enabled is `--danger`
 * with a white glyph; off is a desaturated grey-blue with a `#6E7F88` label.
 */
import clsx from "clsx";

import { Icon, type IconName } from "../ui/Icon";
import { SETUP_TOKENS } from "../ui/tokens";

export interface ModifierToggleProps {
  /** The `data-testid` suffix — `modifier-<key>`. */
  readonly modifierKey: string;
  readonly label: string;
  readonly icon: IconName;
  readonly on: boolean;
  readonly onToggle: (next: boolean) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function ModifierToggle({
  modifierKey,
  label,
  icon,
  on,
  onToggle,
  disabled = false,
  className,
}: ModifierToggleProps) {
  return (
    <div className={clsx("flex w-[84px] flex-col items-center gap-1", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-testid={`modifier-${modifierKey}`}
        data-on={on ? "true" : "false"}
        disabled={disabled}
        onClick={() => onToggle(!on)}
        className={clsx(
          "flex items-center justify-center outline-none focus-visible:ring-4 focus-visible:ring-white/70",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        )}
        style={{
          width: 68,
          height: 68,
          minWidth: 44,
          minHeight: 44,
          borderRadius: 18,
          background: on ? "var(--danger)" : "var(--chrome-700)",
          border: `2px solid ${on ? "var(--danger-deep)" : "var(--chrome-line)"}`,
          color: on ? "var(--text)" : SETUP_TOKENS.modifierOffLabel,
          filter: on ? "none" : "saturate(.35)",
          boxShadow: on ? "var(--sh-chip)" : "none",
          transition: "background 200ms ease-out, color 200ms ease-out",
        }}
      >
        <Icon name={icon} size={34} />
      </button>
      <span
        data-testid={`modifier-${modifierKey}-label`}
        className="text-center font-head font-bold leading-tight"
        style={{
          fontSize: "clamp(12px, 1.4vw, 18px)",
          color: on ? "var(--text)" : SETUP_TOKENS.modifierOffLabel,
        }}
      >
        {label}
      </span>
    </div>
  );
}

export default ModifierToggle;
