// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { POST } from "@/app/api/friends/requests/[id]/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function actReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/friends/requests/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Tests are intentionally sequential and share the seeded requests below:
 * a request that's asserted `accepted` in one case is then used to prove
 * "already resolved" is a 409 in the next. */
describe("POST /api/friends/requests/[id]", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await POST(actReq({ action: "accept" }) as never, ctxFor("freq_bogus"));
    expect(res.status).toBe(403);
  });

  it("returns not_found (404) for an id that doesn't exist", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(
      actReq({ action: "accept" }, cookie) as never,
      ctxFor("freq_totally_made_up"),
    );
    expect(res.status).toBe(404);
  });

  it("returns not_found (404) for a real request when the caller is a third party — never leaks its existence", async () => {
    const { store } = await getContainer();
    const priya = await store.users.findByHandle("priya");
    const cookie = await sessionCookieFor(priya!.id);

    const [chaosRequest] = await store.friends.listIncomingRequests(
      (await store.users.findByHandle("dev"))!.id,
      "pending",
    );
    const res = await POST(actReq({ action: "accept" }, cookie) as never, ctxFor(chaosRequest!.id));
    expect(res.status).toBe(404);
  });

  it("returns forbidden (403) when the sender tries to accept their own request", async () => {
    const { store } = await getContainer();
    const chaosgremlin = await store.users.findByHandle("chaosgremlin");
    const cookie = await sessionCookieFor(chaosgremlin!.id);

    const outgoing = await store.friends.listOutgoingRequests(chaosgremlin!.id, "pending");
    const res = await POST(actReq({ action: "accept" }, cookie) as never, ctxFor(outgoing[0]!.id));
    expect(res.status).toBe(403);
  });

  it("returns forbidden (403) when the recipient tries to cancel an incoming request", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const incoming = await store.friends.listIncomingRequests(dev!.id, "pending");
    const chaosRequest = incoming[0]!;
    const res = await POST(actReq({ action: "cancel" }, cookie) as never, ctxFor(chaosRequest.id));
    expect(res.status).toBe(403);
  });

  it("returns validation (400) for an invalid action", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);
    const incoming = await store.friends.listIncomingRequests(dev!.id, "pending");

    const res = await POST(
      actReq({ action: "yeet" }, cookie) as never,
      ctxFor(incoming[0]!.id),
    );
    expect(res.status).toBe(400);
  });

  it("happy path: dev accepts chaosgremlin's request — friendship created atomically, sender notified", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const incoming = await store.friends.listIncomingRequests(dev!.id, "pending");
    const chaosRequest = incoming[0]!;

    const res = await POST(actReq({ action: "accept" }, cookie) as never, ctxFor(chaosRequest.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.request.status).toBe("accepted");
    expect(body.data.friendship).toBeDefined();

    const areFriends = await store.friends.areFriends(dev!.id, chaosRequest.fromId);
    expect(areFriends).toBe(true);

    const notifications = await store.notifications.listByUser(chaosRequest.fromId);
    expect(
      notifications.some((n) => n.type === "friend_request_accepted"),
    ).toBe(true);
  });

  it("returns conflict (409) accepting the same request a second time", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    // The request accepted in the previous test is now non-pending.
    const allIncoming = await Promise.all(
      (await store.friends.listIncomingRequests(dev!.id)).filter((r) => r.status === "accepted"),
    );
    const accepted = allIncoming[0]!;

    const res = await POST(actReq({ action: "accept" }, cookie) as never, ctxFor(accepted.id));
    expect(res.status).toBe(409);
  });

  it("happy path: dev declines yeetmaster's request", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);
    const yeetmaster = await store.users.findByHandle("yeetmaster");

    const pending = await store.friends.findPendingRequest(yeetmaster!.id, dev!.id);
    const res = await POST(actReq({ action: "decline" }, cookie) as never, ctxFor(pending!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.request.status).toBe("declined");
  });

  it("happy path: dev cancels the outgoing request to noodle", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);
    const noodle = await store.users.findByHandle("noodle");

    const pending = await store.friends.findPendingRequest(dev!.id, noodle!.id);
    const res = await POST(actReq({ action: "cancel" }, cookie) as never, ctxFor(pending!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.request.status).toBe("cancelled");
  });
});
