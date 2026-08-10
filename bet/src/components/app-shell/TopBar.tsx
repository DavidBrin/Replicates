import Link from "next/link";
import { Search } from "lucide-react";
import { GroupTabsNav, type GroupTabItem } from "./GroupTabsNav";
import { CreateGroupButton } from "./CreateGroupButton";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import type { Credits } from "@/domain/money";

export interface TopBarProps {
  groups: GroupTabItem[];
  unreadCount: number;
  user: {
    handle: string;
    displayName: string;
    avatarInitials: string;
    avatarColor: string;
    balance: Credits;
  };
}

/**
 * The app shell's top bar (SPEC §2's sketch; task-9-brief's ambiguity
 * resolution): `[⬤ Bet] [group tabs…] [+] ⋯ [Explore] [🔍] [🔔] [avatar]`.
 * Group tabs are the primary navigation (see `GroupTabsNav`'s doc comment)
 * — everything else is a secondary affordance clustered to the right.
 * Server Component: only the pieces that truly need client state
 * (`GroupTabsNav`'s active-tab tracking, `CreateGroupButton`'s modal,
 * `UserMenu`'s dropdown) are their own client leaves.
 */
export function TopBar({ groups, unreadCount, user }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-(--border) bg-(--surface-0)/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-3 px-4">
        <Link
          href="/app"
          className="flex shrink-0 items-center gap-2 rounded-(--radius-input) py-1 text-sm font-semibold tracking-tight text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
        >
          <span className="size-2.5 rounded-full bg-(--accent)" aria-hidden="true" />
          Bet
        </Link>

        <nav aria-label="Groups" className="flex min-w-0 flex-1 items-center gap-1">
          <GroupTabsNav groups={groups} className="min-w-0" />
          <CreateGroupButton variant="icon" />
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <a
            href="/explore"
            target="_blank"
            rel="noopener"
            className="rounded-(--radius-input) px-2.5 py-1.5 text-sm font-medium text-(--text-2) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
          >
            Explore
          </a>
          <Link
            href="/app/friends"
            aria-label="Search"
            title="Search friends"
            className="inline-flex size-8 items-center justify-center rounded-(--radius-input) text-(--text-2) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
          >
            <Search className="size-4" aria-hidden="true" />
          </Link>
          <NotificationBell unreadCount={unreadCount} />
          <UserMenu
            handle={user.handle}
            displayName={user.displayName}
            avatarInitials={user.avatarInitials}
            avatarColor={user.avatarColor}
            balance={user.balance}
          />
        </div>
      </div>
    </header>
  );
}
