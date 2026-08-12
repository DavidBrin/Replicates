/**
 * `BroadcastChannel` — two tabs on one machine.
 *
 * This is a real feature and not only a development convenience: opening a
 * second window is how two people play on one laptop when the keyboard cannot
 * carry both control schemes at once (SPEC §6), and it is how one person tests
 * a match against themselves. It is also the fastest way to develop netcode,
 * because a bug reproduces by pressing F5 twice.
 *
 * `BroadcastChannel` gives ordered, reliable, same-origin delivery and *no*
 * notion of who is listening — it is a bus, not a connection. So the presence
 * that `Transport` promises has to be built here: peers announce themselves,
 * answer announcements, heartbeat, and say goodbye. A peer that stops
 * heartbeating (a closed tab that never got to send its goodbye, which is most
 * of them) is dropped after a timeout.
 */

import { createEmitter, type Transport } from "../transport";

const CHANNEL_PREFIX = "super-smash:";

/** Announcements and heartbeats, twice a second. */
export const HEARTBEAT_MS = 500;
/** Silence this long means the tab is gone. Three missed beats. */
export const PEER_TIMEOUT_MS = 1600;

type Envelope =
  | { readonly t: "hello"; readonly from: string }
  | { readonly t: "welcome"; readonly from: string }
  | { readonly t: "beat"; readonly from: string }
  | { readonly t: "bye"; readonly from: string }
  | { readonly t: "msg"; readonly from: string; readonly d: Uint8Array };

/** The slice of `BroadcastChannel` this adapter uses. Narrowed so a test can
 *  supply a two-line fake instead of a DOM global. */
export interface BroadcastLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface BroadcastOptions {
  /** Same string on both tabs. Usually the room code or the match id. */
  roomId?: string;
  /** Overridable for tests, and for the day a browser needs a polyfill. */
  channelFactory?: (name: string) => BroadcastLike;
  /** Injected so tests can drive presence with fake timers or by hand. */
  setInterval?: (fn: () => void, ms: number) => number;
  clearInterval?: (handle: number) => void;
  now?: () => number;
  selfId?: string;
}

export function createBroadcastTransport(options: BroadcastOptions = {}): Transport {
  const roomId = options.roomId ?? "local";
  const selfId = options.selfId ?? randomId();
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms) as never);
  const clearTimer = options.clearInterval ?? ((h) => globalThis.clearInterval(h));

  const factory =
    options.channelFactory ??
    ((name: string) => {
      if (typeof BroadcastChannel === "undefined") {
        throw new Error("BroadcastChannel is unavailable in this environment");
      }
      return new BroadcastChannel(name) as unknown as BroadcastLike;
    });

  const channel = factory(CHANNEL_PREFIX + roomId);
  const messages = createEmitter<[Uint8Array, string]>();
  const joins = createEmitter<[string]>();
  const leaves = createEmitter<[string]>();
  const lastSeen = new Map<string, number>();
  let closed = false;

  const noteAlive = (peerId: string): void => {
    const known = lastSeen.has(peerId);
    lastSeen.set(peerId, now());
    if (!known) joins.emit(peerId);
  };

  channel.onmessage = (event) => {
    if (closed) return;
    const envelope = event.data as Envelope | null;
    if (!envelope || typeof envelope !== "object" || typeof envelope.from !== "string") return;
    if (envelope.from === selfId) return; // our own post, echoed by some polyfills

    switch (envelope.t) {
      case "hello":
        noteAlive(envelope.from);
        // Answer directly rather than waiting for the next heartbeat, so a tab
        // that has just opened learns about the tab that was already there
        // within one round of the bus instead of half a second.
        channel.postMessage({ t: "welcome", from: selfId } satisfies Envelope);
        break;
      case "welcome":
      case "beat":
        noteAlive(envelope.from);
        break;
      case "bye":
        if (lastSeen.delete(envelope.from)) leaves.emit(envelope.from);
        break;
      case "msg": {
        noteAlive(envelope.from);
        const data = envelope.d;
        if (data instanceof Uint8Array) messages.emit(data, envelope.from);
        else if (ArrayBuffer.isView(data)) messages.emit(toBytes(data), envelope.from);
        break;
      }
    }
  };

  const sweep = (): void => {
    const cutoff = now() - PEER_TIMEOUT_MS;
    for (const [peerId, seen] of [...lastSeen]) {
      if (seen < cutoff) {
        lastSeen.delete(peerId);
        leaves.emit(peerId);
      }
    }
    channel.postMessage({ t: "beat", from: selfId } satisfies Envelope);
  };

  channel.postMessage({ t: "hello", from: selfId } satisfies Envelope);
  const timer = setTimer(sweep, HEARTBEAT_MS);

  return {
    selfId,
    send(bytes) {
      if (closed) return;
      // A copy, because structured clone is asynchronous in spirit even when it
      // is not in practice, and the caller reuses its encode buffer.
      channel.postMessage({ t: "msg", from: selfId, d: bytes.slice() } satisfies Envelope);
    },
    onMessage: (cb) => messages.add(cb),
    /**
     * Subscribing late must not mean missing somebody.
     *
     * A bus delivers synchronously: the `hello` posted during construction can
     * draw a `welcome` back before the constructor has even returned, which is
     * necessarily before any caller could have subscribed. Replaying the peers
     * already known makes subscription order irrelevant — which matters,
     * because there is no order in which a caller could win that race.
     */
    onPeerJoin(cb) {
      const off = joins.add(cb);
      for (const peerId of [...lastSeen.keys()]) cb(peerId);
      return off;
    },
    onPeerLeave: (cb) => leaves.add(cb),
    close() {
      if (closed) return;
      closed = true;
      clearTimer(timer);
      try {
        channel.postMessage({ t: "bye", from: selfId } satisfies Envelope);
      } catch {
        // The channel may already be gone if the tab is unloading. Nothing to
        // do about it, and the peers' timeout covers exactly this case.
      }
      channel.onmessage = null;
      channel.close();
      messages.clear();
      joins.clear();
      leaves.clear();
      lastSeen.clear();
    },
  };
}

function toBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

function randomId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
  const bytes = new Uint8Array(8);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
