import { describe, expect, it } from "vitest";

import { DEFAULT_UNRELIABLE_CHANNEL_ID, INPUT_CHANNEL_LABEL } from "../channel";
import { STUN_ONLY } from "../iceConfig";
import { toRtcIceServers } from "../iceServers";
import type { WireIceCandidate } from "../signalProtocol";
import { FakeSignalling } from "../testing/fakeSignalling";
import {
  createDoSignalTransport,
  type DataChannelInitLike,
  type DataChannelLike,
  type DoSignalStatus,
  type PeerConfig,
  type PeerConnectionLike,
  type SessionDescriptionLike,
} from "./doSignal";

/* --------------------------------------------------------------- fakes -- */

class FakeChannel implements DataChannelLike {
  readyState = "connecting";
  binaryType = "blob";
  onopen: DataChannelLike["onopen"] = null;
  onclose: DataChannelLike["onclose"] = null;
  onerror: DataChannelLike["onerror"] = null;
  onmessage: DataChannelLike["onmessage"] = null;
  readonly sent: Uint8Array[] = [];
  closed = false;

  constructor(readonly label: string, readonly init: DataChannelInitLike) {}

  send(data: Uint8Array<ArrayBuffer>): void {
    if (this.readyState !== "open") throw new Error("not open");
    this.sent.push(new Uint8Array(data));
  }
  close(): void {
    this.closed = true;
    this.readyState = "closed";
  }
  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }
  remoteClose(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

class FakePeer implements PeerConnectionLike {
  connectionState = "new";
  onicecandidate: PeerConnectionLike["onicecandidate"] = null;
  onconnectionstatechange: PeerConnectionLike["onconnectionstatechange"] = null;
  readonly channels: FakeChannel[] = [];
  readonly added: WireIceCandidate[] = [];
  local: SessionDescriptionLike | null = null;
  remote: SessionDescriptionLike | null = null;
  closed = false;

  constructor(readonly config: PeerConfig) {}

  createDataChannel(label: string, init: DataChannelInitLike): FakeChannel {
    const channel = new FakeChannel(label, init);
    this.channels.push(channel);
    return channel;
  }
  async createOffer() {
    return { sdp: "offer-sdp" };
  }
  async createAnswer() {
    return { sdp: "answer-sdp" };
  }
  async setLocalDescription(d: SessionDescriptionLike) {
    this.local = d;
  }
  async setRemoteDescription(d: SessionDescriptionLike) {
    this.remote = d;
  }
  /** As a browser does: a candidate needs the remote description it belongs to, and an m-line to land on. */
  addIceCandidate(c: WireIceCandidate): Promise<void> {
    // Thrown rather than rejected, so the adapter is shown to survive either shape.
    if (c.sdpMid === null && c.sdpMLineIndex === null) throw new TypeError("sdpMid and sdpMLineIndex are both null");
    if (this.remote === null) return Promise.reject(new DOMException("no remote description", "InvalidStateError"));
    if (c.sdpMLineIndex !== null && c.sdpMLineIndex > 0) return Promise.reject(new DOMException("no such m-line", "OperationError"));
    this.added.push(c);
    return Promise.resolve();
  }
  close(): void {
    this.closed = true;
  }
  emitCandidate(candidate: string): void {
    this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate, sdpMid: "0", sdpMLineIndex: 0 }) } });
  }
  fail(): void {
    this.connectionState = "failed";
    this.onconnectionstatechange?.();
  }
}

/** The checks the RTCPeerConnection constructor makes on its ICE servers (WebRTC spec, "validate an ICE server"). */
function refuseLikeABrowser(config: PeerConfig): void {
  for (const server of config.iceServers) {
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    if (urls.length === 0) throw new SyntaxError("an ICE server with no urls");
    const turn = urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
    if (turn && (server.username === undefined || server.credential === undefined)) {
      throw new DOMException("a TURN server needs a username and a credential", "InvalidAccessError");
    }
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CANDIDATE: WireIceCandidate = { candidate: "candidate:1 1 udp 1 10.0.0.2 5000 typ host", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null };
const STUN: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

interface SetupOptions {
  readonly forceRelay?: boolean;
  readonly iceServers?: RTCIceServer[];
  /** Runs before each peer connection is built, and throws where the browser's constructor would. */
  readonly vet?: (config: PeerConfig) => void;
}

function setup({ forceRelay = false, iceServers = STUN, vet }: SetupOptions = {}) {
  const signalling = new FakeSignalling();
  const peers: FakePeer[] = [];
  const statuses: DoSignalStatus[] = [];
  const transport = createDoSignalTransport({
    signalling,
    iceServers,
    forceRelay,
    createPeerConnection: (config) => {
      vet?.(config);
      const peer = new FakePeer(config);
      peers.push(peer);
      return peer;
    },
    onStatus: (status) => statuses.push(status),
  });
  const joins: string[] = [];
  const leaves: string[] = [];
  const received: [number[], string][] = [];
  transport.onPeerJoin((id) => joins.push(id));
  transport.onPeerLeave((id) => leaves.push(id));
  transport.onMessage((bytes, id) => received.push([[...bytes], id]));
  return { signalling, peers, statuses, transport, joins, leaves, received };
}

async function linkedHost() {
  const t = setup();
  t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
  t.signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
  await settle();
  t.signalling.deliver({ t: "signal", from: "g1", payload: { kind: "answer", sdp: "answer-sdp" } });
  await settle();
  t.peers[0].channels[0].open();
  return t;
}

/* --------------------------------------------------------------- tests -- */

describe("the host", () => {
  it("offers as soon as a guest is in the room, on the negotiated unreliable channel", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    expect(t.peers).toHaveLength(0);
    t.signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
    await settle();

    expect(t.peers).toHaveLength(1);
    expect(t.peers[0].config).toEqual({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], iceTransportPolicy: "all" });
    expect(t.peers[0].channels[0].label).toBe(INPUT_CHANNEL_LABEL);
    expect(t.peers[0].channels[0].init).toEqual({ negotiated: true, id: DEFAULT_UNRELIABLE_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
    expect(t.peers[0].local).toEqual({ type: "offer", sdp: "offer-sdp" });
    expect(t.signalling.sent).toContainEqual({ t: "signal", payload: { kind: "offer", sdp: "offer-sdp" } });
    expect(t.transport.selfId).toBe("h1");
    expect(t.transport.role).toBe("host");
    expect(t.statuses).toEqual(["negotiating"]);
  });

  it("forces the TURN relay when asked to", async () => {
    const t = setup({ forceRelay: true });
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    await settle();
    expect(t.peers[0].config.iceTransportPolicy).toBe("relay");
  });

  it("relays its own ICE candidates, but not the end-of-candidates marker", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    await settle();
    t.peers[0].emitCandidate(CANDIDATE.candidate);
    t.peers[0].emitCandidate("");
    const ice = t.signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "ice");
    expect(ice).toEqual([{ t: "signal", payload: { kind: "ice", candidate: CANDIDATE } }]);
  });
});

describe("the guest", () => {
  it("answers the host's offer, holding early candidates until it can use them", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "offer-sdp" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "ice", candidate: CANDIDATE } });
    await settle();

    expect(t.peers).toHaveLength(1);
    expect(t.peers[0].remote).toEqual({ type: "offer", sdp: "offer-sdp" });
    expect(t.peers[0].added).toEqual([CANDIDATE]);
    expect(t.signalling.sent).toContainEqual({ t: "signal", payload: { kind: "answer", sdp: "answer-sdp" } });
  });

  it("holds candidates that outrun the offer itself, and applies them once the offer is in", async () => {
    const STALE: WireIceCandidate = { ...CANDIDATE, candidate: "candidate:9 1 udp 1 10.0.0.9 5009 typ host" };
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "ice", candidate: CANDIDATE } });
    t.signalling.deliver({ t: "signal", from: "h0", payload: { kind: "ice", candidate: STALE } });
    await settle();
    expect(t.peers).toHaveLength(0);

    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "offer-sdp" } });
    await settle();
    expect(t.peers[0].remote).toEqual({ type: "offer", sdp: "offer-sdp" });
    // Filed by sender: h1's candidate reaches h1's connection, h0's does not.
    expect(t.peers[0].added).toEqual([CANDIDATE]);
    expect(t.signalling.sent).toContainEqual({ t: "signal", payload: { kind: "answer", sdp: "answer-sdp" } });
  });

  it("forgets the held candidates of a sender who leaves the room", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "ice", candidate: CANDIDATE } });
    t.signalling.deliver({ t: "peer-left", peerId: "h1" });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "offer-sdp" } });
    await settle();
    expect(t.peers[0].added).toEqual([]);
  });

  it("ignores candidates from anyone but the peer it is negotiating with", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "offer-sdp" } });
    await settle();
    t.signalling.deliver({ t: "signal", from: "intruder", payload: { kind: "ice", candidate: CANDIDATE } });
    await settle();
    expect(t.peers[0].added).toEqual([]);
  });

  it("skips a malformed candidate, held or not, and keeps negotiating", async () => {
    const NO_LINE: WireIceCandidate = { ...CANDIDATE, sdpMid: null, sdpMLineIndex: null };
    const NO_SUCH_LINE: WireIceCandidate = { ...CANDIDATE, sdpMid: null, sdpMLineIndex: 7 };
    const LATER: WireIceCandidate = { ...CANDIDATE, candidate: "candidate:2 1 udp 1 10.0.0.3 5001 typ host" };
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "offer-sdp" } });
    // Held: the offer's description is still being set.
    for (const candidate of [NO_LINE, NO_SUCH_LINE, CANDIDATE]) {
      t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "ice", candidate } });
    }
    await settle();
    // Applied straight away.
    for (const candidate of [NO_LINE, NO_SUCH_LINE, LATER]) {
      t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "ice", candidate } });
    }
    await settle();

    expect(t.peers[0].added).toEqual([CANDIDATE, LATER]);
    expect(t.peers[0].closed).toBe(false);
    expect(t.transport.status).toBe("negotiating");
    expect(t.signalling.sent).toContainEqual({ t: "signal", payload: { kind: "answer", sdp: "answer-sdp" } });
  });
});

describe("a peer connection the browser will not build", () => {
  it.each<[string, RTCIceServer[]]>([
    ["a TURN url without credentials", [{ urls: "turn:turn.example.com:3478?transport=udp" }]],
    ["an ICE server with no urls", [{ urls: [] }]],
  ])("falls back to STUN only for %s, and still offers", async (_, iceServers) => {
    const t = setup({ iceServers, vet: refuseLikeABrowser });
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    await settle();

    expect(t.peers).toHaveLength(1);
    expect(t.peers[0].config).toEqual({ iceServers: toRtcIceServers(STUN_ONLY), iceTransportPolicy: "all" });
    expect(t.signalling.sent).toContainEqual({ t: "signal", payload: { kind: "offer", sdp: "offer-sdp" } });
    expect(t.transport.status).toBe("negotiating");
  });

  it("keeps a forced relay forced on the fallback, so a broken TURN config fails rather than quietly going direct", async () => {
    const t = setup({ forceRelay: true, iceServers: [{ urls: "turn:turn.example.com:3478" }], vet: refuseLikeABrowser });
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    await settle();
    expect(t.peers[0].config).toEqual({ iceServers: toRtcIceServers(STUN_ONLY), iceTransportPolicy: "relay" });
  });

  it("reports failure, rather than throwing, when no peer connection can be built at all", async () => {
    const t = setup({
      vet: () => {
        throw new ReferenceError("RTCPeerConnection is not defined");
      },
    });
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    await settle();
    expect(t.peers).toEqual([]);
    expect(t.statuses).toEqual(["failed"]);
    expect(t.transport.status).toBe("failed");
  });
});

describe("a linked match", () => {
  it("announces the peer once the channel opens, and carries bytes both ways", async () => {
    const t = await linkedHost();
    expect(t.joins).toEqual(["g1"]);
    expect(t.transport.status).toBe("open");

    t.transport.send(new Uint8Array([1, 2, 3]));
    expect(t.peers[0].channels[0].sent).toEqual([new Uint8Array([1, 2, 3])]);

    t.peers[0].channels[0].onmessage?.({ data: new Uint8Array([9, 8]).buffer });
    expect(t.received).toEqual([[[9, 8], "g1"]]);
  });

  it("sends nothing, and does not throw, before the channel is open", async () => {
    const t = setup();
    expect(() => t.transport.send(new Uint8Array([1]))).not.toThrow();

    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    await settle();
    const channel = t.peers[0].channels[0];
    expect(channel.readyState).toBe("connecting");
    expect(() => t.transport.send(new Uint8Array([2]))).not.toThrow();
    expect(channel.sent).toEqual([]);

    // The early sends cost nothing: once the channel opens, packets flow.
    t.signalling.deliver({ t: "signal", from: "g1", payload: { kind: "answer", sdp: "answer-sdp" } });
    await settle();
    channel.open();
    t.transport.send(new Uint8Array([3]));
    expect(channel.sent).toEqual([new Uint8Array([3])]);
  });

  it("reports the peer gone when the channel closes", async () => {
    const t = await linkedHost();
    t.peers[0].channels[0].remoteClose();
    expect(t.leaves).toEqual(["g1"]);
    expect(t.transport.status).toBe("waiting");
  });

  it("keeps playing when the room's sockets drop mid-match (a Worker deploy restarts the Durable Object)", async () => {
    const t = await linkedHost();
    t.signalling.deliver({ t: "peer-left", peerId: "g1" });
    t.signalling.deliver({ t: "closed", code: 1006, reason: "" });
    expect(t.leaves).toEqual([]);
    expect(t.transport.status).toBe("open");
    expect(t.peers[0].closed).toBe(false);
    t.transport.send(new Uint8Array([7]));
    expect(t.peers[0].channels[0].sent).toEqual([new Uint8Array([7])]);
    t.peers[0].channels[0].onmessage?.({ data: new Uint8Array([6]).buffer });
    expect(t.received).toEqual([[[6], "g1"]]);
  });

  it("treats a failed ICE connection as a lost peer", async () => {
    const t = await linkedHost();
    t.peers[0].fail();
    expect(t.transport.status).toBe("failed");
    expect(t.leaves).toEqual(["g1"]);
  });

  it("sends the host back to waiting if the guest leaves before the channel opens", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    t.signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
    await settle();
    t.signalling.deliver({ t: "peer-left", peerId: "g1" });
    expect(t.peers[0].closed).toBe(true);
    expect(t.transport.status).toBe("waiting");
    expect(t.leaves).toEqual([]);
  });

  it("releases everything on close() and stays quiet afterwards", async () => {
    const t = await linkedHost();
    const channel = t.peers[0].channels[0];
    t.transport.close();
    expect(t.peers[0].closed).toBe(true);
    expect(channel.closed).toBe(true);
    expect(t.transport.status).toBe("closed");
    channel.onmessage?.({ data: new Uint8Array([1]).buffer });
    expect(t.received).toEqual([]);
  });
});
