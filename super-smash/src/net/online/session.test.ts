import { afterEach, describe, expect, it, vi } from "vitest";

import type { DataChannelLike, PeerConnectionLike } from "../adapters/doSignal";
import { STUN_ONLY } from "../iceConfig";
import type { RoomIntent } from "../signalProtocol";
import { FakeSignalling } from "../testing/fakeSignalling";
import type { OnlineMatchConfig } from "./lobby";
import { OnlineSession, ROOM_LOST_GRACE_MS, getActiveSession, setActiveSession, type SessionEvent } from "./session";

const inertChannel = (): DataChannelLike => ({
  readyState: "connecting",
  binaryType: "blob",
  onopen: null,
  onclose: null,
  onerror: null,
  onmessage: null,
  send() {},
  close() {},
});

const inertPeer = (): PeerConnectionLike => ({
  connectionState: "new",
  onicecandidate: null,
  onconnectionstatechange: null,
  createDataChannel: inertChannel,
  createOffer: async () => ({ sdp: "o" }),
  createAnswer: async () => ({ sdp: "a" }),
  setLocalDescription: async () => {},
  setRemoteDescription: async () => {},
  addIceCandidate: async () => {},
  close() {},
});

/** A data channel the test opens, as the browser does once ICE connects. */
class OpenableChannel implements DataChannelLike {
  readyState = "connecting";
  binaryType = "blob";
  onopen: DataChannelLike["onopen"] = null;
  onclose: DataChannelLike["onclose"] = null;
  onerror: DataChannelLike["onerror"] = null;
  onmessage: DataChannelLike["onmessage"] = null;
  readonly sent: Uint8Array[] = [];
  send(data: Uint8Array<ArrayBuffer>): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = "closed";
  }
  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }
  /** The channel gives up before it ever opened. */
  drop(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

const CONFIG: OnlineMatchConfig = {
  seed: 1234,
  stageId: "battlefield",
  stageForm: "omega",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};

async function open(intent: RoomIntent = "create", createPeerConnection: () => PeerConnectionLike = inertPeer) {
  const order: string[] = [];
  const signalling = new FakeSignalling();
  const session = await OnlineSession.open("ABCD", intent, {
    fetchIce: async () => {
      order.push("ice");
      return STUN_ONLY;
    },
    openSignalling: (code, i) => {
      order.push(`socket ${code} ${i}`);
      return signalling;
    },
    createPeerConnection,
  });
  const events: SessionEvent[] = [];
  session.on((event) => events.push(event));
  return { session, signalling, events, order };
}

/** A host welcomed beside a guest, so it is negotiating, over a peer connection the test drives. */
async function negotiatingHost() {
  const channel = new OpenableChannel();
  const peer = { ...inertPeer(), connectionState: "new", createDataChannel: () => channel };
  const opened = await open("create", () => peer);
  opened.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
  expect(opened.session.transport.status).toBe("negotiating");
  const fail = () => {
    peer.connectionState = "failed";
    peer.onconnectionstatechange?.();
  };
  return { ...opened, channel, fail };
}

/** A Worker deploy restarts the Durable Object and drops its sockets without a close frame. */
const ROOM_DROP = { t: "closed", code: 1006, reason: "" } as const;

const errors = (events: readonly SessionEvent[]) => events.filter((e) => e.type === "error");

afterEach(() => {
  setActiveSession(null);
  vi.useRealTimers();
});

describe("OnlineSession", () => {
  it("fetches ICE servers before it opens the room socket", async () => {
    const { order, session } = await open("join");
    expect(order).toEqual(["ice", "socket ABCD join"]);
    expect(session.turn).toBe(false);
    expect(session.roomCode).toBe("ABCD");
  });

  it("learns its role and port from the room", async () => {
    const host = await open();
    host.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    expect(host.events).toContainEqual({ type: "joined", role: "host" });
    expect(host.session.role).toBe("host");
    expect(host.session.localPort).toBe(0);

    const guest = await open("join");
    guest.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    expect(guest.session.localPort).toBe(1);
    expect(guest.events).toContainEqual({ type: "peer", present: true });
  });

  it("reports the other player arriving and leaving", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
    signalling.deliver({ t: "peer-left", peerId: "g1" });
    expect(events.filter((e) => e.type === "peer")).toEqual([
      { type: "peer", present: true },
      { type: "peer", present: false },
    ]);
    expect(events).toContainEqual({ type: "link", status: "negotiating" });
  });

  it("passes on the lobby messages it understands and drops the rest", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 1 } });
    signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "explode" } });
    expect(events).toEqual([{ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 1 } }]);
  });

  it("says why the room refused it, once", async () => {
    const { signalling, events } = await open("join");
    signalling.deliver({ t: "error", reason: "full" });
    signalling.deliver({ t: "closed", code: 4001, reason: "full" });
    expect(events).toEqual([{ type: "error", reason: "full" }]);
  });

  it("calls a Worker that is not there unreachable", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "closed", code: 1006, reason: "" });
    expect(events).toEqual([{ type: "error", reason: "unreachable" }]);
  });

  describe("when the room drops after the welcome", () => {
    it("while it waits for a peer, the room is lost at once", async () => {
      const { signalling, events } = await open();
      signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
      signalling.deliver(ROOM_DROP);
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
    });

    it("mid-match, the open channel and the match run on", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      const left: string[] = [];
      session.transport.onPeerLeave((id) => left.push(id));
      channel.open();
      expect(session.transport.status).toBe("open");

      signalling.deliver(ROOM_DROP);

      expect(errors(events)).toEqual([]);
      expect(events.filter((e) => e.type === "link").at(-1)).toEqual({ type: "link", status: "open" });
      expect(session.transport.status).toBe("open");
      expect(left).toEqual([]);
      session.transport.send(new Uint8Array([1, 2, 3]));
      expect(channel.sent).toEqual([new Uint8Array([1, 2, 3])]);
    });

    it("mid-negotiation, a channel that opens within the grace carries on", async () => {
      vi.useFakeTimers();
      const { session, signalling, channel, events } = await negotiatingHost();
      signalling.deliver(ROOM_DROP);
      vi.advanceTimersByTime(ROOM_LOST_GRACE_MS - 1);
      channel.open();
      vi.advanceTimersByTime(ROOM_LOST_GRACE_MS);
      expect(errors(events)).toEqual([]);
      expect(session.transport.status).toBe("open");
    });

    it("mid-negotiation, a channel that never opens loses the room when the grace runs out", async () => {
      vi.useFakeTimers();
      const { signalling, events } = await negotiatingHost();
      signalling.deliver(ROOM_DROP);
      vi.advanceTimersByTime(ROOM_LOST_GRACE_MS - 1);
      expect(errors(events)).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
      vi.advanceTimersByTime(ROOM_LOST_GRACE_MS);
      expect(errors(events)).toHaveLength(1);
    });

    it("once the grace has run out, a late open cannot undo the loss", async () => {
      vi.useFakeTimers();
      const { session, signalling, channel, events } = await negotiatingHost();
      signalling.deliver(ROOM_DROP);
      vi.advanceTimersByTime(ROOM_LOST_GRACE_MS);
      expect(session.transport.status).toBe("closed");
      channel.open();
      expect(events).not.toContainEqual({ type: "link", status: "open" });
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
    });

    it("a lobby message during the grace loses the room, and the negotiation with it", async () => {
      vi.useFakeTimers();
      const { session, signalling, channel, events } = await negotiatingHost();
      signalling.deliver(ROOM_DROP);
      expect(session.sendLobby({ kind: "pick", fighterId: "fox", costume: 1 })).toBe(false);
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
      expect(session.transport.status).toBe("closed");
      expect(vi.getTimerCount()).toBe(0);
      channel.open();
      expect(events).not.toContainEqual({ type: "link", status: "open" });
    });

    it("with the link already failed, the room is lost at once", async () => {
      const { signalling, events, fail } = await negotiatingHost();
      fail();
      expect(errors(events)).toEqual([]);
      signalling.deliver(ROOM_DROP);
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
    });

    it("with the channel open in the lobby, a stage or a start is not sent: the room is lost, once", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      channel.open();
      signalling.deliver(ROOM_DROP);
      expect(errors(events)).toEqual([]);
      const written = signalling.sent.length;

      expect(session.sendLobby({ kind: "stage", stageId: "battlefield", form: "normal" })).toBe(false);
      expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(false);

      expect(signalling.sent).toHaveLength(written);
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
    });

    it("with the channel open, an away is dropped without a word", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      channel.open();
      signalling.deliver(ROOM_DROP);
      const written = signalling.sent.length;
      expect(session.sendLobby({ kind: "away", away: true })).toBe(false);
      expect(signalling.sent).toHaveLength(written);
      expect(errors(events)).toEqual([]);
    });

    it("with the channel open, the channel closing loses the room, once", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      channel.open();
      signalling.deliver(ROOM_DROP);
      channel.drop();
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
      expect(session.sendLobby({ kind: "pick", fighterId: "fox", costume: 1 })).toBe(false);
      expect(errors(events)).toHaveLength(1);
    });

    it("mid-negotiation, a link that fails or falls through loses the room at once", async () => {
      vi.useFakeTimers();
      const failing = await negotiatingHost();
      failing.signalling.deliver(ROOM_DROP);
      failing.fail();
      expect(failing.events.slice(-2)).toEqual([
        { type: "link", status: "failed" },
        { type: "error", reason: "room-lost" },
      ]);

      const dropped = await negotiatingHost();
      dropped.signalling.deliver(ROOM_DROP);
      dropped.channel.drop();
      expect(errors(dropped.events)).toEqual([{ type: "error", reason: "room-lost" }]);
      // Both graces ended with their negotiations.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("close() during the grace cancels it", async () => {
      vi.useFakeTimers();
      const { session, signalling } = await negotiatingHost();
      signalling.deliver(ROOM_DROP);
      expect(vi.getTimerCount()).toBe(1);
      session.close();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("sends lobby messages through the room", async () => {
    const { session, signalling } = await open();
    expect(session.sendLobby({ kind: "away", away: true })).toBe(true);
    expect(signalling.sent.at(-1)).toEqual({ t: "lobby", payload: { kind: "away", away: true } });
  });

  it("sends a start the guest's parser will take", async () => {
    const { session, signalling, events } = await open();
    expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
    expect(signalling.sent).toEqual([{ t: "lobby", payload: { kind: "start", config: CONFIG } }]);
    expect(events).toEqual([]);
  });

  it("keeps back a start the guest would drop, and makes it the host's error", async () => {
    const { session, signalling, events } = await open();
    expect(session.sendLobby({ kind: "start", config: { ...CONFIG, fighters: ["mario", "nobody"] } })).toBe(false);
    expect(session.sendLobby({ kind: "start", config: { ...CONFIG, seed: 1.5 } })).toBe(false);
    expect(signalling.sent).toEqual([]);
    expect(events).toEqual([
      { type: "error", reason: "bad-start" },
      { type: "error", reason: "bad-start" },
    ]);
  });

  it("keeps back a start the guest would read differently, and makes it the host's error", async () => {
    const { session, signalling, events } = await open();
    // As though MatchRules grew a field the lobby parser does not read yet: the guest would play without it.
    const rules = { ...CONFIG.rules, items: true };
    const config: OnlineMatchConfig = { ...CONFIG, rules };
    expect(session.sendLobby({ kind: "start", config })).toBe(false);
    expect(signalling.sent).toEqual([]);
    expect(events).toEqual([{ type: "error", reason: "bad-start" }]);
  });

  it("close() closes the transport and the socket, and goes quiet", async () => {
    const { session, signalling, events } = await open();
    session.close();
    expect(signalling.closed).toBe(true);
    expect(session.transport.status).toBe("closed");
    expect(signalling.listenerCount).toBe(0);
    signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
    expect(events).toEqual([]);
  });

  it("replacing the active session closes the old one", async () => {
    const first = await open();
    const second = await open();
    setActiveSession(first.session);
    setActiveSession(second.session);
    expect(first.signalling.closed).toBe(true);
    expect(getActiveSession()).toBe(second.session);
    setActiveSession(null);
    expect(second.signalling.closed).toBe(true);
    expect(getActiveSession()).toBeNull();
  });
});
