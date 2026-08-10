import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds the hover lift from SPEC §5.1 (surface-3 fill, border-2 outline). */
  interactive?: boolean;
}

/** Base surface for cards, panels and rows (SPEC §5.1). Server-renderable. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-4",
        interactive && "transition-colors hover:border-(--border-2) hover:bg-(--surface-3)",
        className,
      )}
      {...props}
    />
  );
});
