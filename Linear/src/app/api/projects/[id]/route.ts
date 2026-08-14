/**
 * `PATCH|POST|DELETE /api/projects/{id}`
 *
 * One project: its fields, its milestones, its status updates and its teams.
 *
 * ## Why `POST` carries an `action`
 *
 * A milestone and a status update are not fields of a project, and in a larger
 * API they would be `/projects/{id}/milestones` and `/projects/{id}/updates`.
 * They are folded in here because this slice owns a fixed list of route files;
 * the discriminated union keeps the folding honest — `zod` rejects a body whose
 * `action` does not match its shape, so there is no "some fields are optional
 * depending on the others" ambiguity.
 *
 * ## `health` is not patchable
 *
 * Deliberately absent from {@link Patch}. Health is the lead's weekly judgement
 * and changes by *posting an update*, which is the only thing that writes it
 * (`adapters/repositories/projects.ts`). A `PATCH { health }` would let the two
 * disagree: a project reading "at risk" whose latest update says "on track".
 *
 * ## Neither is `leadId`, and for a stronger reason
 *
 * Who leads a project is stored twice — `projects.lead_id` names one person,
 * `project_members.role` records the grant — and the two have to agree, because
 * the roll-up in `domain/policy.ts` reads the *membership row* while every
 * screen renders the *column*. A generic field patch can only write the column,
 * so accepting `leadId` here produced a project whose header named a lead the
 * permission matrix had never heard of.
 *
 * It was also the wrong gate: `project.update` is held by every project member
 * (row 30), while minting a lead is `project.change_member_role` measured
 * against the target's rank (footnote 12). So the field leaves entirely, and
 * `PATCH /api/projects/{id}/members` — which writes both stores under the
 * project's row lock (`domain/services/membership.ts`) — is the only way in.
 * A body that still carries it is refused rather than silently ignored: the
 * optimistic store has already drawn the new lead, and a 200 that changed
 * nothing reverts on the next reload with no error anywhere.
 */

import { z } from "zod";

import { getRepositories } from "@/adapters/repositories";
import {
  accessForWorkspace,
  badRequest,
  canOnProject,
  forbidden,
  notFoundResponse,
  projectScope,
  sessionForRequest,
  unauthorized,
  type WorkspaceAccess,
} from "@/components/members/workspace-access";
import {
  PROJECT_HEALTHS,
  PROJECT_STATES,
  type ProjectId,
} from "@/domain/entities";
import { canViewTeam, type Action } from "@/domain/policy";

const Patch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  summary: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  state: z.enum(PROJECT_STATES).optional(),
  startDate: z.string().max(10).nullable().optional(),
  targetDate: z.string().max(10).nullable().optional(),
  sortOrder: z.string().max(120).optional(),
});

/**
 * Fields this endpoint refuses by name rather than by dropping them.
 *
 * `z.object` strips what it does not declare, so without this a `leadId` would
 * be a 200 that wrote nothing — see the header. Named explicitly so the message
 * can point at the endpoint that does own the field.
 */
const ELSEWHERE: Readonly<Record<string, string>> = {
  leadId: "The project lead is set through /api/projects/{id}/members.",
  health: "Project health is set by posting an update.",
};

/** The first refused key a body carries, if any. */
function fieldOwnedElsewhere(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  for (const [field, message] of Object.entries(ELSEWHERE)) {
    if (field in body) return message;
  }
  return null;
}

const Command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("postUpdate"),
    body: z.string().trim().min(1).max(20_000),
    health: z.enum(PROJECT_HEALTHS),
  }),
  z.object({
    action: z.literal("createMilestone"),
    name: z.string().trim().min(1).max(200),
    targetDate: z.string().max(10).nullable().optional(),
  }),
  z.object({
    action: z.literal("updateMilestone"),
    milestoneId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(200).optional(),
    targetDate: z.string().max(10).nullable().optional(),
  }),
  z.object({
    action: z.literal("deleteMilestone"),
    milestoneId: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("addTeam"),
    teamId: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("removeTeam"),
    teamId: z.string().min(1).max(64),
  }),
]);

type Context = { params: Promise<{ id: string }> };

/**
 * Resolve the project, the actor, and the answer to one permission question.
 *
 * Written once because the alternative is three handlers that each look up a
 * project, each build a scope, and each remember to ask — and the one that
 * forgets is the hole. The `Response` return is the refusal, already formed.
 */
type Authorized =
  | {
      readonly ok: true;
      readonly access: WorkspaceAccess;
      readonly projectId: ProjectId;
      readonly headers: Headers;
    }
  | { readonly ok: false; readonly response: Response };

async function authorize(
  request: Request,
  context: Context,
  action: Action,
): Promise<Authorized> {
  const session = await sessionForRequest(request);
  if (!session) return { ok: false, response: unauthorized() };
  const { headers } = session;

  const { id } = await context.params;

  // The project is looked up before the workspace, because the project is what
  // names the workspace. A project id from another workspace therefore resolves
  // to that workspace and is refused by the membership check below, not by a
  // mismatched-id branch that would have to be remembered here.
  const project = await getRepositories().projects.byId(id);
  if (!project) return { ok: false, response: notFoundResponse("project", headers) };

  const access = await accessForWorkspace(session.user, project.workspaceId);
  if (!access) {
    return { ok: false, response: notFoundResponse("project", headers) };
  }

  const scope = await projectScope(access.repos, project.id);
  if (!canOnProject(access.actor, action, project.id, scope)) {
    // A caller who cannot even *view* the project is told it does not exist;
    // one who can view it but not act gets the honest 403. Anything else makes
    // this endpoint an existence oracle for private work.
    const visible = canOnProject(access.actor, "project.view", project.id, scope);
    return {
      ok: false,
      response: visible
        ? forbidden(action, headers)
        : notFoundResponse("project", headers),
    };
  }

  return { ok: true, access, projectId: project.id, headers };
}

/**
 * Does the authorized project own this milestone?
 *
 * The permission question was asked about a project; the command names a
 * milestone by a bare id. Nothing connects the two unless something does it
 * here, and without it a member of any project can rename or delete a milestone
 * of a project they cannot open — the repository looks the row up by primary
 * key and has no project to compare it against.
 *
 * Read from the authorized project's own list rather than by id-then-compare,
 * so there is no branch in which a foreign row has been loaded and the check
 * merely forgotten.
 */
async function ownsMilestone(
  auth: Extract<Authorized, { ok: true }>,
  milestoneId: string,
): Promise<boolean> {
  const milestones = await auth.access.repos.projects.listMilestones(
    auth.projectId,
  );
  return milestones.some((milestone) => milestone.id === milestoneId);
}

export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  const auth = await authorize(request, context, "project.update");
  if (!auth.ok) return auth.response;

  const raw: unknown = await request.json().catch(() => null);

  const elsewhere = fieldOwnedElsewhere(raw);
  if (elsewhere !== null) return badRequest(elsewhere, auth.headers);

  const parsed = Patch.safeParse(raw);
  if (!parsed.success) return badRequest("Invalid project patch.", auth.headers);

  const project = await auth.access.repos.projects.update(
    auth.projectId,
    parsed.data,
    auth.access.user.id,
  );
  return Response.json({ project }, { headers: auth.headers });
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = Command.safeParse(raw);

  // Parsed before authorizing, because *which* permission is required depends
  // on the command: attaching a team is `project.add_team`, everything else is
  // `project.update`.
  const action: Action =
    parsed.success && (parsed.data.action === "addTeam" || parsed.data.action === "removeTeam")
      ? "project.add_team"
      : "project.update";

  const auth = await authorize(request, context, action);
  if (!auth.ok) return auth.response;
  if (!parsed.success) return badRequest("Invalid project command.", auth.headers);

  const { repos, user } = auth.access;
  const command = parsed.data;

  switch (command.action) {
    case "postUpdate": {
      const update = await repos.projects.postUpdate({
        projectId: auth.projectId,
        userId: user.id,
        body: command.body,
        health: command.health,
      });
      return Response.json({ update }, { status: 201, headers: auth.headers });
    }
    case "createMilestone": {
      const milestone = await repos.projects.createMilestone(
        {
          projectId: auth.projectId,
          name: command.name,
          targetDate: command.targetDate ?? null,
        },
        user.id,
      );
      return Response.json({ milestone }, { status: 201, headers: auth.headers });
    }
    case "updateMilestone": {
      if (!(await ownsMilestone(auth, command.milestoneId))) {
        return notFoundResponse("project", auth.headers);
      }
      const milestone = await repos.projects.updateMilestone(
        command.milestoneId,
        {
          ...(command.name === undefined ? {} : { name: command.name }),
          ...(command.targetDate === undefined
            ? {}
            : { targetDate: command.targetDate }),
        },
        user.id,
      );
      return Response.json({ milestone }, { headers: auth.headers });
    }
    case "deleteMilestone": {
      if (!(await ownsMilestone(auth, command.milestoneId))) {
        return notFoundResponse("project", auth.headers);
      }
      await repos.projects.deleteMilestone(command.milestoneId, user.id);
      return Response.json({ deleted: command.milestoneId }, { headers: auth.headers });
    }
    case "addTeam": {
      const team = await repos.teams.byId(command.teamId);
      // `project.add_team` was granted on the *project*. It is not a licence to
      // name any team in the world: attaching one changes who may read the
      // project (footnote 11's roll-up) and, across a workspace boundary, would
      // hand a second tenancy a foothold in this one. So the team has to be in
      // this workspace *and* visible to the actor — `canViewTeam` picks the
      // public/private row of the matrix so the call site never does.
      if (
        !team ||
        team.workspaceId !== auth.access.workspace.id ||
        !canViewTeam(auth.access.actor, team)
      ) {
        // 404, not 403: a private team the actor cannot see must not be
        // confirmed to exist by the shape of the refusal.
        return notFoundResponse("team", auth.headers);
      }
      await repos.projects.addTeam(auth.projectId, command.teamId, user.id);
      return Response.json({ added: command.teamId }, { headers: auth.headers });
    }
    case "removeTeam": {
      await repos.projects.removeTeam(auth.projectId, command.teamId, user.id);
      return Response.json({ removed: command.teamId }, { headers: auth.headers });
    }
  }
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  const auth = await authorize(request, context, "project.delete");
  if (!auth.ok) return auth.response;

  await auth.access.repos.projects.delete(auth.projectId, auth.access.user.id);
  return Response.json({ deleted: auth.projectId }, { headers: auth.headers });
}
