/**
 * The JSON a room's Durable Object relays between two browsers.
 *
 * Compiled twice — into the Worker (worker/tsconfig.json) and into the app —
 * so it imports nothing and touches no DOM type. The room understands only the
 * envelope: who you are, who else is here, and "deliver this to the other
 * one". SDP, ICE and lobby payloads pass through it untouched, which is what
 * keeps the Durable Object a dumb pipe with nothing to keep in sync.
 *
 * Parsers return null rather than throwing, for the reason `decodePacket`
 * does: these bytes come from a machine we do not control.
 */

export type Role = "host" | "guest";

/** The host is P1 and picks the stage; the guest is P2. */
export const ROLE_PORT: Readonly<Record<Role, number>> = { host: 0, guest: 1 };

export type RoomIntent = "create" | "join";

export type RoomError = "full" | "taken" | "not-found" | "bad-message" | "too-many-messages";

/**
 * WebSocket close codes the room uses. 4000–4999 is the range RFC 6455 leaves
 * to applications, and the browser cannot read an HTTP status off a failed
 * upgrade — so a refusal is an accepted socket that says why and then closes.
 */
export const ROOM_CLOSE_CODES: Readonly<Record<RoomError, number>> = {
  full: 4001,
  taken: 4002,
  "not-found": 4003,
  "bad-message": 4004,
  "too-many-messages": 4008,
};

/** A WebSocket attachment caps at 16 KiB; no signalling message needs more. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * Per socket. A connection exchanges an offer, an answer, a few dozen ICE
 * candidates and a handful of lobby picks; two thousand is generous for that
 * and still bounds what one misbehaving tab can bill against the free tier's
 * 100k requests a day (incoming WebSocket messages count 20:1, R§5).
 */
export const MAX_MESSAGES_PER_PEER = 2000;

export interface PeerInfo {
  readonly id: string;
  readonly role: Role;
}

export interface WireIceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly usernameFragment: string | null;
}

export type SignalPayload =
  | { readonly kind: "offer"; readonly sdp: string }
  | { readonly kind: "answer"; readonly sdp: string }
  | { readonly kind: "ice"; readonly candidate: WireIceCandidate };

/** A lobby payload, as the room sees it: something with a short `kind`. */
export interface OpaquePayload {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export type ClientMessage =
  | { readonly t: "signal"; readonly payload: SignalPayload }
  | { readonly t: "lobby"; readonly payload: OpaquePayload };

export type ServerMessage =
  | { readonly t: "welcome"; readonly self: PeerInfo; readonly peer: PeerInfo | null }
  | { readonly t: "peer-joined"; readonly peer: PeerInfo }
  | { readonly t: "peer-left"; readonly peerId: string }
  | { readonly t: "signal"; readonly from: string; readonly payload: SignalPayload }
  | { readonly t: "lobby"; readonly from: string; readonly payload: OpaquePayload }
  | { readonly t: "error"; readonly reason: RoomError };

const ROOM_ERRORS: readonly RoomError[] = ["full", "taken", "not-found", "bad-message", "too-many-messages"];

export function parseRoomIntent(value: string | null): RoomIntent | null {
  return value === "create" || value === "join" ? value : null;
}

/**
 * One raw WebSocket frame from a browser. Binary frames are never valid.
 *
 * The cap is in UTF-8 bytes, which is what the wire carries and the free tier
 * bills. `raw.length` counts UTF-16 code units, and each takes one to three
 * bytes (three for CJK), so it can only ever undercount: it is a cheap
 * early-out, and a frame short in code units can still be too long in bytes.
 */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  if (new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.t === "signal") {
    const payload = parseSignalPayload(value.payload);
    return payload ? { t: "signal", payload } : null;
  }
  if (value.t === "lobby") {
    const payload = value.payload;
    return isOpaquePayload(payload) ? { t: "lobby", payload } : null;
  }
  return null;
}

export function parseSignalPayload(value: unknown): SignalPayload | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  const sdp = value.sdp;
  if ((kind === "offer" || kind === "answer") && typeof sdp === "string") return { kind, sdp };
  if (kind === "ice") {
    const candidate = parseIceCandidate(value.candidate);
    return candidate ? { kind: "ice", candidate } : null;
  }
  return null;
}

/** A frame from the room, already through `JSON.parse`. */
export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "welcome": {
      const self = parsePeer(value.self);
      if (!self) return null;
      if (value.peer === null) return { t: "welcome", self, peer: null };
      const peer = parsePeer(value.peer);
      return peer ? { t: "welcome", self, peer } : null;
    }
    case "peer-joined": {
      const peer = parsePeer(value.peer);
      return peer ? { t: "peer-joined", peer } : null;
    }
    case "peer-left": {
      const peerId = value.peerId;
      return typeof peerId === "string" ? { t: "peer-left", peerId } : null;
    }
    case "signal": {
      const from = value.from;
      const payload = parseSignalPayload(value.payload);
      return payload && typeof from === "string" ? { t: "signal", from, payload } : null;
    }
    case "lobby": {
      const from = value.from;
      const payload = value.payload;
      return typeof from === "string" && isOpaquePayload(payload) ? { t: "lobby", from, payload } : null;
    }
    case "error": {
      const reason = value.reason;
      return isRoomError(reason) ? { t: "error", reason } : null;
    }
    default:
      return null;
  }
}

export function roomErrorForCloseCode(code: number): RoomError | null {
  for (const reason of ROOM_ERRORS) if (ROOM_CLOSE_CODES[reason] === code) return reason;
  return null;
}

/**
 * A plain JSON object: not null, not an array. Exported so the lobby messages
 * (which are parsed on the same untrusted-bytes terms) share this guard
 * instead of keeping a second copy.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ----------------------------------------------------------------- helpers -- */

function parseIceCandidate(value: unknown): WireIceCandidate | null {
  if (!isRecord(value)) return null;
  const candidate = value.candidate;
  if (typeof candidate !== "string") return null;
  const sdpMid = typeof value.sdpMid === "string" ? value.sdpMid : null;
  const index = value.sdpMLineIndex;
  const sdpMLineIndex = typeof index === "number" && Number.isInteger(index) ? index : null;
  const usernameFragment = typeof value.usernameFragment === "string" ? value.usernameFragment : null;
  return { candidate, sdpMid, sdpMLineIndex, usernameFragment };
}

function parsePeer(value: unknown): PeerInfo | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const role = value.role;
  if (typeof id !== "string" || (role !== "host" && role !== "guest")) return null;
  return { id, role };
}

function isOpaquePayload(value: unknown): value is OpaquePayload {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  return typeof kind === "string" && kind.length > 0 && kind.length <= 32;
}

function isRoomError(value: unknown): value is RoomError {
  return typeof value === "string" && (ROOM_ERRORS as readonly string[]).includes(value);
}
