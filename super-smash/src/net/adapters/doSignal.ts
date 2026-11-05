/**
 * WebRTC, introduced through the room's Durable Object — the adapter online
 * play uses.
 *
 * Same contract as the Trystero adapter (`webrtc.ts`), different matchmaker:
 * instead of public Nostr relays, the two browsers meet in a room on our own
 * Worker, which relays one offer, one answer and their ICE candidates and then
 * has nothing more to do. Game traffic goes straight between the browsers,
 * unless no direct link can be made: then `useRelay` moves it onto the room
 * socket too (relay mode, below).
 *
 * The host offers; the guest answers. Roles come from the room, so there is
 * no glare to resolve. There is exactly one data channel, the input channel —
 * `negotiated: true` on stream 42, `ordered: false, maxRetransmits: 0` —
 * created by both sides before the offer, so it is part of the first SDP and
 * opens with the connection. Nothing here needs a reliable channel: the lobby
 * goes over the room socket, and inputs are redundant by design (packet.ts).
 *
 * While the route is direct, the data channel is the authority on whether the
 * peer is there. The room socket is not: every Worker deploy restarts every
 * Durable Object and drops its sockets (Cloudflare's WebSocket docs say so),
 * and a match in progress must shrug that off. So once the match holds the
 * channel, `peer-left` from the room means nothing, and neither does a
 * newcomer: the room's two-peer cap counts live sockets, so after a drop it
 * admits anyone else with the code, and an open match ignores their
 * `peer-joined` or offer rather than dropping its peer. In the lobby it is the
 * other way round. The lobby rides the room socket, so a peer the room no
 * longer seats cannot be talked to, and the channel to it is let go: kept, it
 * would make this side ignore the newcomer the room seats next, and the lobby
 * would wait on a link that never comes.
 *
 * A lobby channel can also close with both room sockets still open, and then
 * nobody joins or leaves to start a new negotiation. So the host can offer the
 * guest the room still seats a fresh connection (`offerAgain`; the session
 * decides when), and a guest answers a new offer from its own host even while
 * it holds a connection, replacing it. A guest whose side closed alone says so
 * (`renegotiate`), and its host lets its own side go. Once the match starts,
 * `holdChannel` ends all three: the match's channel is never replaced.
 *
 * Relay mode (`useRelay`, Plan 7) is the other route. The peer connection is
 * gone and the room socket carries the game: a binary frame per send batch
 * (`relayFrame.ts`), stamped by the room with its sender. Now the room socket
 * is the link, so the roles above reverse: the room's `peer-joined` and
 * `peer-left` are the peers arriving and leaving (it seats them; there is
 * nothing to negotiate), and the socket closing, with any code, is every peer
 * leaving at once, because a relayed match with no room socket has no way to
 * hear anyone. The relay is sticky: there is no way back to direct.
 */

import { asBytes } from "../bytes";
import { DEFAULT_UNRELIABLE_CHANNEL_ID, INPUT_CHANNEL_LABEL } from "../channel";
import { STUN_ONLY } from "../iceConfig";
import { toRtcIceServers } from "../iceServers";
import { createRelayBatcher, decodeRelayBatch } from "../relayFrame";
import type { SignallingClient } from "../signalling";
import type { Role, WireIceCandidate } from "../signalProtocol";
import { createEmitter, type Transport } from "../transport";

export type DoSignalStatus = "waiting" | "negotiating" | "open" | "closed" | "failed";

/**
 * Where game packets go: straight to the peer, or through the room's Durable Object.
 *
 * The two routes order their events differently. Direct, the status changes
 * first and then the peer is announced or lost (`onopen`, `lose`). Relayed,
 * the join or leave is emitted first and the status changes after it. So a
 * join or leave listener must not read `status`: it would see the old one on
 * the relay and the new one on direct.
 */
export type Route = "direct" | "relay";

/**
 * How long a new peer connection gets to open its channel. A healthy one opens
 * in seconds, even through TURN; ICE that hangs rather than fails would
 * otherwise leave both players on "Connecting…" for good. Missing it counts as
 * the channel lost before it opened: the session retries a channel that had
 * opened before, and moves a first one that never did to the room relay
 * (`useRelay`; Plan 7, D60).
 */
export const NEGOTIATION_TIMEOUT_MS = 15_000;

/* -------------------------------------------- the WebRTC slice, structurally -- */

export interface DataChannelLike {
  readonly readyState: string;
  binaryType: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  send(data: Uint8Array<ArrayBuffer>): void;
  close(): void;
}

export interface IceCandidateJson {
  readonly candidate?: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
  readonly usernameFragment?: string | null;
}

export interface SessionDescriptionLike {
  readonly type: "offer" | "answer";
  readonly sdp: string;
}

export interface DataChannelInitLike {
  readonly negotiated: boolean;
  readonly id: number;
  readonly ordered: boolean;
  readonly maxRetransmits: number;
}

export interface PeerConnectionLike {
  readonly connectionState: string;
  onicecandidate: ((event: { readonly candidate: { toJSON(): IceCandidateJson } | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  createDataChannel(label: string, init: DataChannelInitLike): DataChannelLike;
  createOffer(): Promise<{ readonly sdp?: string }>;
  createAnswer(): Promise<{ readonly sdp?: string }>;
  setLocalDescription(description: SessionDescriptionLike): Promise<void>;
  setRemoteDescription(description: SessionDescriptionLike): Promise<void>;
  addIceCandidate(candidate: WireIceCandidate): Promise<void>;
  close(): void;
}

export interface PeerConfig {
  readonly iceServers: RTCIceServer[];
  /** "relay" forces TURN — the public e2e uses it to prove TURN works. */
  readonly iceTransportPolicy: "all" | "relay";
}

export interface DoSignalOptions {
  readonly signalling: SignallingClient;
  readonly iceServers: RTCIceServer[];
  readonly forceRelay?: boolean;
  /** Injected in tests; jsdom has no WebRTC. */
  readonly createPeerConnection?: (config: PeerConfig) => PeerConnectionLike;
  readonly onStatus?: (status: DoSignalStatus) => void;
}

export interface DoSignalTransport extends Transport {
  readonly status: DoSignalStatus;
  /** Known once the room's welcome arrives. */
  readonly role: Role | null;
  /**
   * The host offers `peerId` a fresh peer connection, as when it joined. Only
   * while the channel is down (`waiting`) and not held; a no-op otherwise.
   */
  offerAgain(peerId: string): void;
  /** The match has started: from now on its channel is never replaced, by either side. */
  holdChannel(): void;
  /** The seat the match was for emptied before it began: a lobby again (see `holdChannel`). */
  releaseChannel(): void;
  /** Where packets go now. Starts direct; `useRelay` makes it relay, for good. */
  readonly route: Route;
  /**
   * No direct link: carry the match through the room socket instead. The peer
   * connection is let go, every peer the room seats is announced (one the
   * direct channel had announced is not announced again, unless the room has
   * stopped seating it: then it leaves, as a peer the room says left does),
   * and the status is open if anyone is seated. A no-op once relaying or
   * closed. Joins and leaves are emitted before the status changes, the
   * reverse of the direct route: listeners must not read `status` inside them
   * (see `Route`).
   */
  useRelay(): void;
}

/** One cast at the boundary, for the reason webrtc.ts gives for `RoomLike`. */
const browserPeerConnection = (config: PeerConfig): PeerConnectionLike =>
  new RTCPeerConnection(config) as unknown as PeerConnectionLike;

/* ----------------------------------------------------------------- adapter -- */

export function createDoSignalTransport(options: DoSignalOptions): DoSignalTransport {
  const createPeer = options.createPeerConnection ?? browserPeerConnection;
  const messages = createEmitter<[Uint8Array, string]>();
  const joins = createEmitter<[string]>();
  const leaves = createEmitter<[string]>();
  const batcher = createRelayBatcher((batch) => options.signalling.sendGame(batch));

  let selfId = "pending";
  let role: Role | null = null;
  /**
   * The host the room named: the welcome's, or a replacement that joined
   * before the channel opened. A guest takes offers from no one else.
   */
  let hostId: string | null = null;
  let status: DoSignalStatus = "waiting";
  let closed = false;
  /** Set by `holdChannel`: the match owns the channel now. */
  let held = false;

  let pc: PeerConnectionLike | null = null;
  let channel: DataChannelLike | null = null;
  let remoteId: string | null = null;
  let announced = false;
  let remoteDescriptionSet = false;
  let route: Route = "direct";
  /** The peers the room seats, in either route: `welcome`'s, then `peer-joined` and `peer-left`. */
  const seated = new Set<string>();
  /** Relay mode: the peers announced so far, so each is announced once and its leave is said once. */
  const relayAnnounced = new Set<string>();
  /** The current connection's deadline to open its channel; see `NEGOTIATION_TIMEOUT_MS`. */
  let deadline: ReturnType<typeof setTimeout> | null = null;
  /**
   * Remote candidates waiting for a description to land on, filed by sender.
   * Kept across teardown, since a sender's next offer may already have
   * candidates here; dropped once applied, when the sender leaves the room, or
   * on close().
   */
  const pendingIce = new Map<string, WireIceCandidate[]>();

  function setStatus(next: DoSignalStatus): void {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  }

  function clearDeadline(): void {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
  }

  function teardown(): void {
    clearDeadline();
    const ch = channel;
    const conn = pc;
    channel = null;
    pc = null;
    remoteId = null;
    announced = false;
    remoteDescriptionSet = false;
    if (ch) {
      ch.onopen = null;
      ch.onclose = null;
      ch.onerror = null;
      ch.onmessage = null;
      try {
        ch.close();
      } catch {
        /* already gone */
      }
    }
    if (conn) {
      conn.onicecandidate = null;
      conn.onconnectionstatechange = null;
      try {
        conn.close();
      } catch {
        /* already gone */
      }
    }
  }

  /** The peer is gone for good: say so once, then wait for another. */
  function lose(next: DoSignalStatus): void {
    const id = remoteId;
    const wasAnnounced = announced;
    teardown();
    setStatus(next);
    if (wasAnnounced && id !== null) leaves.emit(id);
  }

  /**
   * The constructor throws on a config the browser refuses (a TURN url without
   * credentials, a server with no urls) before any network I/O. A match on
   * STUN alone beats none, so that falls back. A forced relay stays forced, so
   * a broken TURN config fails visibly rather than quietly going direct. Null
   * only when no peer connection can be built at all.
   */
  function buildPeer(): PeerConnectionLike | null {
    const iceTransportPolicy = options.forceRelay ? "relay" : "all";
    try {
      return createPeer({ iceServers: options.iceServers, iceTransportPolicy });
    } catch {
      /* fall back to STUN only, below */
    }
    try {
      return createPeer({ iceServers: toRtcIceServers(STUN_ONLY), iceTransportPolicy });
    } catch {
      return null; // no WebRTC here at all
    }
  }

  /** Relay mode: a seated peer is here. Said once. */
  function announceRelayed(peerId: string): void {
    if (relayAnnounced.has(peerId)) return;
    relayAnnounced.add(peerId);
    joins.emit(peerId);
  }

  /** Relay mode: the room socket is gone, so every peer announced is gone with it. */
  function loseRelayedPeers(): void {
    const gone = [...relayAnnounced];
    relayAnnounced.clear();
    seated.clear();
    for (const id of gone) leaves.emit(id);
    setStatus("waiting");
  }

  function useRelay(): void {
    if (closed || route === "relay") return;
    // The peer the direct channel had announced stays announced while the room
    // still seats it: the relay only changes how it is reached, so neither a
    // leave nor a second join goes out. A held match keeps its channel through
    // the room's `peer-left`, so the peer may be gone from the room by now. The
    // relay cannot reach it and the room will not say so again: it leaves here.
    const carried = announced ? remoteId : null;
    teardown();
    route = "relay";
    if (carried !== null && seated.has(carried)) relayAnnounced.add(carried);
    for (const id of seated) announceRelayed(id);
    if (carried !== null && !seated.has(carried)) leaves.emit(carried);
    setStatus(seated.size > 0 ? "open" : "waiting");
  }

  function openPeer(peerId: string): PeerConnectionLike | null {
    teardown();
    const conn = buildPeer();
    const ch = conn === null ? null : openInputChannel(conn);
    if (conn === null || ch === null) {
      // No peer connection, or one without the input channel: no online play in this browser.
      setStatus("failed");
      return null;
    }
    remoteId = peerId;
    ch.binaryType = "arraybuffer";

    conn.onicecandidate = (event) => {
      if (conn !== pc || event.candidate === null) return;
      const candidate = toWire(event.candidate.toJSON());
      if (candidate) options.signalling.send({ t: "signal", payload: { kind: "ice", candidate } });
    };
    conn.onconnectionstatechange = () => {
      if (conn === pc && conn.connectionState === "failed") lose("failed");
    };
    ch.onopen = () => {
      if (ch !== channel || closed || remoteId === null) return;
      clearDeadline();
      setStatus("open");
      if (!announced) {
        announced = true;
        joins.emit(remoteId);
      }
    };
    ch.onmessage = (event) => {
      if (ch !== channel || closed || remoteId === null) return;
      const bytes = asBytes(event.data);
      if (bytes) messages.emit(bytes, remoteId);
    };
    ch.onclose = () => {
      if (ch === channel) lose("waiting");
    };
    ch.onerror = () => {
      if (ch === channel) lose("waiting");
    };

    pc = conn;
    channel = ch;
    // Missed, it is the channel lost before it opened, as if it had closed.
    deadline = setTimeout(() => {
      deadline = null;
      if (ch === channel && !announced) lose("waiting");
    }, NEGOTIATION_TIMEOUT_MS);
    setStatus("negotiating");
    return conn;
  }

  async function offerTo(peerId: string): Promise<void> {
    const conn = openPeer(peerId);
    if (conn === null) return;
    try {
      const offer = await conn.createOffer();
      if (conn !== pc) return;
      const sdp = offer.sdp ?? "";
      await conn.setLocalDescription({ type: "offer", sdp });
      if (conn !== pc) return;
      options.signalling.send({ t: "signal", payload: { kind: "offer", sdp } });
    } catch {
      if (conn === pc) lose("failed");
    }
  }

  async function answer(peerId: string, offerSdp: string): Promise<void> {
    const conn = openPeer(peerId);
    if (conn === null) return;
    try {
      await conn.setRemoteDescription({ type: "offer", sdp: offerSdp });
      if (conn !== pc) return;
      remoteDescriptionSet = true;
      await flushIce(conn);
      const reply = await conn.createAnswer();
      if (conn !== pc) return;
      const sdp = reply.sdp ?? "";
      await conn.setLocalDescription({ type: "answer", sdp });
      if (conn !== pc) return;
      options.signalling.send({ t: "signal", payload: { kind: "answer", sdp } });
    } catch {
      if (conn === pc) lose("failed");
    }
  }

  async function acceptAnswer(sdp: string): Promise<void> {
    const conn = pc;
    if (conn === null) return;
    try {
      await conn.setRemoteDescription({ type: "answer", sdp });
      if (conn !== pc) return;
      remoteDescriptionSet = true;
      await flushIce(conn);
    } catch {
      if (conn === pc) lose("failed");
    }
  }

  /**
   * Candidates can outrun the description they belong to, even the offer
   * itself, and adding one first throws. So a candidate waits, filed under its
   * sender, until that sender's description is set on our connection.
   */
  async function addIce(from: string, candidate: WireIceCandidate): Promise<void> {
    const conn = pc;
    if (conn === null || from !== remoteId || !remoteDescriptionSet) {
      const held = pendingIce.get(from);
      if (held) held.push(candidate);
      else pendingIce.set(from, [candidate]);
      return;
    }
    await applyIce(conn, candidate);
  }

  /** `conn`'s remote description is set: whatever its peer sent early goes in now. */
  async function flushIce(conn: PeerConnectionLike): Promise<void> {
    if (remoteId === null) return;
    const held = pendingIce.get(remoteId) ?? [];
    pendingIce.delete(remoteId);
    for (const candidate of held) {
      if (conn !== pc) return;
      await applyIce(conn, candidate);
    }
  }

  async function applyIce(conn: PeerConnectionLike, candidate: WireIceCandidate): Promise<void> {
    try {
      await conn.addIceCandidate(candidate);
    } catch {
      // Malformed (no m-line, or one out of range), stale or duplicate: the
      // browser refuses that one candidate and the connection carries on.
    }
  }

  const off = options.signalling.on((event) => {
    if (closed) return;
    switch (event.t) {
      case "welcome":
        selfId = event.self.id;
        role = event.self.role;
        if (event.peer) seated.add(event.peer.id);
        // A guest is only ever admitted beside a host, so its welcome's peer is that host.
        hostId = role === "guest" ? (event.peer?.id ?? null) : null;
        if (route === "relay") {
          // Nothing to negotiate: the room seats the peer, and that is the link.
          if (event.peer) {
            announceRelayed(event.peer.id);
            setStatus("open");
          }
        } else if (role === "host" && event.peer) void offerTo(event.peer.id);
        break;
      case "peer-joined":
        seated.add(event.peer.id);
        if (route === "relay") {
          announceRelayed(event.peer.id);
          setStatus("open");
          break;
        }
        // While a channel is open it decides (see the header): a newcomer does not replace the peer.
        if (announced) break;
        if (role === "host") void offerTo(event.peer.id);
        // Before then, a host that left can be replaced: the room makes the next joiner host.
        else if (role === "guest" && event.peer.role === "host") hostId = event.peer.id;
        break;
      case "signal": {
        // The relay has no peer connection to negotiate, and a late message from the old one is stale.
        if (route === "relay") break;
        const payload = event.payload;
        if (payload.kind === "offer") {
          // Only from our own host. Once open, only in the lobby: our host
          // offers again only after its side of the channel was lost, which
          // this side may not have noticed yet (see the header).
          if (role === "guest" && event.from === hostId && !(announced && held)) void answer(event.from, payload.sdp);
        } else if (payload.kind === "answer") {
          if (role === "host" && event.from === remoteId) void acceptAnswer(payload.sdp);
        } else if (payload.kind === "renegotiate") {
          // Our guest lost its side of the lobby channel, which this side may
          // still think open: let it go, and the session offers again.
          if (role === "host" && event.from === remoteId && !held) lose("waiting");
        } else {
          void addIce(event.from, payload.candidate);
        }
        break;
      }
      case "peer-left":
        // Nothing it sent early can be used now.
        pendingIce.delete(event.peerId);
        seated.delete(event.peerId);
        if (route === "relay") {
          // The room is the link, so its word is final, match or lobby.
          if (relayAnnounced.delete(event.peerId)) leaves.emit(event.peerId);
          if (seated.size === 0) setStatus("waiting");
          break;
        }
        if (event.peerId !== remoteId) break;
        if (!announced) {
          teardown();
          setStatus("waiting");
        } else if (!held) {
          // An open lobby channel to a peer the room no longer seats: let it go,
          // so the next `peer-joined` is offered to. A match's channel stays,
          // and its link monitor decides (see the header).
          lose("waiting");
        }
        break;
      case "game": {
        // Only the relay carries game data, and only from a peer the room seats.
        if (route !== "relay" || !seated.has(event.from)) break;
        const packets = decodeRelayBatch(event.bytes);
        if (packets) for (const packet of packets) messages.emit(packet, event.from);
        break;
      }
      case "closed":
        // Direct, the channel is the link and a dropped room socket means nothing (see the
        // header). Relayed, it was the link: every peer is gone, whatever the close code.
        if (route === "relay") loseRelayedPeers();
        break;
      default:
        // lobby and error belong to the session, not the transport.
        break;
    }
  });

  return {
    get selfId() {
      return selfId;
    },
    get role() {
      return role;
    },
    get status() {
      return status;
    },
    get route() {
      return route;
    },
    send(bytes) {
      if (route === "relay") {
        if (!closed) batcher.push(bytes);
        return;
      }
      const ch = channel;
      if (closed || ch === null || ch.readyState !== "open") return;
      try {
        // Every packet comes from `encodePacket`, which allocates a plain ArrayBuffer.
        ch.send(bytes as Uint8Array<ArrayBuffer>);
      } catch {
        /* fire and forget: the next frame carries these inputs again */
      }
    },
    onMessage: (cb) => messages.add(cb),
    onPeerJoin: (cb) => joins.add(cb),
    onPeerLeave: (cb) => leaves.add(cb),
    offerAgain(peerId) {
      if (closed || route === "relay" || held || role !== "host" || status !== "waiting") return;
      void offerTo(peerId);
    },
    holdChannel() {
      held = true;
    },
    releaseChannel() {
      held = false;
    },
    useRelay,
    close() {
      if (closed) return;
      closed = true;
      off();
      teardown();
      // Only frees what is queued: `send` already drops everything once closed.
      batcher.clear();
      pendingIce.clear();
      seated.clear();
      relayAnnounced.clear();
      setStatus("closed");
      messages.clear();
      joins.clear();
      leaves.clear();
    },
  };
}

/* ----------------------------------------------------------------- helpers -- */

/** The input channel on `conn`, or null, with `conn` closed, if the browser refuses it. */
function openInputChannel(conn: PeerConnectionLike): DataChannelLike | null {
  try {
    return conn.createDataChannel(INPUT_CHANNEL_LABEL, {
      negotiated: true,
      id: DEFAULT_UNRELIABLE_CHANNEL_ID,
      ordered: false,
      maxRetransmits: 0,
    });
  } catch {
    try {
      conn.close();
    } catch {
      /* already gone */
    }
    return null;
  }
}

function toWire(json: IceCandidateJson): WireIceCandidate | null {
  // An empty candidate is the end-of-candidates marker; there is nothing to relay.
  if (!json.candidate) return null;
  return {
    candidate: json.candidate,
    sdpMid: json.sdpMid ?? null,
    sdpMLineIndex: json.sdpMLineIndex ?? null,
    usernameFragment: json.usernameFragment ?? null,
  };
}
