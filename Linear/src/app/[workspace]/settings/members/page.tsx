import { notFound } from "next/navigation";

import { InviteControl } from "@/components/members/invite-modal";
import type { MemberRow } from "@/components/members/members-table";
import { MembersTable } from "@/components/members/members-table";
import type { PendingInviteView } from "@/components/members/pending-invites";
import { PendingInvites } from "@/components/members/pending-invites";
import { accessForPage } from "@/components/members/workspace-access";
import { can } from "@/domain/policy";

/**
 * `/[workspace]/settings/members` — workspace administration.
 *
 * ## Why a plain member gets a 404 rather than a read-only table
 *
 * The matrix grants `workspace.view_members` to members (row 5), so a members
 * *list* is not privileged information and `GET /api/workspaces/{id}/members`
 * serves it to them. This screen is a different thing: it is the place where
 * roles are changed and people are removed, and every control on it is live.
 *
 * A read-only version of an administration screen is a screen whose every
 * control is disabled — which reads as "you may do this, but not right now",
 * invites people to try, and puts a role comparison in a component to decide
 * what to grey out. `e2e/permissions.spec.ts` asserts the absence of the table
 * and the invite button for a member, and the cheapest way to be certain of
 * that is for the route to refuse.
 *
 * The gate is `member.change_role` — the narrowest permission this screen
 * actually exercises, rather than a role name.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspace: string }>;
}

export default async function MembersSettingsPage({ params }: PageProps) {
  const { workspace: urlKey } = await params;
  const access = await accessForPage(urlKey);
  if (!access) notFound();

  const { repos, workspace, user, actor } = access;
  if (!can(actor, "member.change_role", { kind: "member" })) notFound();

  const [members, invites, teams] = await Promise.all([
    repos.workspaces.listMembers(workspace.id),
    repos.workspaces.listInvites(workspace.id, "pending"),
    repos.teams.listForWorkspace(workspace.id),
  ]);

  const rows: MemberRow[] = members.map((member) => ({
    userId: member.userId,
    email: member.user.email,
    name: member.user.name,
    displayName: member.user.displayName,
    avatarUrl: member.user.avatarUrl,
    avatarColor: member.user.avatarColor,
    role: member.role,
    joinedAt: member.joinedAt,
    active: member.user.active,
  }));

  // Expired-but-still-`pending` rows are listed rather than hidden. The status
  // column only flips to `expired` when somebody tries to *use* the link, so
  // "pending" in the database and "usable" are not the same set — and an admin
  // wondering why a link stopped working needs to see the row and its date
  // rather than have it silently disappear. Each row renders its expiry.
  const pending: PendingInviteView[] = invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
  }));

  // `actor.workspaceRole` is non-null: `can()` above denies a null role by
  // precondition, so reaching this line proves there is a membership row.
  const actorRole = actor.workspaceRole ?? "member";

  const canInvite = can(actor, "member.invite", { kind: "invite" });

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-large font-[var(--weight-title)] text-primary">
            Members
          </h1>
          <p className="text-mini text-tertiary">
            {rows.length === 1 ? "1 person" : `${rows.length} people`} in{" "}
            {workspace.name}. Roles apply across every team and project.
          </p>
        </div>
        {canInvite ? (
          <InviteControl
            workspaceId={workspace.id}
            actorRole={actorRole}
            teams={teams.map((team) => ({
              id: team.id,
              key: team.key,
              name: team.name,
            }))}
          />
        ) : null}
      </div>

      <MembersTable
        workspaceId={workspace.id}
        members={rows}
        currentUserId={user.id}
      />

      <PendingInvites workspaceId={workspace.id} invites={pending} />
    </div>
  );
}
