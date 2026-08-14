/**
 * `PATCH /api/notifications/{id}` — read, unread, snooze, unsnooze.
 * `DELETE /api/notifications/{id}` — dismiss one.
 *
 * ## Why the id alone is never enough
 *
 * Every repository call below takes `userId` as well as the notification id,
 * and the `where` clause carries both. An id lifted from someone else's
 * response therefore updates zero rows and reports as missing, rather than
 * silently succeeding against a stranger's inbox
 * (`adapters/repositories/notifications.ts`). The route adds the workspace on
 * top, so a notification cannot be addressed from a workspace the actor has no
 * standing in even if it is genuinely theirs.
 *
 * ## Snooze is a timestamp
 *
 * `snoozeUntil: null` unsnoozes and `snoozeUntil: <iso>` hides the row until
 * that instant passes. There is no unsnooze job and nothing on a schedule — the
 * notification comes back because the comparison in the `where` clause changed
 * its mind, which is the only design that survives a host with no background
 * workers.
 */

import { z } from "zod";

import { getRepositories } from "@/adapters/repositories";
import {
  authorizeInboxRequest,
  loadOneNotification,
} from "@/components/inbox/data";

import { unreadCountForWorkspace } from "../scope";

const PatchBody = z
  .object({
    workspace: z.string().min(1).max(64),
    read: z.boolean().optional(),
    /** ISO instant, or null to unsnooze. */
    snoozeUntil: z.iso.datetime().nullable().optional(),
  })
  .refine(
    (body) => body.read !== undefined || body.snoozeUntil !== undefined,
    // A PATCH that changes nothing is a client bug, and answering 200 to it
    // hides the bug behind a green request.
    { message: "Nothing to change." },
  );

const DeleteBody = z.object({ workspace: z.string().min(1).max(64) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = PatchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const resolved = await authorizeInboxRequest(request, parsed.data.workspace);
  if ("response" in resolved) return resolved.response;
  const { access, headers } = resolved;

  const { id } = await context.params;
  const notifications = getRepositories().notifications;

  // Read before write. The row must be one this actor may see *now* — not
  // merely one addressed to them — or a user removed from a team could still
  // mark its notifications read and learn from the response that they exist.
  const before = await loadOneNotification(
    access.db,
    access.actor,
    access.user,
    access.workspace.id,
    id,
  );
  if (before === null) {
    return Response.json({ error: "Not found." }, { status: 404, headers });
  }

  if (parsed.data.read !== undefined) {
    if (parsed.data.read) await notifications.markRead([id], access.user.id);
    else await notifications.markUnread([id], access.user.id);
  }

  if (parsed.data.snoozeUntil !== undefined) {
    await notifications.snooze(id, parsed.data.snoozeUntil, access.user.id);
  }

  const after = await loadOneNotification(
    access.db,
    access.actor,
    access.user,
    access.workspace.id,
    id,
  );
  // The same workspace-scoped count the collection returns, so the badge does
  // not change meaning depending on which request last refreshed it.
  const unread = await unreadCountForWorkspace(
    access.db,
    access.user.id,
    access.workspace.id,
  );
  return Response.json({ notification: after, unread }, { headers });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = DeleteBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const resolved = await authorizeInboxRequest(request, parsed.data.workspace);
  if ("response" in resolved) return resolved.response;
  const { access, headers } = resolved;

  const { id } = await context.params;
  const before = await loadOneNotification(
    access.db,
    access.actor,
    access.user,
    access.workspace.id,
    id,
  );
  if (before === null) {
    return Response.json({ error: "Not found." }, { status: 404, headers });
  }

  await getRepositories().notifications.delete(id, access.user.id);
  const unread = await unreadCountForWorkspace(
    access.db,
    access.user.id,
    access.workspace.id,
  );
  return Response.json({ deleted: id, unread }, { headers });
}
