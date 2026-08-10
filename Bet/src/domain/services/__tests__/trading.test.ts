import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { executeTrade, priceOrder } from "@/domain/services/trading";
import { compare, fromDecimal, sub, credits } from "@/domain/money";
import { buildFixture } from "@/test-support/trading-fixtures";

describe("domain/services/trading.ts — executeTrade", () => {
  it("a buy debits exactly the quoted cost and credits the right shares", async () => {
    const f = await buildFixture();
    const before = (await f.store.users.findById(f.alice.id))!;

    const result = await executeTrade(
      { store: f.store, clock: f.clock, idGen: f.idGen },
      {
        actor: { userId: f.alice.id },
        marketId: f.market.id,
        order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(10) },
      },
    );

    const after = (await f.store.users.findById(f.alice.id))!;
    expect(sub(before.balance, after.balance)).toBe(result.quote.cost);
    expect(result.position.shares).toBeCloseTo(result.quote.shares, 9);
    expect(result.position.costBasis).toBe(result.quote.cost);
    expect(result.quote.cost).toBeGreaterThan(0);

    // The market's persisted pricing state actually moved.
    expect(result.market.pricing.kind).toBe("lmsr");
    if (result.market.pricing.kind === "lmsr") {
      expect(result.market.pricing.q[f.yes.id]).toBeCloseTo(result.quote.shares, 9);
    }
  });

  it("a buy -> sell round trip never leaves the trader better off", async () => {
    const f = await buildFixture();
    const before = (await f.store.users.findById(f.alice.id))!;
    const deps = { store: f.store, clock: f.clock, idGen: f.idGen };

    const buy = await executeTrade(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(25) },
    });

    const sell = await executeTrade(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      order: { outcomeId: f.yes.id, side: "sell", shares: buy.position.shares },
    });

    const after = (await f.store.users.findById(f.alice.id))!;
    expect(compare(after.balance, before.balance)).toBeLessThanOrEqual(0);
    expect(sell.position.shares).toBeCloseTo(0, 6);
  });

  it("rejects trading a market that is not open", async () => {
    const f = await buildFixture({ status: "closed" });
    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(10) },
        },
      ),
    ).rejects.toMatchObject({ code: "market_closed" });
  });

  it("rejects trading once closesAt has elapsed even if status still reads open", async () => {
    const f = await buildFixture({ closesInMs: -1000 });
    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(10) },
        },
      ),
    ).rejects.toMatchObject({ code: "market_closed" });
  });

  it("rejects a buy the trader can't afford (insufficient_balance)", async () => {
    const f = await buildFixture();
    await f.store.users.update(f.alice.id, { balance: credits(50) }); // 0.50 credits

    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(1000) },
        },
      ),
    ).rejects.toMatchObject({ code: "insufficient_balance" });

    // Balance untouched — the rejected trade wrote nothing.
    const after = (await f.store.users.findById(f.alice.id))!;
    expect(after.balance).toBe(credits(50));
  });

  it("enforces the client's maxCost slippage bound as a conflict", async () => {
    const f = await buildFixture();
    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(20), maxCost: credits(1) },
        },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects selling shares the trader does not hold", async () => {
    const f = await buildFixture();
    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "sell", shares: 5 },
        },
      ),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("rejects selling more shares than are held", async () => {
    const f = await buildFixture();
    const deps = { store: f.store, clock: f.clock, idGen: f.idGen };
    const buy = await executeTrade(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(5) },
    });

    await expect(
      executeTrade(deps, {
        actor: { userId: f.alice.id },
        marketId: f.market.id,
        order: { outcomeId: f.yes.id, side: "sell", shares: buy.position.shares + 1000 },
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("one trade creates exactly one system message in the Room", async () => {
    const f = await buildFixture();
    const before = await f.store.messages.listMessages(f.market.id, { limit: 100 });

    await executeTrade(
      { store: f.store, clock: f.clock, idGen: f.idGen },
      {
        actor: { userId: f.alice.id },
        marketId: f.market.id,
        order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(5) },
      },
    );

    const after = await f.store.messages.listMessages(f.market.id, { limit: 100 });
    expect(after.length - before.length).toBe(1);
    const [added] = after.filter((m) => !before.some((b) => b.id === m.id));
    expect(added!.kind).toBe("system");
    expect(added!.body).toMatch(/Alice bought \d+ Yes @ \d+¢/);
  });

  it("notifies every other participant, never the trader themself", async () => {
    const f = await buildFixture();
    const deps = { store: f.store, clock: f.clock, idGen: f.idGen };
    await executeTrade(deps, {
      actor: { userId: f.bob.id },
      marketId: f.market.id,
      order: { outcomeId: f.no.id, side: "buy", budget: fromDecimal(5) },
    });

    const aliceNotifications = await f.store.notifications.listByUser(f.alice.id);
    const bobNotifications = await f.store.notifications.listByUser(f.bob.id);
    expect(aliceNotifications.length).toBeGreaterThan(0); // alice is the creator
    expect(bobNotifications.length).toBe(0); // bob traded — never notifies himself
  });

  it("rejects any trade on a market you're not a member of (404-shaped)", async () => {
    const f = await buildFixture();
    const strangerUser = await f.store.users.insert({
      id: brand(f.idGen.next("usr")),
      handle: "stranger",
      displayName: "Stranger",
      avatarColor: "#000",
      avatarInitials: "ST",
      balance: credits(100_000),
      createdAt: f.clock.now(),
    });
    const stranger = { userId: strangerUser.id };

    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: stranger,
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(5) },
        },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("priceOrder is a pure preview — it never mutates the market", async () => {
    const f = await buildFixture();
    const before = await f.store.markets.findById(f.market.id);
    const quote = priceOrder(f.market, { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(10) });
    expect(quote.shares).toBeGreaterThan(0);
    const after = await f.store.markets.findById(f.market.id);
    expect(after).toEqual(before);
  });

  it("parimutuel markets reject selling (surfaced as validation, not a raw engine error)", async () => {
    const f = await buildFixture({ pricingKind: "parimutuel" });
    const deps = { store: f.store, clock: f.clock, idGen: f.idGen };
    await executeTrade(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(5) },
    });

    await expect(
      executeTrade(deps, {
        actor: { userId: f.alice.id },
        marketId: f.market.id,
        order: { outcomeId: f.yes.id, side: "sell", shares: 1 },
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
