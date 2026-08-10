import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { formatMutualGroups } from "./mutual-groups";

export interface UserCardPerson {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  avatarInitials: string;
}

export interface UserCardProps {
  user: UserCardPerson;
  mutualGroups: number;
  /** e.g. "Friends since Aug 2026" or a request's relative timestamp. Never
   * a friend list/count for anyone but the viewer's own relationship to
   * `user` — see this file's sibling `mutual-groups.ts`. */
  subtitle?: string;
  /** Add / Accept+Decline / Cancel — whatever this tab's context calls for.
   * `undefined` renders no action (the Friends tab). */
  actions?: ReactNode;
  className?: string;
}

/**
 * One row on the Friends page (SPEC §3.5: "A user card shows handle,
 * display name, avatar, mutual-group count — never a friend list").
 * Server-renderable; the actions it's handed own their own interactivity.
 */
export function UserCard({ user, mutualGroups, subtitle, actions, className }: UserCardProps) {
  const mutualLabel = formatMutualGroups(mutualGroups);

  return (
    <Card className={cn("flex items-center gap-3 p-3", className)}>
      <Avatar initials={user.avatarInitials} color={user.avatarColor} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-(--text-1)">{user.displayName}</p>
        <p className="truncate text-sm text-(--text-2) tabular-nums">@{user.handle}</p>
        {mutualLabel || subtitle ? (
          <p className="truncate text-xs text-(--text-3)">
            {[mutualLabel, subtitle].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </Card>
  );
}
