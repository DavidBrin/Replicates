import { describe, expect, it, vi } from "vitest";

import { LoopbackNetwork, createLoopbackPair } from "./loopback";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("delivery", () => {
  it("holds a packet for exactly the configured latency", () => {
    const { network, a, b } = createLoopbackPair({ latencyMs: 100 });
    const received = vi.fn();
    b.onMessage(received);

    a.send(bytes(1, 2, 3));
    network.advance(99);
    expect(received).not.toHaveBeenCalled();

    network.advance(2);
    expect(received).toHaveBeenCalledExactlyOnceWith(bytes(1, 2, 3), "A");
  });

  it("never delivers a packet back to its sender", () => {
    const { network, a } = createLoopbackPair();
    const received = vi.fn();
    a.onMessage(received);
    a.send(bytes(9));
    network.advance(10);
    expect(received).not.toHaveBeenCalled();
  });

  it("copies the payload, so a sender reusing its buffer cannot corrupt it", () => {
    const { network, a, b } = createLoopbackPair({ latencyMs: 50 });
    const received: Uint8Array[] = [];
    b.onMessage((data) => received.push(data));

    const buffer = bytes(1, 1, 1);
    a.send(buffer);
    buffer[0] = 99; // the encode buffer gets reused in a real session
    network.advance(60);

    expect([...received[0]]).toEqual([1, 1, 1]);
  });

  it("delivers to every other endpoint, which is what a 4-player match needs", () => {
    const network = new LoopbackNetwork();
    const a = network.connect("A");
    const b = network.connect("B");
    const c = network.connect("C");
    const onB = vi.fn();
    const onC = vi.fn();
    b.onMessage(onB);
    c.onMessage(onC);

    a.send(bytes(7));
    network.advance(1);

    expect(onB).toHaveBeenCalledOnce();
    expect(onC).toHaveBeenCalledOnce();
  });
});

describe("jitter", () => {
  it("reorders packets, which is the whole reason it exists", () => {
    // A rollback session that assumed ordering would pass every test on a
    // perfect link and fall over on real WiFi.
    const { network, a, b } = createLoopbackPair({ latencyMs: 50, jitterMs: 40, seed: 3 });
    const order: number[] = [];
    b.onMessage((data) => order.push(data[0]));

    for (let i = 0; i < 40; i++) {
      a.send(bytes(i));
      network.advance(1);
    }
    network.flush();

    expect(order).toHaveLength(40);
    const sorted = [...order].sort((x, y) => x - y);
    expect(order).not.toEqual(sorted);
    expect(sorted).toEqual([...Array(40).keys()]);
  });

  it("is reproducible from the seed", () => {
    const collect = (seed: number) => {
      const { network, a, b } = createLoopbackPair({ latencyMs: 30, jitterMs: 25, seed });
      const order: number[] = [];
      b.onMessage((data) => order.push(data[0]));
      for (let i = 0; i < 30; i++) {
        a.send(bytes(i));
        network.advance(1);
      }
      network.flush();
      return order;
    };
    expect(collect(11)).toEqual(collect(11));
    expect(collect(11)).not.toEqual(collect(12));
  });
});

describe("loss", () => {
  it("drops roughly the configured fraction", () => {
    const { network, a, b } = createLoopbackPair({ lossRate: 0.25, seed: 99 });
    let delivered = 0;
    b.onMessage(() => delivered++);

    for (let i = 0; i < 2000; i++) a.send(bytes(i & 0xff));
    network.flush();

    expect(delivered).toBeGreaterThan(1400);
    expect(delivered).toBeLessThan(1600);
    expect(network.counts.dropped + delivered).toBe(2000);
  });

  it("loses everything at a rate of one", () => {
    const { network, a, b } = createLoopbackPair({ lossRate: 1 });
    const received = vi.fn();
    b.onMessage(received);
    a.send(bytes(1));
    network.flush();
    expect(received).not.toHaveBeenCalled();
  });
});

describe("presence", () => {
  it("announces peers that were already connected, and new ones", () => {
    const network = new LoopbackNetwork();
    const a = network.connect("A");
    const seenByA: string[] = [];
    a.onPeerJoin((id) => seenByA.push(id));

    const b = network.connect("B");
    const seenByB: string[] = [];
    b.onPeerJoin((id) => seenByB.push(id));

    network.advance(0);

    expect(seenByA).toEqual(["B"]);
    expect(seenByB).toEqual(["A"]);
  });

  it("reports a departure", () => {
    const { network, a, b } = createLoopbackPair();
    const left = vi.fn();
    a.onPeerLeave(left);
    network.advance(0);

    b.close();

    expect(left).toHaveBeenCalledExactlyOnceWith("B");
  });

  it("refuses a duplicate endpoint id", () => {
    const network = new LoopbackNetwork();
    network.connect("A");
    expect(() => network.connect("A")).toThrow(/already exists/);
  });

  it("stops delivering to a closed endpoint", () => {
    const { network, a, b } = createLoopbackPair({ latencyMs: 20 });
    const received = vi.fn();
    b.onMessage(received);
    a.send(bytes(1));
    b.close();
    network.flush();
    expect(received).not.toHaveBeenCalled();
  });
});

describe("the virtual clock", () => {
  it("advances by exactly what it is asked for", () => {
    const network = new LoopbackNetwork();
    expect(network.now()).toBe(0);
    network.advance(16);
    network.advance(16);
    expect(network.now()).toBe(32);
  });

  it("runs work scheduled by work, at the same instant", () => {
    // A pong answering a ping over a zero-latency link. Without the drain
    // loop this would sit in the queue for a frame.
    const { network, a, b } = createLoopbackPair();
    b.onMessage((data) => {
      if (data[0] === 1) b.send(bytes(2));
    });
    const replies: number[] = [];
    a.onMessage((data) => replies.push(data[0]));

    a.send(bytes(1));
    network.advance(0);

    expect(replies).toEqual([2]);
  });
});
