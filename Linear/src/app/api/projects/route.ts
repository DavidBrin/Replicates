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
  denialResponse,
  forbidden,
  notFoundResponse,
  sessionForRequest,
  unauthorized,
  type WorkspaceAccess,
} from "@/components/members/workspace-access";
import {
  PROJECT_STATES,
  type UserId,
  type WorkspaceRole,
} from "@/domain/entities";
import { can, canViewTeam, checkProjectRoleChange } from "@/domain/policy";

import { HEX_COLOR } from "@/domain/color";

/**
 * A project colour, which reaches a CSS property when the project renders.
 * `z.string().max(40)` let an authorised member store `url(...)` and make
 * every other member's browser fetch it. See `domain/color.ts`.
 */
const HEX_COLOR_SCHEMA = z
  .string()
  .regex(HEX_COLOR, "Colour must be a hex value such as #5e6ad2.")
  .transform((value) => value.toLowerCase());

const Body = z.object({
  workspaceId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  summary: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  color: HEX_COLOR_SCHEMA.optional(),
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
    // A team from another workspace — or a private one this actor is not in —
    // is not a 403: from this actor's point of view it does not exist, and
    // saying so would confirm that it does. `canViewTeam` picks the public or
    // private row of the matrix so this call site never does.
    if (
      !team ||
      team.workspaceId !== access.workspace.id ||
      !canViewTeam(access.actor, team)
    ) {
      return notFoundResponse("team", headers);
    }
    teams.push(team);
  }

  // `every`, emphatically not `some`. `project.create` is team-scoped, so a
  // body naming two teams is two separate permission questions, and one grant
  // is not an answer to the other: with `some`, a member of Engineering could
  // attach the private Design team to a project simply by listing both — and
  // an attached team is what decides who may read the project afterwards
  // (footnote 11). The no-teams case is spelled out rather than left to
  // `every`'s vacuous truth, which would grant it to everybody.
  const permitted =
    teams.length === 0
      ? can(access.actor, "project.create", { kind: "project" })
      : teams.every((team) =>
          can(access.actor, "project.create", {
            kind: "project",
            team: { id: team.id, private: team.private },
          }),
        );
  if (!permitted) return forbidden("project.create", headers);

  // The creator is a member of what they created, and leads it unless the body
  // names somebody else. Membership grants edit here (`DECISIONS.md` D8), so
  // omitting it would produce a project its author cannot change.
  const membership = await plannedMembership(
    access,
    headers,
    {
      userId: input.leadId === undefined ? access.user.id : input.leadId,
      explicit: input.leadId !== undefined,
    },
    input.memberIds,
  );
  if (!membership.ok) return membership.response;

  const project = await access.repos.projects.create(
    {
      workspaceId: access.workspace.id,
      name: input.name,
      description: input.description ?? "",
      summary: input.summary ?? "",
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.state === undefined ? {} : { state: input.state }),
      leadId: membership.leadId,
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      teamIds,
      memberIds: membership.memberIds,
    },
    access.user.id,
  );

  return Response.json({ project }, { status: 201, headers });
}

type PlannedMembership =
  | {
      readonly ok: true;
      readonly leadId: UserId | null;
      readonly memberIds: UserId[];
    }
  | { readonly ok: false; readonly response: Response };

/**
 * The project's founding membership, checked against the same rules a later
 * `POST /api/projects/{id}/members` would face.
 *
 * `leadId` and `memberIds` used to go straight into the insert, which made
 * project creation a way around every membership rule there is: a plain team
 * member could name a workspace **guest** as lead and mint the container admin
 * R7 exists to forbid, or seed a project with somebody who is not a principal
 * of the workspace at all.
 *
 * The checks live here rather than in `domain/services/membership.ts` for one
 * reason: that service acts on a project row under a lock, and there is no row
 * yet. Creating first and repairing afterwards would leave a window — however
 * short — in which the illegal grant is real and readable. So the transition is
 * decided before the write, by the same `policy.ts` function the service calls,
 * and the insert only ever writes principals that have already been cleared.
 *
 * `lead.explicit` is the one subtlety. A guest may hold `team:member`, and row
 * 28 grants `project.create` to `team:member` — so a guest *may* create a
 * project and may *never* lead one. Refusing the whole request would contradict
 * the matrix; silently ignoring a lead the caller asked for would be worse. So
 * the default lead (the creator) steps down to plain membership and the project
 * is created without one, which R6 explicitly allows, while a lead the body
 * named is refused out loud.
 */
async function plannedMembership(
  access: WorkspaceAccess,
  headers: Headers,
  lead: { readonly userId: string | null; readonly explicit: boolean },
  requested: readonly string[] | undefined,
): Promise<PlannedMembership> {
  const actor = {
    workspaceRole: access.actor.workspaceRole ?? "guest",
    projectRole: null,
  };

  /**
   * Not "no such user": a project membership for somebody with no
   * `workspace_members` row is the state `SPEC.md` §4 says cannot exist, and an
   * id borrowed from another tenancy must be indistinguishable from a typo.
   */
  const workspaceRoleOf = async (
    userId: string,
  ): Promise<WorkspaceRole | null> =>
    (await access.repos.workspaces.memberOf(access.workspace.id, userId))
      ?.role ?? null;

  // The lead is decided first, because failing the check can change who it is.
  let leadId: UserId | null = null;
  if (lead.userId !== null) {
    const targetRole = await workspaceRoleOf(lead.userId);
    if (targetRole === null) {
      return { ok: false, response: notFoundResponse("member", headers) };
    }
    const decision = checkProjectRoleChange(
      actor,
      { workspaceRole: targetRole },
      "lead",
    );
    if (decision.ok) {
      leadId = lead.userId;
    } else if (lead.explicit) {
      return { ok: false, response: denialResponse(decision.denial, headers) };
    }
  }

  const memberIds = new Set<UserId>(requested ?? []);
  memberIds.add(access.user.id);
  if (leadId !== null) memberIds.add(leadId);

  for (const userId of memberIds) {
    if (userId === leadId) continue;
    const targetRole = await workspaceRoleOf(userId);
    if (targetRole === null) {
      return { ok: false, response: notFoundResponse("member", headers) };
    }
    const decision = checkProjectRoleChange(
      actor,
      { workspaceRole: targetRole },
      "member",
    );
    if (!decision.ok) {
      return { ok: false, response: denialResponse(decision.denial, headers) };
    }
  }

  return { ok: true, leadId, memberIds: [...memberIds] };
}
