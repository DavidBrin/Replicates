/**
 * `POST /api/projects`
 *
 * Creating a project.
 *
 * The interesting part is that `project.create` is a *team*-scoped permission
 * (footnote 10): a project is owned by the teams attached to it, so the question
 * is never "may this person create projects" but "may they create one here".
 * A body with no teams therefore falls back to the workspace columns of the
 * same row, which only owners and admins hold — that is the matrix's answer,
 * not a special case invented here.
 */

import { z } from "zod";

import {
  accessForWorkspace,
  badRequest,
  forbidden,
  notFoundResponse,
  sessionForRequest,
  unauthorized,
} from "@/components/members/workspace-access";
import { PROJECT_STATES } from "@/domain/entities";
import { can } from "@/domain/policy";

const Body = z.object({
  workspaceId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  summary: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  state: z.enum(PROJECT_STATES).optional(),
  leadId: z.string().min(1).max(64).nullable().optional(),
  startDate: z.string().max(10).nullable().optional(),
  targetDate: z.string().max(10).nullable().optional(),
  teamIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  memberIds: z.array(z.string().min(1).max(64)).max(200).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();
  const { headers } = session;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid project.", headers);
  const input = parsed.data;

  const access = await accessForWorkspace(session.user, input.workspaceId);
  if (!access) return notFoundResponse("workspace", headers);

  const teamIds = input.teamIds ?? [];
  const teams = [];
  for (const teamId of teamIds) {
    const team = await access.repos.teams.byId(teamId);
    // A team from another workspace is not a 403 — from this actor's point of
    // view it does not exist, and saying so would confirm that it does.
    if (!team || team.workspaceId !== access.workspace.id) {
      return notFoundResponse("team", headers);
    }
    teams.push(team);
  }

  const permitted =
    teams.length === 0
      ? can(access.actor, "project.create", { kind: "project" })
      : teams.some((team) =>
          can(access.actor, "project.create", {
            kind: "project",
            team: { id: team.id, private: team.private },
          }),
        );
  if (!permitted) return forbidden("project.create", headers);

  const project = await access.repos.projects.create(
    {
      workspaceId: access.workspace.id,
      name: input.name,
      description: input.description ?? "",
      summary: input.summary ?? "",
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.state === undefined ? {} : { state: input.state }),
      // The creator is a member of what they created. Membership grants edit
      // here (`DECISIONS.md` D8), so omitting it would produce a project its
      // author cannot change.
      leadId: input.leadId === undefined ? access.user.id : input.leadId,
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      teamIds,
      memberIds: input.memberIds ?? [access.user.id],
    },
    access.user.id,
  );

  return Response.json({ project }, { status: 201, headers });
}
