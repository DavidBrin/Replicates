import { notFound } from "next/navigation";

import { accessForPage } from "@/components/members/workspace-access";
import { ProjectList } from "@/components/projects/project-list";
import type { PersonView, ProjectCardView } from "@/components/projects/types";
import { can } from "@/domain/policy";

/**
 * `/[workspace]/projects` — every project the viewer may see.
 *
 * ## Visibility is the query, not a filter
 *
 * `projects.listForUser` decides membership in its `where` clause: a guest gets
 * the projects they were explicitly added to and nothing else. Fetching all of
 * them and hiding some here would be the same screen and a different product —
 * the count in an empty state, an autocomplete, or the next endpoint that
 * forgets the filter all leak the ones that were hidden (`SPEC.md` §4).
 *
 * ## Progress is N+1 and that is the right trade at this size
 *
 * One `count` per project rather than one grouped query over every issue in the
 * workspace. A workspace has tens of projects and the alternative is a query
 * whose plan changes shape as the issue table grows; if this list ever gets
 * long enough to matter, the fix is a single grouped rollup, not a cache.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspace: string }>;
}

export default async function ProjectsPage({ params }: PageProps) {
  const { workspace: urlKey } = await params;
  const access = await accessForPage(urlKey);
  if (!access) notFound();

  // A signed-in stranger and a non-existent workspace leave through the same
  // door. `can()` denies a null workspace role by precondition, so this one
  // check covers both.
  if (!can(access.actor, "workspace.view", { kind: "workspace" })) notFound();

  const { repos, workspace, user } = access;

  const projects = await repos.projects.listForUser(workspace.id, user.id);
  const members = await repos.workspaces.listMembers(workspace.id);
  const people = new Map<string, PersonView>(
    members.map((member) => [
      member.userId,
      {
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        avatarUrl: member.user.avatarUrl,
        avatarColor: member.user.avatarColor,
      },
    ]),
  );

  const cards: ProjectCardView[] = await Promise.all(
    projects.map(async (project): Promise<ProjectCardView> => {
      const progress = await repos.projects.progress(project.id);
      return {
        id: project.id,
        slugId: project.slugId,
        name: project.name,
        summary: project.summary,
        icon: project.icon,
        color: project.color,
        state: project.state,
        health: project.health,
        targetDate: project.targetDate,
        lead:
          project.leadId === null ? null : (people.get(project.leadId) ?? null),
        progress: {
          total: progress.total,
          completed: progress.completed,
          started: progress.started,
          canceled: progress.canceled,
          scope: progress.scope,
          completedScope: progress.completedScope,
        },
      };
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-6 py-6">
      <div>
        <h1 className="text-large font-[var(--weight-title)] text-primary">
          Projects
        </h1>
        <p className="text-mini text-tertiary">
          {cards.length === 1 ? "1 project" : `${cards.length} projects`} in{" "}
          {workspace.name}
        </p>
      </div>
      <ProjectList projects={cards} basePath={`/${workspace.urlKey}`} />
    </div>
  );
}
