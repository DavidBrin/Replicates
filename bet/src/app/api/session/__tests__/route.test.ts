// @vitest-environment node
//
// This route signs sessions via jose, which is jsdom-incompatible in this
// project's vitest setup — see src/adapters/auth/__tests__/demo-session.test.ts.
import { describe, expect, it } from "vitest";
import { getContainer } from "@/lib/container";
import { DELETE, POST } from "@/app/api/session/route";

/** G8: routes are tested by calling the exported handler functions directly
 * with a `Request` — no dev server, no `NextRequest` construction needed
 * (handler()'s wrapper accepts a plain Request-shaped object fine, since it
 * never calls anything NextRequest-specific on `req` itself here). */
function postSessionReq(body: unknown): Request {
  return new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST/DELETE /api/session", () => {
  it("signs in as a known seeded demo user: sets bet_session and returns the user", async () => {
    const { store } = await getContainer();
    const users = await store.users.list();
    expect(users.length).toBeGreaterThan(0);
    const demoUser = users[0]!;

    const res = await POST(postSessionReq({ userId: demoUser.id }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.user.id).toBe(demoUser.id);
    expect(body.data.user.handle).toBe(demoUser.handle);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("bet_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).toContain("path=/");
  });

  it("returns not_found (404) for an unknown userId", async () => {
    const res = await POST(postSessionReq({ userId: "usr_totally_made_up" }) as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns validation (400) when userId is missing", async () => {
    const res = await POST(postSessionReq({}) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
    expect(body.error.fields).toBeDefined();
  });

  it("DELETE clears the cookie and always succeeds", async () => {
    const req = new Request("http://localhost/api/session", { method: "DELETE" });
    const res = await DELETE(req as never);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("bet_session=");
    // Cleared cookies carry Max-Age=0 (or an epoch Expires) — either way the
    // browser drops it immediately.
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=/);
  });
});
