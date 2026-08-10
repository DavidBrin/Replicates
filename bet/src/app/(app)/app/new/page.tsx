import { CalendarPlus } from "lucide-react";
import { getContainer } from "@/lib/container";
import { requireCurrentUser } from "@/lib/server-actor";
import { CreateBetWizard } from "@/components/wizard/CreateBetWizard";
import type { WizardFriend } from "@/components/wizard/Step4Invite";
import { EmptyState } from "@/components/ui/EmptyState";
import type { User, UserId } from "@/domain/entities";

/**
 * `/app/new` — the create-bet wizard's entry point (SPEC §3.4,
 * docs/plan.md Task 11). Server Component: resolves "who am I", "which
 * groups can I post to", and "who are my friends" once, here, and hands
 * them to `CreateBetWizard` as plain props — the client component never
 * has to re-fetch any of this itself (friends in particular need to be
 * available on the very first paint, per SPEC's "zero keystrokes" friends-
 * first requirement).
 *
 * `?group=<slug>` (the group dashboard's "+ New bet" link,
 * `/app/new?group=${group.slug}`, task-9's `GroupHeader`) preselects that
 * group; otherwise this defaults to the user's first group. A user with no
 * groups at all can't post a market anywhere (`POST /api/markets` requires
 * membership) — that's an edge case this page has to render *something*
 * for, but there is no group-creation UI in this task's ownership
 * (`src/components/app-shell/**`, Task 9's), so it's a plain empty state
 * with a link back to `/app` rather than an inline "create a group" flow.
 */
export default async function CreateBetPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group: groupSlugParam } = await searchParams;
  const user = await requireCurrentUser();
  const { store } = await getContainer();

  const groups = await store.groups.listByMember(user.id);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<CalendarPlus className="size-8" />}
        title="Join a group first"
        description="Bets live inside a group. Ask a friend to invite you, or head back and create one."
        action={
          <a
            href="/app"
            className="inline-flex h-10 items-center justify-center rounded-(--radius-input) bg-(--accent) px-4 text-sm font-medium text-(--surface-0) transition-colors hover:bg-(--accent-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
          >
            Back to your groups
          </a>
        }
      />
    );
  }

  const preselected = groupSlugParam ? groups.find((g) => g.slug === groupSlugParam) : undefined;
  const initialGroupId = (preselected ?? groups[0]!).id;

  const friendships = await store.friends.listFriends(user.id);
  const userCache = new Map<UserId, User | undefined>([[user.id, user]]);
  async function loadUser(id: UserId): Promise<User | undefined> {
    if (!userCache.has(id)) userCache.set(id, await store.users.findById(id));
    return userCache.get(id);
  }

  // Explicit return type (not inferred) so `id` narrows to `WizardFriend`'s
  // plain `string` rather than the branded `UserId` — a branded id IS
  // assignable to a wider plain-string field, but the reverse isn't, which
  // is exactly what makes the `.filter` type predicate below type-check.
  function toWizardFriend(u: User): WizardFriend {
    return {
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      avatarColor: u.avatarColor,
      avatarInitials: u.avatarInitials,
    };
  }

  const friends: WizardFriend[] = (
    await Promise.all(
      friendships.map(async (f) => {
        const otherId = f.userAId === user.id ? f.userBId : f.userAId;
        const other = await loadUser(otherId);
        return other ? toWizardFriend(other) : null;
      }),
    )
  )
    .filter((f): f is WizardFriend => f !== null)
    .sort((a, b) => a.handle.localeCompare(b.handle));

  return (
    <CreateBetWizard
      userId={user.id}
      groups={groups.map((g) => ({ id: g.id, slug: g.slug, name: g.name, emoji: g.emoji }))}
      initialGroupId={initialGroupId}
      friends={friends}
    />
  );
}
