import { afterEach, describe, expect, it, vi } from "vitest";

import { NEGOTIATION_TIMEOUT_MS, type PeerConnectionLike } from "../adapters/doSignal";
import { STUN_ONLY } from "../iceConfig";
import type { RoomIntent } from "../signalProtocol";
import { OpenableChannel, inertPeer } from "../testing/fakePeer";
import { PROTOCOL_VERSION, PacketType, encodePacket } from "../packet";
import { encodeRelayBatch } from "../relayFrame";
import { FakeSignalling } from "../testing/fakeSignalling";
import type { OnlineMatchConfig } from "./lobby";
import {
  GUEST_REOFFER_WAIT_MS,
  OnlineSession,
  REOFFER_DELAYS_MS,
  ROOM_LOST_GRACE_MS,
  getActiveSession,
  setActiveSession,
  type SessionEvent,
} from "./session";

const CONFIG: OnlineMatchConfig = {
  seed: 1234,
  stageId: "battlefield",
  stageForm: "omega",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
  controls: [0, 0],
  build: "0123456789ab",
  protocol: PROTOCOL_VERSION,
  bones: "0123abcd",
  engineRules: "4567ef01",
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
  opened.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [{ id: "g1", role: "guest", port: 1 }] });
  expect(opened.session.transport.status).toBe("negotiating");
  const fail = () => {
    peer.connectionState = "failed";
    peer.onconnectionstatechange?.();
  };
  return { ...opened, channel, fail };
}

/** Every peer connection the session builds gets a channel of its own, which the test opens or drops. */
async function opened(intent: RoomIntent) {
  const channels: OpenableChannel[] = [];
  const session = await open(intent, () => {
    const channel = new OpenableChannel();
    channels.push(channel);
    return { ...inertPeer(), createDataChannel: () => channel };
  });
  const offers = () => session.signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "offer").length;
  return { ...session, channels, offers };
}

/** A host welcomed beside a guest, with its first offer out, on fake timers. */
async function hostMeetingGuest() {
  vi.useFakeTimers();
  const h = await opened("create");
  h.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [{ id: "g1", role: "guest", port: 1 }] });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.offers()).toBe(1);
  return h;
}

/** A guest that answered its host's first offer and then followed it onto the relay, on fake timers. */
async function relayedGuest() {
  vi.useFakeTimers();
  const g = await opened("join");
  g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
  g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
  await vi.advanceTimersByTimeAsync(0);
  g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "use-relay" } });
  expect(g.session.transport.status).toBe("open");
  return g;
}

const useRelays = (signalling: FakeSignalling) =>
  signalling.sent.filter((m) => m.t === "lobby" && m.payload.kind === "use-relay").length;

const renegotiates = (signalling: FakeSignalling) =>
  signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "renegotiate");

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
    host.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [] });
    expect(host.events).toContainEqual({ type: "joined", role: "host" });
    expect(host.session.role).toBe("host");
    expect(host.session.seatPort).toBe(0);

    const guest = await open("join");
    guest.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
    expect(guest.session.seatPort).toBe(1);
    expect(guest.events).toContainEqual({ type: "peer", present: true, peer: { id: "h1", role: "host", port: 0 } });
  });

  it("reports the other player arriving and leaving", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [] });
    signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest", port: 1 } });
    signalling.deliver({ t: "peer-left", peerId: "g1" });
    expect(events.filter((e) => e.type === "peer")).toEqual([
      { type: "peer", present: true, peer: { id: "g1", role: "guest", port: 1 } },
      { type: "peer", present: false, peer: { id: "g1", role: "guest", port: 1 } },
    ]);
    expect(events).toContainEqual({ type: "link", status: "negotiating" });
  });

  it("passes on the lobby messages it understands and drops the rest", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 1 } });
    signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "explode" } });
    expect(events).toEqual([{ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 1 }, from: "g1" }]);
  });

  /** Dropped, it would leave the guest waiting while the host played alone; passed on, the guest refuses it (Plan 2 Task 27). */
  it("passes on a start it cannot read, with the build it claims, for the guest to refuse", async () => {
    const { signalling, events } = await open("join");
    signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
    const newer = { ...CONFIG, protocol: PROTOCOL_VERSION + 1, fighters: ["mario", "mewtwo-from-the-future"] };
    signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "start", config: newer } });
    expect(events.at(-1)).toEqual({
      type: "lobby",
      message: { kind: "unreadable-start", build: { build: CONFIG.build, protocol: PROTOCOL_VERSION + 1, bones: CONFIG.bones, engineRules: CONFIG.engineRules } },
      from: "h1",
    });
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
      signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [] });
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
      // The negotiation's own deadline, set before the drop, ends it no later than the grace.
      expect(session.transport.status).toBe("waiting");
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
      const { signalling, channel, events, fail } = await negotiatingHost();
      // One that had opened: a first link failing moves to the relay instead (below).
      channel.open();
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
      // The grace, and the negotiation's own deadline.
      expect(vi.getTimerCount()).toBe(2);
      session.close();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  /**
   * A lobby channel can close while both room sockets stay open (an SCTP
   * close, a network switch). Nobody joins or leaves, so before this nothing
   * offered again and both players waited on a screen that never moved.
   */
  describe("when the lobby channel closes with both players still in the room", () => {
    async function linkedHost() {
      vi.useFakeTimers();
      const h = await opened("create");
      h.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [{ id: "g1", role: "guest", port: 1 }] });
      await vi.advanceTimersByTimeAsync(0);
      h.channels[0].open();
      expect(h.offers()).toBe(1);
      return h;
    }

    async function linkedGuest() {
      vi.useFakeTimers();
      const g = await opened("join");
      g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
      await vi.advanceTimersByTimeAsync(0);
      g.channels[0].open();
      return g;
    }

    it("has the host offer the seated guest a fresh connection a second later, and carries on once it opens", async () => {
      const h = await linkedHost();
      h.channels[0].drop();
      expect(h.session.transport.status).toBe("waiting");

      await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0] - 1);
      expect(h.offers()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.offers()).toBe(2);

      h.channels[1].open();
      expect(h.session.transport.status).toBe("open");
      expect(errors(h.events)).toEqual([]);
    });

    it("backs off between offers, and after three says the room is lost, then stops", async () => {
      const h = await linkedHost();
      h.channels[0].drop();
      for (const [i, delay] of REOFFER_DELAYS_MS.entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(h.offers()).toBe(i + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.offers()).toBe(i + 2);
        expect(errors(h.events)).toEqual([]);
        // The fresh connection's channel gives up before it opens.
        h.channels[i + 1].drop();
      }
      expect(errors(h.events)).toEqual([{ type: "error", reason: "room-lost" }]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(1 + REOFFER_DELAYS_MS.length);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("counts afresh once a fresh connection has opened", async () => {
      const h = await linkedHost();
      h.channels[0].drop();
      await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
      h.channels[1].open();
      h.channels[1].drop();
      await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
      expect(h.offers()).toBe(3);
    });

    it("never offers the old guest again once a newcomer has taken the seat", async () => {
      const h = await linkedHost();
      h.channels[0].drop();
      h.signalling.deliver({ t: "peer-left", peerId: "g1" });
      h.signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
      await vi.advanceTimersByTimeAsync(0);
      // The newcomer gets the ordinary offer, and nothing else follows.
      expect(h.offers()).toBe(2);
      h.channels[1].open();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(2);
      expect(errors(h.events)).toEqual([]);
    });

    /**
     * The old guest's room socket left while its channel was still open (codex
     * P1): kept, that channel made the host ignore the newcomer, and the lobby
     * sat in "linking" with Start disabled.
     */
    it("lets the departed guest's open channel go, and links the newcomer", async () => {
      const h = await linkedHost();
      h.signalling.deliver({ t: "peer-left", peerId: "g1" });
      expect(h.session.transport.status).toBe("waiting");
      h.signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.offers()).toBe(2);
      h.channels[1].open();
      expect(h.session.transport.status).toBe("open");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(2);
      expect(errors(h.events)).toEqual([]);
    });

    /** Mid-match the link monitor owns the channel: the room's leave and join do not touch it. */
    it("keeps the match's channel when the guest's socket leaves and a newcomer joins", async () => {
      const h = await linkedHost();
      expect(h.session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      h.signalling.deliver({ t: "peer-left", peerId: "g1" });
      h.signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(1);
      expect(h.channels).toHaveLength(1);
      expect(h.channels[0].readyState).toBe("open");
      expect(h.session.transport.status).toBe("open");
      expect(errors(h.events)).toEqual([]);
    });

    it("never offers again after leaving", async () => {
      const h = await linkedHost();
      h.channels[0].drop();
      h.session.close();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(1);
    });

    /** Mid-match the link monitor decides, and a fresh connection must never replace the match's channel. */
    it("never offers again once a start has gone out", async () => {
      const h = await linkedHost();
      expect(h.session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      h.channels[0].drop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(1);
      expect(errors(h.events)).toEqual([]);
    });

    /** A start withdrawn because its guest left before the match began: the next guest's lobby is a lobby again. */
    it("offers again for the next guest once the guest a start went to has left", async () => {
      const h = await linkedHost();
      expect(h.session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      h.channels[0].drop();
      h.signalling.deliver({ t: "peer-left", peerId: "g1" });
      h.signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.offers()).toBe(2);
      h.channels[1].open();
      h.channels[1].drop();
      await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
      expect(h.offers()).toBe(3);
    });

    it("has a guest whose host left after a start answer the next host while it still holds a connection", async () => {
      const g = await linkedGuest();
      g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "start", config: CONFIG } });
      g.signalling.deliver({ t: "peer-left", peerId: "h1" });
      g.channels[0].drop();
      g.signalling.deliver({ t: "peer-joined", peer: { id: "h2", role: "host", port: 0 } });
      g.signalling.deliver({ t: "signal", from: "h2", payload: { kind: "offer", sdp: "o2" } });
      await vi.advanceTimersByTimeAsync(0);
      g.channels[1].open();
      // The new host's own channel loss: its re-offer replaces this side's connection.
      g.signalling.deliver({ t: "signal", from: "h2", payload: { kind: "offer", sdp: "o3" } });
      await vi.advanceTimersByTimeAsync(0);
      expect(g.channels).toHaveLength(3);
    });

    /** Only the guest's side closed: the host, still open, hears of it through the room, addressed to it alone. */
    it("has the guest ask its host to renegotiate when its channel is lost, but not once a start has come", async () => {
      const g = await linkedGuest();
      g.channels[0].drop();
      expect(renegotiates(g.signalling)).toEqual([{ t: "signal", to: "h1", payload: { kind: "renegotiate" } }]);

      const started = await linkedGuest();
      started.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "start", config: CONFIG } });
      started.channels[0].drop();
      expect(started.signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "renegotiate")).toEqual([]);
    });

    it("has the host take its guest's request as its own channel loss, retries and all", async () => {
      const h = await linkedHost();
      h.signalling.deliver({ t: "signal", from: "g1", payload: { kind: "renegotiate" } });
      expect(h.session.transport.status).toBe("waiting");
      await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
      expect(h.offers()).toBe(2);
    });

    it("has the host ignore a request to renegotiate once a start has gone out, or from anyone else", async () => {
      const h = await linkedHost();
      h.signalling.deliver({ t: "signal", from: "g2", payload: { kind: "renegotiate" } });
      expect(h.session.transport.status).toBe("open");
      expect(h.session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      h.signalling.deliver({ t: "signal", from: "g1", payload: { kind: "renegotiate" } });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.session.transport.status).toBe("open");
      expect(h.offers()).toBe(1);
    });

    /** Two sessions in one room: what either sends, the other hears, stamped with the sender. */
    async function pairedInRoom() {
      vi.useFakeTimers();
      const host = await opened("create");
      const guest = await opened("join");
      const relay = (from: typeof host, fromId: string, to: typeof host) => {
        const send = from.signalling.send.bind(from.signalling);
        from.signalling.send = (message) => {
          send(message);
          to.signalling.deliver({ ...message, from: fromId } as Parameters<typeof to.signalling.deliver>[0]);
        };
      };
      relay(host, "h1", guest);
      relay(guest, "g1", host);
      host.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [] });
      guest.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
      host.signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest", port: 1 } });
      await vi.advanceTimersByTimeAsync(0);
      host.channels[0].open();
      guest.channels[0].open();
      expect([host.session.transport.status, guest.session.transport.status]).toEqual(["open", "open"]);
      return { host, guest };
    }

    it("brings both back when only the guest's side of the channel closed", async () => {
      const { host, guest } = await pairedInRoom();
      guest.channels[0].drop();
      // The host heard the guest's request through the room and let its own side go.
      expect(host.session.transport.status).toBe("waiting");
      await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
      expect(host.offers()).toBe(2);
      expect(guest.channels).toHaveLength(2);
      host.channels[1].open();
      guest.channels[1].open();
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 2);
      expect([host.session.transport.status, guest.session.transport.status]).toEqual(["open", "open"]);
      expect([...errors(host.events), ...errors(guest.events)]).toEqual([]);
    });

    it("has the guest answer its host's fresh offer and carry on", async () => {
      const g = await linkedGuest();
      g.channels[0].drop();
      await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o2" } });
      await vi.advanceTimersByTimeAsync(0);
      g.channels[1].open();
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 2);
      expect(g.session.transport.status).toBe("open");
      expect(errors(g.events)).toEqual([]);
    });

    it("has the guest say the room is lost when its host never offers again", async () => {
      const g = await linkedGuest();
      g.channels[0].drop();
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS - 1);
      expect(errors(g.events)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(errors(g.events)).toEqual([{ type: "error", reason: "room-lost" }]);
    });

    it("has the guest wait without a word once its host has left the room, for whoever the room seats next", async () => {
      const g = await linkedGuest();
      g.channels[0].drop();
      g.signalling.deliver({ t: "peer-left", peerId: "h1" });
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 2);
      expect(errors(g.events)).toEqual([]);
    });

    it("has the guest hold its channel once the start has arrived", async () => {
      const g = await linkedGuest();
      g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "start", config: CONFIG } });
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o2" } });
      await vi.advanceTimersByTimeAsync(0);
      expect(g.channels).toHaveLength(1);
      expect(g.session.transport.status).toBe("open");
      g.channels[0].drop();
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 2);
      expect(errors(g.events)).toEqual([]);
    });
  });

  /**
   * A negotiation whose channel never opens and never closes (ICE that hangs
   * rather than fails) would leave both players on "Connecting…" for good. It
   * gets a deadline, and missing it is a channel lost before it opened.
   */
  describe("a negotiation that never finishes", () => {
    /** A channel that had opened and dropped is a reconnect, not a first link: its re-offers stand. */
    it("says the room is lost once every re-offer to a channel that had opened has timed out too", async () => {
      const h = await hostMeetingGuest();
      h.channels[0].open();
      h.channels[0].drop();
      for (const [i, delay] of REOFFER_DELAYS_MS.entries()) {
        expect(errors(h.events)).toEqual([]);
        await vi.advanceTimersByTimeAsync(delay);
        expect(h.offers()).toBe(i + 2);
        // The fresh connection's deadline passes too.
        await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
      }
      expect(errors(h.events)).toEqual([{ type: "error", reason: "room-lost" }]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(1 + REOFFER_DELAYS_MS.length);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves a channel that opens before the deadline alone, for good", async () => {
      const h = await hostMeetingGuest();
      await vi.advanceTimersByTimeAsync(14_000);
      h.channels[0].open();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.session.transport.status).toBe("open");
      expect(h.offers()).toBe(1);
      expect(errors(h.events)).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("hears nothing more once the player leaves before the deadline", async () => {
      const h = await hostMeetingGuest();
      await vi.advanceTimersByTimeAsync(10_000);
      h.session.close();
      expect(vi.getTimerCount()).toBe(0);
      const heard = h.events.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.events).toHaveLength(heard);
      expect(h.offers()).toBe(1);
    });

    it("sends a guest whose re-answer never opens back to waiting for its host's next offer", async () => {
      vi.useFakeTimers();
      const g = await opened("join");
      g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
      await vi.advanceTimersByTimeAsync(0);
      g.channels[0].open();
      g.channels[0].drop();
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o2" } });
      await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
      expect(g.session.transport.status).toBe("waiting");
      // Its host's own deadline passed too, and it offers again.
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o3" } });
      await vi.advanceTimersByTimeAsync(0);
      g.channels[2].open();
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 2);
      expect(g.session.transport.status).toBe("open");
      expect(errors(g.events)).toEqual([]);
    });
  });

  /**
   * Plan 6, Task 40b ended the room here: David's testers on separate networks
   * waited out a deadline to read "Couldn't connect directly…". Plan 7 (D60)
   * carries the match through the room instead. The side that finds out tells
   * the other (`use-relay`), and both move their packets onto the room socket.
   */
  describe("a direct link that cannot open falls back to the relay", () => {
    it("moves the host's first connect, unopened after the deadline, to the relay: tells the guest, makes no re-offer, raises no error", async () => {
      const h = await hostMeetingGuest();
      await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS - 1);
      expect(useRelays(h.signalling)).toBe(0);
      expect(h.session.route).toBe("direct");
      await vi.advanceTimersByTimeAsync(1);
      expect(h.signalling.sent.filter((m) => m.t === "lobby")).toEqual([{ t: "lobby", payload: { kind: "use-relay" } }]);
      // The route first, so the store never reads a direct link on the way to the relay.
      expect(h.events.slice(-2)).toEqual([
        { type: "route", route: "relay" },
        { type: "link", status: "open" },
      ]);
      expect(h.session.route).toBe("relay");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(errors(h.events)).toEqual([]);
      expect(h.offers()).toBe(1);
      expect(h.signalling.closed).toBe(false);
      expect(h.session.transport.status).toBe("open");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("moves a guest's first answer, unopened after the deadline, to the relay without asking for another offer", async () => {
      vi.useFakeTimers();
      const g = await opened("join");
      g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
      await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
      expect(renegotiates(g.signalling)).toEqual([]);
      expect(useRelays(g.signalling)).toBe(1);
      expect(g.session.route).toBe("relay");
      expect(g.session.transport.status).toBe("open");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(errors(g.events)).toEqual([]);
      expect(g.signalling.closed).toBe(false);
    });

    it("moves a first connect whose link fails to the relay at once, and never reports the failed link", async () => {
      const { session, signalling, events, fail } = await negotiatingHost();
      fail();
      expect(events).not.toContainEqual({ type: "link", status: "failed" });
      expect(events.slice(-2)).toEqual([
        { type: "route", route: "relay" },
        { type: "link", status: "open" },
      ]);
      expect(useRelays(signalling)).toBe(1);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(errors(events)).toEqual([]);
      expect(signalling.closed).toBe(false);
      expect(session.route).toBe("relay");
    });

    it("follows the other side's use-relay, and does not say it back", async () => {
      vi.useFakeTimers();
      const g = await opened("join");
      g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
      await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS - 50);
      g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "use-relay" } });
      expect(g.session.route).toBe("relay");
      expect(g.session.transport.status).toBe("open");
      // The session's own word: it never reaches the store as a lobby message.
      expect(g.events.filter((e) => e.type === "lobby")).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(g.signalling.sent.filter((m) => m.t === "lobby")).toEqual([]);
      expect(errors(g.events)).toEqual([]);
      expect(g.events.filter((e) => e.type === "route")).toHaveLength(1);
    });

    it("calls a player who leaves during the first negotiation gone, not the relay", async () => {
      const h = await hostMeetingGuest();
      await vi.advanceTimersByTimeAsync(5_000);
      h.signalling.deliver({ t: "peer-left", peerId: "g1" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(errors(h.events)).toEqual([]);
      expect(h.events.at(-1)).toEqual({ type: "peer", present: false, peer: { id: "g1", role: "guest", port: 1 } });
      expect(useRelays(h.signalling)).toBe(0);
      expect(h.session.route).toBe("direct");
      expect(h.signalling.closed).toBe(false);
    });

    /**
     * A started match owns the channel (Task 40b review Minor 1, final review
     * item 35), so a stray or hostile use-relay from the room cannot pull it
     * off a working link. Only a lobby session follows one.
     */
    it("lets a use-relay that arrives after the start change nothing: the direct channel and the room stay", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      channel.open();
      expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "use-relay" } });
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(session.route).toBe("direct");
      expect(events.filter((e) => e.type === "route")).toEqual([]);
      expect(errors(events)).toEqual([]);
      expect(signalling.closed).toBe(false);
      expect(session.transport.status).toBe("open");
      session.transport.send(new Uint8Array([1, 2, 3]));
      expect(channel.sent).toEqual([new Uint8Array([1, 2, 3])]);
    });

    it("tells a newcomer to a relayed seat to use the relay, and never offers it a direct connection", async () => {
      const h = await hostMeetingGuest();
      await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
      expect(useRelays(h.signalling)).toBe(1);
      h.signalling.deliver({ t: "peer-left", peerId: "g1" });
      h.signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
      expect(h.signalling.sent.at(-1)).toEqual({ t: "lobby", to: "g2", payload: { kind: "use-relay" } });
      expect(useRelays(h.signalling)).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(1);
      expect(h.channels).toHaveLength(1);
      expect(h.session.transport.status).toBe("open");
      expect(errors(h.events)).toEqual([]);
    });

    it("calls a room drop in the relayed lobby the room lost, with no re-offer and no renegotiate", async () => {
      const g = await relayedGuest();
      g.signalling.deliver(ROOM_DROP);
      await vi.advanceTimersByTimeAsync(0);
      expect(errors(g.events)).toEqual([{ type: "error", reason: "room-lost" }]);
      expect(renegotiates(g.signalling)).toEqual([]);

      const h = await hostMeetingGuest();
      await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
      h.signalling.deliver(ROOM_DROP);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(errors(h.events)).toEqual([{ type: "error", reason: "room-lost" }]);
      expect(h.offers()).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    /**
     * Relayed, the room's leave is the link going down (Task 3), and nothing
     * direct is coming back: no fresh offer, no request for one, and no wait
     * for one that could run out into the room lost.
     */
    it("takes a relayed peer's leave as a leave, not a lost channel to retry", async () => {
      const g = await relayedGuest();
      g.signalling.deliver({ t: "peer-left", peerId: "h1" });
      expect(g.session.transport.status).toBe("waiting");
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 2);
      expect(renegotiates(g.signalling)).toEqual([]);
      expect(errors(g.events)).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);

      const h = await hostMeetingGuest();
      await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
      h.signalling.deliver({ t: "peer-left", peerId: "g1" });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(1);
      expect(errors(h.events)).toEqual([]);
    });

    it("ends a guest's wait for its host's fresh offer once it moves to the relay", async () => {
      vi.useFakeTimers();
      const g = await opened("join");
      g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
      await vi.advanceTimersByTimeAsync(0);
      g.channels[0].open();
      g.channels[0].drop();
      expect(renegotiates(g.signalling)).toHaveLength(1);
      g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "use-relay" } });
      expect(g.session.route).toBe("relay");
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 2);
      expect(errors(g.events)).toEqual([]);
      expect(g.session.transport.status).toBe("open");
    });

    /**
     * Review Focus 1. The host's deadline starts before the guest's, so it can
     * run out just as the guest's channel opens. The guest must follow onto
     * the relay with the peer it already announced kept, neither left nor
     * announced again, and no error. This is order (A): the use-relay lands
     * first. In order (B), below, the host's side closing reaches this channel
     * first, and the peer is left and announced again.
     */
    it("Review Focus: a use-relay that lands while this side's direct channel is open moves it to the relay, and announces the peer once", async () => {
      vi.useFakeTimers();
      const g = await opened("join");
      const joins: string[] = [];
      const leaves: string[] = [];
      g.session.transport.onPeerJoin((id) => joins.push(id));
      g.session.transport.onPeerLeave((id) => leaves.push(id));
      g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
      await vi.advanceTimersByTimeAsync(0);
      g.channels[0].open();
      expect(joins).toEqual(["h1"]);

      g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "use-relay" } });

      expect(g.session.transport.route).toBe("relay");
      expect(g.session.transport.status).toBe("open");
      expect(joins).toEqual(["h1"]);
      expect(leaves).toEqual([]);
      expect(g.events.filter((e) => e.type === "route")).toEqual([{ type: "route", route: "relay" }]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(errors(g.events)).toEqual([]);
      expect(useRelays(g.signalling)).toBe(0);
    });

    /**
     * Order (B) of Review Focus 1, likely the commoner one live: the host lets
     * its peer connection go, and that close reaches this channel peer to peer
     * before the use-relay crosses the room. This side then leaves the peer,
     * asks for a fresh offer and waits for it, and the relay announces the
     * peer again. Safe because it all happens before the start: nothing
     * listens for joins and leaves until the play page's rollback session.
     */
    it("Review Focus, order (B): a use-relay that lands after this side's open channel closed moves it to the relay, with no error and one route", async () => {
      vi.useFakeTimers();
      const g = await opened("join");
      const joins: string[] = [];
      const leaves: string[] = [];
      g.session.transport.onPeerJoin((id) => joins.push(id));
      g.session.transport.onPeerLeave((id) => leaves.push(id));
      g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
      g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
      await vi.advanceTimersByTimeAsync(0);
      g.channels[0].open();
      g.channels[0].drop();
      expect(leaves).toEqual(["h1"]);

      g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "use-relay" } });

      expect(g.session.route).toBe("relay");
      expect(g.session.transport.status).toBe("open");
      expect(joins).toEqual(["h1", "h1"]);
      expect(leaves).toEqual(["h1"]);
      expect(g.events.filter((e) => e.type === "route")).toEqual([{ type: "route", route: "relay" }]);
      await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 2);
      expect(errors(g.events)).toEqual([]);
      expect(useRelays(g.signalling)).toBe(0);
    });

    /**
     * A browser with no WebRTC at all: the transport cannot build a peer
     * connection, and says so (`failed`) inside the room's own message, before
     * the session has heard it. That is a first link that cannot open, so the
     * match goes through the room, and the guest is told once.
     */
    it("moves a host without WebRTC to the relay, with no error, and tells each guest once", async () => {
      const noWebRtc = (): PeerConnectionLike => {
        throw new Error("no RTCPeerConnection here");
      };
      const later = await open("create", noWebRtc);
      later.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [] });
      later.signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest", port: 1 } });
      expect(later.session.route).toBe("relay");
      expect(later.session.transport.status).toBe("open");
      expect(useRelays(later.signalling)).toBe(1);
      expect(later.events.filter((e) => e.type === "route")).toEqual([{ type: "route", route: "relay" }]);

      const seated = await open("create", noWebRtc);
      seated.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [{ id: "g1", role: "guest", port: 1 }] });
      expect(seated.session.route).toBe("relay");
      expect(useRelays(seated.signalling)).toBe(1);

      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect([...errors(later.events), ...errors(seated.events)]).toEqual([]);
      expect([later.signalling.closed, seated.signalling.closed]).toEqual([false, false]);
      // A later newcomer is told too: only the delivery that moved the room said it already.
      later.signalling.deliver({ t: "peer-left", peerId: "g1" });
      later.signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
      expect(useRelays(later.signalling)).toBe(2);
    });

    it("moves a newcomer's first link that fails to the relay too", async () => {
      const { session, signalling, channel, events, fail } = await negotiatingHost();
      channel.open();
      expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      signalling.deliver({ t: "peer-left", peerId: "g1" });
      signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
      fail();
      expect(events).not.toContainEqual({ type: "link", status: "failed" });
      expect(session.route).toBe("relay");
      expect(useRelays(signalling)).toBe(1);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(errors(events)).toEqual([]);
      expect(signalling.closed).toBe(false);
    });

    /**
     * The final wave (Task 40b review Minor 2): mid-match the other player's room socket can
     * drop while the held channel stays open. A link that worked and then fails is a failed
     * link, not a first link to relay: only a newcomer in the seat starts a first link.
     */
    it("calls a link that had opened, failing after its peer's room socket left mid-match, a failed link", async () => {
      const { session, signalling, channel, events, fail } = await negotiatingHost();
      channel.open();
      expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      signalling.deliver({ t: "peer-left", peerId: "g1" });
      fail();
      expect(events.at(-1)).toEqual({ type: "link", status: "failed" });
      expect(errors(events)).toEqual([]);
      expect(useRelays(signalling)).toBe(0);
      expect(session.route).toBe("direct");
    });
  });

  /**
   * An error the room cannot recover from leaves it: left open, the code would
   * stay joinable, and a newcomer could pair with a screen showing a dead
   * error. Deferred past the current delivery, so a lost channel's leave still
   * reaches a match's link monitor first.
   */
  describe("after an error the room cannot go on from", () => {
    const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

    it("closes the room socket and the transport after room-lost, so a newcomer pairs with nobody", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      channel.open();
      signalling.deliver({ t: "peer-left", peerId: "g1" });
      expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(false);
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
      await flush();

      expect(signalling.closed).toBe(true);
      expect(session.transport.status).toBe("closed");
      const sent = signalling.sent.length;
      const heard = events.length;
      signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
      expect(signalling.sent).toHaveLength(sent);
      expect(events).toHaveLength(heard);
    });

    it("closes after a start it would not send", async () => {
      const { session, signalling, events } = await open();
      expect(session.sendLobby({ kind: "start", config: { ...CONFIG, seed: 1.5 } })).toBe(false);
      expect(errors(events)).toEqual([{ type: "error", reason: "bad-start" }]);
      await flush();
      expect(signalling.closed).toBe(true);
    });

    it("closes after the link fails", async () => {
      const { session, signalling, channel, events, fail } = await negotiatingHost();
      // One that had opened: a first link that fails moves to the relay instead.
      channel.open();
      fail();
      expect(events).toContainEqual({ type: "link", status: "failed" });
      await flush();
      expect(signalling.closed).toBe(true);
      expect(session.transport.status).toBe("closed");
    });

    it("closes after the room turns it away", async () => {
      const { signalling } = await open("join");
      signalling.deliver({ t: "error", reason: "bad-message" });
      await flush();
      expect(signalling.closed).toBe(true);
    });

    it("lets a lost channel's leave reach the match before it closes", async () => {
      const { session, signalling, channel } = await negotiatingHost();
      const left: string[] = [];
      session.transport.onPeerLeave((id) => left.push(id));
      channel.open();
      expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      signalling.deliver(ROOM_DROP);
      channel.drop();
      expect(left).toEqual(["g1"]);
      await flush();
      expect(signalling.closed).toBe(true);
    });

    it("is closed once however many errors arrive", async () => {
      const { session, signalling, events } = await open();
      session.sendLobby({ kind: "start", config: { ...CONFIG, seed: 1.5 } });
      session.sendLobby({ kind: "start", config: { ...CONFIG, seed: 2.5 } });
      await flush();
      expect(signalling.closed).toBe(true);
      expect(errors(events)).toHaveLength(2);
      session.close();
    });
  });

  it("sends lobby messages through the room", async () => {
    const { session, signalling } = await open();
    expect(session.sendLobby({ kind: "away", away: true })).toBe(true);
    expect(signalling.sent.at(-1)).toEqual({ t: "lobby", payload: { kind: "away", away: true } });
  });

  it("sends a start the guest's parser will take", async () => {
    const { session, signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [{ id: "g1", role: "guest", port: 1 }] });
    expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
    expect(signalling.sent.filter((m) => m.t === "lobby")).toEqual([{ t: "lobby", payload: { kind: "start", config: CONFIG } }]);
    expect(errors(events)).toEqual([]);
  });

  /**
   * The guest's room socket alone can drop (an idle proxy or NAT timeout)
   * while the channel stays open. The room then drops a start it has nobody
   * to give to, and the host would play alone until the link monitor gave up.
   * In the lobby the transport lets that channel go too, so the link is down
   * by the time a start could be tried.
   */
  describe("a start while the room says the other player is not there", () => {
    it("is not sent once the guest's socket has left: the room is lost", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      channel.open();
      signalling.deliver({ t: "peer-left", peerId: "g1" });
      expect(session.transport.status).toBe("waiting");
      const written = signalling.sent.length;

      expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(false);

      expect(signalling.sent).toHaveLength(written);
      expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
    });

    it("leaves picks and the stage alone", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      channel.open();
      signalling.deliver({ t: "peer-left", peerId: "g1" });
      expect(session.sendLobby({ kind: "pick", fighterId: "fox", costume: 0 })).toBe(true);
      expect(session.sendLobby({ kind: "stage", stageId: "battlefield", form: "normal" })).toBe(true);
      expect(errors(events)).toEqual([]);
    });

    it("goes once somebody is in the seat again", async () => {
      const { session, signalling, events } = await open();
      signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [] });
      signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest", port: 1 } });
      expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
      expect(errors(events)).toEqual([]);
    });
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
    signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest", port: 1 } });
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

/**
 * Phase B (Plan 7): a room seats up to four. Two players try a direct channel
 * first; a third seat moves everyone to the room relay, a star through the
 * Durable Object, with no WebRTC mesh and no message needed (every member
 * sees the same joins).
 */
describe("rooms of three and four (Plan 7)", () => {
  const HOST = { id: "h1", role: "host", port: 0 } as const;
  const G1 = { id: "g1", role: "guest", port: 1 } as const;
  const G2 = { id: "g2", role: "guest", port: 2 } as const;
  const G3 = { id: "g3", role: "guest", port: 3 } as const;
  const FOUR: OnlineMatchConfig = {
    ...CONFIG,
    rules: { ...CONFIG.rules, oneOnOne: false },
    fighters: ["mario", "fox", "mario", "fox"],
    costumes: [0, 1, 2, 3],
    controls: [0, 0, 0, 0],
  };
  const ping = (token: number) => encodeRelayBatch([encodePacket({ type: PacketType.Ping, token })]);

  /** A host negotiating with g1: its offer is out and the channel has not opened. Every peer connection it builds is recorded. */
  async function hostNegotiatingWithG1() {
    vi.useFakeTimers();
    const built: { closed: boolean }[] = [];
    const h = await open("create", () => {
      const channel = new OpenableChannel();
      const peer = { ...inertPeer(), createDataChannel: () => channel, closed: false };
      peer.close = () => {
        peer.closed = true;
      };
      built.push(peer);
      return peer;
    });
    const offers = () => h.signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "offer").length;
    h.signalling.deliver({ t: "welcome", self: HOST, peers: [G1] });
    await vi.advanceTimersByTimeAsync(0);
    expect(offers()).toBe(1);
    expect(h.session.transport.status).toBe("negotiating");
    return { ...h, built, offers };
  }

  it("puts a room that seats three on the relay at once, without a message", async () => {
    vi.useFakeTimers();
    const g = await opened("join");
    g.signalling.deliver({ t: "welcome", self: G2, peers: [HOST, G1] });

    expect(g.session.route).toBe("relay");
    expect(g.session.transport.status).toBe("open");
    expect(g.events.filter((e) => e.type === "route")).toEqual([{ type: "route", route: "relay" }]);
    expect(g.signalling.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(g.channels).toHaveLength(0);
    expect(errors(g.events)).toEqual([]);
  });

  it("moves a two-player room to the relay when a third joins, and keeps it there when the third leaves", async () => {
    const h = await hostMeetingGuest();
    h.channels[0].open();
    expect(h.session.route).toBe("direct");

    h.signalling.deliver({ t: "peer-joined", peer: G2 });
    expect(h.session.route).toBe("relay");
    expect(h.session.transport.status).toBe("open");

    h.signalling.deliver({ t: "peer-left", peerId: "g2" });
    expect(h.session.route).toBe("relay");
    expect(h.session.transport.status).toBe("open");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.offers()).toBe(1);
    expect(h.events.filter((e) => e.type === "route")).toEqual([{ type: "route", route: "relay" }]);
    // The join that moved it is told to the room, once (see the split-lock test below).
    expect(h.signalling.sent.filter((m) => m.t === "lobby")).toEqual([{ t: "lobby", payload: { kind: "use-relay" } }]);
    expect(errors(h.events)).toEqual([]);
  });

  it("reports each lobby message with its sender, and each arrival or departure with its seat", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: HOST, peers: [G1, G2] });
    signalling.deliver({ t: "peer-joined", peer: G3 });
    signalling.deliver({ t: "lobby", from: "g3", payload: { kind: "pick", fighterId: "fox", costume: 1 } });
    signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "away", away: true } });
    signalling.deliver({ t: "peer-left", peerId: "g2" });

    expect(events.filter((e) => e.type === "peer" || e.type === "lobby")).toEqual([
      { type: "peer", present: true, peer: G1 },
      { type: "peer", present: true, peer: G2 },
      { type: "peer", present: true, peer: G3 },
      { type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 1 }, from: "g3" },
      { type: "lobby", message: { kind: "away", away: true }, from: "g1" },
      { type: "peer", present: false, peer: G2 },
    ]);
  });

  it("addresses a lobby message to one peer when asked", async () => {
    const { session, signalling } = await open();
    signalling.deliver({ t: "welcome", self: HOST, peers: [G1, G2] });
    const payload = { kind: "pick", fighterId: "fox", costume: 1 } as const;

    expect(session.sendLobby(payload, "g2")).toBe(true);
    expect(signalling.sent.at(-1)).toEqual({ t: "lobby", to: "g2", payload });
    // Unaddressed, it goes to everyone, with no address at all.
    expect(session.sendLobby(payload)).toBe(true);
    expect(signalling.sent.at(-1)).toStrictEqual({ t: "lobby", payload });
  });

  it("knows its own seat port from the welcome", async () => {
    const { session, signalling } = await open("join");
    expect(session.seatPort).toBeNull();
    signalling.deliver({ t: "welcome", self: G2, peers: [HOST, G1] });
    expect(session.seatPort).toBe(2);
    expect(session.role).toBe("guest");
  });

  it("sends a four-player start with three others seated, and calls the room lost when one of them is missing", async () => {
    const full = await open();
    full.signalling.deliver({ t: "welcome", self: HOST, peers: [] });
    for (const peer of [G1, G2, G3]) full.signalling.deliver({ t: "peer-joined", peer });
    expect(full.session.peers.size).toBe(3);
    expect(full.session.sendLobby({ kind: "start", config: FOUR })).toBe(true);
    expect(full.signalling.sent.filter((m) => m.t === "lobby" && m.payload.kind === "start")).toHaveLength(1);
    expect(errors(full.events)).toEqual([]);

    const short = await open();
    short.signalling.deliver({ t: "welcome", self: HOST, peers: [G1, G2] });
    expect(short.session.sendLobby({ kind: "start", config: FOUR })).toBe(false);
    expect(short.signalling.sent.filter((m) => m.t === "lobby" && m.payload.kind === "start")).toEqual([]);
    expect(errors(short.events)).toEqual([{ type: "error", reason: "room-lost" }]);
  });

  it("lets only the host tell a newcomer to a relayed room to use the relay", async () => {
    const g = await relayedGuest();
    g.signalling.deliver({ t: "peer-joined", peer: G2 });
    expect(useRelays(g.signalling)).toBe(0);

    const h = await hostMeetingGuest();
    await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
    expect(useRelays(h.signalling)).toBe(1);
    h.signalling.deliver({ t: "peer-joined", peer: G2 });
    expect(useRelays(h.signalling)).toBe(2);
    expect(h.signalling.sent.at(-1)).toEqual({ t: "lobby", to: "g2", payload: { kind: "use-relay" } });
  });

  it("keeps a begun room's route and players when a stranger joins and leaves", async () => {
    // Direct: the begun room's two players, and a stranger typing the code.
    const { session, signalling, channel, events } = await negotiatingHost();
    const joins: string[] = [];
    const leaves: string[] = [];
    session.transport.onPeerJoin((id) => joins.push(id));
    session.transport.onPeerLeave((id) => leaves.push(id));
    channel.open();
    session.lockRoster(["g1"]);
    signalling.deliver({ t: "peer-joined", peer: G2 });
    signalling.deliver({ t: "peer-left", peerId: "g2" });
    expect(session.route).toBe("direct");

    expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
    signalling.deliver({ t: "peer-joined", peer: G3 });
    signalling.deliver({ t: "peer-left", peerId: "g3" });
    // The start still holds: a stray use-relay cannot move the match.
    signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "use-relay" } });
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(session.route).toBe("direct");
    expect(events.filter((e) => e.type === "route")).toEqual([]);
    expect(joins).toEqual(["g1"]);
    expect(leaves).toEqual([]);
    expect(session.transport.status).toBe("open");
    expect(errors(events)).toEqual([]);

    // Relayed: the stranger is neither announced nor heard.
    const h = await hostMeetingGuest();
    await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
    const heard: string[] = [];
    const relayJoins: string[] = [];
    const relayLeaves: string[] = [];
    h.session.transport.onMessage((_bytes, id) => heard.push(id));
    h.session.transport.onPeerJoin((id) => relayJoins.push(id));
    h.session.transport.onPeerLeave((id) => relayLeaves.push(id));
    h.session.lockRoster(["g1"]);
    expect(h.session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
    h.signalling.deliver({ t: "peer-joined", peer: G2 });
    h.signalling.deliver({ t: "game", from: "g2", bytes: ping(1) });
    h.signalling.deliver({ t: "game", from: "g1", bytes: ping(2) });
    h.signalling.deliver({ t: "peer-left", peerId: "g2" });

    expect(heard).toEqual(["g1"]);
    expect(relayJoins).toEqual([]);
    expect(relayLeaves).toEqual([]);
    expect(h.session.transport.status).toBe("open");
    expect(errors(h.events)).toEqual([]);
  });

  it("Review Focus: a third player joining mid-negotiation moves all three to the relay and leaves the old negotiation unanswered", async () => {
    const h = await hostNegotiatingWithG1();
    const joins: string[] = [];
    h.session.transport.onPeerJoin((id) => joins.push(id));

    h.signalling.deliver({ t: "peer-joined", peer: G2 });

    expect(h.session.route).toBe("relay");
    expect(h.built).toHaveLength(1);
    expect(h.built[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.offers()).toBe(1);

    // The old negotiation's late answer and candidate land on nothing.
    h.signalling.deliver({ t: "signal", from: "g1", payload: { kind: "answer", sdp: "a" } });
    h.signalling.deliver({
      t: "signal",
      from: "g1",
      payload: { kind: "ice", candidate: { candidate: "candidate:1 1 udp 1 10.0.0.2 5000 typ host", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null } },
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.built).toHaveLength(1);
    expect(h.offers()).toBe(1);
    expect(joins).toEqual(["g1", "g2"]);
    expect(h.session.transport.status).toBe("open");
    expect(errors(h.events)).toEqual([]);
    expect(useRelays(h.signalling)).toBe(1);
  });

  /** RF5's other half: g1, a guest with a half-open answer, moves too, and its host's late word builds nothing. */
  it("Review Focus, the guest's side: a third player joining mid-negotiation moves the guest to the relay and leaves its answer behind", async () => {
    vi.useFakeTimers();
    const built: { closed: boolean }[] = [];
    const g = await open("join", () => {
      const channel = new OpenableChannel();
      const peer = { ...inertPeer(), createDataChannel: () => channel, closed: false };
      peer.close = () => {
        peer.closed = true;
      };
      built.push(peer);
      return peer;
    });
    const joins: string[] = [];
    g.session.transport.onPeerJoin((id) => joins.push(id));
    g.signalling.deliver({ t: "welcome", self: G1, peers: [HOST] });
    g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(g.signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "answer")).toHaveLength(1);

    g.signalling.deliver({ t: "peer-joined", peer: G2 });

    expect(g.session.route).toBe("relay");
    expect(built).toHaveLength(1);
    expect(built[0].closed).toBe(true);
    g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o2" } });
    g.signalling.deliver({
      t: "signal",
      from: "h1",
      payload: { kind: "ice", candidate: { candidate: "candidate:1 1 udp 1 10.0.0.2 5000 typ host", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null } },
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(built).toHaveLength(1);
    expect(g.signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "answer")).toHaveLength(1);
    expect(joins).toEqual(["h1", "g2"]);
    expect(g.session.transport.status).toBe("open");
    expect(errors(g.events)).toEqual([]);
  });

  /**
   * The host locks the roster as it sends the begin, and a guest only as it
   * receives it. A stranger the room seats in between counts as a third seat
   * for the guest and not for the host: the guest's word brings the host to
   * the relay too, rather than leave it on a channel the guest let go.
   */
  it("brings a host that locked its roster to the relay when a guest that had not yet locked moved for a third seat", async () => {
    const h = await hostMeetingGuest();
    h.channels[0].open();
    h.session.lockRoster(["g1"]);
    h.signalling.deliver({ t: "peer-joined", peer: G2 });
    expect(h.session.route).toBe("direct");

    const g = await opened("join");
    g.signalling.deliver({ t: "welcome", self: G1, peers: [HOST] });
    g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
    await vi.advanceTimersByTimeAsync(0);
    g.channels[0].open();
    g.signalling.deliver({ t: "peer-joined", peer: G2 });
    g.session.lockRoster(["h1"]);
    expect(g.session.route).toBe("relay");
    const told = g.signalling.sent.filter((m) => m.t === "lobby" && m.payload.kind === "use-relay");
    expect(told).toEqual([{ t: "lobby", payload: { kind: "use-relay" } }]);

    // The room passes it on to the host, stamped with the guest.
    h.signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "use-relay" } });
    expect(h.session.route).toBe("relay");
    expect(h.session.transport.status).toBe("open");
    await vi.advanceTimersByTimeAsync(60_000);
    expect([...errors(h.events), ...errors(g.events)]).toEqual([]);
  });

  it("lets no stranger in a begun room move it to the relay or start it", async () => {
    // A stranger's use-relay, once the host has locked its roster.
    const h = await hostMeetingGuest();
    h.channels[0].open();
    h.session.lockRoster(["g1"]);
    h.signalling.deliver({ t: "peer-joined", peer: G2 });
    h.signalling.deliver({ t: "lobby", from: "g2", payload: { kind: "use-relay" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.session.route).toBe("direct");
    expect(h.events.filter((e) => e.type === "route")).toEqual([]);

    // A start, readable or not, from any seat but the host's.
    const g = await opened("join");
    g.signalling.deliver({ t: "welcome", self: G1, peers: [HOST] });
    g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
    await vi.advanceTimersByTimeAsync(0);
    g.channels[0].open();
    g.session.lockRoster(["h1"]);
    g.signalling.deliver({ t: "peer-joined", peer: G2 });
    g.signalling.deliver({ t: "lobby", from: "g2", payload: { kind: "start", config: CONFIG } });
    g.signalling.deliver({ t: "lobby", from: "g2", payload: { kind: "start", config: { ...CONFIG, protocol: PROTOCOL_VERSION + 1 } } });
    expect(g.events.filter((e) => e.type === "lobby")).toEqual([]);
    // Not held for it: its host's fresh offer still replaces the channel.
    g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o2" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(g.channels).toHaveLength(2);
    // The host's own start still goes through.
    g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "start", config: CONFIG } });
    expect(g.events.filter((e) => e.type === "lobby")).toEqual([{ type: "lobby", message: { kind: "start", config: CONFIG }, from: "h1" }]);
  });

  /**
   * Task 14 (from Task 12's review): a begun room of two counts its players,
   * not its seats. With a stranger seated, a lost lobby channel is still
   * offered again to the one player; once that player leaves, the stranger is
   * never the one offered to; and a newcomer the begin seats on the vacated
   * port gets a first link, which moves to the relay if it never opens.
   */
  it("counts a begun two-player lobby's players, not its seats, while a stranger sits in it", async () => {
    const h = await hostMeetingGuest();
    h.channels[0].open();
    h.session.lockRoster(["g1"]);
    h.signalling.deliver({ t: "peer-joined", peer: G2 });
    h.channels[0].drop();
    await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
    expect(h.offers()).toBe(2);
    expect(h.signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "offer").map((m) => m.t === "signal" && m.to)).toEqual([
      "g1",
      "g1",
    ]);

    // The player leaves; the stranger stays and is offered nothing, however long it sits.
    h.signalling.deliver({ t: "peer-left", peerId: "g1" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.offers()).toBe(2);

    // A newcomer the re-sent begin seats on the vacated port: offered as the lock lists it.
    h.signalling.deliver({ t: "peer-joined", peer: G3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.offers()).toBe(2);
    h.session.lockRoster(["g3"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.offers()).toBe(3);
    expect(h.signalling.sent.at(-1)).toMatchObject({ t: "signal", to: "g3", payload: { kind: "offer" } });
    // Its first link never opens: that is the relay, not a re-offer, and never the room lost.
    await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
    expect(h.session.route).toBe("relay");
    expect(h.offers()).toBe(3);
    expect(errors(h.events)).toEqual([]);
  });

  it("counts only the roster's players toward a start once the roster is locked", async () => {
    const { session, signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: HOST, peers: [G1] });
    session.lockRoster(["g1"]);
    signalling.deliver({ t: "peer-left", peerId: "g1" });
    signalling.deliver({ t: "peer-joined", peer: G2 });
    expect(session.peers.size).toBe(1);
    expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(false);
    expect(errors(events)).toEqual([{ type: "error", reason: "room-lost" }]);
  });
});
