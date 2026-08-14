import "server-only";

/**
 * Loading the Inbox: notifications, plus the one line of context that makes
 * each one readable.
 *
 * A notification row is `{ type, issue_id, actor_id }` — three foreign keys and
 * no prose. Rendering that needs the actor's name, the issue's identifier and
 * title, and its status glyph, which is four joins the repository port
 * deliberately does not expose (`NotificationRepository.listForUser` returns
 * domain `Notification`s and nothing else). Rather than N+1 through the
 * repositories per row, this module does the join once.
 *
 * ## The authorization rule, and why it is not "the row is mine"
 *
 * `notifications.user_id` already scopes every query to the recipient, so no
 * user can read another's inbox. That is necessary and not sufficient: a
 * notification is a *pointer to an issue*, and team membership changes. Someone
 * removed from Engineering yesterday still has last week's "assigned you
 * ENG-14" sitting in their inbox, and rendering its title would leak the
 * contents of a team they are no longer in — through a screen nobody thinks of
 * as an issue view.
 *
 * So every row's issue goes through `can(actor, "issue.view", …)`, and a row
 * whose issue the actor may no longer see is **dropped**, not redacted. A
 * redacted row ("a notification about something you cannot see") is a
 * disclosure with extra steps: it confirms the issue exists and that something
 * happened to it.
 */

import type { SqlExecutor, SqlRow } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import {
  accessForWorkspace,
  sessionForRequest,
  type WorkspaceAccess,
} from "@/components/members/workspace-access";
import { formatIdentifier, type NotificationType } from "@/domain/entities";
import { can, type Actor } from "@/domain/policy";
import type { SessionUser } from "@/lib/auth/current-user";

import type { InboxNotification } from "./types";

export type { InboxNotification } from "./types";

interface Row extends SqlRow {
  readonly id: string;
  readonly type: string;
  readonly created_at: string | Date;
  readonly read_at: string | Date | null;
  readonly snoozed_until_at: string | Date | null;
  readonly actor_id: string;
  readonly actor_name: string;
  readonly issue_id: string | null;
  readonly issue_number: number | null;
  readonly issue_title: string | null;
  readonly issue_creator_id: string | null;
  readonly issue_assignee_id: string | null;
  readonly team_id: string | null;
  readonly team_key: string | null;
  readonly team_name: string | null;
  readonly team_private: boolean | null;
  readonly issue_project_id: string | null;
  readonly state_type: string | null;
  readonly state_color: string | null;
  readonly project_id: string | null;
  readonly project_name: string | null;
  readonly project_slug: string | null;
}

export interface LoadInboxOptions {
  readonly unreadOnly?: boolean;
  /** Include rows snoozed into the future. The "Snoozed" tab. */
  readonly includeSnoozed?: boolean;
  readonly limit?: number;
}

/**
 * The Inbox for one user in one workspace.
 *
 * Scoped by workspace as well as by user because a user can belong to several,
 * and an inbox that mixed them would show an issue from a workspace whose tab
 * you do not have open — with an identifier that collides with the one you do.
 */
export async function loadInbox(
  db: SqlExecutor,
  actor: Actor,
  user: SessionUser,
  workspaceId: string,
  options: LoadInboxOptions = {},
): Promise<InboxNotification[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 200));
  const clauses = ["n.user_id = $1", "w.id = $2"];
  if (options.unreadOnly === true) clauses.push("n.read_at is null");
  if (options.includeSnoozed !== true) {
    // A timestamp, not a state: the row reappears because the comparison
    // changed its mind, which is the only design that survives a host with no
    // background workers (`adapters/repositories/notifications.ts`).
    clauses.push("(n.snoozed_until_at is null or n.snoozed_until_at <= now())");
  }

  const rows = await db.query<Row>(
    `select n.id, n.type, n.created_at, n.read_at, n.snoozed_until_at,
            n.actor_id, a.name as actor_name,
            i.id as issue_id, i.number as issue_number, i.title as issue_title,
            i.creator_id as issue_creator_id, i.assignee_id as issue_assignee_id,
            i.project_id as issue_project_id,
            t.id as team_id, t.key as team_key, t.name as team_name,
            t.private as team_private,
            s.type as state_type, s.color as state_color,
            p.id as project_id, p.name as project_name, p.slug_id as project_slug
       from notifications n
       join users a on a.id = n.actor_id
       left join issues i on i.id = n.issue_id
       left join teams t on t.id = i.team_id
       left join workflow_states s on s.id = i.state_id
       left join projects p on p.id = coalesce(n.project_id, i.project_id)
       -- The workspace is reached through whichever container the row points
       -- at. A notification with neither is impossible in this schema, but the
       -- join must not silently drop the project-only rows.
       join workspaces w on w.id = coalesce(t.workspace_id, p.workspace_id)
      where ${clauses.join(" and ")}
      order by n.created_at desc, n.id desc
      limit ${limit}`,
    [user.id, workspaceId],
  );

  const workspaceKey = await urlKeyFor(db, workspaceId);
  return rows.filter((row) => visible(actor, row)).map((row) => toInbox(row, workspaceKey));
}

/** The single row, for a mutation that wants to echo the updated shape back. */
export async function loadOneNotification(
  db: SqlExecutor,
  actor: Actor,
  user: SessionUser,
  workspaceId: string,
  id: string,
): Promise<InboxNotification | null> {
  const all = await loadInbox(db, actor, user, workspaceId, {
    includeSnoozed: true,
    limit: 200,
  });
  return all.find((entry) => entry.id === id) ?? null;
}

/* ============================================================= authorize = */

export type InboxAuthorization =
  | { readonly access: WorkspaceAccess; readonly headers: Headers }
  | { readonly response: Response };

/**
 * Sign-in, workspace and membership for a notifications route, in one step.
 *
 * Returns the *response* for every refusal rather than throwing, so a handler
 * cannot forget to forward `headers`: a sliding session renewal that is not put
 * on the response signs the user out, and the responses most likely to drop it
 * are the early returns.
 *
 * It lives here rather than in the route because a Next route module may only
 * export the HTTP verbs — anything else is a build error — and both
 * `/api/notifications` and `/api/notifications/[id]` need exactly this.
 */
export async function authorizeInboxRequest(
  request: Request,
  workspaceKey: string | null,
): Promise<InboxAuthorization> {
  const session = await sessionForRequest(request);
  if (!session) {
    return {
      response: Response.json({ error: "Not signed in." }, { status: 401 }),
    };
  }

  const key = workspaceKey?.trim() ?? "";
  const workspace = key === "" ? null : await getRepositories().workspaces.byUrlKey(key);
  const access = await accessForWorkspace(session.user, workspace?.id);
  if (!access) {
    // "No such workspace" and "you are not in it" answer the same, so this
    // endpoint cannot be used to discover which workspace keys exist.
    return {
      response: Response.json(
        { error: "Not found." },
        { status: 404, headers: session.headers },
      ),
    };
  }
  return { access, headers: session.headers };
}

/* =============================================================== internal = */

function visible(actor: Actor, row: Row): boolean {
  if (row.issue_id === null) {
    // Project-only notification. The project's teams are not joined here, so
    // the conservative `allTeamsPublic: false` applies: a workspace member sees
    // it only through a project role, which is the grant that actually put the
    // notification in their inbox in the first place.
    if (row.project_id === null) return false;
    return can(actor, "project.view", {
      kind: "project",
      project: { id: row.project_id, allTeamsPublic: false },
    });
  }
  if (row.team_id === null) return false;
  return can(actor, "issue.view", {
    kind: "issue",
    team: { id: row.team_id, private: row.team_private === true },
    ...(row.issue_project_id === null
      ? {}
      : { project: { id: row.issue_project_id, allTeamsPublic: false } }),
    authorId: row.issue_creator_id,
    assigneeId: row.issue_assignee_id,
  });
}

function toInbox(row: Row, workspaceKey: string): InboxNotification {
  const identifier =
    row.team_key !== null && row.issue_number !== null
      ? formatIdentifier(row.team_key, row.issue_number)
      : null;

  return {
    id: row.id,
    type: row.type as NotificationType,
    createdAt: iso(row.created_at),
    readAt: row.read_at === null ? null : iso(row.read_at),
    snoozedUntilAt:
      row.snoozed_until_at === null ? null : iso(row.snoozed_until_at),
    actor: { id: row.actor_id, name: row.actor_name },
    issue:
      row.issue_id !== null && identifier !== null
        ? {
            id: row.issue_id,
            identifier,
            title: row.issue_title ?? "",
            stateType: row.state_type ?? "backlog",
            stateColor: row.state_color ?? "",
            teamName: row.team_name ?? "",
            href: `/${workspaceKey}/issue/${identifier}`,
          }
        : null,
    project:
      row.project_id !== null && row.project_slug !== null
        ? {
            id: row.project_id,
            name: row.project_name ?? "",
            href: `/${workspaceKey}/project/${row.project_slug}`,
          }
        : null,
  };
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function urlKeyFor(db: SqlExecutor, workspaceId: string): Promise<string> {
  const rows = await db.query<SqlRow & { url_key: string }>(
    "select url_key from workspaces where id = $1",
    [workspaceId],
  );
  return rows[0]?.url_key ?? "";
}
