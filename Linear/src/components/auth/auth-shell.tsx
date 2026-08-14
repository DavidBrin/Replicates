import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/cn";

/**
 * The frame every auth screen sits in.
 *
 * Three decisions, all of them visible within the first second:
 *
 * 1. **It is not a card on a gradient.** The auth screens are the same surface
 *    the application is — `--bg-app` with a hairline panel — because the first
 *    impression of a keyboard-first tool should not be a marketing register the
 *    product then drops. Linear's own sign-in is a centred column on the app
 *    background with no elevation at all.
 * 2. **The mark is ours.** `linear.app/brand` explicitly forbids using Linear's
 *    wordmark or logomark in another product
 *    (`research/01-visual-design.md` §1.4), so this draws an original glyph —
 *    three stacked rules of decreasing width, which is a list seen edge-on — at
 *    the brand indigo. Status and priority glyphs are functional UI and a
 *    different matter; a logo is not.
 * 3. **The column is 320px.** Wide enough for an email address at 13px, narrow
 *    enough that the eye never has to travel. A 480px form makes a two-field
 *    sign-in look like an application form.
 */

export interface AuthShellProps {
  title: string;
  /** One sentence under the title. Never a paragraph. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** The "no account? sign up" line, at the foot of the column. */
  footer?: ReactNode;
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-app px-6 py-16">
      <div className="flex w-full max-w-[320px] flex-col">
        <Link
          href="/"
          aria-label="Home"
          className="mb-8 inline-flex items-center gap-2 self-start"
        >
          <Mark />
          <span className="text-small text-primary [font-weight:var(--weight-title)]">
            Linear
          </span>
        </Link>

        <h1
          className={cn(
            "text-title3 text-primary",
            "[font-weight:var(--weight-title)] [letter-spacing:-0.012em]",
          )}
        >
          {title}
        </h1>
        {subtitle !== undefined ? (
          <p className="mt-1.5 text-small text-tertiary">{subtitle}</p>
        ) : null}

        <div className="mt-6">{children}</div>

        {footer !== undefined ? (
          <div className="mt-6 text-small text-tertiary">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * The product mark.
 *
 * Drawn rather than imported, and deliberately not Linear's. Three rules of
 * decreasing width at the brand indigo: an issue list reduced to its silhouette,
 * which is the one shape this product is actually about.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <rect x="1" y="3" width="14" height="2.4" rx="1.2" fill="var(--accent)" />
      <rect
        x="1"
        y="6.8"
        width="10"
        height="2.4"
        rx="1.2"
        fill="var(--accent)"
        opacity="0.7"
      />
      <rect
        x="1"
        y="10.6"
        width="6"
        height="2.4"
        rx="1.2"
        fill="var(--accent)"
        opacity="0.4"
      />
    </svg>
  );
}

/**
 * A refusal, or a note, above a form's submit button.
 *
 * `role="alert"` rather than `aria-live`, because a failed sign-in is the one
 * message on these screens that must interrupt: the user has just pressed a
 * button and is waiting for the answer.
 */
export function AuthMessage({
  children,
  testId,
  tone = "error",
}: {
  children: ReactNode;
  testId?: string;
  tone?: "error" | "info";
}) {
  return (
    <p
      role="alert"
      {...(testId === undefined ? {} : { "data-testid": testId })}
      className={cn(
        "rounded-[var(--radius-md)] px-2.5 py-2 text-small",
        tone === "error"
          ? "bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]"
          : "bg-[var(--bg-translucent)] text-tertiary",
      )}
    >
      {children}
    </p>
  );
}

/** A labelled field. The label is real text, never a placeholder. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-mini text-tertiary [font-weight:var(--weight-medium)]"
      >
        {label}
      </label>
      {children}
      {hint !== undefined ? (
        <span className="text-micro text-quaternary">{hint}</span>
      ) : null}
    </div>
  );
}
