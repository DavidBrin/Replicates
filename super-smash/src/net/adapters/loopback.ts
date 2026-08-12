/**
 * The in-process transport, with a network attached that lies.
 *
 * This is the adapter that makes the rollback tests mean something. A rollback
 * session tested over a perfect link tests almost nothing: no packet is ever
 * late, so no input is ever predicted, so the rewind path never runs. What has
 * to be proven is the opposite — that with a hundred milliseconds of latency,
 * jitter reordering packets and one in ten thrown away, two peers still arrive
 * at bit-identical states. That requires a network whose latency, jitter and
 * loss are dials, and whose clock the test drives by hand.
 *
 * The clock is virtual on purpose. Real timers would make the tests slow,
 * flaky, and unable to simulate ten seconds of play; a virtual clock makes a
 * thousand frames of 100ms-latency netplay run in milliseconds and produce the
 * same answer every time. Loss and jitter come from the engine's seeded
 * generator for the same reason — a netcode test that fails one run in fifty
 * teaches nobody anything.
 */

import { nextRandom } from "@/engine/fixed";
import { createEmitter, type Transport } from "../transport";

export interface LoopbackOptions {
  /** One-way delay, milliseconds. 100 models a bad transcontinental link. */
  latencyMs?: number;
  /** Uniform +/- variation on the delay. Enough of it reorders packets. */
  jitterMs?: number;
  /** 0..1. Packets vanish silently, exactly as a real datagram would. */
  lossRate?: number;
  /** Seed for loss and jitter, so a failure reproduces. */
  seed?: number;
}

interface Endpoint {
  readonly id: string;
  readonly messages: ReturnType<typeof createEmitter<[Uint8Array, string]>>;
  readonly joins: ReturnType<typeof createEmitter<[string]>>;
  readonly leaves: ReturnType<typeof createEmitter<[string]>>;
  closed: boolean;
}

/** Anything waiting to happen: a packet arriving or a peer being announced. */
interface Scheduled {
  readonly at: number;
  readonly seq: number;
  readonly fire: () => void;
}

export class LoopbackNetwork {
  private readonly endpoints = new Map<string, Endpoint>();
  private queue: Scheduled[] = [];
  private clock = 0;
  private seq = 0;
  private seed: number;
  private options: Required<LoopbackOptions>;

  readonly counts = { sent: 0, delivered: 0, dropped: 0 };

  constructor(options: LoopbackOptions = {}) {
    this.options = {
      latencyMs: options.latencyMs ?? 0,
      jitterMs: options.jitterMs ?? 0,
      lossRate: options.lossRate ?? 0,
      seed: options.seed ?? 0x5eed,
    };
    this.seed = this.options.seed;
  }

  /**
   * Milliseconds since the network was created.
   *
   * Feed this to the session's `now` so RTT measurement observes the simulated
   * latency rather than how fast the test machine happens to be.
   */
  now(): number {
    return this.clock;
  }

  setOptions(patch: LoopbackOptions): void {
    this.options = { ...this.options, ...patch };
  }

  connect(id: string): Transport {
    if (this.endpoints.has(id)) throw new Error(`loopback endpoint "${id}" already exists`);
    const endpoint: Endpoint = {
      id,
      messages: createEmitter<[Uint8Array, string]>(),
      joins: createEmitter<[string]>(),
      leaves: createEmitter<[string]>(),
      closed: false,
    };

    // Announcements are queued rather than fired here, because the caller has
    // not registered its listeners yet — it is still inside `connect()`. They
    // land on the first `advance()`, which every caller does anyway.
    for (const other of this.endpoints.values()) {
      if (other.closed) continue;
      this.schedule(this.clock, () => {
        if (!endpoint.closed) endpoint.joins.emit(other.id);
      });
      this.schedule(this.clock, () => {
        if (!other.closed) other.joins.emit(id);
      });
    }
    this.endpoints.set(id, endpoint);

    let closed = false;
    return {
      selfId: id,
      send: (bytes) => {
        if (closed) return;
        this.dispatch(id, bytes);
      },
      onMessage: (cb) => endpoint.messages.add(cb),
      onPeerJoin: (cb) => endpoint.joins.add(cb),
      onPeerLeave: (cb) => endpoint.leaves.add(cb),
      close: () => {
        if (closed) return;
        closed = true;
        this.disconnect(id);
      },
    };
  }

  disconnect(id: string): void {
    const endpoint = this.endpoints.get(id);
    if (!endpoint || endpoint.closed) return;
    endpoint.closed = true;
    this.endpoints.delete(id);
    endpoint.messages.clear();
    endpoint.joins.clear();
    endpoint.leaves.clear();
    for (const other of this.endpoints.values()) {
      if (!other.closed) other.leaves.emit(id);
    }
  }

  /**
   * Move the clock forward, firing everything that comes due.
   *
   * Work is drained in arrival order, which is what makes jitter produce
   * genuine reordering: a packet sent later with a smaller delay overtakes one
   * sent earlier, and the session has to cope with that. Ties break on send
   * order, so the whole thing stays reproducible. The loop repeats because
   * firing can enqueue more work at the same instant — a pong answering a ping
   * on a zero-latency link, for example.
   */
  advance(ms: number): void {
    const until = this.clock + ms;
    for (let guard = 0; guard < 10_000; guard++) {
      let next: Scheduled | null = null;
      for (const item of this.queue) {
        if (item.at > until) continue;
        if (next === null || item.at < next.at || (item.at === next.at && item.seq < next.seq)) {
          next = item;
        }
      }
      if (next === null) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      this.clock = Math.max(this.clock, next.at);
      next.fire();
    }
    this.clock = until;
  }

  /** Deliver everything still in flight, however far in the future. */
  flush(): void {
    while (this.queue.length > 0) {
      const furthest = this.queue.reduce((m, d) => Math.max(m, d.at), this.clock);
      this.advance(Math.max(0, furthest - this.clock));
    }
  }

  get inFlight(): number {
    return this.queue.length;
  }

  private dispatch(from: string, bytes: Uint8Array): void {
    for (const endpoint of this.endpoints.values()) {
      if (endpoint.id === from || endpoint.closed) continue;
      this.counts.sent++;
      if (this.options.lossRate > 0 && this.random() < this.options.lossRate) {
        this.counts.dropped++;
        continue;
      }
      const jitter =
        this.options.jitterMs > 0 ? (this.random() * 2 - 1) * this.options.jitterMs : 0;
      const at = this.clock + Math.max(0, this.options.latencyMs + jitter);
      // Copied, because the sender owns its buffer and may reuse it. A receiver
      // aliasing the sender's bytes is a bug that only ever shows up under load.
      const copy = bytes.slice();
      const target = endpoint;
      this.schedule(at, () => {
        if (target.closed) return;
        this.counts.delivered++;
        target.messages.emit(copy, from);
      });
    }
  }

  private schedule(at: number, fire: () => void): void {
    this.queue.push({ at, seq: this.seq++, fire });
  }

  /**
   * Mulberry32, borrowed from the engine so the codebase has exactly one PRNG
   * and no test can quietly depend on `Math.random`.
   */
  private random(): number {
    const r = nextRandom(this.seed);
    this.seed = r.seed;
    return r.value;
  }
}

/** Two endpoints on one network — the shape every rollback test wants. */
export function createLoopbackPair(
  options: LoopbackOptions = {},
  ids: [string, string] = ["A", "B"],
): { network: LoopbackNetwork; a: Transport; b: Transport } {
  const network = new LoopbackNetwork(options);
  return { network, a: network.connect(ids[0]), b: network.connect(ids[1]) };
}
