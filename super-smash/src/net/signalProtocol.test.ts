import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_BYTES,
  ROLE_PORT,
  ROOM_CLOSE_CODES,
  parseClientMessage,
  parseRoomIntent,
  parseServerMessage,
  roomErrorForCloseCode,
  type RoomError,
} from "./signalProtocol";

const CANDIDATE = "candidate:1 1 udp 2122260223 192.168.1.4 54321 typ host";

describe("client messages, as the room reads them", () => {
  it("accepts an offer, an answer and an ICE candidate", () => {
    expect(parseClientMessage(JSON.stringify({ t: "signal", payload: { kind: "offer", sdp: "v=0" } }))).toEqual({
      t: "signal",
      payload: { kind: "offer", sdp: "v=0" },
    });
    expect(parseClientMessage(JSON.stringify({ t: "signal", payload: { kind: "answer", sdp: "v=1" } }))).toEqual({
      t: "signal",
      payload: { kind: "answer", sdp: "v=1" },
    });
    expect(
      parseClientMessage(
        JSON.stringify({ t: "signal", payload: { kind: "ice", candidate: { candidate: CANDIDATE, sdpMid: "0", sdpMLineIndex: 0 } } }),
      ),
    ).toEqual({
      t: "signal",
      payload: { kind: "ice", candidate: { candidate: CANDIDATE, sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null } },
    });
  });

  it("passes lobby payloads through without understanding them", () => {
    const payload = { kind: "pick", fighterId: "fox", costume: 1 };
    expect(parseClientMessage(JSON.stringify({ t: "lobby", payload }))).toEqual({ t: "lobby", payload });
  });

  it("rejects binary frames, oversized frames, bad JSON and anything it does not know", () => {
    expect(parseClientMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseClientMessage("x".repeat(MAX_MESSAGE_BYTES + 1))).toBeNull();
    expect(parseClientMessage("{nope")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "welcome" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "signal", payload: { kind: "offer" } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "signal", payload: { kind: "ice", candidate: {} } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "lobby", payload: "pick" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "lobby", payload: { kind: "k".repeat(33) } }))).toBeNull();
  });
});

describe("server messages, as the browser reads them", () => {
  it("reads a welcome with and without somebody already in the room", () => {
    expect(parseServerMessage({ t: "welcome", self: { id: "a", role: "host" }, peer: null })).toEqual({
      t: "welcome",
      self: { id: "a", role: "host" },
      peer: null,
    });
    expect(
      parseServerMessage({ t: "welcome", self: { id: "b", role: "guest" }, peer: { id: "a", role: "host" } }),
    ).toEqual({ t: "welcome", self: { id: "b", role: "guest" }, peer: { id: "a", role: "host" } });
  });

  it("reads joins, leaves, relayed signals, lobby payloads and errors", () => {
    expect(parseServerMessage({ t: "peer-joined", peer: { id: "b", role: "guest" } })).toEqual({
      t: "peer-joined",
      peer: { id: "b", role: "guest" },
    });
    expect(parseServerMessage({ t: "peer-left", peerId: "b" })).toEqual({ t: "peer-left", peerId: "b" });
    expect(parseServerMessage({ t: "signal", from: "a", payload: { kind: "offer", sdp: "v=0" } })).toEqual({
      t: "signal",
      from: "a",
      payload: { kind: "offer", sdp: "v=0" },
    });
    expect(parseServerMessage({ t: "lobby", from: "a", payload: { kind: "away", away: true } })).toEqual({
      t: "lobby",
      from: "a",
      payload: { kind: "away", away: true },
    });
    expect(parseServerMessage({ t: "error", reason: "full" })).toEqual({ t: "error", reason: "full" });
  });

  it("rejects a malformed role, a missing sender or an unknown error", () => {
    expect(parseServerMessage({ t: "welcome", self: { id: "a", role: "boss" }, peer: null })).toBeNull();
    expect(parseServerMessage({ t: "signal", payload: { kind: "offer", sdp: "v=0" } })).toBeNull();
    expect(parseServerMessage({ t: "error", reason: "on-fire" })).toBeNull();
    expect(parseServerMessage("welcome")).toBeNull();
  });
});

describe("room vocabulary", () => {
  it("puts the host on port 0 and the guest on port 1", () => {
    expect(ROLE_PORT).toEqual({ host: 0, guest: 1 });
  });

  it("maps every close code back to its reason, and nothing else", () => {
    for (const [reason, code] of Object.entries(ROOM_CLOSE_CODES)) {
      expect(roomErrorForCloseCode(code)).toBe(reason as RoomError);
    }
    expect(roomErrorForCloseCode(1006)).toBeNull();
    expect(roomErrorForCloseCode(1000)).toBeNull();
  });

  it("reads only the two intents", () => {
    expect(parseRoomIntent("create")).toBe("create");
    expect(parseRoomIntent("join")).toBe("join");
    expect(parseRoomIntent("spectate")).toBeNull();
    expect(parseRoomIntent(null)).toBeNull();
  });
});
