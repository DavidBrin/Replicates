/**
 * `GET|POST /api/markets/[id]/messages` — the Room (SPEC §5.4). `GET` is
 * keyset-paginated via `?before=`, `limit` capped at 50. `POST` is
 * idempotent on `clientId`: posting the same `clientId` twice returns the
 * original message rather than creating a duplicate — enforced by
 * `MemoryMessageRepo.insert` itself (`src/adapters/memory/message-repo.ts`),
 * so this route just passes `clientId` through unconditionally.
 */

import { z } from "zod";
import { brand } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getActor, getContainer } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, parseBody, throwApp } from "@/lib/http";
import { computeRoomFacts } from "@/domain/services/market-access";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

const postMessageSchema = z.object({
  clientId: z.string().min(1).max(100),
  body: z.string().trim().min(1).max(2000),
});

function encodeCursor(at: Date, id: string): string {
  return `${at.toISOString()}|${id}`;
}

function decodeCursor(raw: string): { at: Date; id: string } | undefined {
  const sep = raw.indexOf("|");
  if (sep === -1) return undefined;
  const atStr = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  const at = new Date(atStr);
  if (Number.isNaN(at.getTime()) || !id) return undefined;
  return { at, id };
}

/** Mirrors `lib/http.ts`'s private `fieldsFromZodError` (dotted path ->
 * first message per field) for query-string validation — see
 * `history/route.ts`'s identical copy for why this isn't shared out of a
 * module this task doesn't own. */
function fieldsFromZodError(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * `?limit=` — accepted as any finite positive number (floored, then capped
 * at `MAX_LIMIT`) to preserve the exact prior hand-rolled behavior; `.int()`
 * is deliberately NOT enforced here so `limit=3.7` still floors to 3
 * instead of being rejected. `?before=` — an empty string is treated as
 * "absent" (matching the prior `if (beforeRaw)` truthy check); a non-empty
 * value must decode via `decodeCursor` or the whole query is `validation`.
 */
const listQuerySchema = z.object({
  limit: z.coerce.number().finite().positive().optional(),
  before: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      const decoded = decodeCursor(raw);
      if (!decoded) {
        ctx.addIssue({ code: "custom", message: "Invalid before cursor." });
        return z.NEVER;
      }
      return decoded;
    }),
});

async function loadRoom(req: Request, id: string) {
  const marketId = brand<"MarketId">(id);
  const actor = await getActor(req);
  const { store, idGen, clock } = await getContainer();
  const market = await store.markets.findById(marketId);
  if (!market) throwApp({ code: "not_found", message: "Market not found." });
  return { marketId, actor, store, idGen, clock, market };
}

export const GET = handler<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { marketId, actor, store, market } = await loadRoom(req, id);

  const roomFacts = await computeRoomFacts(store, market, actor);
  authorizeOr404(can(actor, "read", { type: "room", id: marketId }, { room: roomFacts }));

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
      ? Math.min(MAX_LIMIT, Math.floor(parsedQuery.data.limit))
      : DEFAULT_LIMIT;
  const before = parsedQuery.data.before;

  const messages = await store.messages.listMessages(marketId, { before, limit });
  const last = messages[messages.length - 1];
  const nextCursor = messages.length === limit && last ? encodeCursor(last.at, last.id) : null;

  return jsonOk({ messages, nextCursor });
});

export const POST = handler<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { marketId, actor, store, idGen, clock, market } = await loadRoom(req, id);

  const roomFacts = await computeRoomFacts(store, market, actor);
  authorizeOr404(can(actor, "write", { type: "room", id: marketId }, { room: roomFacts }));
  if (!("userId" in actor)) throwApp({ code: "forbidden", message: "Sign in required." });

  const body = await parseBody(req, postMessageSchema);

  const message = await store.messages.insert({
    id: brand(idGen.next("msg")),
    roomId: marketId,
    authorId: actor.userId,
    kind: "text",
    body: body.body,
    clientId: body.clientId,
    at: clock.now(),
  });

  return jsonOk({ message }, { status: 201 });
});
