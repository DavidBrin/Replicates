/**
 * The workspace layout: the one place a URL segment becomes a workspace, a
 * viewer and a set of teams.
 *
 * ## Authorization happens here, not in the components
 *
 * Three checks, in order, and the order matters:
 *
 * 1. **No session → sign in.** With a `next` parameter, so accepting an invite
 *    link and then signing in lands where the link pointed.
 * 2. **No such workspace → 404.**
 * 3. **Not a member → 404, not 403.** `can(actor, "workspace.view", …)` is
 *    false for a user with no `workspace_members` row, and the response is a
 *    *not found* rather than a *forbidden*: telling an outsider that
 *    `/acme/…` exists but is closed to them is a membership disclosure, which
 *    for a workspace tool is the whole secret.
 *
 * ## Why the teams come from `listForUser`
 *
 * Not from `listForWorkspace` filtered afterwards. `ports/repositories.ts` is
 * explicit about the difference: a guest must not be able to *discover* a team,
 * so an unlisted team is one that was never selected, not one that was fetched
 * and hidden. The sidebar renders whatever this returns and holds no opinion
 * about permissions.
 */

import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";

import { getDb } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import { unreadCountForWorkspace } from "@/app/api/notifications/scope";
import { can } from "@/domain/policy";
import { actorFor, currentUser } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell/app-shell";
import type { ShellData } from "@/components/app-shell/workspace-context";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: urlKey } = await params;
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/${urlKey}`)}`);

  const repositories = getRepositories();
  const workspace = await repositories.workspaces.byUrlKey(urlKey);
  if (!workspace) notFound();

  const actor = await actorFor(workspace.id, user.id);
  if (!can(actor, "workspace.view", { kind: "workspace" })) notFound();

  const [teams, workspaces, views, unreadCount] = await Promise.all([
    repositories.teams.listForUser(workspace.id, user.id),
    repositories.workspaces.listForUser(user.id),
    repositories.views.listForUser(workspace.id, user.id),
    // Scoped to this workspace, not to the account. The sidebar badge sits
    // inside one workspace's chrome, so an account-wide count makes it promise
    // unread items that this Inbox will never show — and, worse, silently
    // reports the existence of activity in a workspace the reader may have
    // been removed from. Same defect the notifications API carried; same fix.
    unreadCountForWorkspace(getDb(), user.id, workspace.id),
  ]);

  const data: ShellData = {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      urlKey: workspace.urlKey,
    },
    workspaces: workspaces.map((entry) => ({
      id: entry.id,
      name: entry.name,
      urlKey: entry.urlKey,
    })),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      avatarColor: user.avatarColor,
    },
    teams: teams.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
      icon: team.icon,
      color: team.color,
      private: team.private,
    })),
    views: views.map((view) => ({
      id: view.id,
      name: view.name,
      icon: view.icon,
      color: view.color,
      teamId: view.teamId,
    })),
    unreadCount,
  };

  return <AppShell data={data}>{children}</AppShell>;
}
