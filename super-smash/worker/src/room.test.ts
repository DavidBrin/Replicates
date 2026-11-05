// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGES_PER_PEER,
  RELAY_BURST,
  RELAY_ID_BYTES,
  RELAY_KICK_DROPS,
  RELAY_MAX_FRAME_BYTES,
  RELAY_MAX_FRAMES_PER_SOCKET,
  RELAY_RATE_PER_SECOND,
  ROOM_CLOSE_CODES,
  type PeerInfo,
} from "../../src/net/signalProtocol";
import {
  decideJoin,
  departures,
  livePeerFor,
  newRelayBucket,
  peerIdBytes,
  relay,
  relayGameFrame,
  type PeerAttachment,
} from "./room";

const host: PeerInfo = { id: "h1", role: "host" };
const guest: PeerInfo = { id: "g1", role: "guest" };
const attach = (peer: PeerInfo, received = 0): PeerAttachment => ({ ...peer, received });
const offer = JSON.stringify({ t: "signal", payload: { kind: "offer", sdp: "v=0" } });

describe("joining a room", () => {
  it("makes whoever creates an empty room the host", () => {
    expect(decideJoin([], "create", "h1")).toEqual({
      type: "admit",
      peer: host,
      welcome: { t: "welcome", self: host, peer: null },
      notify: null,
    });
  });

  it("makes the second arrival the guest, and tells the host", () => {
    expect(decideJoin([host], "join", "g1")).toEqual({
      type: "admit",
      peer: guest,
      welcome: { t: "welcome", self: guest, peer: host },
      notify: { to: "h1", message: { t: "peer-joined", peer: guest } },
    });
  });

  it("turns a third peer away with 'full' and leaves the two alone", () => {
    expect(decideJoin([host, guest], "join", "x1")).toEqual({
      type: "reject",
      reason: "full",
      closeCode: ROOM_CLOSE_CODES.full,
      message: { t: "error", reason: "full" },
    });
    expect(decideJoin([host, guest], "create", "x1")).toMatchObject({ type: "reject", reason: "full" });
  });

  it("refuses to create a room somebody is already in", () => {
    expect(decideJoin([host], "create", "h2")).toMatchObject({ type: "reject", reason: "taken" });
  });

  it("refuses to join a room nobody created, which is what a mistyped code looks like", () => {
    expect(decideJoin([], "join", "g1")).toMatchObject({ type: "reject", reason: "not-found" });
  });

  it("never leaks the room's own bookkeeping into a welcome", () => {
    const attachment = { ...host, received: 41 };
    const decision = decideJoin([attachment], "join", "g1");
    expect(decision.type === "admit" && decision.welcome.t === "welcome" ? decision.welcome.peer : null).toEqual(host);
  });

  it("hands the host seat to a newcomer if the host left first", () => {
    expect(decideJoin([guest], "join", "h2")).toMatchObject({ type: "admit", peer: { id: "h2", role: "host" } });
  });
});

describe("relaying", () => {
  it("forwards a signal to the other peer, stamped with who sent it", () => {
    expect(relay(attach(host), offer, [host, guest])).toEqual({
      type: "forward",
      delivery: { to: "g1", message: { t: "signal", from: "h1", payload: { kind: "offer", sdp: "v=0" } } },
    });
  });

  it("forwards a guest's request to renegotiate to the host", () => {
    const renegotiate = JSON.stringify({ t: "signal", payload: { kind: "renegotiate" } });
    expect(relay(attach(guest), renegotiate, [host, guest])).toEqual({
      type: "forward",
      delivery: { to: "h1", message: { t: "signal", from: "g1", payload: { kind: "renegotiate" } } },
    });
  });

  it("cannot be talked into a forged sender", () => {
    const forged = JSON.stringify({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 0 } });
    expect(relay(attach(host), forged, [host, guest])).toEqual({
      type: "forward",
      delivery: { to: "g1", message: { t: "lobby", from: "h1", payload: { kind: "pick", fighterId: "fox", costume: 0 } } },
    });
  });

  it("answers garbage with bad-message instead of passing it on", () => {
    const bad = { type: "reply", message: { t: "error", reason: "bad-message" } };
    expect(relay(attach(host), "{nope", [host, guest])).toEqual(bad);
    expect(relay(attach(host), new ArrayBuffer(8), [host, guest])).toEqual(bad);
  });

  it("drops a message when nobody else is in the room", () => {
    expect(relay(attach(host), offer, [host])).toEqual({ type: "drop" });
  });

  it("closes a socket that floods the room", () => {
    expect(relay(attach(host, MAX_MESSAGES_PER_PEER), offer, [host, guest])).toEqual({
      type: "kick",
      reason: "too-many-messages",
      closeCode: ROOM_CLOSE_CODES["too-many-messages"],
      message: { t: "error", reason: "too-many-messages" },
    });
  });
});

describe("relaying game frames", () => {
  const sender = (): Uint8Array => peerIdBytes("h1abcd12");
  const frameOf = (bytes: number): ArrayBuffer => new ArrayBuffer(bytes);

  it("stamps a game frame with its sender and passes the bytes on unread", () => {
    // Not JSON on purpose: the room must not care what is in it.
    const payload = new Uint8Array([0xff, 0x7b, 0x6e, 0x00, 0x01]).buffer;
    const outcome = relayGameFrame(sender(), payload, newRelayBucket(0), 0);
    expect(outcome.type).toBe("forward");
    if (outcome.type !== "forward") return;
    expect(new TextDecoder().decode(outcome.frame.subarray(0, RELAY_ID_BYTES))).toBe("h1abcd12");
    expect([...outcome.frame.subarray(RELAY_ID_BYTES)]).toEqual([0xff, 0x7b, 0x6e, 0x00, 0x01]);
    expect(outcome.frame.length).toBe(RELAY_ID_BYTES + 5);
  });

  it("lets RELAY_BURST frames through at once, drops the next, and refills at RELAY_RATE_PER_SECOND", () => {
    const bucket = newRelayBucket(0);
    expect(bucket.tokens).toBe(RELAY_BURST);
    const frame = new Uint8Array([1]).buffer;
    const runAt = (nowMs: number, count: number): string[] =>
      Array.from({ length: count }, () => relayGameFrame(sender(), frame, bucket, nowMs).type);
    expect(runAt(0, RELAY_BURST).every((type) => type === "forward")).toBe(true);
    expect(runAt(0, 1)).toEqual(["drop"]);
    expect(runAt(1000, RELAY_RATE_PER_SECOND).every((type) => type === "forward")).toBe(true);
    expect(runAt(1000, 1)).toEqual(["drop"]);
    // A long quiet spell refills to the burst and no further.
    expect(runAt(100_000, RELAY_BURST).every((type) => type === "forward")).toBe(true);
    expect(runAt(100_000, 1)).toEqual(["drop"]);
  });

  it("closes a socket with too-many-messages on its next frame over the rate once RELAY_KICK_DROPS have been dropped", () => {
    expect(RELAY_KICK_DROPS).toBe(4 * RELAY_BURST);
    const bucket = newRelayBucket(0);
    const frame = new Uint8Array([1]).buffer;
    const runAt = (nowMs: number, count: number): string[] =>
      Array.from({ length: count }, () => relayGameFrame(sender(), frame, bucket, nowMs).type);
    expect(runAt(0, RELAY_BURST).every((type) => type === "forward")).toBe(true);
    expect(runAt(0, RELAY_KICK_DROPS).every((type) => type === "drop")).toBe(true);
    expect(relayGameFrame(sender(), frame, bucket, 0)).toEqual({
      type: "kick",
      reason: "too-many-messages",
      closeCode: ROOM_CLOSE_CODES["too-many-messages"],
      message: { t: "error", reason: "too-many-messages" },
    });
  });

  it("only drops a frame over the rate while fewer than RELAY_KICK_DROPS have been dropped", () => {
    const bucket = newRelayBucket(0);
    const frame = new Uint8Array([1]).buffer;
    const runAt = (nowMs: number, count: number): string[] =>
      Array.from({ length: count }, () => relayGameFrame(sender(), frame, bucket, nowMs).type);
    expect(runAt(0, RELAY_BURST).every((type) => type === "forward")).toBe(true);
    expect(runAt(0, RELAY_KICK_DROPS - 1).every((type) => type === "drop")).toBe(true);
    // The RELAY_KICK_DROPS-th drop is still a drop; only the frame after it is kicked.
    expect(runAt(0, 1)).toEqual(["drop"]);
  });

  it("forgets the drops once the bucket refills to full, but not on a partial refill", () => {
    const bucket = newRelayBucket(0);
    const frame = new Uint8Array([1]).buffer;
    const runAt = (nowMs: number, count: number): string[] =>
      Array.from({ length: count }, () => relayGameFrame(sender(), frame, bucket, nowMs).type);
    const fullMs = (RELAY_BURST / RELAY_RATE_PER_SECOND) * 1000;
    runAt(0, RELAY_BURST);
    expect(runAt(0, RELAY_KICK_DROPS).every((type) => type === "drop")).toBe(true);
    // A full refill: the count starts again, and a whole burst plus RELAY_KICK_DROPS drops pass unkicked.
    expect(runAt(fullMs, RELAY_BURST).every((type) => type === "forward")).toBe(true);
    expect(runAt(fullMs, RELAY_KICK_DROPS).every((type) => type === "drop")).toBe(true);
    // A partial refill (one token short of full) keeps the count, so the next frame over the rate is kicked.
    const partialMs = fullMs + ((RELAY_BURST - 1) / RELAY_RATE_PER_SECOND) * 1000;
    expect(runAt(partialMs, RELAY_BURST - 1).every((type) => type === "forward")).toBe(true);
    expect(runAt(partialMs, 1)).toEqual(["kick"]);
  });

  it("closes a socket with too-many-messages on its next game frame once it has sent RELAY_MAX_FRAMES_PER_SOCKET", () => {
    expect(RELAY_MAX_FRAMES_PER_SOCKET).toBe(60 * 60 * 30);
    const bucket = newRelayBucket(0);
    bucket.frames = RELAY_MAX_FRAMES_PER_SOCKET;
    expect(relayGameFrame(sender(), new Uint8Array([1]).buffer, bucket, 0)).toEqual({
      type: "kick",
      reason: "too-many-messages",
      closeCode: ROOM_CLOSE_CODES["too-many-messages"],
      message: { t: "error", reason: "too-many-messages" },
    });
  });

  it("forwards a socket's game frames up to RELAY_MAX_FRAMES_PER_SOCKET, counting each one", () => {
    const bucket = newRelayBucket(0);
    expect(bucket.frames).toBe(0);
    relayGameFrame(sender(), new Uint8Array([1]).buffer, bucket, 0);
    expect(bucket.frames).toBe(1);
    bucket.frames = RELAY_MAX_FRAMES_PER_SOCKET - 1;
    // The last frame of the allowance goes through; only the one after it is kicked.
    expect(relayGameFrame(sender(), new Uint8Array([1]).buffer, bucket, 0).type).toBe("forward");
    expect(relayGameFrame(sender(), new Uint8Array([1]).buffer, bucket, 0).type).toBe("kick");
  });

  it("closes a socket whose game frame is over RELAY_MAX_FRAME_BYTES, and forwards one exactly at it", () => {
    expect(relayGameFrame(sender(), frameOf(RELAY_MAX_FRAME_BYTES + 1), newRelayBucket(0), 0)).toEqual({
      type: "kick",
      reason: "bad-message",
      closeCode: ROOM_CLOSE_CODES["bad-message"],
      message: { t: "error", reason: "bad-message" },
    });
    expect(relayGameFrame(sender(), frameOf(RELAY_MAX_FRAME_BYTES), newRelayBucket(0), 0).type).toBe("forward");
    expect(relayGameFrame(sender(), frameOf(0), newRelayBucket(0), 0)).toEqual({ type: "drop" });
  });

  it("refuses a peer id that is not RELAY_ID_BYTES long", () => {
    expect(peerIdBytes("h1abcd12")).toHaveLength(RELAY_ID_BYTES);
    expect(() => peerIdBytes("abc")).toThrow();
    expect(() => peerIdBytes("h1abcd1")).toThrow();
    expect(() => peerIdBytes("h1abcd123")).toThrow();
  });

  it("builds a relay entry only for an admitted peer with a well-formed id, and never throws", () => {
    expect(livePeerFor(null, 0)).toBeNull();
    expect(livePeerFor(attach({ ...host, id: "abc" }), 0)).toBeNull();
    const entry = livePeerFor(attach({ ...host, id: "h1abcd12" }), 0);
    expect(entry?.id).toBe("h1abcd12");
    expect(entry?.idBytes.length).toBe(RELAY_ID_BYTES);
    expect(entry?.bucket).toEqual(newRelayBucket(0));
    expect(entry?.bucket.tokens).toBe(RELAY_BURST);
  });
});

describe("leaving", () => {
  it("tells whoever is left", () => {
    expect(departures(guest, [host, guest])).toEqual([{ to: "h1", message: { t: "peer-left", peerId: "g1" } }]);
  });

  it("tells nobody when the room is now empty", () => {
    expect(departures(host, [host])).toEqual([]);
  });
});
