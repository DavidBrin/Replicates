import { describe, expect, it } from "vitest";

import { createSignallingClient, roomSocketUrl, type SignallingEvent, type WebSocketLike } from "./signalling";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  closedWith: [number | undefined, string | undefined] | null = null;
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onclose: WebSocketLike["onclose"] = null;
  onerror: WebSocketLike["onerror"] = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = [code, reason];
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(value: unknown): void {
    this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) });
  }
  drop(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function client() {
  let socket: FakeSocket | null = null;
  const signalling = createSignallingClient({
    roomCode: "ABCD",
    intent: "create",
    origin: "https://david-smash.leaders-game.workers.dev",
    createSocket: (url) => (socket = new FakeSocket(url)),
  });
  const events: SignallingEvent[] = [];
  signalling.on((event) => events.push(event));
  return { signalling, socket: socket as unknown as FakeSocket, events };
}

describe("roomSocketUrl", () => {
  it("uses wss on an https page and ws on http", () => {
    expect(roomSocketUrl("https://david-smash.leaders-game.workers.dev", "ABCD", "create")).toBe(
      "wss://david-smash.leaders-game.workers.dev/ws/room/ABCD?intent=create",
    );
    expect(roomSocketUrl("http://localhost:8787", "QRST", "join")).toBe("ws://localhost:8787/ws/room/QRST?intent=join");
  });
});

describe("the signalling client", () => {
  it("holds messages until the socket opens, then sends them in order", () => {
    const { signalling, socket } = client();
    signalling.send({ t: "lobby", payload: { kind: "away", away: true } });
    signalling.send({ t: "lobby", payload: { kind: "away", away: false } });
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent.map((s) => JSON.parse(s).payload.away)).toEqual([true, false]);
    signalling.send({ t: "signal", payload: { kind: "offer", sdp: "v=0" } });
    expect(socket.sent).toHaveLength(3);
  });

  it("emits what the room says, and ignores what it cannot read", () => {
    const { socket, events } = client();
    socket.open();
    socket.receive({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    socket.receive("{not json");
    socket.receive({ t: "mystery" });
    expect(events).toEqual([{ t: "welcome", self: { id: "h1", role: "host" }, peer: null }]);
  });

  it("reports how the room closed, so a full room can be told apart from a dead Worker", () => {
    const { socket, events } = client();
    socket.drop(4001, "full");
    expect(events).toEqual([{ t: "closed", code: 4001, reason: "full" }]);
  });

  it("closes politely and goes quiet", () => {
    const { signalling, socket, events } = client();
    socket.open();
    signalling.close();
    expect(socket.closedWith).toEqual([1000, "leaving"]);
    socket.receive({ t: "peer-left", peerId: "g1" });
    signalling.send({ t: "lobby", payload: { kind: "away", away: true } });
    expect(events).toEqual([]);
    expect(socket.sent).toEqual([]);
  });
});
