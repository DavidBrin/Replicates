import { describe, expect, it, vi } from "vitest";

import { createEmitter, createNullTransport, type Transport } from "./transport";

describe("createEmitter", () => {
  it("delivers to every listener and stops on unsubscribe", () => {
    const emitter = createEmitter<[string]>();
    const a = vi.fn();
    const b = vi.fn();
    const offA = emitter.add(a);
    emitter.add(b);

    emitter.emit("one");
    offA();
    emitter.emit("two");

    expect(a).toHaveBeenCalledExactlyOnceWith("one");
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("survives a listener that unsubscribes itself mid-emit", () => {
    // The session does exactly this on close. Iterating the live set would
    // skip whichever listener happened to be next.
    const emitter = createEmitter<[]>();
    const seen: string[] = [];
    const off = emitter.add(() => {
      seen.push("first");
      off();
    });
    emitter.add(() => seen.push("second"));

    expect(() => emitter.emit()).not.toThrow();
    expect(seen).toEqual(["first", "second"]);
    expect(emitter.size).toBe(1);
  });

  it("drops everything on clear", () => {
    const emitter = createEmitter<[]>();
    const cb = vi.fn();
    emitter.add(cb);
    emitter.clear();
    emitter.emit();
    expect(cb).not.toHaveBeenCalled();
    expect(emitter.size).toBe(0);
  });
});

describe("the null transport", () => {
  it("satisfies the port and delivers nothing", () => {
    const transport: Transport = createNullTransport("solo");
    const onMessage = vi.fn();
    const onJoin = vi.fn();
    transport.onMessage(onMessage);
    transport.onPeerJoin(onJoin);

    transport.send(new Uint8Array([1, 2, 3]));

    expect(transport.selfId).toBe("solo");
    expect(onMessage).not.toHaveBeenCalled();
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("closes idempotently", () => {
    const transport = createNullTransport();
    transport.close();
    expect(() => transport.close()).not.toThrow();
    expect(() => transport.send(new Uint8Array(1))).not.toThrow();
  });
});
