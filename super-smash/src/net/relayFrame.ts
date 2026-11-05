/**
 * How game packets ride the room socket when the relay carries them.
 *
 * The room Durable Object forwards a binary WebSocket message without reading
 * it, so this file is the whole format: `[the sender's id, RELAY_ID_BYTES of
 * ASCII, stamped by the room][batch]`, and a batch is
 * `[u16 little-endian length][packet bytes]` once per packet, with no header
 * and no count. Incoming WebSocket messages are what the free plan bills (20:1),
 * so the sender puts two frames' packets in each message (`RELAY_INPUTS_PER_MESSAGE`),
 * which halves the bill at about one frame of extra delay.
 *
 * Imports `signalProtocol` and `packet` only, and no DOM type.
 */

import { PacketType } from "./packet";
import { RELAY_ID_BYTES, RELAY_MAX_FRAME_BYTES } from "./signalProtocol";

/** Input packets a message carries before it goes: one per frame, online has one local port. */
export const RELAY_INPUTS_PER_MESSAGE = 2;

/** A send while the socket already holds this much unsent is dropped, as a lost datagram would be. */
export const RELAY_MAX_BUFFERED_BYTES = 16 * 1024;

const LENGTH_BYTES = 2;

export function encodeRelayBatch(packets: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const packet of packets) total += LENGTH_BYTES + packet.length;
  const batch = new Uint8Array(total);
  const view = new DataView(batch.buffer);
  let offset = 0;
  for (const packet of packets) {
    view.setUint16(offset, packet.length, true);
    batch.set(packet, offset + LENGTH_BYTES);
    offset += LENGTH_BYTES + packet.length;
  }
  return batch;
}

/** Every packet is a fresh copy. A truncated entry or an empty one refuses the whole batch. */
export function decodeRelayBatch(batch: Uint8Array): Uint8Array[] | null {
  const packets: Uint8Array[] = [];
  let offset = 0;
  while (offset < batch.length) {
    if (offset + LENGTH_BYTES > batch.length) return null;
    const length = batch[offset] | (batch[offset + 1] << 8);
    offset += LENGTH_BYTES;
    if (length === 0 || offset + length > batch.length) return null;
    packets.push(batch.slice(offset, offset + length));
    offset += length;
  }
  return packets;
}

/** The room's stamp, and what follows it. Null when nothing follows: the room never sends a bare stamp. */
export function splitRelayFrame(frame: Uint8Array): { from: string; batch: Uint8Array } | null {
  if (frame.length <= RELAY_ID_BYTES) return null;
  let from = "";
  for (let i = 0; i < RELAY_ID_BYTES; i++) from += String.fromCharCode(frame[i]);
  return { from, batch: frame.subarray(RELAY_ID_BYTES) };
}

export interface RelayBatcher {
  push(packet: Uint8Array): void;
  /** Drops what is queued, unsent. */
  clear(): void;
}

/**
 * Queues packets and flushes on the pinned rule, never on a timer: the second
 * Input packet since the last flush sends the queue as one batch, with any
 * Ping, Pong or Hash queued before it. A packet that would take the batch past
 * `RELAY_MAX_FRAME_BYTES` sends the queue first, and every flush starts the
 * Input count again.
 */
export function createRelayBatcher(flush: (batch: Uint8Array) => void): RelayBatcher {
  let queue: Uint8Array[] = [];
  let queuedBytes = 0;
  let inputs = 0;

  function send(): void {
    const packets = queue;
    queue = [];
    queuedBytes = 0;
    inputs = 0;
    flush(encodeRelayBatch(packets));
  }

  return {
    push(packet) {
      const entryBytes = LENGTH_BYTES + packet.length;
      if (queue.length > 0 && queuedBytes + entryBytes > RELAY_MAX_FRAME_BYTES) send();
      queue.push(packet);
      queuedBytes += entryBytes;
      if (packet[1] === PacketType.Input && ++inputs >= RELAY_INPUTS_PER_MESSAGE) send();
    },
    clear() {
      queue = [];
      queuedBytes = 0;
      inputs = 0;
    },
  };
}
