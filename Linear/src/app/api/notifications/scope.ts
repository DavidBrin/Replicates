import "server-only";

/**
 * The Inbox's two set-wide operations, scoped to the workspace that asked.
 *
 * ## The bug this module exists to close
 *
 * `/api/notifications` is a workspace endpoint: it takes `?workspace=` (or
 * `{ workspace }` in the body), refuses anyone without standing in it, and lists
 * rows joined to it. The badge count and "mark all read" were the two things
 * that then ignored it — `notifications.user_id` is the only clause in
 * `NotificationRepository.unreadCount` and `markAllRead`, so both spanned
 * **every workspace the user belongs to**. The visible half was a badge that
 * counted a different workspace's inbox; the destructive half was `markAllRead`
 * from one workspace silently clearing the unread state of all the others,
 * which is not a permission error but is an unasked-for write across a boundary
 * the endpoint otherwise enforces on every request.
 *
 * ## Why it is a route-local module rather than a repository option
 *
 * A Next route file may only export HTTP verbs, and both `/api/notifications`
 * and `/api/notifications/[id]` need this — the same reason
 * `api/issues/authorize.ts` sits beside its handlers. Keeping it here also keeps
 * the workspace resolution in one shape: a notification reaches its workspace
 * through *whichever* container it points at, exactly as `loadInbox` reaches it,
 * and a row with neither an issue nor a project belongs to no workspace and is
 * counted by none.
 *
 * These are set operations over the recipient's own rows, so there is no `can()`
 * call here and there should not be: the authorization already happened —
 * `authorizeInboxRequest` established standing in the workspace, and every row
 * touched is `user_id = $1`. What this module adds is the *scope* of the set,
 * not the right to touch it. Per-row visibility (a notification pointing at an
 * issue the actor may no longer see) stays where it belongs, in
 * `components/inbox/data.ts`.
 */

import type { SqlExecutor } from "@/adapters/db";
import type { UserId, WorkspaceId } from "@/domain/entities";

/**
 * The workspace a notification belongs to, as a `where` fragment.
 *
 * `coalesce(t.workspace_id, p.workspace_id)` and not a join on `workspaces`:
 * the workspace id is already known and already authorized, so the join would
 * only cost a lookup to prove something the caller established.
 */
const IN_WORKSPACE = `
     left join issues i on i.id = n.issue_id
     left join teams t on t.id = i.team_id
     left join projects p on p.id = coalesce(n.project_id, i.project_id)
    where n.user_id = $1
      and coalesce(t.workspace_id, p.workspace_id) = $2`;

/**
 * Unread, in this workspace, not snoozed into the future.
 *
 * Counted in the database rather than from the listed rows: the list is capped
 * by a limit and filtered by `can()`, so deriving the badge from it would show
 * "3" beside a list of three when there are forty.
 */
export async function unreadCountForWorkspace(
  db: SqlExecutor,
  userId: UserId,
  workspaceId: WorkspaceId,
): Promise<number> {
  const rows = await db.query<{ unread: number | string }>(
    `select count(*) as unread
       from notifications n
       ${IN_WORKSPACE}
        and n.read_at is null
        and (n.snoozed_until_at is null or n.snoozed_until_at <= now())`,
    [userId, workspaceId],
  );
  const unread = rows[0]?.unread;
  // `count(*)` is a bigint, which some drivers hand back as a string.
  const parsed = Number(unread ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Inbox zero — for this workspace only.
 *
 * Snoozed rows are included, which is the behaviour the collection has always
 * had: "mark everything read" is one intention and a row hidden until Thursday
 * is still one of the things being dismissed. Only the workspace clause is new.
 *
 * Returns the number of rows changed, which is what the client renders as the
 * count that went away.
 */
export async function markAllReadInWorkspace(
  db: SqlExecutor,
  userId: UserId,
  workspaceId: WorkspaceId,
): Promise<number> {
  return db.execute(
    `update notifications set read_at = now()
      where user_id = $1
        and read_at is null
        and id in (
          select n.id
            from notifications n
            ${IN_WORKSPACE}
        )`,
    [userId, workspaceId],
  );
}
