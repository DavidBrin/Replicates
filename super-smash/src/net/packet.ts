/**
 * The wire format.
 *
 * Four packet types, all fixed-layout little-endian binary, all far below the
 * fragmentation threshold. The design constraint that shapes everything here is
 * that the channel underneath is *unreliable and unordered* (SPEC §5): there is
 * no retransmission, so every packet must be independently useful and must not
 * assume it is the first, the last, or the only copy of itself.
 *
 * That is why an input packet carries a **window** of the last ten frames
 * rather than one frame. A dropped packet is repaired 16ms later by the next
 * one, which still carries the frame that went missing — nine more chances
 * before the loss can matter. Asking for a retransmission would cost a round
 * trip, and an input that arrives a round trip late has already been simulated
 * with a prediction; the redundancy is both cheaper and earlier. Ten frames of
 * cover survives a 150ms outage, which is longer than the rollback window can
 * absorb anyway, so widening it further would buy nothing.
 */

import type { InputFrame } from "@/engine/types";

/** Bumped when a layout below changes. A peer on another version is rejected. */
export const PROTOCOL_VERSION = 1;

/**
 * The ceiling every packet must stay under.
 *
 * 1200 bytes is the conventional safe payload for a datagram that must not be
 * fragmented: the smallest IPv6 MTU is 1280, minus IPv6, UDP, DTLS and SCTP
 * headers. A fragmented datagram is lost entirely if any fragment is lost,
 * which would turn one dropped packet into a much longer input gap.
 */
export const MAX_PACKET_BYTES = 1200;

/** Frames of local input carried by every input packet. See the note above. */
export const INPUT_WINDOW_FRAMES = 10;

export const PacketType = {
  Input: 1,
  Ping: 2,
  Pong: 3,
  Hash: 4,
} as const;

export type PacketTypeValue = (typeof PacketType)[keyof typeof PacketType];

/* ------------------------------------------------------------------ shapes -- */

export interface InputPacket {
  readonly type: typeof PacketType.Input;
  /** Player port these inputs belong to, 0-3. */
  readonly port: number;
  /**
   * The sender's local frame at the moment of sending.
   *
   * This is the time-sync signal: comparing it against our own frame (less half
   * the measured round trip) says which peer is running ahead, which is what
   * lets the leader stall a frame instead of dragging the follower into
   * ever-deeper prediction.
   */
  readonly senderFrame: number;
  /** Absolute frame number of `inputs[0]`. The frames are consecutive. */
  readonly startFrame: number;
  /** Up to `INPUT_WINDOW_FRAMES` consecutive frames of input. */
  readonly inputs: readonly InputFrame[];
}

export interface PingPacket {
  readonly type: typeof PacketType.Ping;
  /** Echoed verbatim in the pong. The sender times its own token locally, so
   *  the two peers never need agreeing clocks. */
  readonly token: number;
}

export interface PongPacket {
  readonly type: typeof PacketType.Pong;
  readonly token: number;
}

export interface HashPacket {
  readonly type: typeof PacketType.Hash;
  readonly port: number;
  /** The frame the hash was taken at — always a frame with confirmed inputs. */
  readonly frame: number;
  /** `hashState()`'s output, as an unsigned 32-bit integer. */
  readonly hash: number;
}

export type Packet = InputPacket | PingPacket | PongPacket | HashPacket;

/* ---------------------------------------------------------------- encoding -- */

const HEADER_BYTES = 2; // version, type
const INPUT_HEADER_BYTES = HEADER_BYTES + 1 + 1 + 4 + 4; // port, count, senderFrame, startFrame
const PING_BYTES = HEADER_BYTES + 4;
const HASH_BYTES = HEADER_BYTES + 1 + 1 + 4 + 4; // port, pad, frame, hash

/** Exact encoded size of an input packet carrying `count` frames. */
export function inputPacketBytes(count: number): number {
  return INPUT_HEADER_BYTES + count * 2;
}

/**
 * The largest packet this protocol can produce.
 *
 * Asserted against `MAX_PACKET_BYTES` by the tests rather than only computed,
 * because the interesting failure is somebody widening the input window later
 * and not noticing that the packet crossed the MTU.
 */
export const MAX_ENCODED_BYTES = Math.max(
  inputPacketBytes(INPUT_WINDOW_FRAMES),
  PING_BYTES,
  HASH_BYTES,
);

export function encodePacket(packet: Packet): Uint8Array {
  switch (packet.type) {
    case PacketType.Input: {
      const count = packet.inputs.length;
      if (count > INPUT_WINDOW_FRAMES) {
        throw new RangeError(
          `input window is ${count} frames; the protocol carries at most ${INPUT_WINDOW_FRAMES}`,
        );
      }
      const bytes = new Uint8Array(inputPacketBytes(count));
      const view = new DataView(bytes.buffer);
      bytes[0] = PROTOCOL_VERSION;
      bytes[1] = PacketType.Input;
      bytes[2] = packet.port & 0xff;
      bytes[3] = count;
      view.setUint32(4, packet.senderFrame >>> 0, true);
      view.setUint32(8, packet.startFrame >>> 0, true);
      for (let i = 0; i < count; i++) {
        // An InputFrame is a 9-bit button mask (see engine/types Btn); 16 bits
        // leaves room for seven more buttons before this needs revisiting.
        view.setUint16(INPUT_HEADER_BYTES + i * 2, packet.inputs[i] & 0xffff, true);
      }
      return bytes;
    }
    case PacketType.Ping:
    case PacketType.Pong: {
      const bytes = new Uint8Array(PING_BYTES);
      const view = new DataView(bytes.buffer);
      bytes[0] = PROTOCOL_VERSION;
      bytes[1] = packet.type;
      view.setUint32(2, packet.token >>> 0, true);
      return bytes;
    }
    case PacketType.Hash: {
      const bytes = new Uint8Array(HASH_BYTES);
      const view = new DataView(bytes.buffer);
      bytes[0] = PROTOCOL_VERSION;
      bytes[1] = PacketType.Hash;
      bytes[2] = packet.port & 0xff;
      bytes[3] = 0;
      view.setUint32(4, packet.frame >>> 0, true);
      view.setUint32(8, packet.hash >>> 0, true);
      return bytes;
    }
  }
}

/**
 * Decode, or return null.
 *
 * Every failure mode returns null rather than throwing. These bytes came off a
 * data channel from a machine we do not control, and the one thing the game
 * loop must never do is die at frame 400 because a peer sent something odd. A
 * malformed packet is indistinguishable from a lost one, and the protocol
 * already knows how to survive a lost one.
 */
export function decodePacket(bytes: Uint8Array): Packet | null {
  if (bytes.length < HEADER_BYTES) return null;
  if (bytes[0] !== PROTOCOL_VERSION) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = bytes[1];

  switch (type) {
    case PacketType.Input: {
      if (bytes.length < INPUT_HEADER_BYTES) return null;
      const port = bytes[2];
      const count = bytes[3];
      if (count > INPUT_WINDOW_FRAMES) return null;
      if (bytes.length < inputPacketBytes(count)) return null;
      const senderFrame = view.getUint32(4, true);
      const startFrame = view.getUint32(8, true);
      const inputs: InputFrame[] = new Array(count);
      for (let i = 0; i < count; i++) {
        inputs[i] = view.getUint16(INPUT_HEADER_BYTES + i * 2, true);
      }
      return { type: PacketType.Input, port, senderFrame, startFrame, inputs };
    }
    case PacketType.Ping:
    case PacketType.Pong: {
      if (bytes.length < PING_BYTES) return null;
      return { type, token: view.getUint32(2, true) };
    }
    case PacketType.Hash: {
      if (bytes.length < HASH_BYTES) return null;
      return {
        type: PacketType.Hash,
        port: bytes[2],
        frame: view.getUint32(4, true),
        hash: view.getUint32(8, true),
      };
    }
    default:
      return null;
  }
}
