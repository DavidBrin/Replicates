import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  /** Precomputed initials (User.avatarInitials, SPEC §4) — not derived here. */
  initials: string;
  /** Precomputed per-user color (User.avatarColor, SPEC §4). This is
   * runtime data, not a design-token literal, so it's applied via inline
   * style rather than a Tailwind class (G7 governs component-authored
   * colors, not per-record data passed in as props). */
  color: string;
  size?: AvatarSize;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: "size-5 text-[10px]",
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-12 text-base",
};

/** A single user's circular initials avatar. Server-renderable. */
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { initials, color, size = "sm", className, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-(--surface-0) tabular-nums",
        sizeClasses[size],
        className,
      )}
      style={{ backgroundColor: color, ...style }}
      {...props}
    >
      {initials}
    </div>
  );
});

export interface AvatarStackItem {
  id: string;
  initials: string;
  color: string;
}

export interface AvatarStackProps {
  avatars: AvatarStackItem[];
  /** Max avatars shown before collapsing into a `+N` badge. Default 4. */
  max?: number;
  size?: AvatarSize;
  className?: string;
}

/** Overlapping avatar row with a `+N` overflow badge (SPEC §3.2, §5.1). */
export function AvatarStack({ avatars, max = 4, size = "sm", className }: AvatarStackProps) {
  const shown = avatars.slice(0, max);
  const overflow = avatars.length - shown.length;

  return (
    <div className={cn("flex -space-x-2", className)}>
      {shown.map((a) => (
        <Avatar
          key={a.id}
          initials={a.initials}
          color={a.color}
          size={size}
          className="ring-2 ring-(--surface-2)"
        />
      ))}
      {overflow > 0 ? (
        <div
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full bg-(--surface-3) font-medium text-(--text-2) tabular-nums ring-2 ring-(--surface-2)",
            sizeClasses[size],
          )}
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}
