// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
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

  /** Walks a seeded busy market's full message list page by page via
   * `?before=`, concatenating pages, and asserts the result is EXACTLY
   * equal (same order, no duplicates, no gaps) to a single unpaginated
   * fetch — Task 10's Room paginates on exactly this contract. */
  it("keyset pagination concatenates to exactly the same list as a single unpaginated fetch", async () => {
    const market = await sl10k(); // sl-10k: 10 seeded trades + 14 seeded chat lines = 24 messages
    const cookie = await sessionCookieFor("dev");

    const fullRes = await GET(getReq(market.id, "?limit=50", cookie) as never, ctxFor(market.id));
    expect(fullRes.status).toBe(200);
    const fullBody = await fullRes.json();
    const fullIds: string[] = fullBody.data.messages.map((m: { id: string }) => m.id);
    expect(fullIds.length).toBeGreaterThanOrEqual(20);
    expect(fullBody.data.nextCursor).toBeNull(); // fewer than the 50 requested — no further page

    const paginatedIds: string[] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    do {
      const qs = cursor ? `?limit=5&before=${encodeURIComponent(cursor)}` : "?limit=5";
      const res = await GET(getReq(market.id, qs, cookie) as never, ctxFor(market.id));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.messages.length).toBeLessThanOrEqual(5);
      paginatedIds.push(...body.data.messages.map((m: { id: string }) => m.id));
      cursor = body.data.nextCursor;
      pageCount += 1;
      expect(pageCount).toBeLessThan(20); // guards against an infinite loop on a regression
    } while (cursor);

    expect(pageCount).toBeGreaterThan(1); // actually exercised multiple pages
    expect(paginatedIds).toEqual(fullIds); // same order, no duplicates, no gaps
    expect(new Set(paginatedIds).size).toBe(paginatedIds.length);
  });

  /** The same continuity guarantee across a page boundary that lands
   * squarely inside a group of messages sharing an IDENTICAL timestamp —
   * the seed's hand-authored data never produces one (see task-7-report.md
   * "Fix round 1"), so this constructs one directly via the store to
   * exercise `MemoryMessageRepo`'s id-descending tie-break at a boundary. */
  it("keyset pagination has no gaps or duplicates across a same-timestamp boundary", async () => {
    const market = await sl10k();
    const cookie = await sessionCookieFor("dev");
    const { store, clock } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    // Newer than every seeded message (all are hours-to-days old), so these
    // four land at the very front of the newest-first list, guaranteeing a
    // `limit=3` page boundary falls inside the tied group.
    const tiedAt = new Date(clock.now().getTime() - 1_000);
    const tiedIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const message = await store.messages.insert({
        id: brand(`msg_tiedtest_${i}`),
        roomId: market.id,
        authorId: dev!.id,
        kind: "text",
        body: `tied message ${i}`,
        at: tiedAt,
      });
      tiedIds.push(message.id);
    }

    const fullRes = await GET(getReq(market.id, "?limit=50", cookie) as never, ctxFor(market.id));
    const fullBody = await fullRes.json();
    const fullIds: string[] = fullBody.data.messages.map((m: { id: string }) => m.id);
    // All four tied messages are the newest and thus the first four entries.
    expect(fullIds.slice(0, 4).sort()).toEqual([...tiedIds].sort());

    const paginatedIds: string[] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    do {
      const qs = cursor ? `?limit=3&before=${encodeURIComponent(cursor)}` : "?limit=3";
      const res = await GET(getReq(market.id, qs, cookie) as never, ctxFor(market.id));
      const body = await res.json();
      paginatedIds.push(...body.data.messages.map((m: { id: string }) => m.id));
      cursor = body.data.nextCursor;
      pageCount += 1;
      expect(pageCount).toBeLessThan(20);
    } while (cursor);

    expect(paginatedIds).toEqual(fullIds);
    expect(new Set(paginatedIds).size).toBe(paginatedIds.length);
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
