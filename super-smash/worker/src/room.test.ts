// @vitest-environment node
import { describe, expect, it } from "vitest";

import { MAX_MESSAGES_PER_PEER, ROOM_CLOSE_CODES, type PeerInfo } from "../../src/net/signalProtocol";
import { decideJoin, departures, relay, type PeerAttachment } from "./room";

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

describe("leaving", () => {
  it("tells whoever is left", () => {
    expect(departures(guest, [host, guest])).toEqual([{ to: "h1", message: { t: "peer-left", peerId: "g1" } }]);
  });

  it("tells nobody when the room is now empty", () => {
    expect(departures(host, [host])).toEqual([]);
  });
});
