// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseIceResponse } from "./iceConfig";
import { makeRoomCode } from "./roomCode";
import { ROOM_CLOSE_CODES, type RoomIntent } from "./signalProtocol";

/**
 * Against a running Worker — `pnpm preview` locally, or the deployed URL.
 * Skipped in the ordinary `pnpm test`:
 *   WORKER_URL=http://localhost:8787 pnpm vitest run src/net/roomWorker.integration.test.ts
 */
const WORKER_URL = process.env.WORKER_URL;

interface Client {
  readonly closed: Promise<number>;
  send(value: unknown): void;
  next(t: string): Promise<Record<string, unknown>>;
  close(): void;
}

function connect(code: string, intent: RoomIntent): Client {
  const base = (WORKER_URL ?? "").replace(/^http/, "ws");
  const ws = new WebSocket(`${base}/ws/room/${code}?intent=${intent}`);
  const messages: Record<string, unknown>[] = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data)) as Record<string, unknown>));
  const opened = new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
  return {
    closed,
    send: (value) => void opened.then(() => ws.send(JSON.stringify(value))),
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
