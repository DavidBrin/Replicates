import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_UNRELIABLE_CHANNEL_ID,
  INPUT_CHANNEL_LABEL,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  createWebRtcTransport,
  makeRoomCode,
  normalizeRoomCode,
  type RoomLike,
} from "./webrtc";

/* ------------------------------------------------------------- room codes -- */

describe("room codes", () => {
  it("is four letters a person can read down a phone", () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(/^[A-Z]{4}$/);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it("contains no character that is misheard as a digit", () => {
    // "Oh" vs zero and "eye" vs one are the two that cost a room.
    expect(ROOM_CODE_ALPHABET).not.toContain("I");
    expect(ROOM_CODE_ALPHABET).not.toContain("O");
  });

  it("uses the whole alphabet", () => {
    const seen = new Set<string>();
    let value = 0;
    const cycling = () => ((value = (value + 1) % ROOM_CODE_ALPHABET.length) / ROOM_CODE_ALPHABET.length);
    for (let i = 0; i < 200; i++) for (const ch of makeRoomCode(cycling)) seen.add(ch);
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it("repairs what a person actually types", () => {
    expect(normalizeRoomCode("abcd")).toBe("ABCD");
    expect(normalizeRoomCode("  QRST ")).toBe("QRST");
    expect(normalizeRoomCode("QR-ST")).toBe("QRST");
  });

  it("rejects rather than guesses", () => {
    expect(normalizeRoomCode("ABC")).toBeNull();
    expect(normalizeRoomCode("ABCDE")).toBeNull();
    expect(normalizeRoomCode("AB1D")).toBeNull();
    // `I` is not in the alphabet, so a code containing one was misheard.
    // Silently joining a *different* valid room would be worse than failing.
    expect(normalizeRoomCode("ABID")).toBeNull();
    expect(normalizeRoomCode("")).toBeNull();
  });
});

/* ------------------------------------------------------------- fake trystero -- */

class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Uint8Array[] = [];
  closed = false;

  constructor(readonly label: string, readonly options: RTCDataChannelInit) {}

  send(data: Uint8Array): void {
    if (this.readyState !== "open") throw new Error("not open");
    this.sent.push(new Uint8Array(data));
  }

  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }

  close(): void {
    this.closed = true;
    this.readyState = "closed";
  }
}

class FakeRoom implements RoomLike {
  onPeerJoin: ((peerId: string) => void) | null = null;
  onPeerLeave: ((peerId: string) => void) | null = null;
  readonly channels = new Map<string, FakeDataChannel>();
  readonly actionSends: Uint8Array[] = [];
  actionOnMessage: ((data: unknown, context: { peerId: string }) => void) | null = null;
  left = false;
  /** Peers whose RTCPeerConnection refuses an extra channel. */
  readonly refuse = new Set<string>();

  makeAction() {
    return {
      send: (data: Uint8Array) => {
        this.actionSends.push(new Uint8Array(data));
      },
      get onMessage() {
        return null as ((data: unknown, context: { peerId: string }) => void) | null;
      },
      set onMessage(handler: ((data: unknown, context: { peerId: string }) => void) | null) {
        room.actionOnMessage = handler;
      },
    };
  }

  getPeers(): Record<string, RTCPeerConnection | undefined> {
    const peers: Record<string, RTCPeerConnection> = {};
    for (const id of this.peerIds) {
      peers[id] = {
        createDataChannel: (label: string, options: RTCDataChannelInit) => {
          if (this.refuse.has(id)) throw new Error("no channel for you");
          const channel = new FakeDataChannel(label, options);
          this.channels.set(id, channel);
          return channel as unknown as RTCDataChannel;
        },
      } as unknown as RTCPeerConnection;
    }
    return peers;
  }

  leave(): void {
    this.left = true;
  }

  readonly peerIds = new Set<string>();

  join(peerId: string): void {
    this.peerIds.add(peerId);
    this.onPeerJoin?.(peerId);
  }

  leavePeer(peerId: string): void {
    this.peerIds.delete(peerId);
    this.onPeerLeave?.(peerId);
  }
}

// `makeAction` needs to reach the room instance through a setter, which a class
// field cannot express cleanly; one module-level binding keeps the fake honest.
let room: FakeRoom;

function connect(options: { refuse?: string[] } = {}) {
  room = new FakeRoom();
  for (const id of options.refuse ?? []) room.refuse.add(id);
  const transport = createWebRtcTransport({
    roomCode: "abcd",
    selfId: "me",
    joinRoom: () => room,
  });
  return { transport, room };
}

/* ------------------------------------------------------------------ adapter -- */

describe("the data channel", () => {
  it("opens an unreliable, unordered channel of its own", () => {
    // The whole point. Trystero's channel is ordered and reliable, so one lost
    // packet would hold every later input behind it for a round trip — at
    // exactly the moment the session needs the *next* frame, not the last one.
    const { room } = connect();
    room.join("them");

    const channel = room.channels.get("them")!;
    expect(channel.label).toBe(INPUT_CHANNEL_LABEL);
    expect(channel.options).toMatchObject({
      ordered: false,
      maxRetransmits: 0,
    });
  });

  it("negotiates the channel out of band, so no renegotiation is needed", () => {
    // `negotiated: true` with a fixed id is what avoids a fresh offer/answer
    // through the signalling relay at the moment the match starts.
    const { room } = connect();
    room.join("them");
    expect(room.channels.get("them")!.options).toMatchObject({
      negotiated: true,
      id: DEFAULT_UNRELIABLE_CHANNEL_ID,
    });
  });

  it("takes the direct path once the channel opens, and not before", () => {
    const { transport, room } = connect();
    room.join("them");

    transport.send(new Uint8Array([1]));
    expect(room.actionSends).toHaveLength(1);
    expect(room.channels.get("them")!.sent).toHaveLength(0);

    room.channels.get("them")!.open();
    transport.send(new Uint8Array([2]));

    expect(room.channels.get("them")!.sent).toHaveLength(1);
    // Not sent twice: the peer would receive every input on both paths.
    expect(room.actionSends).toHaveLength(1);
  });

  it("falls back for everybody when one peer has no direct channel", () => {
    // Trystero's action is a broadcast, so the fallback covers the whole room.
    const { transport, room } = connect({ refuse: ["stubborn"] });
    room.join("them");
    room.join("stubborn");
    room.channels.get("them")!.open();

    transport.send(new Uint8Array([1]));

    expect(room.channels.get("them")!.sent).toHaveLength(1);
    expect(room.actionSends).toHaveLength(1);
  });

  it("plays on when a browser refuses the extra channel", () => {
    const { transport, room } = connect({ refuse: ["them"] });
    expect(() => room.join("them")).not.toThrow();
    transport.send(new Uint8Array([1]));
    expect(room.actionSends).toHaveLength(1);
  });

  it("reverts to the reliable path if the channel breaks mid-match", () => {
    const { transport, room } = connect();
    room.join("them");
    const channel = room.channels.get("them")!;
    channel.open();
    transport.send(new Uint8Array([1]));
    expect(room.actionSends).toHaveLength(0);

    channel.onclose?.();
    transport.send(new Uint8Array([2]));

    expect(room.actionSends).toHaveLength(1);
  });
});

describe("receiving", () => {
  it("accepts bytes from the direct channel", () => {
    const { transport, room } = connect();
    const received = vi.fn();
    transport.onMessage(received);
    room.join("them");
    room.channels.get("them")!.open();

    room.channels
      .get("them")!
      .onmessage?.({ data: new Uint8Array([7, 8]).buffer } as MessageEvent);

    expect(received).toHaveBeenCalledOnce();
    expect([...(received.mock.calls[0][0] as Uint8Array)]).toEqual([7, 8]);
    expect(received.mock.calls[0][1]).toBe("them");
  });

  it("accepts bytes from the reliable fallback too", () => {
    const { transport, room } = connect();
    const received = vi.fn();
    transport.onMessage(received);
    room.join("them");

    room.actionOnMessage?.(new Uint8Array([1, 2, 3]), { peerId: "them" });

    expect([...(received.mock.calls[0][0] as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it("ignores anything that is not bytes", () => {
    const { transport, room } = connect();
    const received = vi.fn();
    transport.onMessage(received);
    room.join("them");

    room.actionOnMessage?.({ hello: true }, { peerId: "them" });
    room.actionOnMessage?.("string", { peerId: "them" });

    expect(received).not.toHaveBeenCalled();
  });
});

describe("presence and shutdown", () => {
  it("passes joins and leaves through", () => {
    const { transport, room } = connect();
    const joined = vi.fn();
    const left = vi.fn();
    transport.onPeerJoin(joined);
    transport.onPeerLeave(left);

    room.join("them");
    room.leavePeer("them");

    expect(joined).toHaveBeenCalledExactlyOnceWith("them");
    expect(left).toHaveBeenCalledExactlyOnceWith("them");
  });

  it("reports which path each peer is on", () => {
    const statuses: { peerId: string; channel: string }[] = [];
    room = new FakeRoom();
    createWebRtcTransport({
      roomCode: "ABCD",
      selfId: "me",
      joinRoom: () => room,
      onStatus: (status) => statuses.push({ ...status }),
    });

    room.join("them");
    room.channels.get("them")!.open();
    room.leavePeer("them");

    expect(statuses.map((s) => s.channel)).toEqual(["reliable", "unreliable", "closed"]);
  });

  it("tears down channels and leaves the room on close", () => {
    const { transport, room } = connect();
    room.join("them");
    const channel = room.channels.get("them")!;
    channel.open();

    transport.close();

    expect(channel.closed).toBe(true);
    expect(room.left).toBe(true);
    expect(room.onPeerJoin).toBeNull();
    // Idempotent, and inert afterwards.
    expect(() => transport.close()).not.toThrow();
    transport.send(new Uint8Array([1]));
    expect(room.actionSends).toHaveLength(0);
  });

  it("refuses to join a room whose code is not a room code", () => {
    expect(() =>
      createWebRtcTransport({ roomCode: "nope!", joinRoom: () => new FakeRoom() }),
    ).toThrow(/not a room code/);
  });
});
