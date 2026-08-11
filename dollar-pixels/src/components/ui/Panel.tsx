import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * Rendered as plain bold text, not a heading. What heading level a panel
   * title belongs at depends on the page around it, so the page owns that.
   */
  title?: ReactNode;
  footer?: ReactNode;
}

/** The content box the whole site is built from: light panel on grey ground. */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { title, footer, className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("border border-(--rule) bg-(--panel) text-(--ink)", className)}
      {...props}
    >
      {title != null ? (
        <div className="border-b border-(--rule) bg-(--panel-2) px-3 py-2 text-sm font-bold">
          {title}
        </div>
      ) : null}
      <div className="p-3">{children}</div>
      {footer != null ? (
        <div className="border-t border-(--rule) bg-(--panel-2) px-3 py-2 text-sm text-(--ink-2)">
          {footer}
        </div>
      ) : null}
    </div>
  );
});
