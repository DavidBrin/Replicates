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
  ROOM_CAPACITY,
  decideJoin,
  departures,
  livePeerFor,
  newRelayBucket,
  peerIdBytes,
  relay,
  relayGameFrame,
  type PeerAttachment,
} from "./room";

const host: PeerInfo = { id: "h1", role: "host", port: 0 };
const guest: PeerInfo = { id: "g1", role: "guest", port: 1 };
const third: PeerInfo = { id: "t1", role: "guest", port: 2 };
const attach = (peer: PeerInfo, received = 0): PeerAttachment => ({ ...peer, received });
const offer = JSON.stringify({ t: "signal", payload: { kind: "offer", sdp: "v=0" } });

describe("joining a room", () => {
  it("makes whoever creates an empty room the host, on port 0", () => {
    expect(decideJoin([], "create", "h1")).toEqual({
      type: "admit",
      peer: host,
      welcome: { t: "welcome", self: host, peers: [], peer: null },
      notify: [],
    });
  });

  it("makes the second arrival the guest, on port 1, and tells the host", () => {
    expect(decideJoin([host], "join", "g1")).toEqual({
      type: "admit",
      peer: guest,
      welcome: { t: "welcome", self: guest, peers: [host], peer: host },
      notify: [{ to: "h1", message: { t: "peer-joined", peer: guest } }],
    });
  });

  it("gives each newcomer the lowest free port, and the host seat to whoever takes port 0", () => {
    const seat = (existing: readonly PeerInfo[], id: string): PeerInfo => {
      const decision = decideJoin(existing, existing.length === 0 ? "create" : "join", id, 4);
      if (decision.type !== "admit") throw new Error(`${id} was refused: ${decision.reason}`);
      return decision.peer;
    };
    const room: PeerInfo[] = [];
    for (const [id, port] of [["p0", 0], ["p1", 1], ["p2", 2], ["p3", 3]] as const) {
      const peer = seat(room, id);
      expect(peer).toEqual({ id, role: port === 0 ? "host" : "guest", port });
      room.push(peer);
    }
    // A seat that empties is the next one filled, whichever port it was.
    const withoutPortOne = room.filter((p) => p.port !== 1);
    expect(seat(withoutPortOne, "n1")).toEqual({ id: "n1", role: "guest", port: 1 });
    const withoutPortTwo = room.filter((p) => p.port !== 2);
    expect(seat(withoutPortTwo, "n2")).toEqual({ id: "n2", role: "guest", port: 2 });
    // The host's port empties: its seat, and the host role with it, go to the next arrival.
    const withoutHost = room.filter((p) => p.port !== 0);
    expect(seat(withoutHost, "n0")).toEqual({ id: "n0", role: "host", port: 0 });
    // With both ports 0 and 1 free, the lowest goes first.
    expect(seat(room.filter((p) => p.port >= 2), "n01")).toEqual({ id: "n01", role: "host", port: 0 });
  });

  it("lists the others in a welcome by port, whatever order the room holds them in", () => {
    const decision = decideJoin([third, host, guest], "join", "x1", 4);
    expect(decision).toMatchObject({ type: "admit", peer: { id: "x1", port: 3 } });
    expect(decision.type === "admit" ? decision.welcome : null).toEqual({
      t: "welcome",
      self: { id: "x1", role: "guest", port: 3 },
      peers: [host, guest, third],
      peer: host,
    });
  });

  it("tells every peer already seated that somebody joined", () => {
    const decision = decideJoin([host, guest, third], "join", "x1", 4);
    const newcomer: PeerInfo = { id: "x1", role: "guest", port: 3 };
    expect(decision.type === "admit" ? decision.notify : null).toEqual([
      { to: "h1", message: { t: "peer-joined", peer: newcomer } },
      { to: "g1", message: { t: "peer-joined", peer: newcomer } },
      { to: "t1", message: { t: "peer-joined", peer: newcomer } },
    ]);
  });

  /**
   * A tab opened before this release reads a welcome as `{ self, peer }` and
   * drops one without a `peer` it understands, so it would wait on "Connecting
   * to room ABCD..." for good. Sent the old field it reaches the hello, which
   * refuses it with the build-mismatch notice. Drop this with the field, after Plan 7.
   */
  it("also sends the old welcome's peer field, so a tab from before this release reaches the build check", () => {
    // What the previous release's parser needed of a welcome (signalProtocol.ts at 34c0788).
    const isPeer = (p: unknown): boolean =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as { id?: unknown }).id === "string" &&
      ((p as { role?: unknown }).role === "host" || (p as { role?: unknown }).role === "guest");
    const oldReaderAccepts = (w: object): boolean => {
      const { self, peer } = w as { self?: unknown; peer?: unknown };
      return isPeer(self) && (peer === null || isPeer(peer));
    };
    const welcomeOf = (existing: readonly PeerInfo[], capacity?: number): object => {
      const decision = decideJoin(existing, existing.length === 0 ? "create" : "join", "x1", capacity);
      if (decision.type !== "admit") throw new Error("refused");
      return decision.welcome;
    };

    const creator = welcomeOf([]);
    expect(creator).toMatchObject({ peer: null });
    expect(oldReaderAccepts(creator)).toBe(true);
    const joiner = welcomeOf([host]);
    expect(joiner).toMatchObject({ peer: host });
    expect(oldReaderAccepts(joiner)).toBe(true);
    // With more seated than the old room could hold, the old field is the first of the new list.
    expect(welcomeOf([third, guest, host], 4)).toMatchObject({ peer: host });
  });

  /** Plan 7, Phase B: a room holds four, and the capacity parameter still moves the line. */
  it("seats four and turns a fifth away with full", () => {
    expect(ROOM_CAPACITY).toBe(4);
    expect(decideJoin([host, guest], "join", "t1")).toMatchObject({ type: "admit", peer: third });
    const fourth: PeerInfo = { id: "f1", role: "guest", port: 3 };
    expect(decideJoin([host, guest, third], "join", "f1")).toMatchObject({ type: "admit", peer: fourth });
    expect(decideJoin([host, guest, third, fourth], "join", "x1")).toEqual({
      type: "reject",
      reason: "full",
      closeCode: ROOM_CLOSE_CODES.full,
      message: { t: "error", reason: "full" },
    });
    expect(decideJoin([host, guest, third, fourth], "create", "x1")).toMatchObject({ type: "reject", reason: "full" });
    expect(decideJoin([host, guest], "join", "x1", 2)).toMatchObject({ type: "reject", reason: "full" });
  });

  it("refuses to create a room somebody is already in", () => {
    expect(decideJoin([host], "create", "h2")).toMatchObject({ type: "reject", reason: "taken" });
  });

  it("refuses to join a room nobody created, which is what a mistyped code looks like", () => {
    expect(decideJoin([], "join", "g1")).toMatchObject({ type: "reject", reason: "not-found" });
  });

  it("never leaks the room's own bookkeeping into a welcome or a join notice", () => {
    const attachment = { ...host, received: 41 };
    const decision = decideJoin([attachment], "join", "g1");
    expect(decision.type === "admit" && decision.welcome.t === "welcome" ? decision.welcome.peers : null).toEqual([host]);
    expect(decision.type === "admit" ? decision.notify : null).toEqual([
      { to: "h1", message: { t: "peer-joined", peer: guest } },
    ]);
  });

  it("hands the host seat, port 0, to a newcomer if the host left first", () => {
    expect(decideJoin([guest], "join", "h2")).toMatchObject({
      type: "admit",
      peer: { id: "h2", role: "host", port: 0 },
    });
  });
});

describe("relaying", () => {
  it("forwards a signal to the other peer, stamped with who sent it", () => {
    expect(relay(attach(host), offer, [host, guest])).toEqual({
      type: "forward",
      deliveries: [{ to: "g1", message: { t: "signal", from: "h1", payload: { kind: "offer", sdp: "v=0" } } }],
    });
  });

  it("forwards a guest's request to renegotiate to the host", () => {
    const renegotiate = JSON.stringify({ t: "signal", payload: { kind: "renegotiate" } });
    expect(relay(attach(guest), renegotiate, [host, guest])).toEqual({
      type: "forward",
      deliveries: [{ to: "h1", message: { t: "signal", from: "g1", payload: { kind: "renegotiate" } } }],
    });
  });

  it("cannot be talked into a forged sender", () => {
    const forged = JSON.stringify({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 0 } });
    expect(relay(attach(host), forged, [host, guest])).toEqual({
      type: "forward",
      deliveries: [
        { to: "g1", message: { t: "lobby", from: "h1", payload: { kind: "pick", fighterId: "fox", costume: 0 } } },
      ],
    });
  });

  it("delivers an unaddressed message to every other peer", () => {
    expect(relay(attach(guest), offer, [host, guest, third])).toEqual({
      type: "forward",
      deliveries: [
        { to: "h1", message: { t: "signal", from: "g1", payload: { kind: "offer", sdp: "v=0" } } },
        { to: "t1", message: { t: "signal", from: "g1", payload: { kind: "offer", sdp: "v=0" } } },
      ],
    });
  });

  it("delivers an addressed message to that peer alone, and drops one addressed to nobody seated or to the sender itself", () => {
    const room = [host, guest, third];
    const addressed = (t: "signal" | "lobby", to: string): string =>
      JSON.stringify({ t, to, payload: t === "signal" ? { kind: "offer", sdp: "v=0" } : { kind: "pick" } });
    // To one peer, and not to the other: the sender is stamped, the address is not passed on.
    expect(relay(attach(host), addressed("signal", "t1"), room)).toEqual({
      type: "forward",
      deliveries: [{ to: "t1", message: { t: "signal", from: "h1", payload: { kind: "offer", sdp: "v=0" } } }],
    });
    expect(relay(attach(host), addressed("lobby", "g1"), room)).toEqual({
      type: "forward",
      deliveries: [{ to: "g1", message: { t: "lobby", from: "h1", payload: { kind: "pick" } } }],
    });
    // Nobody seated by that id (a peer that left, or one that never was).
    expect(relay(attach(host), addressed("signal", "gone0001"), room)).toEqual({ type: "drop" });
    expect(relay(attach(host), addressed("lobby", "gone0001"), room)).toEqual({ type: "drop" });
    // The sender itself is not a recipient: it is dropped, not echoed and not widened to the others.
    expect(relay(attach(host), addressed("signal", "h1"), room)).toEqual({ type: "drop" });
    expect(relay(attach(guest), addressed("lobby", "g1"), room)).toEqual({ type: "drop" });
  });

  it("refuses an address that is not a peer id's shape with bad-message, as it does any other garbage", () => {
    const bad = { type: "reply", message: { t: "error", reason: "bad-message" } };
    for (const to of [5, null, "", "x".repeat(17)]) {
      expect(relay(attach(host), JSON.stringify({ t: "signal", to, payload: { kind: "offer", sdp: "v=0" } }), [host, guest])).toEqual(bad);
    }
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
