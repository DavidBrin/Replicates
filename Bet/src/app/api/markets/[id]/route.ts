/**
 * `GET /api/markets/[id]` — market + current prices + the caller's own
 * position(s) + a holders list (SPEC §3.3's positions/holders tabs).
 * Non-members get 404 (D6 — market is existence-sensitive). Holders show
 * side and share count always; another user's exact stake only when
 * `market.stakesVisible` is true (or it's the caller's own row).
 */

import { brand, type OutcomeId, type UserId } from "@/domain/entities";
import { getActor, getContainer } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, throwApp } from "@/lib/http";
import { can } from "@/domain/authz";
import type { Credits } from "@/domain/money";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";
import { computeMarketFacts } from "@/domain/services/market-access";

export interface HolderView {
  userId: UserId;
  handle: string | null;
  displayName: string;
  avatarColor: string | null;
  outcomeId: OutcomeId;
  shares: number;
  /** Present only when `market.stakesVisible` is on, or this row belongs
   * to the requesting actor themself. */
  stake?: Credits;
}

export const GET = handler<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const marketId = brand<"MarketId">(id);
  const actor = await getActor(req);
  const { store } = await getContainer();

  const market = await store.markets.findById(marketId);
  if (!market) throwApp({ code: "not_found", message: "Market not found." });
  const facts = await computeMarketFacts(store, market, actor);
  authorizeOr404(can(actor, "read", { type: "market", id: marketId }, { market: facts }));

  const engine = getEngine(market.pricing.kind);
  const state = toMarketState(market.pricing, market.status);
  const prices = engine.currentPrices(state);

  const positions = await store.positions.listByMarket(marketId);
  const actorId = "userId" in actor ? actor.userId : null;
  const myPositions = actorId ? positions.filter((p) => p.userId === actorId) : [];

  const holderPositions = positions.filter((p) => p.shares > 0);
  const uniqueUserIds = [...new Set(holderPositions.map((p) => p.userId))];
  const userById = new Map<UserId, { handle: string; displayName: string; avatarColor: string }>();
  for (const uid of uniqueUserIds) {
    const u = await store.users.findById(uid);
    if (u) userById.set(uid, { handle: u.handle, displayName: u.displayName, avatarColor: u.avatarColor });
  }

  const holders: HolderView[] = holderPositions.map((p) => {
    const u = userById.get(p.userId);
    const revealStake = market.stakesVisible || p.userId === actorId;
    return {
      userId: p.userId,
      handle: u?.handle ?? null,
      displayName: u?.displayName ?? "Unknown trader",
      avatarColor: u?.avatarColor ?? null,
      outcomeId: p.outcomeId,
      shares: p.shares,
      stake: revealStake ? p.costBasis : undefined,
    };
  });

  return jsonOk({ market, prices, myPositions, holders });
});
