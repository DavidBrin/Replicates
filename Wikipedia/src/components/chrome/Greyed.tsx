import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * A control that looks like part of the chrome but is honestly inert
 * (DECISIONS D5): greyed text, `cursor-not-allowed`, and a tooltip
 * explaining why, rather than a live-looking button that does nothing.
 */
export function Greyed({
  children,
  title = "This control is not functional in this replica",
  className,
  as: As = "span",
}: {
  children: ReactNode;
  title?: string;
  className?: string;
  as?: "span" | "button" | "li";
}) {
  return (
    <As
      className={clsx(
        "cursor-not-allowed select-none text-[color:var(--text)]/50",
        className,
      )}
      title={title}
      aria-disabled="true"
      {...(As === "button" ? { disabled: true } : {})}
    >
      {children}
    </As>
  );
}
