import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The text input.
 *
 * Padding `6px 12px` and font-size `0.8125rem` are measured off the running app
 * (`research/01-visual-design.md` §6.6); the radius is the same 8px
 * `--control-border-radius` the buttons and list rows use.
 *
 * ## Two visual registers, and why
 *
 * `bordered` is a form field — a sign-in page, a settings row. `bare` has no
 * border, no background and no ring, and is what goes inside a popover or a
 * command palette: there, the surrounding surface *is* the field's boundary,
 * and a second border 8px inside the popover's own reads as a box in a box.
 * Linear's property picker uses the bare form under a divider; its settings
 * pages use the bordered one.
 *
 * ## The focus ring
 *
 * `:focus-visible` in `globals.css` already draws a ring on anything focused by
 * keyboard. An input is the one control where that is not enough — a field
 * focused by *click* must also show it, because the caret alone is easy to lose
 * on a dense screen. So the bordered variant lights its border on `:focus`,
 * and suppresses the global outline so the two do not stack.
 */

export interface InputProps extends Omit<ComponentPropsWithRef<"input">, "size"> {
  /** `bare` for popovers and palettes; `bordered` for forms. */
  variant?: "bordered" | "bare";
  /** Rendered inside the field on the left — a search glyph, usually. */
  leading?: ReactNode;
  /** Rendered inside the field on the right — a clear button, a hint. */
  trailing?: ReactNode;
  /** Wrapper class. `className` goes to the `<input>` itself. */
  containerClassName?: string;
  /** Paint the border in the danger colour and set `aria-invalid`. */
  invalid?: boolean;
}

export function Input({
  variant = "bordered",
  leading,
  trailing,
  className,
  containerClassName,
  invalid = false,
  ...rest
}: InputProps) {
  const field = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full min-w-0 bg-transparent text-small text-primary outline-none",
        "placeholder:text-quaternary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );

  if (variant === "bare") {
    return (
      <div
        className={cn(
          "flex h-8 w-full items-center gap-2 px-3 text-tertiary",
          containerClassName,
        )}
      >
        {leading}
        {field}
        {trailing}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-[var(--radius-lg)] border",
        "bg-[var(--bg-translucent)] px-3 py-1.5 text-tertiary",
        // The ring lives on the wrapper so it surrounds the leading/trailing
        // adornments too, and `:focus-within` catches click-focus as well as
        // keyboard focus. `outline-none` on the inner input stops the global
        // `:focus-visible` rule from drawing a second, offset ring.
        "[transition:border-color_var(--speed-quick)_var(--ease-out-quad)]",
        "focus-within:border-[var(--accent)]",
        invalid ? "border-danger" : "border-default",
        containerClassName,
      )}
    >
      {leading}
      {field}
      {trailing}
    </div>
  );
}
