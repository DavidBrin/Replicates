/**
 * `GET /api/markets/[id]/history` — the market's price-point series (SPEC
 * §5.3's `ProbabilityChart`). Optional `?since=` ISO date filters to points
 * at/after that instant.
 */

import { brand } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getActor, getContainer } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, throwApp } from "@/lib/http";
import { computeMarketFacts } from "@/domain/services/market-access";

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
  const sinceRaw = url.searchParams.get("since");
  let since: Date | undefined;
  if (sinceRaw) {
    since = new Date(sinceRaw);
    if (Number.isNaN(since.getTime())) {
      throwApp({ code: "validation", message: "since must be a valid date.", fields: { since: "invalid date" } });
    }
  }

  const points = await store.priceHistory.listByMarket(marketId, since ? { since } : undefined);
  return jsonOk({ points });
});
