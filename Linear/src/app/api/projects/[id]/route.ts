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
import type { Action } from "@/domain/policy";

const Patch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  summary: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  state: z.enum(PROJECT_STATES).optional(),
  leadId: z.string().min(1).max(64).nullable().optional(),
  startDate: z.string().max(10).nullable().optional(),
  targetDate: z.string().max(10).nullable().optional(),
  sortOrder: z.string().max(120).optional(),
});

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

export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  const auth = await authorize(request, context, "project.update");
  if (!auth.ok) return auth.response;

  const parsed = Patch.safeParse(await request.json().catch(() => null));
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
      await repos.projects.deleteMilestone(command.milestoneId, user.id);
      return Response.json({ deleted: command.milestoneId }, { headers: auth.headers });
    }
    case "addTeam": {
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
