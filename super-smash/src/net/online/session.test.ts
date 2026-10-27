import { afterEach, describe, expect, it, vi } from "vitest";

import type { PeerConnectionLike } from "../adapters/doSignal";
import { STUN_ONLY } from "../iceConfig";
import type { RoomIntent } from "../signalProtocol";
import { OpenableChannel, inertPeer } from "../testing/fakePeer";
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

  /**
   * A lobby channel can close while both room sockets stay open (an SCTP
   * close, a network switch). Nobody joins or leaves, so before this nothing
   * offered again and both players waited on a screen that never moved.
   */
  describe("when the lobby channel closes with both players still in the room", () => {
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

    async function linkedHost() {
      vi.useFakeTimers();
      const h = await opened("create");
      h.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
      await vi.advanceTimersByTimeAsync(0);
      h.channels[0].open();
      expect(h.offers()).toBe(1);
      return h;
    }

    async function linkedGuest() {
      vi.useFakeTimers();
      const g = await opened("join");
      g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
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
      h.signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest" } });
      await vi.advanceTimersByTimeAsync(0);
      // The newcomer gets the ordinary offer, and nothing else follows.
      expect(h.offers()).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.offers()).toBe(2);
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

  it("sends lobby messages through the room", async () => {
    const { session, signalling } = await open();
    expect(session.sendLobby({ kind: "away", away: true })).toBe(true);
    expect(signalling.sent.at(-1)).toEqual({ t: "lobby", payload: { kind: "away", away: true } });
  });

  it("sends a start the guest's parser will take", async () => {
    const { session, signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    expect(session.sendLobby({ kind: "start", config: CONFIG })).toBe(true);
    expect(signalling.sent.filter((m) => m.t === "lobby")).toEqual([{ t: "lobby", payload: { kind: "start", config: CONFIG } }]);
    expect(errors(events)).toEqual([]);
  });

  /**
   * The guest's room socket alone can drop (an idle proxy or NAT timeout)
   * while the channel stays open. The room then drops a start it has nobody
   * to give to, and the host would play alone until the link monitor gave up.
   */
  describe("a start while the room says the other player is not there", () => {
    it("is not sent, even with the channel open: the room is lost, and the host stays", async () => {
      const { session, signalling, channel, events } = await negotiatingHost();
      channel.open();
      signalling.deliver({ t: "peer-left", peerId: "g1" });
      expect(session.transport.status).toBe("open");
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
      signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
      signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
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
