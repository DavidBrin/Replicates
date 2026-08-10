/**
 * The full deterministic demo dataset (docs/plan.md Task 5), replacing
 * Task 4's minimal placeholder wholesale. Keeps the exported
 * `seedDataStore(store, clock, idGen)` signature so `src/lib/container.ts`
 * needed no changes.
 *
 * ## Determinism
 *
 * `clock.now()` is read exactly ONCE, right at the top, into a local
 * `now` — every other timestamp in the entire dataset is `now` plus/minus a
 * fixed offset computed from a literal in `seed-data/**`. There is no other
 * ambient-time read anywhere in this module or in `seed-data/**` (no bare
 * `new Date()`, no second `clock.now()` call), and no `Math.random()` —
 * the only randomness is `seed-data/prng.ts`'s seeded `mulberry32`,
 * consumed in a fixed order for the Explore markets' random walk and
 * synthetic volume. Given the same `now` and the same (fresh, in the sense
 * of "starts its numbering from the same place") `IdGen`, two calls to
 * `seedDataStore` against two empty stores produce deep-equal data —
 * that's `__tests__/seed.test.ts`'s determinism test.
 *
 * Almost everything here is deliberately literal, hand-authored data in
 * `seed-data/private-markets.ts` (trades AND chat, scripted together so a
 * chat line can genuinely react to the trade beside it) rather than
 * procedurally generated — see that file's doc comment for why. The one
 * place generation is unavoidable (and explicitly asked for) is Explore's
 * 90-day-per-market random walk; see `seed-data/random-walk.ts` and
 * `seed-data/explore-markets.ts`.
 *
 * ## What "seeded trades go through the pricing engines" means here
 *
 * Every PRIVATE-market trade below is executed via `getEngine(kind)
 * .execute(...)` against the market's real, evolving `MarketState` —
 * never a hand-written price. The resulting `Quote` drives every one of:
 * the appended `Trade`, the upserted `Position` (recomputed average cost
 * basis), the trader's debited `User.balance`, the appended `PricePoint`,
 * and a system chat `Message` (D11) — all inside the outer `transact`, so
 * a fresh store either has the whole dataset or none of it.
 *
 * Explore markets are a deliberate exception, and are NOT run through the
 * engines as live trades: they're a read-only public showcase with no real
 * position-holders (SPEC §3.6, "No trading on Explore"), so there is no
 * per-user ledger for `execute()` to update against. Their price history
 * comes from the random walk directly (still the sole source of truth for
 * their prices — nothing overwrites it), and their `PricingConfig` is
 * reverse-engineered from the walk's final day so `currentPrices()` still
 * reports exactly that price through the same engine machinery every other
 * market uses. Their "$X volume" figure is backed by real `Trade` rows too,
 * but attributed to synthetic "ghost" trader ids that are never inserted as
 * `User` rows — deliberately, so a public market's huge ($100K–$50M)
 * synthetic volume can never be mistaken for money moved by one of the 12
 * real demo users (whose balances the DoD's conservation test checks).
 */

import {
  brand,
  type Group,
  type GroupId,
  type Market,
  type MarketId,
  type Outcome,
  type OutcomeId,
  type PricingConfig,
  type Resolution,
  type User,
  type UserId,
} from "@/domain/entities";
import type { Clock } from "@/ports/clock";
import type { IdGen } from "@/ports/id";
import type { DataStore } from "@/ports/data-store";
import { add, credits, fromDecimal, sub, toDecimal, zero, type Credits } from "@/domain/money";
import { formatPriceCents } from "@/domain/formatters";
import { getEngine } from "@/domain/pricing/registry";
import { fromMarketState, toMarketState } from "@/domain/pricing-config";
import { defaultB } from "@/domain/pricing/lmsr";
import { takerFee } from "@/domain/pricing/fees";
import type { Order } from "@/domain/pricing/types";

import { DEFAULT_USER_HANDLE, USER_SEEDS } from "./seed-data/users";
import { GROUP_SEEDS } from "./seed-data/groups";
import { FRIENDSHIP_PAIRS, PENDING_FRIEND_REQUESTS, PENDING_MARKET_INVITES } from "./seed-data/social";
import { PRIVATE_MARKET_SEEDS, type PrivateMarketSeed } from "./seed-data/private-markets";
import { categoryIdPrefix, EXPLORE_MARKET_SEEDS, type ExploreMarketSeed } from "./seed-data/explore-markets";
import { generateRandomWalk, reverseLmsrQ } from "./seed-data/random-walk";
import { logUniform, mulberry32, pick, randInt, splitByRandomWeights, type Prng } from "./seed-data/prng";

const DAY_MS = 86_400_000;
const EXPLORE_HISTORY_DAYS = 90;
const GHOST_TRADER_COUNT = 40;
/** Any fixed integer works — this one is just today's date, for flavor. */
const EXPLORE_PRNG_SEED = 20_260_809;

function daysFromNow(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** Idempotent + deterministic entry point. `container.ts` calls this
 * exactly once per fresh store (memoized on `globalThis`); this function
 * additionally guards itself so a second call against an already-seeded
 * store is a safe no-op rather than a duplicate-id crash. */
export async function seedDataStore(store: DataStore, clock: Clock, idGen: IdGen): Promise<void> {
  const alreadySeeded = await store.users.findByHandle(DEFAULT_USER_HANDLE);
  if (alreadySeeded) return;

  const now = clock.now(); // the ONE ambient-time read in the whole seed — see module doc comment

  await store.transact(async (tx) => {
    const userIdByHandle = new Map<string, UserId>();
    const userByHandle = new Map<string, User>();
    for (const seed of USER_SEEDS) {
      const user: User = {
        id: brand(idGen.next("usr")),
        handle: seed.handle,
        displayName: seed.displayName,
        avatarColor: seed.avatarColor,
        avatarInitials: seed.avatarInitials,
        balance: credits(100_000), // 1,000 credits
        createdAt: now,
      };
      await tx.users.insert(user);
      userIdByHandle.set(seed.handle, user.id);
      userByHandle.set(seed.handle, user);
    }

    const groupIdBySlug = new Map<string, GroupId>();
    for (const g of GROUP_SEEDS) {
      const group: Group = {
        id: brand(idGen.next("grp")),
        slug: g.slug,
        name: g.name,
        emoji: g.emoji,
        memberIds: g.memberHandles.map((h) => userIdByHandle.get(h)!),
        ownerId: userIdByHandle.get(g.ownerHandle)!,
        createdAt: now,
      };
      await tx.groups.insert(group);
      groupIdBySlug.set(g.slug, group.id);
    }

    for (const [a, b] of FRIENDSHIP_PAIRS) {
      await tx.friends.insertFriendship({
        userAId: userIdByHandle.get(a)!,
        userBId: userIdByHandle.get(b)!,
        createdAt: now,
      });
    }
    for (const req of PENDING_FRIEND_REQUESTS) {
      await tx.friends.createRequest({
        id: brand(idGen.next("freq")),
        fromId: userIdByHandle.get(req.fromHandle)!,
        toId: userIdByHandle.get(req.toHandle)!,
        status: "pending",
        createdAt: now,
      });
    }

    const marketIdByKey = new Map<string, MarketId>();
    for (const def of PRIVATE_MARKET_SEEDS) {
      const marketId = await seedPrivateMarket(tx, now, idGen, def, userIdByHandle, userByHandle, groupIdBySlug);
      marketIdByKey.set(def.key, marketId);
    }

    for (const invite of PENDING_MARKET_INVITES) {
      await tx.invites.insert({
        id: brand(idGen.next("inv")),
        kind: "direct",
        targetType: "market",
        targetId: marketIdByKey.get(invite.marketKey)!,
        inviterId: userIdByHandle.get(invite.inviterHandle)!,
        inviteeId: userIdByHandle.get(invite.inviteeHandle)!,
        status: "sent",
        expiresAt: daysFromNow(now, 7),
        createdAt: now,
      });
    }

    const rng = mulberry32(EXPLORE_PRNG_SEED);
    const devId = userIdByHandle.get(DEFAULT_USER_HANDLE)!;
    for (const def of EXPLORE_MARKET_SEEDS) {
      await seedExploreMarket(tx, now, idGen, rng, def, devId);
    }

    for (const req of PENDING_FRIEND_REQUESTS) {
      await tx.notifications.insert({
        id: brand(idGen.next("ntf")),
        userId: userIdByHandle.get(req.toHandle)!,
        type: "friend_request_received",
        payload: { fromHandle: req.fromHandle },
        createdAt: now,
      });
    }
    for (const invite of PENDING_MARKET_INVITES) {
      await tx.notifications.insert({
        id: brand(idGen.next("ntf")),
        userId: userIdByHandle.get(invite.inviteeHandle)!,
        type: "bet_invite_received",
        payload: { marketId: marketIdByKey.get(invite.marketKey)!, inviterHandle: invite.inviterHandle },
        createdAt: now,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Private markets: real trades through the real pricing engines
// ---------------------------------------------------------------------------

function buildInitialPricing(
  def: PrivateMarketSeed,
  outcomeIdByKey: Map<string, OutcomeId>,
): PricingConfig {
  const outcomeIds = def.outcomes.map((o) => outcomeIdByKey.get(o.key)!);
  switch (def.pricingKind) {
    case "lmsr": {
      const b = defaultB(def.expectedParticipants ?? outcomeIds.length * 2);
      const q: Record<OutcomeId, number> = {};
      outcomeIds.forEach((id) => {
        q[id] = 0;
      });
      return { kind: "lmsr", b, feeBps: def.feeBps, q };
    }
    case "fixedOdds": {
      const raw = def.fixedOpeningPrices!;
      const total = def.outcomes.reduce((sum, o) => sum + raw[o.key]!, 0);
      const openingPrices: Record<OutcomeId, number> = {};
      const escrow: Record<OutcomeId, Credits> = {};
      def.outcomes.forEach((o) => {
        const id = outcomeIdByKey.get(o.key)!;
        openingPrices[id] = raw[o.key]! / total;
        escrow[id] = zero();
      });
      return { kind: "fixedOdds", feeBps: def.feeBps, openingPrices, escrow };
    }
    case "parimutuel": {
      const pools: Record<OutcomeId, Credits> = {};
      outcomeIds.forEach((id) => {
        pools[id] = zero();
      });
      // Friend markets rake nothing from each other (D3's "fee-free by
      // default" spirit) — the standalone `feeBps` toggle (not this) is
      // what SL-10K uses to show the fee UI.
      return { kind: "parimutuel", feeBps: def.feeBps, rakeBps: 0, pools };
    }
  }
}

async function seedPrivateMarket(
  tx: DataStore,
  now: Date,
  idGen: IdGen,
  def: PrivateMarketSeed,
  userIdByHandle: Map<string, UserId>,
  userByHandle: Map<string, User>,
  groupIdBySlug: Map<string, GroupId>,
): Promise<MarketId> {
  const marketId: MarketId = brand(idGen.next("mkt"));
  const outcomeIdByKey = new Map<string, OutcomeId>();
  const outcomes: Outcome[] = def.outcomes.map((o) => {
    const id: OutcomeId = brand(idGen.next("out"));
    outcomeIdByKey.set(o.key, id);
    return { id, marketId, label: o.label, color: o.color };
  });

  let pricing: PricingConfig = buildInitialPricing(def, outcomeIdByKey);
  const engine = getEngine(def.pricingKind);

  // Execute chronologically ascending (largest `dayOffset` — furthest in
  // the past — first): the engines are stateful, so trades must be
  // replayed in the order they "happened."
  const orderedTrades = [...def.trades].sort((a, b) => b.dayOffset - a.dayOffset);

  for (const t of orderedTrades) {
    const state = toMarketState(pricing, "open"); // simulated as open regardless of the market's eventual final status
    // `Order.outcomeId` (pricing/types.ts) is a plain `string`; entity
    // fields want the branded `OutcomeId` (entities.ts) — keep the branded
    // form in its own variable rather than reading it back off `order`.
    const outcomeId: OutcomeId = outcomeIdByKey.get(t.outcomeKey)!;
    const order: Order = {
      outcomeId,
      side: "buy",
      budget: fromDecimal(t.budget),
    };
    const { newState, quote } = engine.execute(state, order);
    pricing = fromMarketState(newState, def.feeBps);

    const fee = def.feeBps > 0 ? takerFee(quote.shares, quote.avgPrice) : zero();
    const userId = userIdByHandle.get(t.handle)!;
    const currentUser = (await tx.users.findById(userId))!;
    await tx.users.update(userId, { balance: sub(currentUser.balance, add(quote.cost, fee)) });

    const at = new Date(now.getTime() - t.dayOffset * DAY_MS);
    await tx.trades.insert({
      id: brand(idGen.next("trd")),
      marketId,
      outcomeId,
      userId,
      side: "buy",
      shares: quote.shares,
      cost: quote.cost,
      avgPrice: quote.avgPrice,
      fee,
      at,
    });

    const existingPos = await tx.positions.find(marketId, outcomeId, userId);
    if (existingPos) {
      await tx.positions.update(existingPos.id, {
        shares: existingPos.shares + quote.shares,
        costBasis: add(existingPos.costBasis, quote.cost),
      });
    } else {
      await tx.positions.insert({
        id: brand(idGen.next("pos")),
        marketId,
        outcomeId,
        userId,
        shares: quote.shares,
        costBasis: quote.cost,
      });
    }

    await tx.priceHistory.append({ marketId, at, prices: engine.currentPrices(newState) });

    const outcomeLabel = def.outcomes.find((o) => o.key === t.outcomeKey)!.label;
    const displayName = userByHandle.get(t.handle)!.displayName;
    await tx.messages.insert({
      id: brand(idGen.next("msg")),
      roomId: marketId,
      authorId: null,
      kind: "system",
      body: `${displayName} bought ${Math.max(1, Math.round(quote.shares))} ${outcomeLabel} @ ${formatPriceCents(quote.avgPrice)}`,
      at,
    });
  }

  for (const line of def.chat) {
    await tx.messages.insert({
      id: brand(idGen.next("msg")),
      roomId: marketId,
      authorId: userIdByHandle.get(line.handle)!,
      kind: "text",
      body: line.text,
      at: new Date(now.getTime() - line.dayOffset * DAY_MS),
    });
  }

  let resolution: Resolution | undefined;
  if (def.resolution) {
    const proposedAt = new Date(now.getTime() - def.resolution.proposedDaysAgo * DAY_MS);
    const finalizesAt = new Date(proposedAt.getTime() + 12 * 60 * 60 * 1000);
    const winningOutcomeId = outcomeIdByKey.get(def.resolution.winningOutcomeKey)!;
    const winningLabel = def.outcomes.find((o) => o.key === def.resolution!.winningOutcomeKey)!.label;
    const proposerName = userByHandle.get(def.resolution.proposedByHandle)!.displayName;

    resolution = {
      winningOutcomeId,
      proposedBy: userIdByHandle.get(def.resolution.proposedByHandle)!,
      proposedAt,
      finalizesAt,
    };
    await tx.messages.insert({
      id: brand(idGen.next("msg")),
      roomId: marketId,
      authorId: null,
      kind: "system",
      body: `${proposerName} proposed "${winningLabel}" as the winning outcome — 12h to dispute.`,
      at: proposedAt,
    });

    if (def.status === "resolved") {
      resolution.resolvedAt = finalizesAt;
      const positions = await tx.positions.listByMarket(marketId);
      const finalState = toMarketState(pricing, "resolved");
      const payouts = engine.settle(finalState, winningOutcomeId, positions);
      for (const payout of payouts) {
        const payoutUserId: UserId = brand(payout.userId);
        const payoutUser = (await tx.users.findById(payoutUserId))!;
        await tx.users.update(payoutUserId, { balance: add(payoutUser.balance, payout.amount) });
      }
      await tx.messages.insert({
        id: brand(idGen.next("msg")),
        roomId: marketId,
        authorId: null,
        kind: "system",
        body: `Market resolved: ${winningLabel} — payouts sent.`,
        at: finalizesAt,
      });
    }
  }

  const market: Market = {
    id: marketId,
    groupId: groupIdBySlug.get(def.groupSlug)!,
    creatorId: userIdByHandle.get(def.creatorHandle)!,
    question: def.question,
    resolutionCriteria: def.resolutionCriteria,
    resolutionSource: def.resolutionSource,
    closesAt: daysFromNow(now, def.closesInDays),
    status: def.status,
    visibility: "group",
    pricing,
    minStake: fromDecimal(def.minStake),
    maxStake: fromDecimal(def.maxStake),
    stakesVisible: def.stakesVisible,
    outcomes,
    createdAt: daysFromNow(now, -def.createdDaysAgo),
    resolution,
  };
  await tx.markets.insert(market);
  return marketId;
}

// ---------------------------------------------------------------------------
// Explore markets: random-walk price history + synthetic display volume
// ---------------------------------------------------------------------------

async function seedExploreMarket(
  tx: DataStore,
  now: Date,
  idGen: IdGen,
  rng: Prng,
  def: ExploreMarketSeed,
  creatorId: UserId,
): Promise<void> {
  const marketId: MarketId = brand(idGen.next(categoryIdPrefix(def.category)));
  const outcomeIdByKey = new Map<string, OutcomeId>();
  const outcomes: Outcome[] = def.outcomes.map((o) => {
    const id: OutcomeId = brand(idGen.next("out"));
    outcomeIdByKey.set(o.key, id);
    return { id, marketId, label: o.label, color: o.color };
  });

  const outcomeKeys = def.outcomes.map((o) => o.key);
  const startProbabilities = outcomeKeys.map((k) => def.startProbabilities[k]!);
  const drift = outcomeKeys.map((k) => def.driftPerOutcome[k]!);
  const walk = generateRandomWalk(rng, startProbabilities, drift, def.volatility, EXPLORE_HISTORY_DAYS);

  for (const step of walk) {
    const at = daysFromNow(now, -(EXPLORE_HISTORY_DAYS - 1 - step.index));
    const prices: Record<OutcomeId, number> = {};
    outcomeKeys.forEach((k, i) => {
      prices[outcomeIdByKey.get(k)!] = step.probabilities[i]!;
    });
    await tx.priceHistory.append({ marketId, at, prices });
  }

  const finalProbabilities = walk[walk.length - 1]!.probabilities;
  const b = 300; // arbitrary — softmax(q/b) reproduces finalProbabilities for any b > 0
  const qValues = reverseLmsrQ(finalProbabilities, b);
  const q: Record<OutcomeId, number> = {};
  outcomeKeys.forEach((k, i) => {
    q[outcomeIdByKey.get(k)!] = qValues[i]!;
  });
  const pricing: PricingConfig = { kind: "lmsr", b, feeBps: 0, q };

  // Synthetic display volume via real (but ghost-attributed) Trade rows —
  // see this module's top doc comment for why these don't touch any real
  // seeded user's balance.
  const targetVolume = logUniform(rng, 100_000, 50_000_000);
  const tradeCount = randInt(rng, 18, 32);
  const tradeCosts = splitByRandomWeights(rng, targetVolume, tradeCount);
  for (let i = 0; i < tradeCount; i++) {
    const dayIndex = randInt(rng, 0, EXPLORE_HISTORY_DAYS - 1);
    const outcomeKey = pick(rng, outcomeKeys);
    const outcomeIdx = outcomeKeys.indexOf(outcomeKey);
    const price = walk[dayIndex]!.probabilities[outcomeIdx]!;
    const cost = fromDecimal(tradeCosts[i]!);
    const shares = price > 0 ? toDecimal(cost) / price : 0;
    const dayStart = daysFromNow(now, -(EXPLORE_HISTORY_DAYS - 1 - dayIndex)).getTime();
    const at = new Date(dayStart + randInt(rng, 0, DAY_MS - 1));
    await tx.trades.insert({
      id: brand(idGen.next("trd")),
      marketId,
      outcomeId: outcomeIdByKey.get(outcomeKey)!,
      userId: brand(`usr_ghost_${randInt(rng, 0, GHOST_TRADER_COUNT - 1)}`),
      side: "buy",
      shares,
      cost,
      avgPrice: price,
      fee: zero(),
      at,
    });
  }

  const createdAt = daysFromNow(now, -EXPLORE_HISTORY_DAYS);
  const market: Market = {
    id: marketId,
    groupId: null,
    creatorId,
    question: def.question,
    resolutionCriteria: def.resolutionCriteria,
    resolutionSource: def.resolutionSource,
    closesAt: daysFromNow(now, def.closesInDays),
    status: "open",
    visibility: "public",
    pricing,
    minStake: credits(100),
    maxStake: credits(1_000_000_00),
    stakesVisible: true,
    outcomes,
    createdAt,
    // Task 7: the real `category` field (entities.ts) replaces the id-prefix
    // workaround as the source of truth `GET /api/explore` groups by. The id
    // still carries the `mkt-${category}_` prefix (harmless, kept for
    // debuggability) but nothing reads it back anymore.
    category: def.category,
  };
  await tx.markets.insert(market);

  // Satisfies "every market has at least one message" without implying
  // Explore has a real Room (SPEC §3.6 describes no chat for Explore).
  await tx.messages.insert({
    id: brand(idGen.next("msg")),
    roomId: marketId,
    authorId: null,
    kind: "system",
    body: "Market opened for public trading — Explore is a read-only showcase.",
    at: createdAt,
  });
}
