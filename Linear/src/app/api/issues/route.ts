/**
 * `GET /api/issues` — list, and `POST /api/issues` — create.
 *
 * ## Why a Route Handler and not a Server Action
 *
 * Server Actions **dispatch sequentially, one at a time per client** (Next's
 * own documentation, and `DECISIONS.md` D6). Selecting five issues and pressing
 * `S` fires five mutations, and the fifth would wait on four round trips in an
 * app whose entire reputation is that it answers instantly. Route Handlers are
 * not subject to that dispatcher.
 *
 * ## Idempotency
 *
 * The client mints the issue id before the request leaves, so the row can
 * render immediately and be reconciled by id (§6.5, rule 2). That makes the
 * create naturally idempotent: a retry after a timeout names an id that already
 * exists, and this handler returns the existing row instead of a duplicate or a
 * unique-violation 500. `Idempotency-Key` is accepted and logged into the same
 * decision, but the id is what actually carries it — a key the client forgot to
 * send cannot produce a second issue.
 *
 * ## A guest asking for a team they are not in gets a 403
 *
 * Not an empty list. `GET` with an explicit `teamId` resolves the team, checks
 * `canViewTeam`, and refuses — because an empty list is indistinguishable from
 * "that team has no issues", which is an answer nobody outside the team is
 * entitled to.
 */

import { z } from "zod";

import { getRepositories } from "@/adapters/repositories";
import { isPriority, type Priority, type StateType } from "@/domain/entities";
import { can, canViewTeam } from "@/domain/policy";
import { actorFor } from "@/lib/auth/current-user";
import {
  authenticate,
  authorize,
  failure,
  issueResource,
  respond,
  validateReferences,
} from "./authorize";

/**
 * Priority, validated through the domain's own guard.
 *
 * `z.enum` cannot express a numeric literal union and `z.number()` would let
 * `7` through to a `smallint` column with a check constraint, where it fails at
 * execution rather than here — with an error that names the statement instead
 * of the field. Reusing `isPriority` keeps one definition of what the five
 * legal values are.
 */
const priority = z.custom<Priority>((value) => isPriority(value), {
  message: "Invalid priority.",
});

const CreateBody = z.object({
  id: z.string().min(1).max(64).optional(),
  teamId: z.string().min(1).max(64),
  title: z.string().min(1).max(512),
  description: z.string().max(50_000).optional(),
  stateId: z.string().min(1).max(64).optional(),
  priority: priority.optional(),
  assigneeId: z.string().min(1).max(64).nullable().optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  dueDate: z.string().max(32).nullable().optional(),
  labelIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  sortOrder: z.string().min(1).max(256).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticate(request);
  if (!authenticated.ok) return authenticated.response;
  const viewer = authenticated.value;

  const parsed = CreateBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return failure(400, "That issue could not be read.", viewer);
  }
  const body = parsed.data;

  const repositories = getRepositories();
  // The workspace comes from the team row, never from the request.
  const team = await repositories.teams.byId(body.teamId);
  if (!team) return failure(404, "No such team.", viewer);

  const actor = await actorFor(team.workspaceId, viewer.user.id);
  if (!canViewTeam(actor, team)) {
    return failure(403, "Your role does not allow this.", viewer);
  }

  const allowed = authorize(
    actor,
    ["issue.create"],
    issueResource(team, {
      creatorId: viewer.user.id,
      assigneeId: body.assigneeId ?? null,
      projectId: body.projectId ?? null,
    }),
    viewer,
  );
  if (!allowed.ok) return allowed.response;

  const invalid = await validateReferences(body, team);
  if (invalid) return failure(400, invalid, viewer);

  if (body.id) {
    const existing = await repositories.issues.byId(body.id);
    if (existing) {
      // A retry, an offline replay, or a double-submit. Returning the row makes
      // the second attempt indistinguishable from the first for the client.
      return respond({ issue: existing }, 200, viewer);
    }
  }

  const issue = await repositories.issues.create(
    {
      ...(body.id ? { id: body.id } : {}),
      teamId: team.id,
      title: body.title,
      description: body.description ?? "",
      ...(body.stateId ? { stateId: body.stateId } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      assigneeId: body.assigneeId ?? null,
      projectId: body.projectId ?? null,
      dueDate: body.dueDate ?? null,
      labelIds: body.labelIds ?? [],
      creatorId: viewer.user.id,
      ...(body.sortOrder ? { sortOrder: body.sortOrder } : {}),
    },
    viewer.user.id,
  );

  return respond({ issue }, 201, viewer);
}

const STATE_TYPES_FOR_VIEW: Readonly<Record<string, readonly StateType[]>> = {
  active: ["unstarted", "started"],
  backlog: ["backlog", "triage"],
};

export async function GET(request: Request): Promise<Response> {
  const authenticated = await authenticate(request);
  if (!authenticated.ok) return authenticated.response;
  const viewer = authenticated.value;

  const url = new URL(request.url);
  const urlKey = url.searchParams.get("workspace");
  if (!urlKey) return failure(400, "A workspace is required.", viewer);

  const repositories = getRepositories();
  const workspace = await repositories.workspaces.byUrlKey(urlKey);
  if (!workspace) return failure(404, "No such workspace.", viewer);

  const actor = await actorFor(workspace.id, viewer.user.id);
  if (!can(actor, "workspace.view", { kind: "workspace" })) {
    return failure(403, "Your role does not allow this.", viewer);
  }

  const teamKey = url.searchParams.get("team");
  let teamIds: string[];
  if (teamKey) {
    const team = await repositories.teams.byKey(
      workspace.id,
      teamKey.toUpperCase(),
    );
    // 404 before 403: a team that does not exist and a team you may not see
    // should not be distinguishable, and the not-found answer is the one that
    // leaks least.
    if (!team || !canViewTeam(actor, team)) {
      return failure(404, "No such team.", viewer);
    }
    teamIds = [team.id];
  } else {
    const teams = await repositories.teams.listForUser(
      workspace.id,
      viewer.user.id,
    );
    teamIds = teams.map((team) => team.id);
  }

  if (teamIds.length === 0) return respond({ issues: [] }, 200, viewer);

  const view = url.searchParams.get("view") ?? "all";
  const stateTypes = STATE_TYPES_FOR_VIEW[view];
  const assignee = url.searchParams.get("assignee");

  const issues = await repositories.issues.list({
    workspaceId: workspace.id,
    filter: {
      teamIds,
      ...(stateTypes ? { stateTypes } : {}),
      ...(assignee
        ? { assigneeIds: [assignee === "me" ? viewer.user.id : assignee] }
        : {}),
    },
    orderBy: "manual",
    limit: 500,
  });

  return respond({ issues }, 200, viewer);
}
