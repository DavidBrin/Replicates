/**
 * Shared helpers `trading.ts`, `resolution.ts`, and every `src/app/api/
 * markets/**` route build on: deriving `authz.ts`'s `MarketAuthzFacts` /
 * `RoomAuthzFacts` from storage, loading+authorizing a market in one step,
 * posting a system chat message, and converting a `PricingEngine`'s thrown
 * `PricingError` into this module's `fail()` shape.
 *
 * There is no dedicated `market_participants` repo (`ports/data-store.ts`
 * has none) — `computeMarketFacts` derives "is this actor a participant"
 * from the facts that DO exist: membership in the market's owning group
 * (every group member can see/trade every one of their group's markets —
 * SPEC §3.2's dashboard already assumes this), holding (or having ever
 * held — Room membership per SPEC §1's Room definition, "everyone holding
 * or who has held a position") a `Position` row in the market, OR having
 * an **accepted** `Invite` targeting this market (Task 6's social API has
 * no `MarketParticipant` entity either — accepting a market invite only
 * flips that invite row's `status` to `"accepted"`, so an invitee who
 * accepted but never traded and isn't in the market's group would
 * otherwise 404 on a market they were legitimately let into).
 */

import type { Actor, MarketAuthzFacts, RoomAuthzFacts } from "@/domain/authz";
import { can } from "@/domain/authz";
import type { Market, MarketId, Outcome, OutcomeId } from "@/domain/entities";
import { brand } from "@/domain/entities";
import type { DataStore } from "@/ports/data-store";
import type { IdGen } from "@/ports/id";
import { PricingError } from "@/domain/pricing/engine";
import { fail } from "./errors";

const ACTIVE_INVITE_STATUSES = new Set(["created", "sent", "viewed"]);

function actorUserId(actor: Actor): string | null {
  return "userId" in actor ? actor.userId : null;
}

export async function computeMarketFacts(
  store: DataStore,
  market: Market,
  actor: Actor,
): Promise<MarketAuthzFacts> {
  const actorId = actorUserId(actor);
  let isParticipant = false;
  let hasPendingInvite = false;

  if (actorId) {
    if (market.groupId) {
      const group = await store.groups.findById(market.groupId);
      if (group?.memberIds.some((m) => m === actorId)) isParticipant = true;
    }
    if (!isParticipant) {
      const positions = await store.positions.listByMarket(market.id);
      isParticipant = positions.some((p) => p.userId === actorId);
    }
    const invites = await store.invites.listByInvitee(brand(actorId));
    const marketInvites = invites.filter(
      (inv) => inv.targetType === "market" && inv.targetId === market.id,
    );
    if (!isParticipant) {
      isParticipant = marketInvites.some((inv) => inv.status === "accepted");
    }
    hasPendingInvite = marketInvites.some((inv) => ACTIVE_INVITE_STATUSES.has(inv.status));
  }

  return {
    creatorId: market.creatorId,
    status: market.status,
    isParticipant,
    hasPendingInvite,
  };
}

/** Room membership (SPEC §1's Room definition) — creator or participant.
 * Deliberately excludes a bare pending invite: you can *see* the market
 * you were invited to (so you can decide whether to join), but you're not
 * "in the room" — and can't post — until you actually hold or have held a
 * position, or you're the creator. */
export async function computeRoomFacts(
  store: DataStore,
  market: Market,
  actor: Actor,
): Promise<RoomAuthzFacts> {
  const facts = await computeMarketFacts(store, market, actor);
  const actorId = actorUserId(actor);
  const isMember = actorId !== null && (facts.creatorId === actorId || facts.isParticipant);
  return { isMember };
}

/** Loads a market and authorizes `actor` for a `"read"` (visibility) check
 * against it, throwing `not_found` (never `forbidden` — market is an
 * existence-sensitive resource, D6) for both "doesn't exist" and "exists
 * but you can't see it." Every markets route/service starts here. */
export async function loadMarketForActor(
  store: DataStore,
  marketId: MarketId,
  actor: Actor,
): Promise<Market> {
  const market = await store.markets.findById(marketId);
  if (!market) fail("not_found", "Market not found.");
  const facts = await computeMarketFacts(store, market, actor);
  const allowed = can(actor, "read", { type: "market", id: marketId }, { market: facts });
  if (!allowed) fail("not_found", "Market not found.");
  return market;
}

export function findOutcome(market: Market, outcomeId: string): Outcome {
  const outcome = market.outcomes.find((o) => o.id === outcomeId);
  if (!outcome) fail("validation", `Unknown outcome "${outcomeId}" for this market.`);
  return outcome;
}

export function assertOutcomeExists(market: Market, outcomeId: string): void {
  findOutcome(market, outcomeId);
}

export async function postSystemMessage(
  tx: DataStore,
  idGen: IdGen,
  marketId: MarketId,
  at: Date,
  body: string,
): Promise<void> {
  await tx.messages.insert({
    id: brand(idGen.next("msg")),
    roomId: marketId,
    authorId: null,
    kind: "system",
    body,
    at,
  });
}

/** Runs `op`, converting a thrown `PricingError` (which — like
 * `MarketNotTradableError` — is a real `Error` instance whose `message` is
 * a non-enumerable inherited property, so it would silently vanish if
 * JSON-serialized directly by `src/lib/http.ts`'s `jsonErr`) into this
 * module's plain-object `fail()` shape, preserving both `code` and
 * `message`. Every call into a `PricingEngine`'s `quote`/`execute` goes
 * through this. */
export function runEngine<T>(op: () => T): T {
  try {
    return op();
  } catch (err) {
    if (err instanceof PricingError) {
      fail(err.code, err.message);
    }
    throw err;
  }
}

export type { OutcomeId };
