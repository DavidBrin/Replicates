/**
 * The browser's end of a room socket: `/ws/room/<CODE>?intent=create|join`.
 *
 * It carries the handshake and the lobby, never a game input. Messages sent
 * before the socket opens are queued rather than dropped, because the lobby
 * fires its first message the moment it learns its role. The socket's close
 * code is surfaced as an event: 4001–4008 are the room refusing (full, taken,
 * not-found…), 1006 before a welcome is "there is no Worker here".
 */

import { createEmitter, type Unsubscribe } from "./transport";
import { parseServerMessage, type ClientMessage, type RoomIntent, type ServerMessage } from "./signalProtocol";

/** The part of a WebSocket this client touches; tests supply a fake. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SignallingEvent = ServerMessage | { readonly t: "closed"; readonly code: number; readonly reason: string };

export interface SignallingClient {
  readonly url: string;
  send(message: ClientMessage): void;
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

  socket.onopen = () => {
    for (const raw of queue.splice(0)) socket.send(raw);
  };
  socket.onmessage = (event) => {
    if (closed || typeof event.data !== "string") return;
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
