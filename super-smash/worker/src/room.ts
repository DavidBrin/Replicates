/**
 * A room's rules, with no Cloudflare in them.
 *
 * The Durable Object (roomDO.ts) is a thin shell that maps these decisions onto
 * sockets; everything that can be wrong lives here, where a plain vitest run
 * can see it. A room holds two peers: the first in is the host (P1, picks the
 * stage), the second the guest. It relays envelopes and understands nothing
 * inside them.
 */

import {
  MAX_MESSAGES_PER_PEER,
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
  | { readonly type: "admit"; readonly peer: PeerInfo; readonly welcome: ServerMessage; readonly notify: Delivery | null }
  | { readonly type: "reject"; readonly reason: RoomError; readonly closeCode: number; readonly message: ServerMessage };

export type RelayOutcome =
  | { readonly type: "forward"; readonly delivery: Delivery }
  | { readonly type: "reply"; readonly message: ServerMessage }
  | { readonly type: "drop" }
  | { readonly type: "kick"; readonly reason: RoomError; readonly closeCode: number; readonly message: ServerMessage };

/** v1 online is two players (spec §3.3). */
export const ROOM_CAPACITY = 2;

export function decideJoin(existing: readonly PeerInfo[], intent: RoomIntent, newId: string): JoinDecision {
  if (existing.length >= ROOM_CAPACITY) return { type: "reject", ...refusal("full") };
  // A fresh code that is already in use: the creator makes another one.
  if (intent === "create" && existing.length > 0) return { type: "reject", ...refusal("taken") };
  // Joining an empty room means the code was misheard or the host has gone.
  if (intent === "join" && existing.length === 0) return { type: "reject", ...refusal("not-found") };

  const role: Role = existing.some((p) => p.role === "host") ? "guest" : "host";
  const peer: PeerInfo = { id: newId, role };
  // Rebuilt rather than passed through: the room hands in its socket
  // attachments, which also carry the private `received` counter.
  const first = existing[0];
  const other: PeerInfo | null = first ? { id: first.id, role: first.role } : null;
  return {
    type: "admit",
    peer,
    welcome: { t: "welcome", self: peer, peer: other },
    notify: other ? { to: other.id, message: { t: "peer-joined", peer } } : null,
  };
}

export function relay(from: PeerAttachment, raw: string | ArrayBuffer, peers: readonly PeerInfo[]): RelayOutcome {
  if (from.received >= MAX_MESSAGES_PER_PEER) return { type: "kick", ...refusal("too-many-messages") };
  const message = parseClientMessage(raw);
  if (!message) return { type: "reply", message: { t: "error", reason: "bad-message" } };
  const other = peers.find((p) => p.id !== from.id);
  if (!other) return { type: "drop" };
  // The sender is stamped here, never read from the message.
  const relayed: ServerMessage =
    message.t === "signal"
      ? { t: "signal", from: from.id, payload: message.payload }
      : { t: "lobby", from: from.id, payload: message.payload };
  return { type: "forward", delivery: { to: other.id, message: relayed } };
}

export function departures(left: PeerInfo, peers: readonly PeerInfo[]): Delivery[] {
  return peers
    .filter((p) => p.id !== left.id)
    .map((p) => ({ to: p.id, message: { t: "peer-left", peerId: left.id } }));
}

function refusal(reason: RoomError): { reason: RoomError; closeCode: number; message: ServerMessage } {
  return { reason, closeCode: ROOM_CLOSE_CODES[reason], message: { t: "error", reason } };
}
