// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { getContainer, resetContainerForTests } from "@/lib/container";
import { POST } from "@/app/api/markets/[id]/quote/route";

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
  return new Request(`http://localhost/api/markets/${marketId}/quote`, {
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
  const market = markets.find((m) => m.question.includes("10k"))!;
  return market;
}

describe("POST /api/markets/[id]/quote", () => {
  it("404s for a non-member", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("noodle");
    const res = await POST(
      postReq(market.id, { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 10 }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(404);
  });

  it("prices a hypothetical order without mutating the market", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("dev");
    const res = await POST(
      postReq(market.id, { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 10 }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.quote.shares).toBeGreaterThan(0);
    expect(body.data.quote.cost).toBeGreaterThan(0);

    const { store } = await getContainer();
    const after = await store.markets.findById(market.id);
    expect(after!.pricing).toEqual(market.pricing);
  });

  it("rejects a body with both shares and budget set", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("dev");
    const res = await POST(
      postReq(market.id, { outcomeId: market.outcomes[0]!.id, side: "buy", budget: 10, shares: 5 }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(400);
  });
});
