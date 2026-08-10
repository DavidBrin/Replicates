// @vitest-environment node
//
// This route verifies sessions via jose, which is jsdom-incompatible in
// this project's vitest setup — see src/adapters/auth/__tests__/demo-session.test.ts.
import { describe, expect, it } from "vitest";
import { getContainer } from "@/lib/container";
import { GET } from "@/app/api/me/route";

function meReq(cookie?: string): Request {
  return new Request("http://localhost/api/me", {
    headers: cookie ? { cookie } : {},
  });
}

describe("GET /api/me", () => {
  it("returns forbidden (403) with no session — requireUser gates the route (G5)", async () => {
    const res = await GET(meReq() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns forbidden (403) for a garbage session cookie", async () => {
    const res = await GET(meReq("bet_session=not-a-real-token") as never);
    expect(res.status).toBe(403);
  });

  it("returns the current user + groups for a valid session", async () => {
    const { store, auth } = await getContainer();
    const users = await store.users.list();
    const demoUser = users[0]!;
    const token = await auth.createSession(demoUser.id);

    const res = await GET(meReq(`bet_session=${token}`) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.user.id).toBe(demoUser.id);
    expect(body.data.user.balance).toBe(demoUser.balance);
    expect(Array.isArray(body.data.groups)).toBe(true);
  });
});
