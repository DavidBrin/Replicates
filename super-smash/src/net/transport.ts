/**
 * The transport port.
 *
 * Everything the rollback session knows about the network is this interface: a
 * way to push bytes at every peer, and three streams of things that arrive back.
 * It deliberately does *not* expose connection state, ICE, room codes, retries
 * or ordering guarantees — the session is written as though every packet is a
 * postcard that may arrive late, twice, out of order, or never, because that is
 * exactly what the WebRTC adapter provides and it is the weakest contract of
 * the three. An adapter that happens to be reliable (BroadcastChannel) satisfies
 * a stronger contract than the session asks for, which costs nothing.
 *
 * The consequence worth stating plainly: `rollback.ts` imports this file and
 * never imports an adapter. Swapping WebRTC for loopback is a constructor
 * argument, which is what makes the netcode testable at all — see
 * `adapters/loopback.ts`.
 */

/** Unsubscribes a listener registered through one of the `on*` methods. */
export type Unsubscribe = () => void;

export interface Transport {
  /**
   * Broadcast to every connected peer. Fire-and-forget by design: there is no
   * completion signal and no error, because at 60Hz there is nothing useful a
   * caller could do with either. A packet that fails to send is handled the
   * same way as a packet that is dropped in flight — by the next packet, which
   * carries the same frames again 16ms later.
   */
  send(bytes: Uint8Array): void;

  /** Bytes from a peer. The buffer belongs to the callback; adapters do not reuse it. */
  onMessage(cb: (bytes: Uint8Array, peerId: string) => void): Unsubscribe;

  onPeerJoin(cb: (peerId: string) => void): Unsubscribe;
  onPeerLeave(cb: (peerId: string) => void): Unsubscribe;

  /** Idempotent. Releases sockets, channels and timers. */
  close(): void;

  /** Stable identity for this endpoint, unique within the room. */
  readonly selfId: string;
}

/* --------------------------------------------------------------- internals -- */

/**
 * The listener bookkeeping every adapter needs and none of them should write
 * twice.
 *
 * Iterating a copy rather than the live set matters: a listener that
 * unsubscribes itself while being notified (the session does exactly this on
 * close) would otherwise mutate the set mid-iteration.
 */
export interface Emitter<A extends unknown[]> {
  add(cb: (...args: A) => void): Unsubscribe;
  emit(...args: A): void;
  clear(): void;
  readonly size: number;
}

export function createEmitter<A extends unknown[]>(): Emitter<A> {
  const listeners = new Set<(...args: A) => void>();
  return {
    add(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    emit(...args) {
      for (const cb of [...listeners]) cb(...args);
    },
    clear() {
      listeners.clear();
    },
    get size() {
      return listeners.size;
    },
  };
}

/**
 * A transport that is connected to nothing.
 *
 * Not a test double: this is what a local-only match uses, so the game loop
 * runs the identical rollback session whether or not anybody else is playing.
 * One code path through the simulation is worth more than the handful of
 * branches it saves.
 */
export function createNullTransport(selfId = "local"): Transport {
  let closed = false;
  const messages = createEmitter<[Uint8Array, string]>();
  const joins = createEmitter<[string]>();
  const leaves = createEmitter<[string]>();
  return {
    selfId,
    send() {
      /* nobody is listening */
    },
    onMessage: (cb) => messages.add(cb),
    onPeerJoin: (cb) => joins.add(cb),
    onPeerLeave: (cb) => leaves.add(cb),
    close() {
      if (closed) return;
      closed = true;
      messages.clear();
      joins.clear();
      leaves.clear();
    },
  };
}
