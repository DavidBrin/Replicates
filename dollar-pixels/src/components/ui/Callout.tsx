import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type CalloutTone = "info" | "warn" | "danger";

export interface CalloutProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CalloutTone;
}

const toneClasses: Record<CalloutTone, string> = {
  info: "border-(--rule) bg-(--panel-2) text-(--ink)",
  warn: "border-(--rule) bg-(--gold) text-(--ink)",
  danger: "border-(--rule) bg-(--open) text-(--panel-2)",
};

/**
 * `danger` is the only tone that interrupts a screen reader. A declined
 * payment or a lost selection has to cut in; a hint about hold expiry does
 * not, and an assertive role on routine copy trains people to ignore it.
 */
export const Callout = forwardRef<HTMLDivElement, CalloutProps>(function Callout(
  { tone = "info", className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role={tone === "danger" ? "alert" : "status"}
      data-tone={tone}
      className={cn("border px-3 py-2 text-sm", toneClasses[tone], className)}
      {...props}
    />
  );
});
