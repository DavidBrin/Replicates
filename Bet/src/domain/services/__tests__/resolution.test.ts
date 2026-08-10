import { describe, expect, it } from "vitest";
import { executeTrade } from "@/domain/services/trading";
import { resolveMarket } from "@/domain/services/resolution";
import { add, compare, credits, fromDecimal, sub } from "@/domain/money";
import { lmsrMaxLoss } from "@/domain/pricing/lmsr";
import { buildFixture, mutableClock } from "@/test-support/trading-fixtures";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

describe("domain/services/resolution.ts — resolveMarket", () => {
  it("only the creator may propose", async () => {
    const f = await buildFixture({ status: "closed" });
    await expect(
      resolveMarket(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        { actor: { userId: f.bob.id }, marketId: f.market.id, input: { action: "propose", outcomeId: f.yes.id } },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("propose requires the market to be closed first", async () => {
    const f = await buildFixture({ status: "open" });
    await expect(
      resolveMarket(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "propose", outcomeId: f.yes.id } },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("propose succeeds once closesAt has elapsed even if status still reads open", async () => {
    const f = await buildFixture({ status: "open", closesInMs: -1000 });
    const updated = await resolveMarket(
      { store: f.store, clock: f.clock, idGen: f.idGen },
      { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "propose", outcomeId: f.yes.id } },
    );
    expect(updated.status).toBe("resolving");
    expect(updated.resolution?.winningOutcomeId).toBe(f.yes.id);
    expect(updated.resolution?.finalizesAt.getTime()).toBe(updated.resolution!.proposedAt.getTime() + TWELVE_HOURS_MS);
  });

  it("finalize before the 12h window elapses is rejected", async () => {
    const f = await buildFixture({ status: "closed" });
    await resolveMarket(
      { store: f.store, clock: f.clock, idGen: f.idGen },
      { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "propose", outcomeId: f.yes.id } },
    );
    await expect(
      resolveMarket(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "finalize" } },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("dispute + vote path: a tied vote leaves the market open, a decided vote finalizes", async () => {
    const clock = mutableClock();
    const f = await buildFixture({ clock, status: "closed" });
    const deps = { store: f.store, clock, idGen: f.idGen };

    await resolveMarket(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      input: { action: "propose", outcomeId: f.yes.id },
    });
    const disputed = await resolveMarket(deps, {
      actor: { userId: f.bob.id }, // bob is a group member -> counts as a participant
      marketId: f.market.id,
      input: { action: "dispute" },
    });
    expect(disputed.status).toBe("disputed");

    // Only bob votes so far — a single voter is a clean (non-tied) majority.
    await resolveMarket(deps, {
      actor: { userId: f.bob.id },
      marketId: f.market.id,
      input: { action: "vote", outcomeId: f.no.id },
    });

    const finalized = await resolveMarket(deps, {
      actor: { userId: f.bob.id },
      marketId: f.market.id,
      input: { action: "finalize" },
    });
    expect(finalized.status).toBe("resolved");
    expect(finalized.resolution?.winningOutcomeId).toBe(f.no.id);
  });

  it("a tied vote is rejected by finalize — the market stays open for more votes", async () => {
    const f = await buildFixture({ status: "closed" });
    const deps = { store: f.store, clock: f.clock, idGen: f.idGen };
    await resolveMarket(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      input: { action: "propose", outcomeId: f.yes.id },
    });
    await resolveMarket(deps, { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "dispute" } });
    await resolveMarket(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      input: { action: "vote", outcomeId: f.yes.id },
    });
    await resolveMarket(deps, {
      actor: { userId: f.bob.id },
      marketId: f.market.id,
      input: { action: "vote", outcomeId: f.no.id },
    });

    await expect(
      resolveMarket(deps, { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "finalize" } }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("settlement conserves money: the winner's payout never exceeds collected cost basis + LMSR's bounded subsidy", async () => {
    const clock = mutableClock();
    const f = await buildFixture({ clock, status: "open" });
    const deps = { store: f.store, clock, idGen: f.idGen };

    const aliceBuy = await executeTrade(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(20) },
    });
    const bobBuy = await executeTrade(deps, {
      actor: { userId: f.bob.id },
      marketId: f.market.id,
      order: { outcomeId: f.no.id, side: "buy", budget: fromDecimal(15) },
    });
    const totalCollected = add(aliceBuy.quote.cost, bobBuy.quote.cost);

    await f.store.markets.update(f.market.id, { status: "closed" });
    await resolveMarket(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      input: { action: "propose", outcomeId: f.yes.id },
    });
    clock.advance(TWELVE_HOURS_MS + 1000);

    const alicePreFinalize = (await f.store.users.findById(f.alice.id))!;
    const bobPreFinalize = (await f.store.users.findById(f.bob.id))!;
    const resolved = await resolveMarket(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      input: { action: "finalize" },
    });
    expect(resolved.status).toBe("resolved");

    const aliceAfter = (await f.store.users.findById(f.alice.id))!;
    const bobAfter = (await f.store.users.findById(f.bob.id))!;
    const alicePayout = sub(aliceAfter.balance, alicePreFinalize.balance);
    const bobPayout = sub(bobAfter.balance, bobPreFinalize.balance);

    // Bob staked on the losing outcome (No) — never paid.
    expect(bobPayout).toBe(credits(0));
    // Alice (sole Yes holder, the winning outcome) is paid at most what was
    // collected plus LMSR's bounded operator subsidy b*ln(n) (SPEC §6.5
    // invariants 4 & 5) — never an unbounded amount.
    const subsidy = fromDecimal(lmsrMaxLoss(100, 2));
    expect(compare(alicePayout, add(totalCollected, subsidy))).toBeLessThanOrEqual(0);
    expect(compare(alicePayout, credits(0))).toBeGreaterThan(0);
  });

  it("a second finalize is rejected and never double-pays (SPEC invariant 6)", async () => {
    const clock = mutableClock();
    const f = await buildFixture({ clock, status: "open" });
    const deps = { store: f.store, clock, idGen: f.idGen };

    await executeTrade(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(20) },
    });
    await executeTrade(deps, {
      actor: { userId: f.bob.id },
      marketId: f.market.id,
      order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(15) },
    });

    await f.store.markets.update(f.market.id, { status: "closed" });
    await resolveMarket(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      input: { action: "propose", outcomeId: f.yes.id },
    });
    clock.advance(TWELVE_HOURS_MS + 1000);

    const resolved = await resolveMarket(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      input: { action: "finalize" },
    });
    expect(resolved.status).toBe("resolved");

    const aliceAfterFirst = (await f.store.users.findById(f.alice.id))!;
    const bobAfterFirst = (await f.store.users.findById(f.bob.id))!;

    await expect(
      resolveMarket(deps, { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "finalize" } }),
    ).rejects.toMatchObject({ code: "conflict" });

    const aliceAfterSecond = (await f.store.users.findById(f.alice.id))!;
    const bobAfterSecond = (await f.store.users.findById(f.bob.id))!;
    expect(aliceAfterSecond.balance).toBe(aliceAfterFirst.balance);
    expect(bobAfterSecond.balance).toBe(bobAfterFirst.balance);
  });

  it("finalize posts a system message and never resolves twice even under a raced call", async () => {
    const clock = mutableClock();
    const f = await buildFixture({ clock, status: "closed" });
    const deps = { store: f.store, clock, idGen: f.idGen };
    await resolveMarket(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      input: { action: "propose", outcomeId: f.yes.id },
    });
    clock.advance(TWELVE_HOURS_MS + 1000);

    const before = await f.store.messages.listMessages(f.market.id, { limit: 100 });
    const [first, second] = await Promise.allSettled([
      resolveMarket(deps, { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "finalize" } }),
      resolveMarket(deps, { actor: { userId: f.alice.id }, marketId: f.market.id, input: { action: "finalize" } }),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const after = await f.store.messages.listMessages(f.market.id, { limit: 100 });
    const resolvedMessages = after.filter(
      (m) => m.kind === "system" && m.body.startsWith("Market resolved") && !before.some((b) => b.id === m.id),
    );
    expect(resolvedMessages.length).toBe(1);
  });
});
