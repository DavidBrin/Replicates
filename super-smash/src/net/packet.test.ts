import { describe, expect, it } from "vitest";

import { Btn } from "@/engine/types";
import {
  INPUT_WINDOW_FRAMES,
  MAX_ENCODED_BYTES,
  MAX_PACKET_BYTES,
  PROTOCOL_VERSION,
  PacketType,
  decodePacket,
  encodePacket,
  inputPacketBytes,
  type Packet,
} from "./packet";

const fullWindow = Array.from({ length: INPUT_WINDOW_FRAMES }, (_, i) => i * 37);

describe("packet round-trips", () => {
  it("carries a full input window intact", () => {
    const packet: Packet = {
      type: PacketType.Input,
      port: 2,
      senderFrame: 1234,
      startFrame: 1225,
      inputs: fullWindow,
    };
    expect(decodePacket(encodePacket(packet))).toEqual(packet);
  });

  it("carries every button of a real input frame", () => {
    const everything =
      Btn.Left | Btn.Right | Btn.Up | Btn.Down | Btn.Attack | Btn.Special | Btn.Shield | Btn.Jump | Btn.Grab;
    const decoded = decodePacket(
      encodePacket({
        type: PacketType.Input,
        port: 0,
        senderFrame: 1,
        startFrame: 0,
        inputs: [everything, 0, Btn.Jump],
      }),
    );
    expect(decoded).toMatchObject({ inputs: [everything, 0, Btn.Jump] });
  });

  it("survives frame numbers past a long match", () => {
    // 60Hz for an hour is 216,000 frames; the field is 32 bits.
    const packet: Packet = {
      type: PacketType.Input,
      port: 3,
      senderFrame: 4_000_000_000,
      startFrame: 3_999_999_991,
      inputs: fullWindow,
    };
    expect(decodePacket(encodePacket(packet))).toEqual(packet);
  });

  it("round-trips ping and pong", () => {
    expect(decodePacket(encodePacket({ type: PacketType.Ping, token: 7 }))).toEqual({
      type: PacketType.Ping,
      token: 7,
    });
    expect(
      decodePacket(encodePacket({ type: PacketType.Pong, token: 0xffffffff })),
    ).toEqual({ type: PacketType.Pong, token: 0xffffffff });
  });

  it("round-trips a state hash, including one with the top bit set", () => {
    const packet: Packet = {
      type: PacketType.Hash,
      port: 1,
      frame: 900,
      hash: 0xdeadbeef,
    };
    expect(decodePacket(encodePacket(packet))).toEqual(packet);
  });
});

describe("packet size", () => {
  it("keeps a full ten-frame window far under the fragmentation threshold", () => {
    const bytes = encodePacket({
      type: PacketType.Input,
      port: 0,
      senderFrame: 999,
      startFrame: 990,
      inputs: fullWindow,
    });
    expect(bytes.length).toBe(inputPacketBytes(INPUT_WINDOW_FRAMES));
    expect(bytes.length).toBe(32);
    expect(bytes.length).toBeLessThan(MAX_PACKET_BYTES);
  });

  it("has no packet type that can approach the MTU", () => {
    // The guard that matters is against a future widening of the input window,
    // which is the only field here that scales with anything.
    expect(MAX_ENCODED_BYTES).toBeLessThan(MAX_PACKET_BYTES);
  });

  it("refuses to encode a window wider than the protocol carries", () => {
    expect(() =>
      encodePacket({
        type: PacketType.Input,
        port: 0,
        senderFrame: 0,
        startFrame: 0,
        inputs: new Array(INPUT_WINDOW_FRAMES + 1).fill(0),
      }),
    ).toThrow(/at most/);
  });
});

describe("decoding hostile bytes", () => {
  // These arrive from a machine we do not control, over a channel with no
  // integrity beyond DTLS. Every one of them must return null, not throw:
  // a malformed packet is indistinguishable from a dropped one, and the
  // protocol already survives a dropped one.
  it("rejects an empty buffer", () => {
    expect(decodePacket(new Uint8Array(0))).toBeNull();
  });

  it("rejects a wrong protocol version", () => {
    const bytes = encodePacket({ type: PacketType.Ping, token: 1 });
    bytes[0] = PROTOCOL_VERSION + 1;
    expect(decodePacket(bytes)).toBeNull();
  });

  it("rejects an unknown packet type", () => {
    const bytes = encodePacket({ type: PacketType.Ping, token: 1 });
    bytes[1] = 99;
    expect(decodePacket(bytes)).toBeNull();
  });

  it("rejects a truncated input packet", () => {
    const bytes = encodePacket({
      type: PacketType.Input,
      port: 0,
      senderFrame: 10,
      startFrame: 1,
      inputs: fullWindow,
    });
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(decodePacket(bytes.subarray(0, cut))).toBeNull();
    }
  });

  it("rejects a count that claims more frames than the protocol allows", () => {
    const bytes = encodePacket({
      type: PacketType.Input,
      port: 0,
      senderFrame: 10,
      startFrame: 1,
      inputs: [1, 2, 3],
    });
    bytes[3] = 200;
    expect(decodePacket(bytes)).toBeNull();
  });

  it("decodes a packet that sits inside a larger buffer", () => {
    // The WebRTC adapter hands over views, not always whole buffers.
    const packet: Packet = { type: PacketType.Ping, token: 42 };
    const encoded = encodePacket(packet);
    const padded = new Uint8Array(encoded.length + 8);
    padded.set(encoded, 4);
    expect(decodePacket(padded.subarray(4, 4 + encoded.length))).toEqual(packet);
  });
});
