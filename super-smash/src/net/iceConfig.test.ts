import { describe, expect, it } from "vitest";

import { STUN_ONLY, STUN_URL, hasTurn, parseIceResponse, withoutPort53 } from "./iceConfig";

const CLOUDFLARE_SHAPE = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
  {
    urls: [
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turn:turn.cloudflare.com:53?transport=udp",
      "turn:turn.cloudflare.com:3478?transport=tcp",
      "turns:turn.cloudflare.com:5349?transport=tcp",
      "turns:turn.cloudflare.com:443?transport=tcp",
    ],
    username: "u",
    credential: "c",
  },
];

describe("ICE configuration", () => {
  it("falls back to Cloudflare's free STUN server", () => {
    expect(STUN_URL).toBe("stun:stun.cloudflare.com:3478");
    expect(STUN_ONLY).toEqual({ iceServers: [{ urls: [STUN_URL] }], turn: false });
  });

  it("drops the port-53 urls browsers time out on, and keeps the rest", () => {
    const kept = withoutPort53(CLOUDFLARE_SHAPE);
    expect(kept[0].urls).toEqual(["stun:stun.cloudflare.com:3478"]);
    expect(kept[1].urls).toEqual([
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turn:turn.cloudflare.com:3478?transport=tcp",
      "turns:turn.cloudflare.com:5349?transport=tcp",
      "turns:turn.cloudflare.com:443?transport=tcp",
    ]);
    expect(kept[1].username).toBe("u");
  });

  it("drops a server whose only url was on port 53", () => {
    expect(withoutPort53([{ urls: "stun:stun.cloudflare.com:53" }])).toEqual([]);
  });

  it("knows whether a TURN relay is on offer", () => {
    expect(hasTurn(CLOUDFLARE_SHAPE)).toBe(true);
    expect(hasTurn(STUN_ONLY.iceServers)).toBe(false);
  });

  it("parses what the Worker returns and refuses anything else", () => {
    expect(parseIceResponse({ iceServers: CLOUDFLARE_SHAPE, turn: true })?.iceServers).toHaveLength(2);
    expect(parseIceResponse({ iceServers: [{ urls: 3 }], turn: true })).toBeNull();
    expect(parseIceResponse({ turn: true })).toBeNull();
    expect(parseIceResponse(null)).toBeNull();
  });
});
