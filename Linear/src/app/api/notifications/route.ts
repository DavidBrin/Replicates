/**
 * `GET /api/notifications` — the Inbox.
 * `POST /api/notifications` — mark every unread notification read.
 *
 * ## Why mark-all is a POST on the collection, not a PATCH on each row
 *
 * "Inbox zero" is one intention. Sending it as forty PATCHes means forty
 * chances for one to fail, an inbox left half-read, and — with the optimistic
 * client this app uses — forty rollbacks to reason about. It is also the one
 * notification mutation with no id to address, so the collection is the only
 * honest place for it.
 *
 * ## Scoping
 *
 * `notifications.user_id` already restricts every row to its recipient. The
 * second check — `can(actor, "issue.view", …)` inside `loadInbox` — exists
 * because a notification is a pointer to an issue and team membership changes
 * underneath it. See `components/inbox/data.ts` for why such a row is dropped
 * rather than redacted.
 *
 * The third is the **workspace**, and it is the one that used to be missing.
 * Both verbs here are addressed to one workspace and refuse anyone without
 * standing in it, but the badge count and the mark-all were asked of the whole
 * account: the count summed every workspace the user belongs to, and "mark all
 * read" cleared all of them from whichever tab happened to be open. `./scope.ts`
 * puts the workspace back into both queries.
 */

import { z } from "zod";

import { authorizeInboxRequest, loadInbox } from "@/components/inbox/data";

import { markAllReadInWorkspace, unreadCountForWorkspace } from "./scope";

const MarkAllBody = z.object({
  workspace: z.string().min(1).max(64),
  action: z.literal("markAllRead"),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const resolved = await authorizeInboxRequest(
    request,
    url.searchParams.get("workspace"),
  );
  if ("response" in resolved) return resolved.response;
  const { access, headers } = resolved;

  const filter = url.searchParams.get("filter");
  const notifications = await loadInbox(
    access.db,
    access.actor,
    access.user,
    access.workspace.id,
    {
      unreadOnly: filter === "unread",
      includeSnoozed: filter === "snoozed",
    },
  );

  // The badge count is a database count rather than `notifications.length`: the
  // list is filtered by `can()` and capped by a limit, so deriving the count
  // from it would show "3" beside a list of three when there are forty. It is
  // scoped to the same workspace the list is, because it labels that inbox.
  const unread = await unreadCountForWorkspace(
    access.db,
    access.user.id,
    access.workspace.id,
  );

  return Response.json({ notifications, unread }, { headers });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = MarkAllBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const resolved = await authorizeInboxRequest(request, parsed.data.workspace);
  if ("response" in resolved) return resolved.response;
  const { access, headers } = resolved;

  // Scoped to the workspace named in the body — the same one standing was just
  // established in. Without it, clearing this inbox cleared every other
  // workspace's too, from a request that never mentioned them.
  const updated = await markAllReadInWorkspace(
    access.db,
    access.user.id,
    access.workspace.id,
  );
  return Response.json({ updated }, { headers });
}
