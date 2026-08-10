// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { getContainer, resetContainerForTests } from "@/lib/container";
import { POST } from "@/app/api/markets/[id]/resolve/route";

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
  return new Request(`http://localhost/api/markets/${marketId}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** `rm-flight` seeds status: "closed", no proposal yet — a clean market to
 * drive through propose -> finalize without waiting on any other seeded
 * resolution state. */
async function rmFlight() {
  const { store } = await getContainer();
  const group = await store.groups.findBySlug("the-roommates");
  const markets = await store.markets.listByGroup(group!.id);
  return markets.find((m) => m.question.toLowerCase().includes("flight"))!;
}

describe("POST /api/markets/[id]/resolve", () => {
  it("only the creator may propose (403)", async () => {
    const market = await rmFlight();
    const cookie = await sessionCookieFor("priya"); // not the creator (kiwi)
    const res = await POST(
      postReq(market.id, { action: "propose", outcomeId: market.outcomes[0]!.id }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(403);
  });

  it("a second finalize is rejected (409 conflict) and never double-pays", async () => {
    const market = await rmFlight();
    const cookie = await sessionCookieFor("kiwi"); // kiwi is rm-flight's creator
    const { store } = await getContainer();

    const proposeRes = await POST(
      postReq(market.id, { action: "propose", outcomeId: market.outcomes[0]!.id }, cookie) as never,
      ctxFor(market.id),
    );
    expect(proposeRes.status).toBe(200);
    const proposeBody = await proposeRes.json();
    expect(proposeBody.data.market.status).toBe("resolving");

    // Force the dispute window open without waiting 12 real hours.
    const proposed = await store.markets.findById(market.id);
    await store.markets.update(market.id, {
      resolution: { ...proposed!.resolution!, finalizesAt: new Date(Date.now() - 1000) },
    });

    const firstFinalize = await POST(postReq(market.id, { action: "finalize" }, cookie) as never, ctxFor(market.id));
    expect(firstFinalize.status).toBe(200);
    const firstBody = await firstFinalize.json();
    expect(firstBody.data.market.status).toBe("resolved");

    const priya = await store.users.findByHandle("priya");
    const balanceAfterFirst = priya!.balance;

    const secondFinalize = await POST(postReq(market.id, { action: "finalize" }, cookie) as never, ctxFor(market.id));
    expect(secondFinalize.status).toBe(409);
    const secondBody = await secondFinalize.json();
    expect(secondBody.error.code).toBe("conflict");

    const priyaAfterSecond = await store.users.findByHandle("priya");
    expect(priyaAfterSecond!.balance).toBe(balanceAfterFirst); // no double payment
  });

  it("404s for a non-member", async () => {
    const market = await rmFlight();
    const cookie = await sessionCookieFor("yeetmaster"); // fantasy-2026 only, not the-roommates
    const res = await POST(
      postReq(market.id, { action: "finalize" }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(404);
  });
});
