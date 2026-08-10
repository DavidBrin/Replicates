/**
 * Resolution/settlement (docs/plan.md Task 7, SPEC §6.4). Four actions,
 * one entry point (`resolveMarket`), all mutations inside exactly one
 * `store.transact` per call:
 *
 *   - `propose` — creator-only, market must be `closed` (or `open` with
 *     `closesAt` already elapsed — this function advances that transition
 *     itself via `nextStatusForClock` before checking, since there's no
 *     separate cron/"close market" endpoint in this app). Opens a 12h
 *     dispute window (`resolution.finalizesAt`) and moves the market to
 *     `resolving`.
 *   - `dispute` — any participant (or the creator) may dispute the
 *     proposal while it's live, moving the market to `disputed` and
 *     opening a quorum vote.
 *   - `vote` — any participant/creator may cast (or change) their vote for
 *     the winning outcome while `disputed`.
 *   - `finalize` — allowed once `now >= resolution.finalizesAt` with no
 *     dispute (status still `resolving`), or once a `disputed` vote has a
 *     clear (non-tied) majority. Runs the pricing engine's `settle`,
 *     credits every payout, and sets `status: "resolved"` — all inside
 *     this same transact. A market already `resolved` fails closed with
 *     `conflict` before touching the engine or any balance, which is what
 *     makes a second `finalize` call safe: it never re-runs `settle` and
 *     therefore never double-pays (SPEC §6.5 invariant 6).
 *
 * Every transition also appends a `kind: "system"` chat message (SPEC
 * §6.4: "every state change ... posted into the Room as a system
 * message").
 */

import type { Actor } from "@/domain/authz";
import {
  brand,
  type Market,
  type MarketId,
  type OutcomeId,
  type Resolution,
  type UserId,
} from "@/domain/entities";
import { add } from "@/domain/money";
import { nextStatusForClock } from "@/domain/market-state";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";
import type { Clock } from "@/ports/clock";
import type { DataStore } from "@/ports/data-store";
import type { IdGen } from "@/ports/id";
import { fail } from "./errors";
import { assertOutcomeExists, computeMarketFacts, findOutcome, loadMarketForActor, postSystemMessage } from "./market-access";

const DISPUTE_WINDOW_MS = 12 * 60 * 60 * 1000;

export type ResolutionInput =
  | { action: "propose"; outcomeId: OutcomeId }
  | { action: "dispute" }
  | { action: "vote"; outcomeId: OutcomeId }
  | { action: "finalize" };

export interface ResolutionDeps {
  store: DataStore;
  clock: Clock;
  idGen: IdGen;
}

export interface ResolveMarketParams {
  actor: Actor;
  marketId: MarketId;
  input: ResolutionInput;
}

async function requireParticipantOrCreator(
  store: DataStore,
  market: Market,
  actor: Actor,
): Promise<UserId> {
  if (!("userId" in actor)) fail("not_found", "Market not found.");
  const facts = await computeMarketFacts(store, market, actor);
  if (!(facts.isParticipant || facts.creatorId === actor.userId)) {
    fail("forbidden", "Only market participants may do that.");
  }
  return actor.userId;
}

/** Simple majority among CAST votes; ties leave the market open (SPEC
 * §6.4). Returns the winning outcome, or `undefined` if there is no vote
 * yet or the top two are tied. */
function tallyVotes(votes: Record<UserId, OutcomeId>): OutcomeId | undefined {
  const counts = new Map<OutcomeId, number>();
  for (const outcomeId of Object.values(votes)) {
    counts.set(outcomeId, (counts.get(outcomeId) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return undefined;
  if (sorted.length > 1 && sorted[0]![1] === sorted[1]![1]) return undefined;
  return sorted[0]![0];
}

export async function resolveMarket(
  deps: ResolutionDeps,
  params: ResolveMarketParams,
): Promise<Market> {
  const { store, clock, idGen } = deps;
  const { actor, marketId, input } = params;

  return store.transact(async (tx) => {
    let market = await loadMarketForActor(tx, marketId, actor);
    // `loadMarketForActor` already denies every anonymous actor (`not_found`
    // — D6). `propose` still needs a concrete `UserId` for its own extra
    // creator-only check, so narrow here rather than re-deriving it below.
    if (!("userId" in actor)) fail("not_found", "Market not found.");
    const actorId = actor.userId;
    const now = clock.now();

    // Advance the clock-driven open -> closed transition first, since
    // there's no separate "close the market" endpoint — a proposal is
    // legal the instant `closesAt` has elapsed even if nothing has
    // persisted that yet.
    const derived = nextStatusForClock(market, now);
    if (derived !== market.status) {
      market = await tx.markets.update(marketId, { status: derived });
    }

    switch (input.action) {
      case "propose":
        return propose(tx, idGen, market, actorId, now, input.outcomeId);
      case "dispute":
        return dispute(tx, idGen, market, actor, now);
      case "vote":
        return vote(tx, idGen, market, actor, now, input.outcomeId);
      case "finalize":
        return finalize(tx, idGen, market, actor, now);
    }
  });
}

async function propose(
  tx: DataStore,
  idGen: IdGen,
  market: Market,
  actorId: UserId,
  now: Date,
  outcomeId: OutcomeId,
): Promise<Market> {
  if (market.creatorId !== actorId) {
    fail("forbidden", "Only the market's creator may propose a resolution.");
  }
  if (market.status !== "closed") {
    fail(
      "conflict",
      `Cannot propose a resolution while the market is "${market.status}" — it must be closed to trading first.`,
    );
  }
  const outcome = findOutcome(market, outcomeId);

  const resolution: Resolution = {
    winningOutcomeId: outcome.id,
    proposedBy: actorId,
    proposedAt: now,
    finalizesAt: new Date(now.getTime() + DISPUTE_WINDOW_MS),
  };
  const updated = await tx.markets.update(market.id, { status: "resolving", resolution });
  await postSystemMessage(
    tx,
    idGen,
    market.id,
    now,
    `Resolution proposed: "${outcome.label}" — 12h to dispute.`,
  );
  return updated;
}

async function dispute(
  tx: DataStore,
  idGen: IdGen,
  market: Market,
  actor: Actor,
  now: Date,
): Promise<Market> {
  const actorId = await requireParticipantOrCreator(tx, market, actor);
  if (market.status !== "resolving" || !market.resolution) {
    fail("conflict", "There is no live proposal to dispute.");
  }
  const resolution: Resolution = { ...market.resolution, disputedBy: actorId, disputedAt: now };
  const updated = await tx.markets.update(market.id, { status: "disputed", resolution });
  await postSystemMessage(tx, idGen, market.id, now, "The proposed resolution was disputed — opening a vote.");
  return updated;
}

async function vote(
  tx: DataStore,
  idGen: IdGen,
  market: Market,
  actor: Actor,
  now: Date,
  outcomeId: OutcomeId,
): Promise<Market> {
  const actorId = await requireParticipantOrCreator(tx, market, actor);
  if (market.status !== "disputed" || !market.resolution) {
    fail("conflict", "Voting is only open while a resolution is disputed.");
  }
  const outcome = findOutcome(market, outcomeId);
  const votes = { ...(market.resolution.votes ?? {}), [actorId]: outcome.id };
  const resolution: Resolution = { ...market.resolution, votes };
  const updated = await tx.markets.update(market.id, { resolution });
  await postSystemMessage(tx, idGen, market.id, now, `A vote was cast for "${outcome.label}".`);
  return updated;
}

async function finalize(
  tx: DataStore,
  idGen: IdGen,
  market: Market,
  actor: Actor,
  now: Date,
): Promise<Market> {
  await requireParticipantOrCreator(tx, market, actor);

  if (market.status === "resolved") {
    // Idempotent-but-not-double-paying guard: a second finalize call never
    // re-runs settle or touches balances (SPEC §6.5 invariant 6).
    fail("conflict", "This market has already been resolved.");
  }
  if (!market.resolution || (market.status !== "resolving" && market.status !== "disputed")) {
    fail("conflict", "There is no proposal ready to finalize.");
  }

  let winningOutcomeId: OutcomeId = market.resolution.winningOutcomeId;

  if (market.status === "resolving") {
    if (now.getTime() < market.resolution.finalizesAt.getTime()) {
      fail("conflict", "The 12h dispute window has not elapsed yet.");
    }
  } else {
    const decided = tallyVotes(market.resolution.votes ?? {});
    if (decided === undefined) {
      fail("conflict", "The vote has no votes yet, or is tied — the market stays open.");
    }
    winningOutcomeId = decided;
  }

  assertOutcomeExists(market, winningOutcomeId);

  const engine = getEngine(market.pricing.kind);
  const state = toMarketState(market.pricing, "resolved");
  const positions = await tx.positions.listByMarket(market.id);
  const payouts = engine.settle(state, winningOutcomeId, positions);

  for (const payout of payouts) {
    const userId = brand<"UserId">(payout.userId);
    const user = await tx.users.findById(userId);
    // A payout to an id with no `User` row (an Explore ghost trader) is
    // never expected on a private market's real settlement — skip
    // defensively rather than throw, so one bad row can't sink every
    // other winner's payout.
    if (!user) continue;
    await tx.users.update(userId, { balance: add(user.balance, payout.amount) });
  }

  const resolution: Resolution = { ...market.resolution, winningOutcomeId, resolvedAt: now };
  const updated = await tx.markets.update(market.id, { status: "resolved", resolution });

  const label = findOutcome(market, winningOutcomeId).label;
  await postSystemMessage(tx, idGen, market.id, now, `Market resolved: "${label}" — payouts sent.`);

  const participantIds = new Set<UserId>([market.creatorId, ...positions.map((p) => p.userId)]);
  for (const userId of participantIds) {
    await tx.notifications.insert({
      id: brand(idGen.next("ntf")),
      userId,
      type: "market_resolved",
      payload: { marketId: market.id, question: market.question, winningOutcomeId, winningLabel: label },
      createdAt: now,
    });
  }

  return updated;
}
