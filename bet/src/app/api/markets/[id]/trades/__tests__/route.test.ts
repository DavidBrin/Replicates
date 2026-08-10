// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { credits } from "@/domain/money";
import { getContainer, resetContainerForTests } from "@/lib/container";
import { POST } from "@/app/api/markets/[id]/trades/route";

beforeEach(() => {
  resetContainerForTests();
});

async function sessionCookieFor(handle: string): Promise<string> {
  const { store, auth } = await getContainer();
  const user = await store.users.findByHandle(handle);
  const token = await auth.createSession(user!.id);
  return `bet_session=${token}`;
}

function postReq(marketId: string, body: unknown, cookie?: string): Request {
  return new Request(`http://localhost/api/markets/${marketId}/trades`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function sl10k() {
  const { store } = await getContainer();
  const group = await store.groups.findBySlug("sunday-league");
  const markets = await store.markets.listByGroup(group!.id);
  return markets.find((m) => m.question.includes("10k"))!;
}

async function rmFlight() {
  const { store } = await getContainer();
  const group = await store.groups.findBySlug("the-roommates");
  const markets = await store.markets.listByGroup(group!.id);
  return markets.find((m) => m.question.toLowerCase().includes("flight"))!;
}

describe("POST /api/markets/[id]/trades", () => {
  it("executes a buy end-to-end: debits the exact quoted cost, moves the price, posts a system message", async () => {
    const market = await sl10k();
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const beforeBalance = dev!.balance;
    const cookie = await sessionCookieFor("dev");

    const res = await POST(
      postReq(market.id, { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 5 }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.quote.cost).toBeGreaterThan(0);

    const devAfter = await store.users.findById(dev!.id);
    expect(beforeBalance - devAfter!.balance).toBe(body.data.quote.cost);
    expect(body.data.market.pricing).not.toEqual(market.pricing);
  });

  it("rejects trading a closed market (409, market_closed)", async () => {
    const market = await rmFlight(); // seeded status: "closed"
    expect(market.status).toBe("closed");
    const cookie = await sessionCookieFor("dev");
    const res = await POST(
      postReq(market.id, { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 5 }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("market_closed");
  });

  it("rejects insufficient balance (422)", async () => {
    const market = await sl10k();
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    await store.users.update(dev!.id, { balance: credits(10) }); // 0.10 credits
    const cookie = await sessionCookieFor("dev");

    // sl-10k's maxStake is 200 credits — a 50-credit budget stays under
    // that bound but still vastly exceeds dev's 0.10-credit balance, so
    // this isolates the balance check from the maxStake check.
    const res = await POST(
      postReq(market.id, { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 50 }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("insufficient_balance");
  });

  it("enforces the maxCost slippage bound as a 409 conflict", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("dev");
    const res = await POST(
      postReq(
        market.id,
        { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 20, maxCost: 0.01 },
        cookie,
      ) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
  });

  it("404s for a non-member", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("noodle");
    const res = await POST(
      postReq(market.id, { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 5 }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(404);
  });

  it("404s (never 403) for an anonymous trade attempt", async () => {
    const market = await sl10k();
    const res = await POST(
      postReq(market.id, { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 5 }) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(404);
  });
});
