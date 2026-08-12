import { beforeEach, describe, expect, it, vi } from "vitest";

import { PEER_TIMEOUT_MS, createBroadcastTransport, type BroadcastLike } from "./broadcast";

/**
 * A one-process `BroadcastChannel`.
 *
 * jsdom does not implement the real thing, and the presence protocol is the
 * part worth testing anyway — it is entirely this adapter's invention, since
 * the browser API has no notion of who is listening.
 */
class FakeBus {
  private readonly channels = new Map<string, FakeChannel[]>();

  open(name: string): FakeChannel {
    const channel = new FakeChannel(this, name);
    const list = this.channels.get(name) ?? [];
    list.push(channel);
    this.channels.set(name, list);
    return channel;
  }

  post(from: FakeChannel, message: unknown): void {
    for (const channel of this.channels.get(from.name) ?? []) {
      if (channel === from || channel.closed) continue;
      channel.onmessage?.({ data: structuredClone(message) });
    }
  }

  remove(channel: FakeChannel): void {
    const list = this.channels.get(channel.name) ?? [];
    this.channels.set(
      channel.name,
      list.filter((c) => c !== channel),
    );
  }
}

class FakeChannel implements BroadcastLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(
    private readonly bus: FakeBus,
    readonly name: string,
  ) {}

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("channel closed");
    this.bus.post(this, message);
  }

  close(): void {
    this.closed = true;
    this.bus.remove(this);
  }
}

/** A clock and a timer wheel the test drives by hand. */
function makeClock() {
  let time = 0;
  const timers = new Map<number, { fn: () => void; every: number; next: number }>();
  let nextHandle = 1;
  return {
    now: () => time,
    setInterval(fn: () => void, ms: number): number {
      const handle = nextHandle++;
      timers.set(handle, { fn, every: ms, next: time + ms });
      return handle;
    },
    clearInterval(handle: number): void {
      timers.delete(handle);
    },
    tick(ms: number): void {
      const until = time + ms;
      for (;;) {
        let due: { fn: () => void; every: number; next: number } | null = null;
        for (const timer of timers.values()) {
          if (timer.next <= until && (due === null || timer.next < due.next)) due = timer;
        }
        if (!due) break;
        time = due.next;
        due.next += due.every;
        due.fn();
      }
      time = until;
    },
  };
}

let bus: FakeBus;
let clock: ReturnType<typeof makeClock>;

function connect(selfId: string) {
  return createBroadcastTransport({
    roomId: "room",
    selfId,
    channelFactory: (name) => bus.open(name),
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    now: clock.now,
  });
}

beforeEach(() => {
  bus = new FakeBus();
  clock = makeClock();
});

describe("presence", () => {
  it("introduces two tabs to each other on open", () => {
    const first = connect("one");
    const joinsOnFirst: string[] = [];
    first.onPeerJoin((id) => joinsOnFirst.push(id));

    const second = connect("two");
    const joinsOnSecond: string[] = [];
    second.onPeerJoin((id) => joinsOnSecond.push(id));

    // The second tab's hello reaches the first immediately; the first answers
    // with a welcome rather than waiting for its next heartbeat, so neither
    // side sits blind for half a second.
    expect(joinsOnFirst).toEqual(["two"]);
    // …and the welcome arrived while `second` was still inside its own
    // constructor, so the join is replayed to the listener that came after it.
    expect(joinsOnSecond).toEqual(["one"]);

    // Neither is announced twice by the heartbeats that follow.
    clock.tick(2000);
    expect(joinsOnFirst).toEqual(["two"]);
    expect(joinsOnSecond).toEqual(["one"]);
  });

  it("announces a departure when a tab closes cleanly", () => {
    const first = connect("one");
    const second = connect("two");
    const left = vi.fn();
    first.onPeerLeave(left);
    clock.tick(600);

    second.close();

    expect(left).toHaveBeenCalledExactlyOnceWith("two");
  });

  it("times out a tab that vanished without saying goodbye", () => {
    // The common case: the window was closed, or the machine slept. There is
    // no unload event a bus can rely on, so silence has to be the signal.
    const first = connect("one");
    const second = connect("two");
    const left = vi.fn();
    first.onPeerLeave(left);
    clock.tick(600);
    expect(left).not.toHaveBeenCalled();

    // Stop `second` heartbeating without letting it say bye.
    (second as unknown as { close: () => void }).close = () => {};
    clock.clearInterval(2);

    clock.tick(PEER_TIMEOUT_MS + 600);
    expect(left).toHaveBeenCalledExactlyOnceWith("two");
  });

  it("keeps a peer alive while it heartbeats", () => {
    const first = connect("one");
    connect("two");
    const left = vi.fn();
    first.onPeerLeave(left);

    clock.tick(PEER_TIMEOUT_MS * 4);

    expect(left).not.toHaveBeenCalled();
  });
});

describe("messages", () => {
  it("carries bytes between tabs", () => {
    const first = connect("one");
    const second = connect("two");
    const received = vi.fn();
    second.onMessage(received);

    first.send(new Uint8Array([4, 5, 6]));

    expect(received).toHaveBeenCalledOnce();
    const [data, peerId] = received.mock.calls[0] as [Uint8Array, string];
    expect([...data]).toEqual([4, 5, 6]);
    expect(peerId).toBe("one");
  });

  it("never echoes a tab's own traffic back to it", () => {
    const first = connect("one");
    connect("two");
    const received = vi.fn();
    first.onMessage(received);
    first.send(new Uint8Array([1]));
    expect(received).not.toHaveBeenCalled();
  });

  it("copies the payload out of the caller's buffer", () => {
    const first = connect("one");
    const second = connect("two");
    const received: Uint8Array[] = [];
    second.onMessage((data) => received.push(data));

    const buffer = new Uint8Array([1, 2]);
    first.send(buffer);
    buffer[0] = 9;

    expect([...received[0]]).toEqual([1, 2]);
  });

  it("treats an unknown sender's first message as a join", () => {
    // BroadcastChannel has no connection and no delivery guarantee across a
    // tab that was mid-navigation, so a payload can outrun the hello. Waiting
    // for a hello that already went past would mean never seeing that peer.
    const first = connect("one");
    const joins: string[] = [];
    first.onPeerJoin((id) => joins.push(id));

    const stranger = bus.open("super-smash:room");
    stranger.postMessage({ t: "msg", from: "ghost", d: new Uint8Array([1]) });

    expect(joins).toEqual(["ghost"]);
  });
});

describe("closing", () => {
  it("stops the heartbeat and the listener", () => {
    const first = connect("one");
    const second = connect("two");
    const received = vi.fn();
    first.onMessage(received);
    clock.tick(600);

    first.close();
    second.send(new Uint8Array([1]));

    expect(received).not.toHaveBeenCalled();
  });

  it("is idempotent, and survives a channel that has already gone", () => {
    const transport = connect("one");
    transport.close();
    expect(() => transport.close()).not.toThrow();
    expect(() => transport.send(new Uint8Array([1]))).not.toThrow();
  });
});
