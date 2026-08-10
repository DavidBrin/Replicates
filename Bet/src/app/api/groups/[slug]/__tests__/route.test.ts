// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { GET } from "@/app/api/groups/[slug]/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function groupReq(cookie?: string): Request {
  return new Request("http://localhost/api/groups/the-roommates", {
    headers: cookie ? { cookie } : {},
  });
}

function ctxFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("GET /api/groups/[slug]", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await GET(groupReq() as never, ctxFor("the-roommates"));
    expect(res.status).toBe(403);
  });

  it("returns not_found (404), never 403, for a non-member (G4/D6)", async () => {
    const { store } = await getContainer();
    // yeetmaster is seeded into fantasy-2026 only, not the-roommates.
    const yeetmaster = await store.users.findByHandle("yeetmaster");
    const cookie = await sessionCookieFor(yeetmaster!.id);

    const res = await GET(groupReq(cookie) as never, ctxFor("the-roommates"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns not_found (404) for a slug that doesn't exist at all", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(groupReq(cookie) as never, ctxFor("no-such-group"));
    expect(res.status).toBe(404);
  });

  it("returns group + members + markets for a member", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(groupReq(cookie) as never, ctxFor("the-roommates"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.group.slug).toBe("the-roommates");
    expect(Array.isArray(body.data.members)).toBe(true);
    const handles = body.data.members.map((m: { handle: string }) => m.handle).sort();
    expect(handles).toEqual(["dev", "jordan", "kiwi", "noodle", "priya"]);
    // Member summaries never leak a balance.
    for (const m of body.data.members) {
      expect(m).not.toHaveProperty("balance");
    }
    expect(Array.isArray(body.data.markets)).toBe(true);
  });
});
