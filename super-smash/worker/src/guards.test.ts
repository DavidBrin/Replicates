// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { refusal } from "./guards";

const ICE = "https://david-smash.example.workers.dev/api/ice";
const ROOM = "https://david-smash.example.workers.dev/ws/room/ABCD?intent=create";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

/** A limiter that answers as told, and records what it was asked. */
function limiter(success: boolean) {
  return { limit: vi.fn<RateLimit["limit"]>(async () => ({ success })) };
}

function expectNoCors(response: Response | null) {
  expect([...(response?.headers.keys() ?? [])].filter((name) => name.startsWith("access-control-"))).toEqual([]);
}

describe("/api/ice, from this site only", () => {
  it("serves a fetch from a page on this Worker", async () => {
    await expect(refusal({}, request(ICE, { "Sec-Fetch-Site": "same-origin" }), "ice")).resolves.toBeNull();
  });

  it("turns away a page on another site, without a CORS header", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const refused = await refusal({}, request(ICE, { "Sec-Fetch-Site": site, Origin: "https://elsewhere.example" }), "ice");
      expect(refused?.status).toBe(403);
      expectNoCors(refused);
    }
  });

  it("turns away an Origin that is not this Worker's, when the browser sent no Sec-Fetch-Site", async () => {
    const refused = await refusal({}, request(ICE, { Origin: "https://elsewhere.example" }), "ice");
    expect(refused?.status).toBe(403);
    expectNoCors(refused);
    await expect(refusal({}, request(ICE, { Origin: "https://david-smash.example.workers.dev" }), "ice")).resolves.toBeNull();
  });

  /** curl and the e2e relay precheck send neither header; the check is hygiene, not authentication. */
  it("serves a request that is not from a page at all", async () => {
    await expect(refusal({}, request(ICE), "ice")).resolves.toBeNull();
  });
});

describe("the rate limit on /api/ice and the room sockets", () => {
  it.each([
    ["ice", ICE],
    ["room", ROOM],
  ] as const)("answers 429 once the address has asked too often (%s)", async (route, url) => {
    const RATE_LIMITER = limiter(false);
    const refused = await refusal({ RATE_LIMITER }, request(url, { "cf-connecting-ip": "203.0.113.7" }), route);
    expect(refused?.status).toBe(429);
    expectNoCors(refused);
    expect(RATE_LIMITER.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("serves the address while it is under the limit", async () => {
    const RATE_LIMITER = limiter(true);
    await expect(refusal({ RATE_LIMITER }, request(ROOM, { "cf-connecting-ip": "203.0.113.7" }), "room")).resolves.toBeNull();
    expect(RATE_LIMITER.limit).toHaveBeenCalledTimes(1);
  });

  /** The binding is optional: it comes out of wrangler.jsonc if the plan refuses it. */
  it("serves everyone when no limiter is bound", async () => {
    await expect(refusal({}, request(ICE, { "cf-connecting-ip": "203.0.113.7" }), "ice")).resolves.toBeNull();
    await expect(refusal({}, request(ROOM, { "cf-connecting-ip": "203.0.113.7" }), "room")).resolves.toBeNull();
  });

  /** A limiter outage must never take the game down with it. */
  it("serves the request when the limiter throws, and logs only the error's name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const RATE_LIMITER = {
        limit: vi.fn<RateLimit["limit"]>(async () => {
          throw new TypeError("quota store said no to 203.0.113.7");
        }),
      };
      await expect(refusal({ RATE_LIMITER }, request(ROOM, { "cf-connecting-ip": "203.0.113.7" }), "room")).resolves.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls[0].map(String).join(" ");
      expect(logged).toContain("TypeError");
      expect(logged).not.toMatch(/quota store|203\.0\.113\.7/);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not count a page from another site against the address", async () => {
    const RATE_LIMITER = limiter(true);
    const refused = await refusal(
      { RATE_LIMITER },
      request(ICE, { "Sec-Fetch-Site": "cross-site", "cf-connecting-ip": "203.0.113.7" }),
      "ice",
    );
    expect(refused?.status).toBe(403);
    expect(RATE_LIMITER.limit).not.toHaveBeenCalled();
  });
});
