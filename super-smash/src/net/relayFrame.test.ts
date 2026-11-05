import { describe, expect, it } from "vitest";

import { MAX_INPUT_WINDOW_FRAMES, PacketType, encodePacket } from "./packet";
import {
  RELAY_INPUTS_PER_MESSAGE,
  createRelayBatcher,
  decodeRelayBatch,
  encodeRelayBatch,
  splitRelayFrame,
} from "./relayFrame";
import { RELAY_ID_BYTES, RELAY_MAX_FRAME_BYTES } from "./signalProtocol";

const input = (startFrame: number, count = MAX_INPUT_WINDOW_FRAMES) =>
  encodePacket({
    type: PacketType.Input,
    port: 0,
    senderFrame: startFrame + count,
    startFrame,
    ack: startFrame - 1,
    inputs: Array.from({ length: count }, (_, i) => (startFrame + i) & 0xffff),
  });
const ping = (token: number) => encodePacket({ type: PacketType.Ping, token });
const pong = (token: number) => encodePacket({ type: PacketType.Pong, token });
const hash = (frame: number) => encodePacket({ type: PacketType.Hash, port: 0, frame, hash: 0xdeadbeef });
/** Not a real packet: a filler of a chosen size whose byte 1 is not Input. */
const filler = (length: number, fill: number) => {
  const bytes = new Uint8Array(length).fill(fill);
  bytes[1] = PacketType.Ping;
  return bytes;
};

function batcher() {
  const flushes: Uint8Array[] = [];
  const queue = createRelayBatcher((batch) => flushes.push(batch));
  return { queue, flushes };
}

describe("the relay batch", () => {
  it("round-trips a batch of packets of every type", () => {
    const packets = [input(10), ping(7), pong(7), hash(120)];
    expect([input(10).length, ping(7).length, pong(7).length, hash(120).length]).toEqual([272, 6, 6, 12]);
    expect(decodeRelayBatch(encodeRelayBatch(packets))).toEqual(packets);
  });

  it("refuses a truncated or empty entry, whole", () => {
    const batch = encodeRelayBatch([ping(1), hash(2)]);
    expect(decodeRelayBatch(batch.subarray(0, batch.length - 1))).toBeNull();
    expect(decodeRelayBatch(batch.subarray(0, batch.length - 11))).toBeNull();
    expect(decodeRelayBatch(new Uint8Array([...batch, 0, 0]))).toBeNull();
    expect(decodeRelayBatch(new Uint8Array([...batch, 5]))).toBeNull();
  });

  it("splits the room's stamp from the batch, and refuses a frame with nothing after it", () => {
    const stamp = new TextEncoder().encode("a1b2c3d4");
    expect(stamp.length).toBe(RELAY_ID_BYTES);
    const batch = encodeRelayBatch([ping(3)]);
    const split = splitRelayFrame(new Uint8Array([...stamp, ...batch]));
    expect(split?.from).toBe("a1b2c3d4");
    expect(split?.batch).toEqual(batch);
    expect(splitRelayFrame(stamp)).toBeNull();
    expect(splitRelayFrame(new Uint8Array(0))).toBeNull();
  });
});

describe("the relay batcher", () => {
  it("flushes on every second input packet, with the pings and hashes queued between", () => {
    const { queue, flushes } = batcher();
    expect(RELAY_INPUTS_PER_MESSAGE).toBe(2);
    const [i1, p, i2, h, i3, i4] = [input(0, 4), ping(1), input(1, 4), hash(5), input(2, 4), input(3, 4)];
    for (const packet of [i1, p, i2, h, i3, i4]) queue.push(packet);
    expect(flushes).toHaveLength(2);
    expect(decodeRelayBatch(flushes[0])).toEqual([i1, p, i2]);
    expect(decodeRelayBatch(flushes[1])).toEqual([h, i3, i4]);
  });

  it("flushes early rather than build a batch over RELAY_MAX_FRAME_BYTES, and starts the input count again", () => {
    const { queue, flushes } = batcher();
    const pushed: Uint8Array[] = [];
    const push = (packet: Uint8Array) => {
      pushed.push(packet);
      queue.push(packet);
    };
    push(input(0));
    for (let i = 0; i < 8; i++) push(filler(300, i + 1));
    expect(flushes.length).toBeGreaterThanOrEqual(1);
    for (const batch of flushes) expect(batch.length).toBeLessThanOrEqual(RELAY_MAX_FRAME_BYTES);
    const afterFillers = flushes.length;

    push(input(1));
    expect(flushes).toHaveLength(afterFillers);
    push(input(2));
    expect(flushes).toHaveLength(afterFillers + 1);

    const delivered = flushes.flatMap((batch) => decodeRelayBatch(batch) ?? []);
    expect(delivered).toEqual(pushed);
  });

  it("drops its queue on clear", () => {
    const { queue, flushes } = batcher();
    queue.push(input(0, 4));
    queue.push(ping(1));
    queue.clear();
    queue.push(input(1, 4));
    expect(flushes).toHaveLength(0);
    queue.push(input(2, 4));
    expect(flushes).toHaveLength(1);
    expect(decodeRelayBatch(flushes[0])).toEqual([input(1, 4), input(2, 4)]);
  });
});
