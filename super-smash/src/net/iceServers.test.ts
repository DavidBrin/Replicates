import { describe, expect, it, vi } from "vitest";

import { STUN_ONLY } from "./iceConfig";
import { ICE_ENDPOINT, fetchIceServers, toRtcIceServers, type IceFetch } from "./iceServers";

const TURN = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp"], username: "u", credential: "c" },
  ],
  turn: true,
};

function answering(ok: boolean, body: unknown) {
  return vi.fn<IceFetch>(async () => ({ ok, json: async () => body }));
}

describe("fetchIceServers", () => {
  it("asks the Worker, uncached", async () => {
    const fetchFn = answering(true, STUN_ONLY);
    await fetchIceServers(fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(ICE_ENDPOINT, expect.objectContaining({ cache: "no-store" }));
  });

  it("returns the relay when the Worker has one, minus port 53", async () => {
    const out = await fetchIceServers(answering(true, TURN));
    expect(out.turn).toBe(true);
    expect(out.iceServers[1].urls).toEqual(["turn:turn.cloudflare.com:3478?transport=udp"]);
  });

  it("does not claim a relay once port 53 was the only TURN url", async () => {
    const only53 = {
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478"] },
        { urls: ["turn:turn.cloudflare.com:53?transport=udp"], username: "u", credential: "c" },
      ],
      turn: true,
    };
    const out = await fetchIceServers(answering(true, only53));
    expect(out.turn).toBe(false);
    expect(out.iceServers).toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
  });

  it("falls back to STUN when there is no Worker (plain next dev answers 404)", async () => {
    await expect(fetchIceServers(answering(false, "<html>"))).resolves.toEqual(STUN_ONLY);
  });

  it("falls back to STUN when the request throws or the body is junk", async () => {
    const throwing = vi.fn<IceFetch>(async () => {
      throw new Error("offline");
    });
    await expect(fetchIceServers(throwing)).resolves.toEqual(STUN_ONLY);
    await expect(fetchIceServers(answering(true, { iceServers: "nope" }))).resolves.toEqual(STUN_ONLY);
  });

  it("gives up after the timeout instead of holding the lobby", async () => {
    const hanging: IceFetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(fetchIceServers(hanging, 5)).resolves.toEqual(STUN_ONLY);
  });

  it("hands RTCPeerConnection plain, mutable arrays", () => {
    const servers = toRtcIceServers({ iceServers: [{ urls: ["turn:x:3478"], username: "u", credential: "c" }], turn: true });
    expect(servers).toEqual([{ urls: ["turn:x:3478"], username: "u", credential: "c" }]);
    expect(toRtcIceServers(STUN_ONLY)).toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
  });
});
