/**
 * `PATCH|POST|DELETE /api/teams/{id}`
 *
 * Team settings, workflow states and labels.
 *
 * ## The two guards on deleting a workflow state
 *
 * `issues.state_id` is `not null` with no cascade, so a state is never merely a
 * row. The repository takes a reassignment target for exactly that reason. This
 * handler refuses earlier and for two different reasons:
 *
 * 1. **The last state of a type.** A team with no `completed` state has no way
 *    to finish an issue, and no screen in the app can express the resulting
 *    state. The repository cannot see this — it deletes one row and knows
 *    nothing about categories — so the rule lives here, where the type is
 *    known.
 * 2. **A state that still holds issues.** Reassignment is available and is what
 *    the repository does, but silently moving forty issues into a state nobody
 *    chose is not something a settings screen should do behind a delete button.
 *    The refusal names the count so the operator can move them deliberately.
 *
 * Both are `409` rather than `403`: no role would change the answer.
 */

import { z } from "zod";

import { getRepositories } from "@/adapters/repositories";
import {
  accessForWorkspace,
  badRequest,
  canOnTeam,
  forbidden,
  notFoundResponse,
  sessionForRequest,
  unauthorized,
  type RequestSession,
  type WorkspaceAccess,
} from "@/components/members/workspace-access";
import { ESTIMATION_SCALES, STATE_TYPES, type Team } from "@/domain/entities";
import type { Action } from "@/domain/policy";

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  key: z.string().trim().min(1).max(5).optional(),
  description: z.string().max(2_000).nullable().optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  private: z.boolean().optional(),
  triageEnabled: z.boolean().optional(),
  estimationScale: z.enum(ESTIMATION_SCALES).optional(),
});

const Command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("createState"),
    name: z.string().trim().min(1).max(60),
    type: z.enum(STATE_TYPES),
    color: z.string().min(1).max(40),
  }),
  z.object({
    action: z.literal("updateState"),
    stateId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(60).optional(),
    color: z.string().min(1).max(40).optional(),
    position: z.number().finite().optional(),
  }),
  z.object({
    action: z.literal("deleteState"),
    stateId: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("createLabel"),
    name: z.string().trim().min(1).max(60),
    color: z.string().min(1).max(40),
  }),
  z.object({
    action: z.literal("updateLabel"),
    labelId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(60).optional(),
    color: z.string().min(1).max(40).optional(),
  }),
  z.object({
    action: z.literal("deleteLabel"),
    labelId: z.string().min(1).max(64),
  }),
]);

type Context = { params: Promise<{ id: string }> };

type Authorized =
  | {
      readonly ok: true;
      readonly access: WorkspaceAccess;
      readonly team: Team;
      readonly headers: Headers;
    }
  | { readonly ok: false; readonly response: Response };

async function authorize(
  session: RequestSession,
  context: Context,
  action: Action,
): Promise<Authorized> {
  const { headers } = session;
  const { id } = await context.params;

  const team = await getRepositories().teams.byId(id);
  if (!team) return { ok: false, response: notFoundResponse("team", headers) };

  const access = await accessForWorkspace(session.user, team.workspaceId);
  if (!access) return { ok: false, response: notFoundResponse("team", headers) };

  if (!canOnTeam(access.actor, action, team)) {
    // A team the actor cannot even see does not exist as far as they are
    // concerned — `SPEC.md` §4's "no team outside their memberships is
    // listable, readable or discoverable" is only true if a 403 does not
    // confirm the id.
    const visible = canOnTeam(
      access.actor,
      team.private ? "team.view_private" : "team.view",
      team,
    );
    return {
      ok: false,
      response: visible
        ? forbidden(action, headers)
        : notFoundResponse("team", headers),
    };
  }

  return { ok: true, access, team, headers };
}

/** A refusal the matrix cannot express, because it depends on a count. */
function conflict(message: string, headers: Headers): Response {
  return Response.json({ error: message, code: "CONFLICT" }, {
    status: 409,
    headers,
  });
}

export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const auth = await authorize(session, context, "team.update");
  if (!auth.ok) return auth.response;

  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid team settings.", auth.headers);

  if (
    parsed.data.private !== undefined &&
    parsed.data.private !== auth.team.private &&
    !canOnTeam(auth.access.actor, "team.set_private", auth.team)
  ) {
    return forbidden("team.set_private", auth.headers);
  }

  try {
    const team = await auth.access.repos.teams.update(
      auth.team.id,
      parsed.data,
      auth.access.user.id,
    );
    return Response.json({ team }, { headers: auth.headers });
  } catch (error) {
    // `ConflictError` is how the repository reports a taken key or an illegal
    // one. It is a 409 with the repository's own message, which names the key
    // — the caller supplied it, so there is nothing to leak.
    return conflict(messageOf(error), auth.headers);
  }
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const raw: unknown = await request.json().catch(() => null);
  const parsed = Command.safeParse(raw);

  const action: Action = !parsed.success
    ? "state.manage"
    : labelAction(parsed.data.action);

  const auth = await authorize(session, context, action);
  if (!auth.ok) return auth.response;
  if (!parsed.success) return badRequest("Invalid team command.", auth.headers);

  const { repos } = auth.access;
  const command = parsed.data;

  switch (command.action) {
    case "createState": {
      const state = await repos.teams.createState({
        teamId: auth.team.id,
        name: command.name,
        type: command.type,
        color: command.color,
      });
      return Response.json({ state }, { status: 201, headers: auth.headers });
    }
    case "updateState": {
      const state = await repos.teams.updateState(command.stateId, {
        ...(command.name === undefined ? {} : { name: command.name }),
        ...(command.color === undefined ? {} : { color: command.color }),
        ...(command.position === undefined ? {} : { position: command.position }),
      });
      return Response.json({ state }, { headers: auth.headers });
    }
    case "deleteState": {
      return deleteState(auth, command.stateId);
    }
    case "createLabel": {
      const label = await repos.labels.create({
        workspaceId: auth.access.workspace.id,
        teamId: auth.team.id,
        name: command.name,
        color: command.color,
      });
      return Response.json({ label }, { status: 201, headers: auth.headers });
    }
    case "updateLabel": {
      const existing = await repos.labels.byId(command.labelId);
      if (!existing || existing.teamId !== auth.team.id) {
        return notFoundResponse("team", auth.headers);
      }
      const label = await repos.labels.update(command.labelId, {
        ...(command.name === undefined ? {} : { name: command.name }),
        ...(command.color === undefined ? {} : { color: command.color }),
      });
      return Response.json({ label }, { headers: auth.headers });
    }
    case "deleteLabel": {
      const existing = await repos.labels.byId(command.labelId);
      if (!existing || existing.teamId !== auth.team.id) {
        return notFoundResponse("team", auth.headers);
      }
      await repos.labels.delete(command.labelId);
      return Response.json({ deleted: command.labelId }, { headers: auth.headers });
    }
  }
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const auth = await authorize(session, context, "team.delete");
  if (!auth.ok) return auth.response;

  await auth.access.repos.teams.delete(auth.team.id, auth.access.user.id);
  return Response.json({ deleted: auth.team.id }, { headers: auth.headers });
}

/* =============================================================== helpers = */

/**
 * Creating a label is work; editing one is administration.
 *
 * Rows 25 and 26 differ by exactly one column (`team:member`), which is the
 * whole reason they are two rows. Collapsing them here would quietly grant
 * every team member the ability to rename a label everyone else is filtering
 * on.
 */
function labelAction(action: Command["action"]): Action {
  if (action === "createLabel") return "label.create";
  if (action === "updateLabel" || action === "deleteLabel") {
    return "label.update_delete";
  }
  return "state.manage";
}

type Command = z.infer<typeof Command>;

async function deleteState(
  auth: Extract<Authorized, { ok: true }>,
  stateId: string,
): Promise<Response> {
  const { repos, workspace } = auth.access;
  const states = await repos.teams.listStates(auth.team.id);
  const target = states.find((state) => state.id === stateId);
  if (!target) return notFoundResponse("team", auth.headers);

  const sameType = states.filter((state) => state.type === target.type);
  if (sameType.length <= 1) {
    return conflict(
      `${target.name} is the only ${target.type} state in this team. Add another before deleting it.`,
      auth.headers,
    );
  }

  const held = await repos.issues.count({
    workspaceId: workspace.id,
    filter: { stateIds: [stateId], includeArchived: true },
  });
  if (held > 0) {
    return conflict(
      `${target.name} still holds ${held} ${held === 1 ? "issue" : "issues"}. Move them to another status first.`,
      auth.headers,
    );
  }

  // The repository insists on a reassignment target because it cannot know the
  // state is empty. It is, so this only satisfies the signature — the `update`
  // it runs matches no rows.
  const fallback = sameType.find((state) => state.id !== stateId);
  if (!fallback) return conflict("No status to reassign to.", auth.headers);

  await repos.teams.deleteState(stateId, fallback.id);
  return Response.json({ deleted: stateId }, { headers: auth.headers });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The change was rejected.";
}
