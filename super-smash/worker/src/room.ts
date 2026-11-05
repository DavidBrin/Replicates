/**
 * A room's rules, with no Cloudflare in them.
 *
 * The Durable Object (roomDO.ts) is a thin shell that maps these decisions onto
 * sockets; everything that can be wrong lives here, where a plain vitest run
 * can see it. A room seats each peer at a port: the first in takes port 0 and
 * is the host (P1, picks the stage), and each later one takes the lowest free
 * port and is a guest. It relays envelopes, to one peer when they are
 * addressed and to every other peer when not, and understands nothing inside
 * them.
 */

import {
  MAX_MESSAGES_PER_PEER,
  RELAY_BURST,
  RELAY_ID_BYTES,
  RELAY_KICK_DROPS,
  RELAY_MAX_FRAME_BYTES,
  RELAY_MAX_FRAMES_PER_SOCKET,
  RELAY_RATE_PER_SECOND,
  ROOM_CLOSE_CODES,
  parseClientMessage,
  type PeerInfo,
  type Role,
  type RoomError,
  type RoomIntent,
  type ServerMessage,
} from "../../src/net/signalProtocol";

/** What the Durable Object keeps on each socket (`serializeAttachment`). */
export interface PeerAttachment extends PeerInfo {
  /** Messages this socket has sent, for the flood cap. */
  readonly received: number;
}

export interface Delivery {
  readonly to: string;
  readonly message: ServerMessage;
}

export type JoinDecision =
  | {
      readonly type: "admit";
      readonly peer: PeerInfo;
      readonly welcome: ServerMessage;
      /** One `peer-joined` for each peer already seated. */
      readonly notify: readonly Delivery[];
    }
  | { readonly type: "reject"; readonly reason: RoomError; readonly closeCode: number; readonly message: ServerMessage };

export type RelayOutcome =
  | { readonly type: "forward"; readonly deliveries: readonly Delivery[] }
  | { readonly type: "reply"; readonly message: ServerMessage }
  | { readonly type: "drop" }
  | { readonly type: "kick"; readonly reason: RoomError; readonly closeCode: number; readonly message: ServerMessage };

/** Online seats up to four (Plan 7, Phase B), as many as a local match (`MAX_PLAYERS`). */
export const ROOM_CAPACITY = 4;

/** `capacity` is a parameter so the full-room rule can be tested at other sizes. */
export function decideJoin(
  existing: readonly PeerInfo[],
  intent: RoomIntent,
  newId: string,
  capacity: number = ROOM_CAPACITY,
): JoinDecision {
  if (existing.length >= capacity) return { type: "reject", ...refusal("full") };
  // A fresh code that is already in use: the creator makes another one.
  if (intent === "create" && existing.length > 0) return { type: "reject", ...refusal("taken") };
  // Joining an empty room means the code was misheard or the host has gone.
  if (intent === "join" && existing.length === 0) return { type: "reject", ...refusal("not-found") };

  // Fewer peers than seats, so a port in 0..capacity-1 is free: the lowest one.
  let port = 0;
  while (existing.some((p) => p.port === port)) port += 1;
  const role: Role = port === 0 ? "host" : "guest";
  const peer: PeerInfo = { id: newId, role, port };
  // Rebuilt rather than passed through: the room hands in its socket
  // attachments, which also carry the private `received` counter.
  const others: PeerInfo[] = existing
    .map((p): PeerInfo => ({ id: p.id, role: p.role, port: p.port }))
    .sort((a, b) => a.port - b.port);
  return {
    type: "admit",
    peer,
    // `peer` is the old welcome's field, for the tabs of the release before this one (see ServerMessage).
    welcome: { t: "welcome", self: peer, peers: others, peer: others[0] ?? null },
    notify: others.map((other) => ({ to: other.id, message: { t: "peer-joined", peer } })),
  };
}

export function relay(from: PeerAttachment, raw: string | ArrayBuffer, peers: readonly PeerInfo[]): RelayOutcome {
  if (from.received >= MAX_MESSAGES_PER_PEER) return { type: "kick", ...refusal("too-many-messages") };
  const message = parseClientMessage(raw);
  if (!message) return { type: "reply", message: { t: "error", reason: "bad-message" } };
  // Addressed: that peer alone, if it is seated and is not the sender. Otherwise: everyone else.
  const { to } = message;
  const recipients = peers.filter((p) => p.id !== from.id && (to === undefined || p.id === to));
  if (recipients.length === 0) return { type: "drop" };
  // The sender is stamped here, never read from the message.
  const relayed: ServerMessage =
    message.t === "signal"
      ? { t: "signal", from: from.id, payload: message.payload }
      : { t: "lobby", from: from.id, payload: message.payload };
  return { type: "forward", deliveries: recipients.map((p) => ({ to: p.id, message: relayed })) };
}

/**
 * A socket's allowance for game frames. Kept in memory only: it is not worth a
 * storage write per frame, and a hibernation wake refills it, which costs
 * nothing a determined flooder could not already do by reconnecting.
 */
export interface RelayBucket {
  tokens: number;
  atMs: number;
  /** Frames dropped over the rate since the bucket was last full (RELAY_KICK_DROPS). */
  dropped: number;
  /**
   * Game frames this socket has sent, dropped or not (RELAY_MAX_FRAMES_PER_SOCKET).
   * In memory like the rest, so a hibernation wake counts again from 0. That is
   * acceptable: a relayed match sends a frame every 33 ms, which keeps the
   * object awake, and a socket quiet long enough to let it sleep cost nothing
   * meanwhile.
   */
  frames: number;
}

export function newRelayBucket(nowMs: number): RelayBucket {
  return { tokens: RELAY_BURST, atMs: nowMs, dropped: 0, frames: 0 };
}

/** A peer id as the bytes the relay prefixes onto its frames. */
export function peerIdBytes(id: string): Uint8Array {
  const bytes = new TextEncoder().encode(id);
  if (bytes.length !== RELAY_ID_BYTES) throw new Error(`a peer id is ${RELAY_ID_BYTES} bytes, got ${bytes.length}`);
  return bytes;
}

export type GameFrameOutcome =
  | { readonly type: "forward"; readonly frame: Uint8Array }
  | { readonly type: "drop" }
  | { readonly type: "kick"; readonly reason: RoomError; readonly closeCode: number; readonly message: ServerMessage };

/**
 * One binary frame from a peer, for every other peer. The payload is copied
 * after the sender's id and read by nothing: it is the rollback session's
 * packets, and the room has no business in them.
 */
export function relayGameFrame(
  sender: Uint8Array,
  payload: ArrayBuffer,
  bucket: RelayBucket,
  nowMs: number,
): GameFrameOutcome {
  // Every frame is billed on arrival, whatever happens to it next, so every one counts.
  if (bucket.frames >= RELAY_MAX_FRAMES_PER_SOCKET) return { type: "kick", ...refusal("too-many-messages") };
  bucket.frames += 1;
  if (payload.byteLength === 0) return { type: "drop" };
  if (payload.byteLength > RELAY_MAX_FRAME_BYTES) return { type: "kick", ...refusal("bad-message") };
  bucket.tokens = Math.min(RELAY_BURST, bucket.tokens + ((nowMs - bucket.atMs) * RELAY_RATE_PER_SECOND) / 1000);
  bucket.atMs = nowMs;
  if (bucket.tokens >= RELAY_BURST) bucket.dropped = 0;
  if (bucket.tokens < 1) {
    // A dropped frame was still billed, so a socket that keeps sending over the rate is closed.
    if (bucket.dropped >= RELAY_KICK_DROPS) return { type: "kick", ...refusal("too-many-messages") };
    bucket.dropped += 1;
    return { type: "drop" };
  }
  bucket.tokens -= 1;
  const frame = new Uint8Array(RELAY_ID_BYTES + payload.byteLength);
  frame.set(sender, 0);
  frame.set(new Uint8Array(payload), RELAY_ID_BYTES);
  return { type: "forward", frame };
}

/** What the Durable Object keeps in memory per admitted socket, to relay its game frames. */
export interface LivePeer {
  readonly id: string;
  readonly idBytes: Uint8Array;
  readonly bucket: RelayBucket;
}

/** An entry for an admitted peer with a well-formed id; null for anything else. Never throws. */
export function livePeerFor(attachment: PeerAttachment | null, nowMs: number): LivePeer | null {
  if (!attachment) return null;
  try {
    return { id: attachment.id, idBytes: peerIdBytes(attachment.id), bucket: newRelayBucket(nowMs) };
  } catch {
    return null;
  }
}

export function departures(left: PeerInfo, peers: readonly PeerInfo[]): Delivery[] {
  return peers
    .filter((p) => p.id !== left.id)
    .map((p) => ({ to: p.id, message: { t: "peer-left", peerId: left.id } }));
}

function refusal(reason: RoomError): { reason: RoomError; closeCode: number; message: ServerMessage } {
  return { reason, closeCode: ROOM_CLOSE_CODES[reason], message: { t: "error", reason } };
}
