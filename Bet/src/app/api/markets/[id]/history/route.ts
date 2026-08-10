/**
 * `GET /api/markets/[id]/history` — the market's price-point series (SPEC
 * §5.3's `ProbabilityChart`). Optional `?since=` ISO date filters to points
 * at/after that instant.
 */

import { z } from "zod";
import { brand } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getActor, getContainer } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, throwApp } from "@/lib/http";
import { computeMarketFacts } from "@/domain/services/market-access";

/** Mirrors `lib/http.ts`'s private `fieldsFromZodError` (dotted path ->
 * first message per field) for query-string validation, which — unlike
 * `parseBody` — has nowhere else to share that mapping from without
 * exporting a new symbol out of a module this task doesn't own. */
function fieldsFromZodError(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

const historyQuerySchema = z.object({
  since: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: "custom", message: "since must be a valid date." });
        return z.NEVER;
      }
      return date;
    }),
});

export const GET = handler<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const marketId = brand<"MarketId">(id);
  const actor = await getActor(req);
  const { store } = await getContainer();

  const market = await store.markets.findById(marketId);
  if (!market) throwApp({ code: "not_found", message: "Market not found." });
  const facts = await computeMarketFacts(store, market, actor);
  authorizeOr404(can(actor, "read", { type: "market", id: marketId }, { market: facts }));

  const url = new URL(req.url);
  const parsedQuery = historyQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsedQuery.success) {
    throwApp({
      code: "validation",
      message: "Invalid query parameters.",
      fields: fieldsFromZodError(parsedQuery.error),
    });
  }
  const { since } = parsedQuery.data;

  const points = await store.priceHistory.listByMarket(marketId, since ? { since } : undefined);
  return jsonOk({ points });
});
