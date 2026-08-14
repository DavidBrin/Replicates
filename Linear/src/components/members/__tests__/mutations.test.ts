import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callApi, refusalMessage } from "../mutations";

/**
 * The transport every membership mutation goes through.
 *
 * ## The assertion this file exists for
 *
 * `keepalive`. Every caller of {@link callApi} is optimistic — the row is on
 * screen before the server has been asked — and an ordinary `fetch` belongs to
 * the document that issued it. Close the tab, navigate, let a route remount,
 * and the browser cancels the request *before the server ever reads it*. The
 * UI has already shown the change, so the failure mode is not a slow save but a
 * silent lost write, with nothing on screen and nothing in the server log.
 *
 * That was a real defect here: adding somebody to a project and navigating away
 * in the same tick left no `POST /api/projects/…/members` in the server's log at
 * all, and the `project_members` row was simply absent. It is asserted at this
 * level rather than through a component because it is a property of the
 * *request*, and a component test that only checks the URL and the body — which
 * the two panel suites already do — passes either way.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callApi", () => {
  it("issues a keepalive request, so a write outlives the page that sent it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { added: true }));

    const result = await callApi("/api/projects/prj_site/members", {
      method: "POST",
      body: { userId: "usr_guest", role: "member" },
    });

    expect(result).toStrictEqual({ ok: true, value: { added: true } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/prj_site/members");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.headers).toStrictEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toStrictEqual({
      userId: "usr_guest",
      role: "member",
    });
  });

  it("keeps the request alive for a bodiless call too", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { members: [] }));

    await callApi("/api/workspaces/wsp_demo/members", { method: "GET" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.keepalive).toBe(true);
    // No content-type on a request with nothing in it — the route parses the
    // body only when there is one, and an empty JSON body is not the same thing.
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("turns a refusal into a code the UI can phrase itself", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: "A workspace must keep at least one owner.",
        code: "LAST_OWNER",
      }),
    );

    const result = await callApi("/api/workspaces/wsp_demo/members", {
      method: "PATCH",
      body: { userId: "usr_owner", role: "admin" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("LAST_OWNER");
    expect(result.failure.status).toBe(409);
    expect(refusalMessage(result.failure)).toMatch(/last owner/i);
  });

  it("reads a thrown fetch as a failure rather than an unhandled rejection", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await callApi("/api/workspaces/wsp_demo/members", {
      method: "DELETE",
      body: { userId: "usr_newcomer" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("NETWORK");
    expect(result.failure.status).toBe(0);
  });
});
