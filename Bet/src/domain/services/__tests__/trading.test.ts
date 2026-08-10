import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { executeTrade, priceOrder } from "@/domain/services/trading";
import { compare, fromDecimal, sub, credits } from "@/domain/money";
import { feeAtRate, takerFee } from "@/domain/pricing/fees";
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

/**
 * G6 at the error-message boundary. `Credits` is integer CENTS, so
 * interpolating one raw into a sentence overstates it 100x — and these
 * strings are not internal: they travel through the `{ error }` envelope
 * into a toast in `OrderTicket.tsx` verbatim. `minStake = credits(500)`
 * (5.00 credits) used to read "Minimum stake is 500 credits."
 */
describe("user-facing money in error messages is formatted, never raw cents", () => {
  it("renders minStake as credits, not as its cent count", async () => {
    const f = await buildFixture({ minStake: 500 }); // 5.00 credits
    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(1) },
        },
      ),
    ).rejects.toMatchObject({
      code: "validation",
      message: "Minimum stake is 5.00 credits.",
    });
  });

  it("renders maxStake as credits, not as its cent count", async () => {
    const f = await buildFixture({ maxStake: 1000 }); // 10.00 credits
    await expect(
      executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(50) },
        },
      ),
    ).rejects.toMatchObject({
      code: "validation",
      message: "Maximum stake is 10.00 credits.",
    });
  });

  it("renders a slippage rejection's cost and limit as credits", async () => {
    const f = await buildFixture();
    let message = "";
    try {
      await executeTrade(
        { store: f.store, clock: f.clock, idGen: f.idGen },
        {
          actor: { userId: f.alice.id },
          marketId: f.market.id,
          order: {
            outcomeId: f.yes.id,
            side: "buy",
            budget: fromDecimal(20),
            maxCost: credits(1000), // 10.00 credits — deliberately too low
          },
        },
      );
    } catch (err) {
      message = (err as { message: string }).message;
    }
    expect(message).toContain("10.00");
    // The realized cost is ~20.xx credits; the raw cent figure (2xxx) must
    // not appear anywhere in the sentence.
    expect(message).not.toMatch(/\b\d{4,}\b/);
  });

  it("renders an oversell rejection's share counts readably", async () => {
    const f = await buildFixture();
    const deps = { store: f.store, clock: f.clock, idGen: f.idGen };
    const buy = await executeTrade(deps, {
      actor: { userId: f.alice.id },
      marketId: f.market.id,
      order: { outcomeId: f.yes.id, side: "buy", budget: fromDecimal(10) },
    });

    await expect(
      executeTrade(deps, {
        actor: { userId: f.alice.id },
        marketId: f.market.id,
        order: { outcomeId: f.yes.id, side: "sell", shares: buy.quote.shares * 10 },
      }),
    ).rejects.toMatchObject({
      code: "validation",
      message: expect.stringMatching(/^Cannot sell [\d,]+\.\d{2} shares — you hold [\d,]+\.\d{2}\.$/),
    });
  });
});

/**
 * The market's `feeBps` is a RATE, and is now charged as one. It used to be
 * read as a bare on/off toggle, with `takerFee`'s hard-coded 700bps charged
 * whenever it was non-zero — so the seeded `feeBps: 200` market billed at 7%
 * while the rules panel displayed the entity's honest "2.00%".
 */
describe("the market's own feeBps is the rate actually charged", () => {
  it("charges 200bps on a 200bps market, not the hard-coded 700bps taker rate", async () => {
    const f = await buildFixture({ feeBps: 200 });
    const quote = priceOrder(f.market, { outcomeId: f.yes.id, side: "buy", shares: 40 });

    expect(quote.fee).toBe(feeAtRate(40, quote.avgPrice, 200));
    expect(quote.fee).not.toBe(takerFee(40, quote.avgPrice));
    // 0.02 x 40 x P x (1-P) with P ~ 0.5497 is ~20c; the old 7% charge was
    // ~70c, about 3.5x what the displayed rate implies.
    expect(quote.fee).toBeLessThan(30);
  });

  it("still charges nothing when feeBps is 0", async () => {
    const f = await buildFixture({ feeBps: 0 });
    const quote = priceOrder(f.market, { outcomeId: f.yes.id, side: "buy", shares: 40 });
    expect(quote.fee).toBe(0);
  });
});

/**
 * The critical bug's surface as `POST /api/markets/[id]/quote` sees it: a
 * budget sell above the extractable cap used to answer HTTP 200 with
 * `{ shares: null, cost: 0, avgPrice: null }`.
 */
describe("priceOrder — an over-cap budget sell is a validation error, not a 0-cost quote", () => {
  it("rejects rather than quoting free money", async () => {
    // b = 100, q = 0 => p = 0.5, so at most -100*ln(0.5) = 69.31 credits
    // can ever be extracted by selling Yes.
    const f = await buildFixture();
    let thrown: { code?: string; message?: string } | undefined;
    try {
      priceOrder(f.market, { outcomeId: f.yes.id, side: "sell", budget: fromDecimal(100) });
    } catch (err) {
      thrown = err as { code?: string; message?: string };
    }
    expect(thrown?.code).toBe("validation");
    expect(thrown?.message).toContain("69.3");
  });

  it("still quotes a sell under the cap", async () => {
    const f = await buildFixture();
    const quote = priceOrder(f.market, { outcomeId: f.yes.id, side: "sell", budget: fromDecimal(20) });
    expect(Number.isFinite(quote.shares)).toBe(true);
    expect(quote.cost).toBeGreaterThan(0);
  });
});
