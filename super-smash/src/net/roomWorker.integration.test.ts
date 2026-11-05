// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseIceResponse } from "./iceConfig";
import { makeRoomCode } from "./roomCode";
import {
  MAX_MESSAGES_PER_PEER,
  RELAY_BURST,
  RELAY_ID_BYTES,
  RELAY_KICK_DROPS,
  RELAY_RATE_PER_SECOND,
  ROOM_CLOSE_CODES,
  type RoomIntent,
} from "./signalProtocol";

/**
 * Against a running Worker — `pnpm preview` locally, or the deployed URL.
 * Skipped in the ordinary `pnpm test`:
 *   WORKER_URL=http://localhost:8787 pnpm vitest run src/net/roomWorker.integration.test.ts
 */
const WORKER_URL = process.env.WORKER_URL;

interface Client {
  readonly closed: Promise<number>;
  /** Binary frames the room relayed to this client, in arrival order. */
  readonly games: Uint8Array[];
  send(value: unknown): void;
  sendBinary(bytes: Uint8Array): void;
  next(t: string): Promise<Record<string, unknown>>;
  close(): void;
}

function connect(code: string, intent: RoomIntent): Client {
  const base = (WORKER_URL ?? "").replace(/^http/, "ws");
  const ws = new WebSocket(`${base}/ws/room/${code}?intent=${intent}`);
  ws.binaryType = "arraybuffer";
  const messages: Record<string, unknown>[] = [];
  const games: Uint8Array[] = [];
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") messages.push(JSON.parse(event.data) as Record<string, unknown>);
    else games.push(new Uint8Array(event.data as ArrayBuffer));
  });
  const opened = new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
  return {
    closed,
    games,
    send: (value) => void opened.then(() => ws.send(JSON.stringify(value))),
    sendBinary: (bytes) => void opened.then(() => ws.send(bytes)),
    async next(t) {
      for (let waited = 0; waited < 5000; waited += 25) {
        const index = messages.findIndex((m) => m.t === t);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`no "${t}" within 5 s; saw ${JSON.stringify(messages)}`);
    },
    close: () => ws.close(1000, "done"),
  };
}

describe.skipIf(!WORKER_URL)("a live room (WORKER_URL)", () => {
  it("admits a host and a guest, relays between them, and turns a third away", async () => {
    const code = makeRoomCode();
    const host = connect(code, "create");
    expect(await host.next("welcome")).toMatchObject({ self: { role: "host" }, peer: null });
    const guest = connect(code, "join");
    const guestWelcome = await guest.next("welcome");
    expect(guestWelcome).toMatchObject({ self: { role: "guest" }, peer: { role: "host" } });
    expect(await host.next("peer-joined")).toMatchObject({ peer: { role: "guest" } });

    host.send({ t: "signal", payload: { kind: "offer", sdp: "v=0" } });
    expect(await guest.next("signal")).toMatchObject({ payload: { kind: "offer", sdp: "v=0" } });

    const third = connect(code, "join");
    expect(await third.next("error")).toEqual({ t: "error", reason: "full" });
    expect(await third.closed).toBe(ROOM_CLOSE_CODES.full);

    guest.close();
    // The refused third was never a peer, so the only exit the host hears is the guest's.
    expect(await host.next("peer-left")).toEqual({ t: "peer-left", peerId: (guestWelcome.self as { id: string }).id });
    host.close();
  });

  it("relays a binary frame to the other peer stamped with its sender, never back to it, and outside the signalling cap", async () => {
    const code = makeRoomCode();
    const host = connect(code, "create");
    const hostWelcome = await host.next("welcome");
    const guest = connect(code, "join");
    await guest.next("welcome");
    await host.next("peer-joined");

    // Past MAX_MESSAGES_PER_PEER (2000) on purpose: game data is not signalling.
    // Sent in batches that each overrun the rate cap, but by less than
    // RELAY_KICK_DROPS, with a pause long enough for the bucket to refill to
    // full between them, so the drops are forgotten and nothing is kicked.
    const body = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const batch = RELAY_BURST + RELAY_KICK_DROPS / 2;
    const refillMs = (RELAY_BURST / RELAY_RATE_PER_SECOND) * 1000 + 2000;
    const startedAt = Date.now();
    let sent = 0;
    while (sent <= MAX_MESSAGES_PER_PEER) {
      if (sent > 0) await new Promise((resolve) => setTimeout(resolve, refillMs));
      for (let i = 0; i < batch; i++) host.sendBinary(body);
      sent += batch;
    }
    for (let waited = 0; waited < 5000 && guest.games.length === 0; waited += 25) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(guest.games.length).toBeGreaterThanOrEqual(1);

    // An offer queued behind the frames: when it lands, every frame the room
    // forwarded has landed too (one socket, in order), and the host was not
    // closed by the cap or a kick.
    host.send({ t: "signal", payload: { kind: "offer", sdp: "v=0" } });
    expect(await guest.next("signal")).toMatchObject({ payload: { kind: "offer", sdp: "v=0" } });
    // Whatever the room would have echoed to the host was sent before the offer reached the guest,
    // so it has arrived before the guest's reply does.
    guest.send({ t: "signal", payload: { kind: "answer", sdp: "v=0" } });
    expect(await host.next("signal")).toMatchObject({ payload: { kind: "answer", sdp: "v=0" } });

    // The rate cap dropped most of the 2100: no more than a burst plus what the
    // time since the first frame was sent could refill (a slow machine gets more).
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    expect(guest.games.length).toBeLessThanOrEqual(RELAY_BURST + RELAY_RATE_PER_SECOND * Math.ceil(elapsedSeconds));
    const hostId = (hostWelcome.self as { id: string }).id;
    for (const game of guest.games) {
      expect(new TextDecoder().decode(game.subarray(0, RELAY_ID_BYTES))).toBe(hostId);
      expect([...game.subarray(RELAY_ID_BYTES)]).toEqual([...body]);
    }
    expect(host.games).toHaveLength(0);

    guest.close();
    host.close();
  }, 60_000);

  it("closes a socket that floods the relay with too-many-messages, and tells the other peer it left", async () => {
    const code = makeRoomCode();
    const host = connect(code, "create");
    const hostWelcome = await host.next("welcome");
    const guest = connect(code, "join");
    await guest.next("welcome");
    await host.next("peer-joined");

    // Twice what a full bucket forwards and drops before the kick, so a slow
    // machine's refill during the burst cannot save it.
    const body = new Uint8Array([1, 2, 3]);
    for (let i = 0; i < 2 * (RELAY_BURST + RELAY_KICK_DROPS); i++) host.sendBinary(body);
    expect(await host.next("error")).toEqual({ t: "error", reason: "too-many-messages" });
    expect(await host.closed).toBe(ROOM_CLOSE_CODES["too-many-messages"]);
    expect(await guest.next("peer-left")).toEqual({ t: "peer-left", peerId: (hostWelcome.self as { id: string }).id });

    guest.close();
  });

  it("tells a mistyped code there is no such room", async () => {
    const lonely = connect(makeRoomCode(), "join");
    expect(await lonely.next("error")).toEqual({ t: "error", reason: "not-found" });
    expect(await lonely.closed).toBe(ROOM_CLOSE_CODES["not-found"]);
  });

  it("serves ICE servers at /api/ice, uncached", async () => {
    const res = await fetch(`${WORKER_URL}/api/ice`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(parseIceResponse(await res.json())).not.toBeNull();
  });
});
