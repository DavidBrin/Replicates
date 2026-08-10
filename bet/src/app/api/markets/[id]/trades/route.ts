/**
 * `POST /api/markets/[id]/trades` — executes a trade. All authorization,
 * validation, and the six-way write (balance, position, trade, market
 * state, price point, system message) plus notifications happen inside
 * `domain/services/trading.ts`'s `executeTrade`, in exactly one
 * `store.transact` (G3, the storage caveat in the Task 7 brief).
 */

import { z } from "zod";
import { brand } from "@/domain/entities";
import { fromDecimal } from "@/domain/money";
import { getActor, getContainer } from "@/lib/container";
import { handler, jsonOk, parseBody } from "@/lib/http";
import { executeTrade, type TradeOrderInput } from "@/domain/services/trading";

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
  const { store, clock, idGen } = await getContainer();

  const body = await parseBody(req, orderSchema);
  const order = toOrderInput(body);

  const result = await executeTrade({ store, clock, idGen }, { actor, marketId, order });

  return jsonOk(result);
});
