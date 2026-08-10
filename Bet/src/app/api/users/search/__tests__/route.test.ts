// @vitest-environment node
//
// This route calls `requireUser`, which verifies sessions via jose —
// jsdom-incompatible in this project's vitest setup (see
// src/adapters/auth/__tests__/demo-session.test.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { brand, type User } from "@/domain/entities";
import { credits } from "@/domain/money";
import { getContainer } from "@/lib/container";
import { GET, resetSearchRateLimiterForTests } from "@/app/api/users/search/route";

function searchReq(query: string, cookie: string): Request {
  return new Request(`http://localhost/api/users/search?q=${encodeURIComponent(query)}`, {
    headers: { cookie },
  });
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

async function insertUser(idSuffix: string, overrides: Partial<User> = {}): Promise<User> {
  const { store, clock } = await getContainer();
  const user: User = {
    id: brand(`usr_search_${idSuffix}`),
    handle: `handle_${idSuffix}`,
    displayName: `Test User ${idSuffix}`,
    avatarColor: "#7c6cff",
    avatarInitials: "TU",
    balance: credits(100_000),
    createdAt: clock.now(),
    ...overrides,
  };
  return store.users.insert(user);
}

describe("GET /api/users/search", () => {
  beforeEach(() => {
    resetSearchRateLimiterForTests();
  });

  it("returns forbidden (403) with no session — not existence-sensitive, just unauthenticated", async () => {
    const res = await GET(new Request("http://localhost/api/users/search?q=ma") as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns an EMPTY list (not an error) below the 2-char minimum", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(searchReq("m", cookie) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results).toEqual([]);
  });

  it("matches by case-insensitive PREFIX on handle, excludes self, and reports isFriend/hasPendingRequest", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    // "maya" is a seeded friend of dev.
    const friendRes = await GET(searchReq("MAY", cookie) as never);
    const friendBody = await friendRes.json();
    const maya = friendBody.data.results.find((r: { handle: string }) => r.handle === "maya");
    expect(maya).toBeDefined();
    expect(maya.isFriend).toBe(true);
    expect(maya.hasPendingRequest).toBe(false);
    expect(maya).not.toHaveProperty("email");
    expect(maya).not.toHaveProperty("balance");

    // "chaosgremlin" has a pending INCOMING request to dev in the seed.
    const pendingRes = await GET(searchReq("chaos", cookie) as never);
    const pendingBody = await pendingRes.json();
    const chaos = pendingBody.data.results[0];
    expect(chaos.handle).toBe("chaosgremlin");
    expect(chaos.isFriend).toBe(false);
    expect(chaos.hasPendingRequest).toBe(true);

    // Searching your own handle/name never returns yourself.
    const selfRes = await GET(searchReq("dev", cookie) as never);
    const selfBody = await selfRes.json();
    expect(selfBody.data.results).toEqual([]);
  });

  it("matches by prefix on displayName too, not just handle", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    // "maya ch" is a prefix of displayName "Maya Chen" but NOT of handle
    // "maya" (too long to be a handle prefix), so this only matches via
    // the displayName branch.
    const res = await GET(searchReq("maya ch", cookie) as never);
    const body = await res.json();
    expect(body.data.results.map((r: { handle: string }) => r.handle)).toContain("maya");
  });

  it("caps results at 10", async () => {
    for (let i = 0; i < 15; i += 1) {
      await insertUser(`cap${i}`, { handle: `capuser${i}`, displayName: `Cap User ${i}` });
    }
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(searchReq("capuser", cookie) as never);
    const body = await res.json();
    expect(body.data.results.length).toBe(10);
  });

  it("trips the rate limiter after 20 requests in a burst — the 21st returns rate_limited (429)", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const res = await GET(searchReq("ma", cookie) as never);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
