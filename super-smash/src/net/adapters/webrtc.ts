/**
 * WebRTC over Trystero — the adapter people actually play on.
 *
 * ## Why WebRTC and not a WebSocket
 *
 * A relayed WebSocket would be simpler to write and would work everywhere. It
 * would also route every input packet through a server: two laptops sitting on
 * the same WiFi would send their inputs across the country and back, turning a
 * 2ms link into a 90ms one. WebRTC gets that back for free, and the mechanism
 * is worth naming precisely because it explains why there is no LAN mode here.
 *
 * ICE gathers candidates in three flavours — *host* (the machine's own LAN
 * addresses), *server-reflexive* (its public address, discovered through STUN)
 * and *relay* (a TURN server). Each side offers all of them, connectivity
 * checks run over every pair, and the pairs are ranked by a priority in which
 * host beats reflexive beats relay. Two machines on one subnet therefore find
 * each other's 192.168 addresses, the direct pair succeeds first, and it wins.
 * Nothing in this file detects a local network, and nothing should: writing
 * that detection would mean reimplementing, worse, the thing the protocol
 * already does correctly.
 *
 * ## Why a second data channel
 *
 * Trystero opens one ordered, reliable channel and uses it for everything. That
 * is right for chat and wrong for inputs: reliability means a lost packet is
 * retransmitted, and ordering means every packet behind it waits — so one drop
 * at 60Hz stalls the input stream for a round trip, precisely when the rollback
 * session most needs the *next* frame. The next packet already carries the
 * frame that went missing (see `packet.ts`), so the retransmission is not just
 * late, it is redundant.
 *
 * So this adapter opens its own channel with `{ordered: false,
 * maxRetransmits: 0}` on the connection Trystero already negotiated. The
 * channel is *negotiated out-of-band* — both peers create it with the same
 * fixed id, so no renegotiation, no extra offer/answer, no signalling round
 * trip; it simply becomes usable once the SCTP association is up. Trystero's
 * reliable action stays wired as a fallback, so a browser that rejects the
 * unreliable channel plays anyway, a little worse.
 */

import { joinRoom, selfId as trysteroSelfId } from "trystero";
import { createEmitter, type Transport } from "../transport";

/* -------------------------------------------------------------- room codes -- */

/**
 * Four uppercase letters, minus `I` and `O`.
 *
 * One player reads this aloud to the other, which is the whole design brief:
 * short enough to say in one breath, and free of the pairs that get misheard.
 * `I`/`1` and `O`/`0` are the classic offenders, and dropping them costs
 * nothing — 24^4 is 331,776 rooms, and the game's population will not be
 * troubled by the birthday problem.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

export function makeRoomCode(random: () => number = defaultRandom): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Accept what a human typed, or reject it.
 *
 * Lowercase and stray spaces are typos, not different rooms, so they are
 * repaired. `0`/`1` are folded onto `O`/`I` — which are not in the alphabet, so
 * they then fail, which is the honest answer: the code they were given did not
 * contain those characters, and silently joining a *different* valid room would
 * be worse than telling them to look again.
 */
export function normalizeRoomCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, "");
  if (cleaned.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

/* ------------------------------------------------------------------- types -- */

/**
 * The part of a Trystero room this adapter touches.
 *
 * Declared structurally rather than imported so tests can supply a fake room
 * without a WebRTC stack, which jsdom does not have.
 */
export interface RoomLike {
  makeAction(namespace: string): {
    send(data: Uint8Array): unknown;
    onMessage: ((data: unknown, context: { peerId: string }) => void) | null;
  };
  getPeers(): Record<string, RTCPeerConnection | undefined>;
  leave(): unknown;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
}

export type JoinRoomLike = (config: { appId: string; password?: string }, roomId: string) => RoomLike;

export interface WebRtcOptions {
  /** Four letters from `makeRoomCode`, or whatever the user typed and
   *  `normalizeRoomCode` accepted. */
  roomCode: string;
  /** Namespaces the signalling topic. Change it and old clients cannot see you. */
  appId?: string;
  /** End-to-end encrypts signalling, so a room code alone is not enough to
   *  join a private match. */
  password?: string;
  /** Injected in tests. Defaults to Trystero's Nostr-signalled `joinRoom`. */
  joinRoom?: JoinRoomLike;
  selfId?: string;
  /** SCTP stream id for the unreliable channel. Must match on both peers, and
   *  must not collide with the in-band channel Trystero opens (id 0). */
  unreliableChannelId?: number;
  onStatus?: (status: WebRtcStatus) => void;
}

export interface WebRtcStatus {
  readonly peerId: string;
  /** `unreliable` once the direct input channel is carrying traffic;
   *  `reliable` while still falling back to Trystero's ordered channel. */
  readonly channel: "reliable" | "unreliable" | "closed";
}

export const DEFAULT_APP_ID = "super-smash";
export const INPUT_CHANNEL_LABEL = "smash-input";
/** Any id both peers agree on and Trystero does not use. */
export const DEFAULT_UNRELIABLE_CHANNEL_ID = 42;
/** Trystero namespaces are short by convention; this one carries every packet. */
const ACTION_NAMESPACE = "smash";

/* ----------------------------------------------------------------- adapter -- */

export function createWebRtcTransport(options: WebRtcOptions): Transport {
  const code = normalizeRoomCode(options.roomCode);
  if (code === null) throw new Error(`"${options.roomCode}" is not a room code`);

  const join = options.joinRoom ?? defaultJoinRoom;
  const channelId = options.unreliableChannelId ?? DEFAULT_UNRELIABLE_CHANNEL_ID;
  const selfId = options.selfId ?? trysteroSelfId;

  const messages = createEmitter<[Uint8Array, string]>();
  const joins = createEmitter<[string]>();
  const leaves = createEmitter<[string]>();
  const channels = new Map<string, RTCDataChannel>();
  const peers = new Set<string>();
  let closed = false;

  const room = join(
    { appId: options.appId ?? DEFAULT_APP_ID, password: options.password },
    code,
  );
  const action = room.makeAction(ACTION_NAMESPACE);

  action.onMessage = (data, context) => {
    if (closed) return;
    const bytes = asBytes(data);
    if (bytes) messages.emit(bytes, context.peerId);
  };

  room.onPeerJoin = (peerId) => {
    if (closed) return;
    peers.add(peerId);
    openUnreliableChannel(peerId);
    joins.emit(peerId);
  };

  room.onPeerLeave = (peerId) => {
    if (closed) return;
    peers.delete(peerId);
    closeChannel(peerId);
    options.onStatus?.({ peerId, channel: "closed" });
    leaves.emit(peerId);
  };

  /**
   * Attach the low-latency channel to the connection Trystero just made.
   *
   * `negotiated: true` is the load-bearing flag. Without it, creating a channel
   * on a live connection fires `negotiationneeded` and requires a fresh
   * offer/answer through the signalling relay — seconds, at the exact moment
   * the match is starting. With it, both peers create the same stream id
   * independently and the channel is usable immediately over the SCTP
   * association that already exists.
   */
  function openUnreliableChannel(peerId: string): void {
    const connection = room.getPeers()[peerId];
    if (!connection || typeof connection.createDataChannel !== "function") return;
    try {
      const channel = connection.createDataChannel(INPUT_CHANNEL_LABEL, {
        negotiated: true,
        id: channelId,
        ordered: false,
        maxRetransmits: 0,
      });
      channel.binaryType = "arraybuffer";
      channel.onopen = () => options.onStatus?.({ peerId, channel: "unreliable" });
      channel.onmessage = (event: MessageEvent) => {
        if (closed) return;
        const bytes = asBytes(event.data);
        if (bytes) messages.emit(bytes, peerId);
      };
      channel.onclose = () => {
        channels.delete(peerId);
        options.onStatus?.({ peerId, channel: "reliable" });
      };
      channel.onerror = () => {
        channels.delete(peerId);
        options.onStatus?.({ peerId, channel: "reliable" });
      };
      channels.set(peerId, channel);
      options.onStatus?.({ peerId, channel: "reliable" });
    } catch {
      // Some browser refused the channel. Trystero's reliable action still
      // carries everything; the match is playable, just less forgiving of loss.
      options.onStatus?.({ peerId, channel: "reliable" });
    }
  }

  function closeChannel(peerId: string): void {
    const channel = channels.get(peerId);
    if (!channel) return;
    channels.delete(peerId);
    channel.onmessage = null;
    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
    try {
      channel.close();
    } catch {
      /* already gone */
    }
  }

  return {
    selfId,
    send(bytes) {
      if (closed) return;
      const covered = new Set<string>();
      for (const [peerId, channel] of [...channels]) {
        if (channel.readyState !== "open") continue;
        try {
          // `send` is typed against a view over a plain ArrayBuffer. Every
          // packet here comes from `encodePacket`, which allocates one; a
          // SharedArrayBuffer-backed view cannot reach this line.
          channel.send(bytes as Uint8Array<ArrayBuffer>);
          covered.add(peerId);
        } catch {
          closeChannel(peerId);
        }
      }
      // The reliable path is skipped only when every peer was reached
      // directly — sending on both would double the traffic and deliver every
      // input twice — but a single peer still waiting for its channel to open
      // brings it back for everybody, since Trystero's action is a broadcast.
      if (peers.size > 0 && covered.size === peers.size) return;
      try {
        void action.send(bytes);
      } catch {
        /* fire and forget: the next frame carries these inputs again */
      }
    },
    onMessage: (cb) => messages.add(cb),
    onPeerJoin: (cb) => joins.add(cb),
    onPeerLeave: (cb) => leaves.add(cb),
    close() {
      if (closed) return;
      closed = true;
      peers.clear();
      for (const peerId of [...channels.keys()]) closeChannel(peerId);
      action.onMessage = null;
      room.onPeerJoin = null;
      room.onPeerLeave = null;
      try {
        void room.leave();
      } catch {
        /* leaving a room that is already gone is not an error worth raising */
      }
      messages.clear();
      joins.clear();
      leaves.clear();
    },
  };
}

/* ----------------------------------------------------------------- helpers -- */

/**
 * Trystero's `joinRoom` is generic and overloaded; `RoomLike` is the narrow
 * structural slice this adapter uses. One cast at the boundary is cheaper than
 * threading Trystero's type parameters through an interface that exists to keep
 * Trystero out of the tests.
 */
const defaultJoinRoom: JoinRoomLike = (config, roomId) =>
  joinRoom(config, roomId) as unknown as RoomLike;

function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function defaultRandom(): number {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    cryptoObj.getRandomValues(buffer);
    return buffer[0] / 0x1_0000_0000;
  }
  return Math.random();
}
