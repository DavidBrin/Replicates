// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { getContainer, resetContainerForTests } from "@/lib/container";
import { GET, POST } from "@/app/api/markets/[id]/messages/route";

beforeEach(() => {
  resetContainerForTests();
});

async function sessionCookieFor(handle: string): Promise<string> {
  const { store, auth } = await getContainer();
  const user = await store.users.findByHandle(handle);
  const token = await auth.createSession(user!.id);
  return `bet_session=${token}`;
}

function getReq(marketId: string, qs: string, cookie?: string): Request {
  return new Request(`http://localhost/api/markets/${marketId}/messages${qs}`, {
    headers: cookie ? { cookie } : {},
  });
}

function postReq(marketId: string, body: unknown, cookie?: string): Request {
  return new Request(`http://localhost/api/markets/${marketId}/messages`, {
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
  return (await store.markets.listByGroup(group!.id)).find((m) => m.question.includes("10k"))!;
}

describe("GET /api/markets/[id]/messages", () => {
  it("returns a keyset page, newest first, capped at the requested limit", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("dev");
    const res = await GET(getReq(market.id, "?limit=3", cookie) as never, ctxFor(market.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.messages.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < body.data.messages.length; i++) {
      expect(new Date(body.data.messages[i - 1].at).getTime()).toBeGreaterThanOrEqual(
        new Date(body.data.messages[i].at).getTime(),
      );
    }
  });

  it("caps limit at 50 even when a larger value is requested", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("dev");
    const res = await GET(getReq(market.id, "?limit=500", cookie) as never, ctxFor(market.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.messages.length).toBeLessThanOrEqual(50);
  });

  it("404s for a non-member", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("noodle");
    const res = await GET(getReq(market.id, "", cookie) as never, ctxFor(market.id));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/markets/[id]/messages", () => {
  it("posts a message and it appears in a subsequent GET", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("dev");
    const res = await POST(
      postReq(market.id, { clientId: "client-1", body: "hey does anyone actually believe in marcus" }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.message.body).toBe("hey does anyone actually believe in marcus");
    expect(body.data.message.kind).toBe("text");

    const listRes = await GET(getReq(market.id, "?limit=1", cookie) as never, ctxFor(market.id));
    const listBody = await listRes.json();
    expect(listBody.data.messages[0].id).toBe(body.data.message.id);
  });

  it("is idempotent on clientId — posting the same clientId twice returns the original message", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("dev");
    const first = await POST(
      postReq(market.id, { clientId: "dup-client", body: "first send" }, cookie) as never,
      ctxFor(market.id),
    );
    const second = await POST(
      postReq(market.id, { clientId: "dup-client", body: "first send" }, cookie) as never,
      ctxFor(market.id),
    );
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.data.message.id).toBe(firstBody.data.message.id);

    const { store } = await getContainer();
    const all = await store.messages.listMessages(market.id, { limit: 200 });
    const matching = all.filter((m) => m.clientId === "dup-client");
    expect(matching).toHaveLength(1);
  });

  it("404s for a non-member trying to post", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("noodle");
    const res = await POST(
      postReq(market.id, { clientId: "x", body: "hi" }, cookie) as never,
      ctxFor(market.id),
    );
    expect(res.status).toBe(404);
  });
});
