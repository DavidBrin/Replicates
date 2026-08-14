import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The button.
 *
 * Two measurements decide whether this reads as Linear or as Bootstrap:
 *
 * 1. **App buttons are not pills.** The marketing site's CTAs are
 *    `border-radius: 9999px`; the *application*'s controls resolve
 *    `--control-border-radius` to **8px**, and that value is shared with
 *    inputs, list rows and group headers. Copying the marketing pill into the
 *    app — which is what happens if you build from linear.app screenshots — is
 *    immediately wrong (`research/01-visual-design.md` §6.6).
 * 2. **Controls are short.** 32px is Linear's `--action-trigger-min-width` and
 *    the height of a default control; the sidebar's primary button is 28px.
 *    A 40px button belongs on a marketing page.
 *
 * Text is 13px at weight 500 — the app's workhorse size. Not 14px, which is the
 * single most common size error in a clone of this product.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  /* Linear indigo. The only saturated fill in the application chrome. */
  primary:
    "bg-accent text-[var(--text-on-accent)] hover:bg-accent-hover " +
    "active:bg-[var(--accent-active)]",
  /* Elevation by background step plus a hairline — dark Linear uses almost no
     drop shadow, and a shadow here would read as a different product. */
  secondary:
    "bg-elevated text-primary border border-default hover:bg-[var(--bg-hover)]",
  /* The default for icon buttons and toolbar affordances: nothing until hover. */
  ghost: "text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary",
  danger:
    "bg-danger text-[var(--text-on-accent)] hover:bg-[var(--danger-hover)]",
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: "h-6 px-2 gap-1 text-mini",
  md: "h-7 px-2.5 gap-1.5 text-small",
  lg: "h-8 px-3 gap-1.5 text-small",
};

/** Square, for a button whose whole content is one icon. */
const ICON_SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: "size-6 p-0 gap-0",
  md: "size-7 p-0 gap-0",
  lg: "size-8 p-0 gap-0",
};

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Render as a square icon target.
   *
   * Needs an `aria-label`, since there is no text to name it — enforce that at
   * the call site; TypeScript cannot require it without making every text
   * button's props awkward.
   */
  iconOnly?: boolean;
  /** Rendered before the label, at the control's own colour. */
  leading?: ReactNode;
  /** Rendered after the label — a chevron, a count, a shortcut hint. */
  trailing?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  leading,
  trailing,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // `type` defaults to "submit" inside a form, which turns a stray toolbar
      // button into an accidental submit. Defaulting it here rather than at
      // every call site removes a whole class of bug.
      type={type}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center",
        "rounded-[var(--radius-lg)] [font-weight:var(--weight-medium)]",
        // Only interaction feedback eases, and only for 100ms. Linear's
        // durations sit below the ~100ms cause-and-effect threshold; a 200ms
        // fade here makes the whole app feel like a slower product.
        "transition-[background-color,color,border-color] " +
          "[transition-duration:var(--speed-quick)] " +
          "[transition-timing-function:var(--ease-out-quad)]",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        iconOnly ? ICON_SIZES[size] : SIZES[size],
        className,
      )}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
}
