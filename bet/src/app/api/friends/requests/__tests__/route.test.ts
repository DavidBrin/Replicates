// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { POST } from "@/app/api/friends/requests/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function sendReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/friends/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/friends/requests", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await POST(sendReq({ toHandle: "birdie" }) as never);
    expect(res.status).toBe(403);
  });

  it("returns validation (400) when toHandle is missing", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(sendReq({}, cookie) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
  });

  it("returns not_found (404) for an unknown handle", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(sendReq({ toHandle: "nobody_at_all" }, cookie) as never);
    expect(res.status).toBe(404);
  });

  it("rejects a self-request as validation (400)", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(sendReq({ toHandle: "dev" }, cookie) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
  });

  it("rejects a duplicate pending request (same direction) as conflict (409)", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    // dev already has a pending outgoing request to noodle (seed data).
    const res = await POST(sendReq({ toHandle: "noodle" }, cookie) as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
  });

  it("rejects sending a request to someone who already sent YOU one — conflict telling the caller to accept instead", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    // yeetmaster -> dev is a pending seeded request.
    const res = await POST(sendReq({ toHandle: "yeetmaster" }, cookie) as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message.toLowerCase()).toContain("accept");
  });

  it("rejects a request to an existing friend as conflict (409)", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(sendReq({ toHandle: "maya" }, cookie) as never);
    expect(res.status).toBe(409);
  });

  it("happy path: dev sends birdie a friend request (birdie is a total stranger in the seed)", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(sendReq({ toHandle: "birdie" }, cookie) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.request.status).toBe("pending");
    expect(body.data.request.fromId).toBe(dev!.id);

    const birdie = await store.users.findByHandle("birdie");
    const notifications = await store.notifications.listByUser(birdie!.id);
    expect(
      notifications.some(
        (n) => n.type === "friend_request_received" && (n.payload as { fromHandle?: string }).fromHandle === "dev",
      ),
    ).toBe(true);
  });
});
