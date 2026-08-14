import { notFound } from "next/navigation";

import {
  accessForPage,
  canOnTeam,
} from "@/components/members/workspace-access";
import { LabelEditor } from "@/components/teams/label-editor";
import type {
  TeamCandidateView,
  TeamMemberView,
} from "@/components/teams/team-member-list";
import { TeamMemberList } from "@/components/teams/team-member-list";
import { TeamSettingsForm } from "@/components/teams/team-settings-form";
import { WorkflowStateEditor } from "@/components/teams/workflow-state-editor";
import { can, canViewTeam } from "@/domain/policy";

/**
 * `/[workspace]/settings/teams/[key]` — one team's settings.
 *
 * ## Visibility first, then each capability separately
 *
 * `canViewTeam` picks between the matrix's two view rows — public and private
 * teams have different columns, and choosing the wrong one by hand is a silent
 * privacy bug, which is why `policy.ts` exposes the choice as a function rather
 * than as two actions call sites pick between.
 *
 * A team the actor cannot view is `notFound()`. Everything below that is a
 * separate question with a separate answer, because they genuinely differ: a
 * plain team member may create a label (row 25) but not rename one (row 26),
 * and may see the settings form without being able to save it. Collapsing them
 * into one `isAdmin` flag would be the role comparison this codebase does not
 * have.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspace: string; key: string }>;
}

export default async function TeamSettingsPage({ params }: PageProps) {
  const { workspace: urlKey, key } = await params;
  const access = await accessForPage(urlKey);
  if (!access) notFound();

  const { repos, workspace, actor } = access;

  const team = await repos.teams.byKey(workspace.id, key);
  if (!team) notFound();
  if (!canViewTeam(actor, team)) notFound();

  const [states, labels, members] = await Promise.all([
    repos.teams.listStates(team.id),
    repos.labels.listForWorkspace(workspace.id, team.id),
    repos.teams.listMembers(team.id),
  ]);

  const canEdit = canOnTeam(actor, "team.update", team);
  const canSetPrivate = canOnTeam(actor, "team.set_private", team);
  const canManageStates = canOnTeam(actor, "state.manage", team);
  const canCreateLabel = canOnTeam(actor, "label.create", team);
  const canEditLabel = canOnTeam(actor, "label.update_delete", team);
  // Adding somebody needs the roster, and the roster is its own permission.
  const canManageMembers =
    canOnTeam(actor, "team.remove_member", team) &&
    can(actor, "workspace.view_members", { kind: "member" });

  const memberViews: TeamMemberView[] = members.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
    avatarColor: member.user.avatarColor,
    role: member.role,
  }));

  const candidates: TeamCandidateView[] = canManageMembers
    ? (await repos.workspaces.listMembers(workspace.id))
        .filter(
          (candidate) =>
            !memberViews.some((existing) => existing.id === candidate.userId),
        )
        .map((candidate) => ({
          id: candidate.user.id,
          name: candidate.user.name,
          email: candidate.user.email,
          avatarUrl: candidate.user.avatarUrl,
          avatarColor: candidate.user.avatarColor,
        }))
    : [];

  // Remount the settings form whenever any field it edits changes on the
  // server, instead of re-seeding its draft from an effect.
  const settingsKey = [
    team.id,
    team.name,
    team.key,
    team.description ?? "",
    team.icon,
    team.color,
    String(team.private),
    String(team.triageEnabled),
    team.estimationScale,
  ].join("|");

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-8 px-6 py-6">
      <div>
        <h1 className="text-large font-[var(--weight-title)] text-primary">
          {team.name}
        </h1>
        <p className="text-mini text-tertiary">
          Team settings for{" "}
          <span className="font-mono text-micro">{team.key}</span>. Issues in
          this team are numbered {team.key}-1, {team.key}-2, and so on.
        </p>
      </div>

      <TeamSettingsForm
        key={settingsKey}
        team={{
          id: team.id,
          name: team.name,
          key: team.key,
          description: team.description,
          icon: team.icon,
          color: team.color,
          private: team.private,
          triageEnabled: team.triageEnabled,
          estimationScale: team.estimationScale,
        }}
        canEdit={canEdit}
        canSetPrivate={canSetPrivate}
      />

      <WorkflowStateEditor
        teamId={team.id}
        states={states}
        canManage={canManageStates}
      />

      <LabelEditor
        teamId={team.id}
        labels={labels}
        canCreate={canCreateLabel}
        canEdit={canEditLabel}
      />

      <TeamMemberList
        teamId={team.id}
        members={memberViews}
        candidates={candidates}
        canManage={canManageMembers}
      />
    </div>
  );
}
