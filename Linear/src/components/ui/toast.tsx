"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { Shortcut } from "@/components/ui/kbd";

/**
 * A single toast card.
 *
 * The rendering half of the toast system; {@link ToastProvider} owns the queue.
 * Kept separate so the card can be rendered in isolation — a Storybook-shaped
 * test, or a static example — without standing up a provider.
 *
 * ## Toasts are an interactive surface, not decoration
 *
 * Linear ships a global shortcut (`Cmd+Option+O`) that opens the link from the
 * *last* toast. That is only a sensible feature if toasts routinely carry
 * something worth acting on, which shapes what belongs in one
 * (`research/04-interaction.md` §8.3):
 *
 * - **Errors** — sticky, no countdown, and they carry a Retry.
 * - **Destructive actions** — always with an Undo, and the Undo shows `⌘Z`,
 *   because the toast is teaching the shortcut as much as offering the button.
 * - **Off-screen results** — "Moved LIN-142 to Design", "Copied branch name".
 *
 * And what does not: **success toasts for visible changes**. "Status updated"
 * is noise — the user is looking at the status. Toasting it trains them to
 * ignore the corner of the screen where the errors also appear.
 *
 * ## The countdown bar
 *
 * A CSS `transform: scaleX()` animation, not a state counter. It is purely
 * decorative and re-rendering the tree 60 times a second to move it would be
 * absurd; `transform` also stays off the paint path, which is the rule the
 * motion system asks for. Hover pauses it via `animation-play-state`, so the
 * pause is free and exactly synchronised with the timer the provider holds.
 */

export type ToastVariant = "default" | "error" | "success";

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** A shortcut expression rendered beside the label — `"mod+z"` on an Undo. */
  shortcut?: string;
}

export interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds. `null` is sticky; errors default to sticky. */
  duration?: number | null;
  action?: ToastAction;
  /**
   * The Undo affordance.
   *
   * Sugar over {@link ToastData.action} because undo is the overwhelmingly
   * common case and every call site would otherwise repeat the same label and
   * the same `mod+z` hint — and half of them would forget the hint.
   */
  undo?: () => void;
}

export interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
  /** Paused while the pointer is over the stack, and while the tab is hidden. */
  paused?: boolean;
  className?: string;
}

export function Toast({ toast, onDismiss, paused = false, className }: ToastProps) {
  const { id, title, description, variant = "default", action, undo } = toast;
  const duration = resolveDuration(toast);
  const [entered, setEntered] = useState(false);
  const frame = useRef<number | null>(null);

  // Enter on the next frame so the transition has two states to interpolate
  // between. Setting the final class in the same commit as the mount would
  // paint it already-arrived.
  useEffect(() => {
    frame.current = requestAnimationFrame(() => setEntered(true));
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const resolvedAction: ToastAction | undefined =
    action ??
    (undo ? { label: "Undo", onClick: undo, shortcut: "mod+z" } : undefined);

  return (
    <div
      data-toast={variant}
      // Errors interrupt; everything else waits its turn. A polite region for
      // an error means the user finds out after they have already retried.
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto relative w-[320px] overflow-hidden",
        "rounded-[var(--radius-lg)] border bg-[var(--bg-overlay)]",
        "shadow-[var(--shadow-medium)]",
        variant === "error" ? "border-danger" : "border-default",
        "[transition:opacity_var(--speed-quick)_var(--ease-out-quad),transform_var(--speed-quick)_var(--ease-out-quad)]",
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        className,
      )}
    >
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-small [font-weight:var(--weight-medium)]",
              variant === "error" ? "text-danger" : "text-primary",
            )}
          >
            {title}
          </p>
          {description ? (
            <p className="mt-0.5 text-mini text-tertiary">{description}</p>
          ) : null}
        </div>

        {resolvedAction ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-primary"
            onClick={() => {
              resolvedAction.onClick();
              // An action always dismisses. Leaving the toast up after Undo
              // invites a second click that undoes the undo.
              onDismiss(id);
            }}
            trailing={
              resolvedAction.shortcut ? (
                <Shortcut keys={resolvedAction.shortcut} />
              ) : undefined
            }
          >
            {resolvedAction.label}
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          iconOnly
          aria-label="Dismiss"
          className="shrink-0"
          onClick={() => onDismiss(id)}
        >
          <CloseIcon size={12} />
        </Button>
      </div>

      {duration !== null ? (
        <div
          aria-hidden="true"
          data-toast-progress=""
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-[var(--border-strong)]"
          style={{
            animation: `toast-countdown ${duration}ms linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      ) : null}

      {/* Scoped keyframes: this is the only thing in the app that uses them,
          and putting them in globals.css would separate the animation from the
          one element it belongs to. */}
      <style>{
        "@keyframes toast-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}"
      }</style>
    </div>
  );
}

/**
 * How long a toast lives.
 *
 * Errors are sticky unless the caller says otherwise: an error that vanishes
 * before it is read is an error that will be hit again. Everything else gets
 * 5 seconds, the middle of the 5–6s window the research settles on.
 */
export function resolveDuration(toast: ToastData): number | null {
  if (toast.duration !== undefined) return toast.duration;
  return toast.variant === "error" ? null : 5_000;
}
