// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { getContainer, resetContainerForTests } from "@/lib/container";
import { GET } from "@/app/api/markets/[id]/history/route";

beforeEach(() => {
  resetContainerForTests();
});

async function sessionCookieFor(handle: string): Promise<string> {
  const { store, auth } = await getContainer();
  const user = await store.users.findByHandle(handle);
  const token = await auth.createSession(user!.id);
  return `bet_session=${token}`;
}

function getReq(marketId: string, cookie?: string): Request {
  return new Request(`http://localhost/api/markets/${marketId}/history`, {
    headers: cookie ? { cookie } : {},
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/markets/[id]/history", () => {
  it("returns the market's price-point series for a member", async () => {
    const { store } = await getContainer();
    const group = await store.groups.findBySlug("sunday-league");
    const market = (await store.markets.listByGroup(group!.id)).find((m) => m.question.includes("10k"))!;
    const cookie = await sessionCookieFor("dev");

    const res = await GET(getReq(market.id, cookie) as never, ctxFor(market.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.points)).toBe(true);
    expect(body.data.points.length).toBeGreaterThan(0);
  });

  it("404s for a non-member", async () => {
    const { store } = await getContainer();
    const group = await store.groups.findBySlug("sunday-league");
    const market = (await store.markets.listByGroup(group!.id)).find((m) => m.question.includes("10k"))!;
    const cookie = await sessionCookieFor("noodle");

    const res = await GET(getReq(market.id, cookie) as never, ctxFor(market.id));
    expect(res.status).toBe(404);
  });
});
