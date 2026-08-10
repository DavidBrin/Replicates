import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/** A pulsing placeholder block for loading states. Pure CSS animation, so
 * it's fully server-renderable — no client JS required. */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("animate-pulse rounded-(--radius-input) bg-(--surface-3)", className)}
      {...props}
    />
  );
});
