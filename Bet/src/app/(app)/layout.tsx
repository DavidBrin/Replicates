import type { ReactNode } from "react";
import { getContainer } from "@/lib/container";
import { requireCurrentUser } from "@/lib/server-actor";
import { TopBar } from "@/components/app-shell/TopBar";
import { ToastProvider } from "@/components/ui/Toast";

/**
 * The shared frame for every `/app/**` route (task-9-brief: "Your
 * layout.tsx is their frame — keep it clean and make sure the group tabs
 * and user menu work from any nested route" — Tasks 10-12 build pages
 * inside this route group). Server Component: it resolves the signed-in
 * user and their groups once per request and hands them down to `TopBar`
 * as plain props; no route below this needs to re-fetch "who am I" or "what
 * groups am I in" itself.
 *
 * Deliberately does NOT render the group dashboard's `GroupHeader`/SubNav —
 * those are specific to `/app/g/[slug]` (the dashboard) and would leak into
 * Task 10's market view (`/app/g/[slug]/m/[id]`), which has its own,
 * different header per SPEC §3.3. See that page for the split.
 *
 * Wraps children in `ToastProvider` (Task 8's provider, not wired up by any
 * earlier task) since every interactive surface under `/app` — trades
 * (Task 10), friend actions (Task 12), this task's own create-group flow —
 * needs a toast host somewhere above it.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireCurrentUser();
  const { store } = await getContainer();

  const groups = await store.groups.listByMember(user.id);
  const unreadNotifications = await store.notifications.listByUser(user.id, { unreadOnly: true });

  return (
    <ToastProvider>
      <div className="flex min-h-svh flex-col bg-(--surface-0)">
        <TopBar
          groups={groups.map((g) => ({ slug: g.slug, name: g.name, emoji: g.emoji }))}
          unreadCount={unreadNotifications.length}
          user={{
            handle: user.handle,
            displayName: user.displayName,
            avatarInitials: user.avatarInitials,
            avatarColor: user.avatarColor,
            balance: user.balance,
          }}
        />
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6">{children}</main>
      </div>
    </ToastProvider>
  );
}
