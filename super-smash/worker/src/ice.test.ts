// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { STUN_ONLY } from "../../src/net/iceConfig";
import { TURN_TTL_SECONDS, iceServersFor, turnCredentialsUrl, type FetchLike } from "./ice";

/** The 201 body Cloudflare documents, including the port-53 urls browsers choke on. */
const CLOUDFLARE_201 = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "u",
      credential: "c",
    },
  ],
};

function respond(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

const ENV = { TURN_KEY_ID: "key-1", TURN_KEY_API_TOKEN: "tok" };

describe("/api/ice", () => {
  it("answers STUN-only, without calling Cloudflare, when no TURN key is set", async () => {
    const fetchFn = respond(201, CLOUDFLARE_201);
    await expect(iceServersFor({}, fetchFn)).resolves.toEqual(STUN_ONLY);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers STUN-only when only half the secret pair is set", async () => {
    const fetchFn = respond(201, CLOUDFLARE_201);
    await expect(iceServersFor({ TURN_KEY_ID: "key-1" }, fetchFn)).resolves.toEqual(STUN_ONLY);
    await expect(iceServersFor({ TURN_KEY_ID: "  ", TURN_KEY_API_TOKEN: "tok" }, fetchFn)).resolves.toEqual(STUN_ONLY);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("asks Cloudflare for one-hour credentials with the key's bearer token", async () => {
    const fetchFn = respond(201, CLOUDFLARE_201);
    await iceServersFor(ENV, fetchFn);
    expect(TURN_TTL_SECONDS).toBe(60 * 60);
    expect(turnCredentialsUrl("key-1")).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers",
    );
    expect(fetchFn).toHaveBeenCalledWith(turnCredentialsUrl("key-1"), {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 3600 }),
    });
  });

  it("returns the relay, minus the port-53 urls", async () => {
    const out = await iceServersFor(ENV, respond(201, CLOUDFLARE_201));
    expect(out.turn).toBe(true);
    const urls = out.iceServers.flatMap((s) => (typeof s.urls === "string" ? [s.urls] : [...s.urls]));
    expect(urls.some((u) => /:53(\?|$)/.test(u))).toBe(false);
    expect(out.iceServers[1]).toMatchObject({ username: "u", credential: "c" });
  });

  it("accepts a single iceServers object as well as an array", async () => {
    const single = { iceServers: { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" } };
    const out = await iceServersFor(ENV, respond(201, single));
    expect(out).toEqual({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" }], turn: true });
  });

  it("falls back to STUN when Cloudflare refuses, throws, or answers nonsense", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(iceServersFor(ENV, respond(401, { errors: [] }))).resolves.toEqual(STUN_ONLY);
    } finally {
      warn.mockRestore();
    }
    await expect(iceServersFor(ENV, respond(201, { nope: true }))).resolves.toEqual(STUN_ONLY);
    const throwing = vi.fn<FetchLike>(async () => {
      throw new Error("network down");
    });
    await expect(iceServersFor(ENV, throwing)).resolves.toEqual(STUN_ONLY);
  });

  /** The one clue `wrangler tail` gives when TURN goes dark: the status, and nothing the API sent or was sent. */
  it("logs the status of a refusal, and never the body, the key or the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await iceServersFor(ENV, respond(403, { errors: [{ message: "token tok for key-1 is not allowed" }] }));
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls[0].map(String).join(" ");
      expect(logged).toContain("403");
      expect(logged).not.toMatch(/tok|key-1|not allowed/);

      await iceServersFor(ENV, respond(201, CLOUDFLARE_201));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
