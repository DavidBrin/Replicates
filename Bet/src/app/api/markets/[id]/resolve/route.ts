/**
 * `POST /api/markets/[id]/resolve { action, outcomeId? }` — propose |
 * dispute | vote | finalize (SPEC §6.4). The base visibility gate (`can()`
 * against the market resource) happens here so an anonymous/non-member
 * caller gets 404 before ever reaching `resolveMarket`; the finer
 * per-action role checks (creator-only propose, participant-only
 * dispute/vote) live in `domain/services/resolution.ts` itself.
 */

import { z } from "zod";
import { brand } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getActor, getContainer } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, parseBody, throwApp } from "@/lib/http";
import { computeMarketFacts } from "@/domain/services/market-access";
import { resolveMarket, type ResolutionInput } from "@/domain/services/resolution";

const resolveSchema = z
  .object({
    action: z.enum(["propose", "dispute", "vote", "finalize"]),
    outcomeId: z.string().min(1).optional(),
  })
  .refine((v) => (v.action === "propose" || v.action === "vote" ? v.outcomeId !== undefined : true), {
    message: "outcomeId is required for propose and vote.",
    path: ["outcomeId"],
  });

function toResolutionInput(body: z.infer<typeof resolveSchema>): ResolutionInput {
  switch (body.action) {
    case "propose":
      return { action: "propose", outcomeId: brand(body.outcomeId!) };
    case "vote":
      return { action: "vote", outcomeId: brand(body.outcomeId!) };
    case "dispute":
      return { action: "dispute" };
    case "finalize":
      return { action: "finalize" };
  }
}

export const POST = handler<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const marketId = brand<"MarketId">(id);
  const actor = await getActor(req);
  const { store, clock, idGen } = await getContainer();

  const market = await store.markets.findById(marketId);
  if (!market) throwApp({ code: "not_found", message: "Market not found." });
  const facts = await computeMarketFacts(store, market, actor);
  authorizeOr404(can(actor, "read", { type: "market", id: marketId }, { market: facts }));

  const body = await parseBody(req, resolveSchema);
  const input = toResolutionInput(body);

  const updated = await resolveMarket({ store, clock, idGen }, { actor, marketId, input });

  return jsonOk({ market: updated });
});
