// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { GET } from "@/app/api/friends/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function friendsReq(cookie?: string): Request {
  return new Request("http://localhost/api/friends", {
    headers: cookie ? { cookie } : {},
  });
}

describe("GET /api/friends", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await GET(friendsReq() as never);
    expect(res.status).toBe(403);
  });

  it("returns dev's own friends, incoming, and outgoing requests — never anyone else's", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(friendsReq(cookie) as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    const friendHandles = body.data.friends.map((f: { handle: string }) => f.handle);
    expect(friendHandles).toContain("maya");
    expect(friendHandles).not.toContain("dev");

    const incomingHandles = body.data.incomingRequests.map(
      (r: { user: { handle: string } }) => r.user.handle,
    );
    expect(incomingHandles.sort()).toEqual(["chaosgremlin", "yeetmaster"]);
    for (const r of body.data.incomingRequests) {
      expect(r.status).toBe("pending");
    }

    const outgoingHandles = body.data.outgoingRequests.map(
      (r: { user: { handle: string } }) => r.user.handle,
    );
    expect(outgoingHandles).toEqual(["noodle"]);

    // Never leaks a balance/email for any friend or requester.
    for (const f of body.data.friends) {
      expect(f).not.toHaveProperty("balance");
      expect(f).not.toHaveProperty("email");
    }
  });

  it("never shows a third party's friend list — a stranger's own /api/friends only shows THEIR graph", async () => {
    const { store } = await getContainer();
    const birdie = await store.users.findByHandle("birdie");
    const cookie = await sessionCookieFor(birdie!.id);

    const res = await GET(friendsReq(cookie) as never);
    const body = await res.json();
    const friendHandles = body.data.friends.map((f: { handle: string }) => f.handle);
    // birdie's seeded friendship is with marcus, not dev's graph.
    expect(friendHandles).toContain("marcus");
    expect(friendHandles).not.toContain("maya");
  });
});
