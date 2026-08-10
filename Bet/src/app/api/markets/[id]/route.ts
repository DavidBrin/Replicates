/**
 * `GET /api/markets/[id]` — market + current prices + the caller's own
 * position(s) + a holders list (SPEC §3.3's positions/holders tabs).
 * Non-members get 404 (D6 — market is existence-sensitive).
 *
 * ## Who may see what in `holders[]` (final-review fix)
 *
 * Reading a market and reading the *positions* inside it are two different
 * permissions, and this route used to conflate them. `can(actor,"read",
 * {type:"market"},…)` deliberately admits a **pending invitee** — you must
 * be able to see a bet you were invited to in order to decide whether to
 * join it (research §7.2). It does not follow that you may see who else is
 * in it. `authz.ts`'s position policy says exactly that
 * (`isFellowParticipant && stakesVisible`), but nothing called it: this
 * route hand-rolled `market.stakesVisible || p.userId === actorId` instead
 * (a G5 violation — "no route hand-rolls its own membership if"), so the
 * policy branch was dead code and an un-accepted invitee could read a
 * private group's whole roster *and* every member's exact stake.
 *
 * Two gates now, both derived from `computeMarketFacts` and both expressed
 * through the policy layer:
 *
 * 1. **Row visibility** — only a fellow participant (creator, group member,
 *    position holder, or accepted invitee) sees the holders list at all. A
 *    pending invitee gets `[]`: they can see the question and the prices,
 *    not who is in the room.
 * 2. **Stake visibility** — each row's exact `stake` is gated per-row by
 *    `can(actor,"read",{type:"position"},…)`: your own row always, anyone
 *    else's only when `market.stakesVisible` is on. Side and share count
 *    stay visible to every participant, per SPEC §3.3.
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
  /** Present only when `can(actor,"read",{type:"position"},…)` allows it:
   * this row belongs to the requesting actor, or `market.stakesVisible` is
   * on and the actor is a fellow participant. */
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

  // "Fellow participant" in `PositionAuthzFacts`' sense: the creator, or
  // anyone `computeMarketFacts` counts as a participant (group member,
  // current/former position holder, accepted invitee). Deliberately NOT
  // `hasPendingInvite` — that fact opens the *market*, never the roster.
  const isFellowParticipant =
    actorId !== null && (facts.creatorId === actorId || facts.isParticipant);

  const holderPositions = isFellowParticipant ? positions.filter((p) => p.shares > 0) : [];
  const uniqueUserIds = [...new Set(holderPositions.map((p) => p.userId))];
  const userById = new Map<UserId, { handle: string; displayName: string; avatarColor: string }>();
  for (const uid of uniqueUserIds) {
    const u = await store.users.findById(uid);
    if (u) userById.set(uid, { handle: u.handle, displayName: u.displayName, avatarColor: u.avatarColor });
  }

  const holders: HolderView[] = holderPositions.map((p) => {
    const u = userById.get(p.userId);
    const revealStake = can(
      actor,
      "read",
      { type: "position", id: p.id },
      {
        position: {
          holderId: p.userId,
          isFellowParticipant,
          stakesVisible: market.stakesVisible,
          marketStatus: market.status,
        },
      },
    );
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
