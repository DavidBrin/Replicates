/**
 * The browser's end of a room socket: `/ws/room/<CODE>?intent=create|join`.
 *
 * It carries the handshake and the lobby. Messages sent before the socket
 * opens are queued rather than dropped, because the lobby fires its first
 * message the moment it learns its role. The socket's close code is surfaced as
 * an event: 4001–4008 are the room refusing (full, taken, not-found…), 1006
 * before a welcome is "there is no Worker here".
 *
 * It also carries game data when the relay is in use (`relayFrame.ts`): binary
 * frames, which are never queued (a frame held until the socket opens would
 * arrive as stale input) and are dropped while the socket's buffer is full.
 */

import { RELAY_MAX_BUFFERED_BYTES, splitRelayFrame } from "./relayFrame";
import { createEmitter, type Unsubscribe } from "./transport";
import { parseServerMessage, type ClientMessage, type RoomIntent, type ServerMessage } from "./signalProtocol";

/** The part of a WebSocket this client touches; tests supply a fake. */
export interface WebSocketLike {
  readonly readyState: number;
  /** How much a `send` has handed the browser that it has not yet written out. */
  readonly bufferedAmount: number;
  /** "arraybuffer" makes a binary message an `ArrayBuffer` rather than a `Blob`. */
  binaryType: string;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SignallingEvent =
  | ServerMessage
  | { readonly t: "closed"; readonly code: number; readonly reason: string }
  /** A binary frame relayed by the room: one `encodeRelayBatch` batch, and the id the room stamped on it. */
  | { readonly t: "game"; readonly from: string; readonly bytes: Uint8Array };

export interface SignallingClient {
  readonly url: string;
  send(message: ClientMessage): void;
  /** One relay batch as a binary frame. Dropped, never queued, unless the socket is open with room in its buffer. */
  sendGame(batch: Uint8Array): void;
  on(cb: (event: SignallingEvent) => void): Unsubscribe;
  /** Idempotent. Closes with 1000 and emits nothing further. */
  close(): void;
}

export interface SignallingOptions {
  readonly roomCode: string;
  readonly intent: RoomIntent;
  /** Defaults to `window.location.origin`. */
  readonly origin?: string;
  readonly createSocket?: (url: string) => WebSocketLike;
}

const OPEN = 1;

export function roomSocketUrl(origin: string, roomCode: string, intent: RoomIntent): string {
  const url = new URL(origin);
  const scheme = url.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${url.host}/ws/room/${encodeURIComponent(roomCode)}?intent=${intent}`;
}

/** One cast at the boundary, as in adapters/webrtc.ts: DOM handler types are wider than the slice used here. */
const browserSocket = (url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike;

export function createSignallingClient(options: SignallingOptions): SignallingClient {
  const url = roomSocketUrl(options.origin ?? window.location.origin, options.roomCode, options.intent);
  const socket = (options.createSocket ?? browserSocket)(url);
  const events = createEmitter<[SignallingEvent]>();
  const queue: string[] = [];
  let closed = false;

  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    for (const raw of queue.splice(0)) socket.send(raw);
  };
  socket.onmessage = (event) => {
    if (closed) return;
    if (event.data instanceof ArrayBuffer) {
      const frame = splitRelayFrame(new Uint8Array(event.data));
      if (frame) events.emit({ t: "game", from: frame.from, bytes: frame.batch });
      return;
    }
    if (typeof event.data !== "string") return;
    let value: unknown;
    try {
      value = JSON.parse(event.data);
    } catch {
      return;
    }
    const message = parseServerMessage(value);
    if (message) events.emit(message);
  };
  socket.onclose = (event) => {
    if (closed) return;
    closed = true;
    events.emit({ t: "closed", code: event.code, reason: event.reason });
    events.clear();
  };
  socket.onerror = () => {
    // A close event always follows an error, and it carries the code.
  };

  return {
    url,
    send(message) {
      if (closed) return;
      const raw = JSON.stringify(message);
      if (socket.readyState === OPEN) socket.send(raw);
      else queue.push(raw);
    },
    sendGame(batch) {
      if (closed || socket.readyState !== OPEN || socket.bufferedAmount > RELAY_MAX_BUFFERED_BYTES) return;
      socket.send(batch as Uint8Array<ArrayBuffer>);
    },
    on: (cb) => events.add(cb),
    close() {
      if (closed) return;
      closed = true;
      events.clear();
      queue.length = 0;
      try {
        socket.close(1000, "leaving");
      } catch {
        /* already closing */
      }
    },
  };
}
