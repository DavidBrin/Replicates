/**
 * `POST /api/markets/[id]/quote` — prices a hypothetical order against the
 * market's CURRENT committed state (G3: display-only, never authoritative
 * for `POST /trades`, which re-derives its own quote from scratch).
 */

import { z } from "zod";
import { brand } from "@/domain/entities";
import { can } from "@/domain/authz";
import { fromDecimal } from "@/domain/money";
import { getActor, getContainer } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, parseBody, throwApp } from "@/lib/http";
import { computeMarketFacts } from "@/domain/services/market-access";
import { priceOrder, type TradeOrderInput } from "@/domain/services/trading";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";

const orderSchema = z
  .object({
    outcomeId: z.string().min(1),
    side: z.enum(["buy", "sell"]),
    shares: z.number().positive().finite().optional(),
    budget: z.number().positive().finite().optional(),
    maxCost: z.number().positive().finite().optional(),
  })
  .refine((v) => (v.shares !== undefined) !== (v.budget !== undefined), {
    message: "Specify exactly one of shares or budget.",
    path: ["shares"],
  });

function toOrderInput(body: z.infer<typeof orderSchema>): TradeOrderInput {
  return {
    outcomeId: brand(body.outcomeId),
    side: body.side,
    shares: body.shares,
    budget: body.budget !== undefined ? fromDecimal(body.budget) : undefined,
    maxCost: body.maxCost !== undefined ? fromDecimal(body.maxCost) : undefined,
  };
}

export const POST = handler<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const marketId = brand<"MarketId">(id);
  const actor = await getActor(req);
  const { store } = await getContainer();

  const market = await store.markets.findById(marketId);
  if (!market) throwApp({ code: "not_found", message: "Market not found." });
  const facts = await computeMarketFacts(store, market, actor);
  authorizeOr404(can(actor, "read", { type: "market", id: marketId }, { market: facts }));

  const body = await parseBody(req, orderSchema);
  const order = toOrderInput(body);

  const quote = priceOrder(market, order);
  const engine = getEngine(market.pricing.kind);
  const prices = engine.currentPrices(toMarketState(market.pricing, market.status));

  return jsonOk({ quote, prices });
});
