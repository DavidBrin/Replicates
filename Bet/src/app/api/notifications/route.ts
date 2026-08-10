/**
 * `GET|POST /api/notifications` — SPEC §8 lists this route, but (per the
 * Task 6 report's "Concurrent-work note") it was never assigned to a task's
 * file list. Task 12 claims it: the Activity page (`/app/activity`) and the
 * app shell's notification bell (`(app)/layout.tsx`, which already reads
 * `store.notifications.listByUser` directly for its unread badge) are this
 * route's only consumers.
 *
 * Follows `src/app/api/me/route.ts` / `markets/[id]/messages/route.ts`'s
 * conventions exactly: `handler()` + `jsonOk`/`jsonErr` from `lib/http.ts`,
 * `requireUser` from `lib/container.ts`, Zod-parsed query params, `can()`
 * before every read.
 */

import { z } from "zod";
import { brand, type UserId } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getContainer, requireUser } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, parseBody, throwApp } from "@/lib/http";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Mirrors `lib/http.ts`'s private `fieldsFromZodError` (dotted path ->
 * first message per field) for query-string validation — see
 * `markets/[id]/messages/route.ts`'s identical copy for why this isn't
 * shared out of a module this task doesn't own. */
function fieldsFromZodError(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * `src/domain/authz.ts` (a file this task doesn't own — extending its
 * `Resource` union is out of scope) has no dedicated `notification`
 * resource kind. `friendGraph`'s own doc comment already generalizes its
 * `ownerId` check beyond literal friend-graph reads to mean "is the caller
 * the one specific person whose authority this action requires" — exactly
 * notification self-ownership (a user may only ever read or mark-read
 * their OWN notifications, research §1.6's "never a third party" rule
 * applied one level beyond friend lists). Reused rather than hand-rolling a
 * second membership `if`, per G5.
 */
function ownsNotification(actorId: UserId, ownerId: UserId): boolean {
  return can(
    { userId: actorId },
    "read",
    { type: "friendGraph", ownerId },
    { friendGraph: { ownerId } },
  );
}

const listQuerySchema = z.object({
  unreadOnly: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().finite().positive().optional(),
});

/**
 * `GET /api/notifications?unreadOnly=&limit=` — always scoped to the
 * caller's own notifications; there is no `userId` query param and never
 * will be (D5). `unreadOnly=true` filters to unread only; `limit` is
 * Zod-parsed and capped at `MAX_LIMIT` (default `DEFAULT_LIMIT`), same
 * "coerce, don't `.int()`" treatment as the Room's `?limit=` so a
 * non-integer value floors instead of failing validation. Response also
 * carries `unreadCount` — computed over the FULL list (not the
 * limited/filtered page) so the app shell's bell badge and this page's own
 * header can both use it without a second request.
 */
export const GET = handler(async (req) => {
  const user = await requireUser(req);
  authorizeOr404(ownsNotification(user.id, user.id));

  const url = new URL(req.url);
  const parsedQuery = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsedQuery.success) {
    throwApp({
      code: "validation",
      message: "Invalid query parameters.",
      fields: fieldsFromZodError(parsedQuery.error),
    });
  }

  const limit =
    parsedQuery.data.limit !== undefined
      ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsedQuery.data.limit)))
      : DEFAULT_LIMIT;
  const unreadOnly = parsedQuery.data.unreadOnly === "true";

  const { store } = await getContainer();
  const all = await store.notifications.listByUser(user.id);
  const unreadCount = all.filter((n) => n.readAt === undefined).length;
  const filtered = unreadOnly ? all.filter((n) => n.readAt === undefined) : all;

  return jsonOk({ notifications: filtered.slice(0, limit), unreadCount });
});

const postBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("markRead"), id: z.string().min(1) }),
  z.object({ action: z.literal("markAllRead") }),
]);

/**
 * `POST /api/notifications` — mark-read. `{action:"markRead", id}` marks
 * one notification read; `{action:"markAllRead"}` marks every one of the
 * caller's unread notifications read. `markRead` 404s — never 403 — for an
 * id that doesn't exist OR belongs to someone else, so a caller can't
 * distinguish "not yours" from "doesn't exist" (mirrors
 * `friends/requests/[id]`'s enumeration-resistant not_found). Every write
 * goes through `store.transact` (`container.ts`'s own reminder: "a bare
 * repo write can be lost against a concurrent transaction").
 */
export const POST = handler(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, postBodySchema);
  const { store } = await getContainer();

  if (body.action === "markAllRead") {
    await store.transact((tx) => tx.notifications.markAllRead(user.id));
    return jsonOk({ markedAll: true });
  }

  const notificationId = brand<"NotificationId">(body.id);
  const existing = await store.notifications.findById(notificationId);
  if (!existing || !ownsNotification(user.id, existing.userId)) {
    return throwApp({ code: "not_found", message: "Notification not found." });
  }

  const updated = await store.transact((tx) => tx.notifications.markRead(notificationId));
  return jsonOk({ notification: updated });
});
