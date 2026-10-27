import { afterEach, describe, expect, it } from "vitest";

import type { DataChannelLike, PeerConnectionLike } from "../adapters/doSignal";
import { STUN_ONLY } from "../iceConfig";
import type { RoomIntent } from "../signalProtocol";
import { FakeSignalling } from "../testing/fakeSignalling";
import type { OnlineMatchConfig } from "./lobby";
import { OnlineSession, getActiveSession, setActiveSession, type SessionEvent } from "./session";

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

afterEach(() => setActiveSession(null));

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

  it("a room restart after joining is not an error", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    signalling.deliver({ t: "closed", code: 1006, reason: "" });
    expect(events.filter((e) => e.type === "error")).toEqual([]);
  });

  it("a room restart mid-match leaves the open channel, and the match, running", async () => {
    const channel = new OpenableChannel();
    const { session, signalling, events } = await open("create", () => ({ ...inertPeer(), createDataChannel: () => channel }));
    const left: string[] = [];
    session.transport.onPeerLeave((id) => left.push(id));
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    channel.open();
    expect(session.transport.status).toBe("open");

    // A Worker deploy restarts the Durable Object and drops its sockets without a close frame.
    signalling.deliver({ t: "closed", code: 1006, reason: "" });

    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(events.filter((e) => e.type === "link").at(-1)).toEqual({ type: "link", status: "open" });
    expect(session.transport.status).toBe("open");
    expect(left).toEqual([]);
    session.transport.send(new Uint8Array([1, 2, 3]));
    expect(channel.sent).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it("sends lobby messages through the room", async () => {
    const { session, signalling } = await open();
    session.sendLobby({ kind: "away", away: true });
    expect(signalling.sent.at(-1)).toEqual({ t: "lobby", payload: { kind: "away", away: true } });
  });

  it("sends a start the guest's parser will take", async () => {
    const { session, signalling, events } = await open();
    session.sendLobby({ kind: "start", config: CONFIG });
    expect(signalling.sent).toEqual([{ t: "lobby", payload: { kind: "start", config: CONFIG } }]);
    expect(events).toEqual([]);
  });

  it("keeps back a start the guest would drop, and makes it the host's error", async () => {
    const { session, signalling, events } = await open();
    session.sendLobby({ kind: "start", config: { ...CONFIG, fighters: ["mario", "nobody"] } });
    session.sendLobby({ kind: "start", config: { ...CONFIG, seed: 1.5 } });
    expect(signalling.sent).toEqual([]);
    expect(events).toEqual([
      { type: "error", reason: "bad-start" },
      { type: "error", reason: "bad-start" },
    ]);
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
