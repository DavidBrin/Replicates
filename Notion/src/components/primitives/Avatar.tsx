"use client";

import { cn } from "@/lib/utils/cn";
import { avatarStyle } from "@/lib/utils/colors";
import type { User } from "@/lib/model/types";

export interface AvatarProps {
  user: User | undefined;
  size?: number;
  className?: string;
  /** Dims the avatar and adds a dashed ring for an unaccepted invite. */
  pending?: boolean;
}

export function Avatar({ user, size = 20, className, pending }: AvatarProps) {
  if (!user) {
    return (
      <span
        className={cn("inline-block shrink-0 rounded-full", className)}
        style={{ width: size, height: size, background: "var(--bac-ter)" }}
      />
    );
  }

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span
      title={user.name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        pending && "opacity-60 ring-1 ring-dashed",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.44)),
        lineHeight: 1,
        ...avatarStyle(user.color),
      }}
    >
      {user.avatarEmoji ? (
        <span style={{ fontSize: Math.round(size * 0.62) }}>{user.avatarEmoji}</span>
      ) : (
        <span className="font-medium">{initials}</span>
      )}
    </span>
  );
}

export interface AvatarStackProps {
  users: (User | undefined)[];
  size?: number;
  max?: number;
  className?: string;
}

/** Overlapping face pile, as in Notion's page header. */
export function AvatarStack({ users, size = 22, max = 4, className }: AvatarStackProps) {
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;

  return (
    <div className={cn("flex items-center", className)}>
      {shown.map((user, index) => (
        <span
          key={user?.id ?? index}
          className="rounded-full"
          style={{
            marginLeft: index === 0 ? 0 : -size * 0.3,
            // Ring in the page background colour cuts each avatar out of the
            // one behind it.
            boxShadow: `0 0 0 2px var(--bac-pri)`,
            zIndex: shown.length - index,
          }}
        >
          <Avatar user={user} size={size} />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="inline-flex items-center justify-center rounded-full text-[10px] font-medium"
          style={{
            width: size,
            height: size,
            marginLeft: -size * 0.3,
            background: "var(--bac-ter)",
            color: "var(--tex-sec)",
            boxShadow: `0 0 0 2px var(--bac-pri)`,
          }}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
