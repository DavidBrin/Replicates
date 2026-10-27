import { DurableObject } from "cloudflare:workers";

import { parseRoomIntent, type ServerMessage } from "../../src/net/signalProtocol";
import type { Env } from "./env";
import { decideJoin, departures, relay, type Delivery, type PeerAttachment } from "./room";

/**
 * One room: at most two sockets, and a pipe between them.
 *
 * Every rule lives in ./room.ts as a pure function; this class only maps those
 * decisions onto sockets. It uses the WebSocket Hibernation API
 * (`ctx.acceptWebSocket`), so an idle lobby costs nothing, and it never sets a
 * timer: a 60 Hz loop here would keep the object awake, which spec §3.1
 * forbids. The match never touches it — once the DataChannel opens, inputs go
 * peer to peer — so the restart every deploy causes drops only the lobby
 * sockets, not a match in progress.
 *
 * A peer is an open socket carrying an attachment, and nothing else: a refused
 * socket never gets one, and a departing socket loses its own the moment its
 * departure is announced, so each peer leaves exactly once and only the peers
 * who saw it arrive hear that it left.
 *
 * SQLite-backed because that is the only Durable Object storage the Free plan
 * offers. v1 keeps all its state in socket attachments and stores nothing.
 */
export class RoomDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const intent = parseRoomIntent(new URL(request.url).searchParams.get("intent"));
    if (request.headers.get("Upgrade") !== "websocket" || intent === null) {
      return new Response("Expected a WebSocket upgrade with ?intent=create|join", { status: 426 });
    }
    // Settle anyone already gone before counting the room, so a newcomer is
    // never told about (or later told of the exit of) a peer it cannot meet.
    this.departClosed();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    // The id is made here; nothing the client sends ever names it.
    const decision = decideJoin(this.peers(), intent, crypto.randomUUID().slice(0, 8));

    if (decision.type === "reject") {
      // Accepted only long enough to say why: a browser cannot read the HTTP
      // status of a refused upgrade, only a close code. Plain accept(), not
      // acceptWebSocket(): the socket never appears in getWebSockets(), carries
      // no attachment, and its close never reaches webSocketClose, so the two
      // peers inside never hear of it. (wrangler dev logs "Network connection
      // lost" when such a socket hangs up; a hibernatable one closed before the
      // 101 instead held the client's close event for ~10 s.)
      server.accept();
      send(server, decision.message);
      close(server, decision.closeCode, decision.reason);      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    const attachment: PeerAttachment = { ...decision.peer, received: 0 };
    server.serializeAttachment(attachment);
    send(server, decision.welcome);
    if (decision.notify) this.deliver(decision.notify);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const from = attachmentOf(ws);
    if (!from) return;
    const outcome = relay(from, message, this.peers());
    // Every frame counts, a refused one included, and the count lives in the
    // attachment so the flood cap holds across hibernation.
    const counted: PeerAttachment = { ...from, received: from.received + 1 };
    ws.serializeAttachment(counted);
    switch (outcome.type) {
      case "forward":
        this.deliver(outcome.delivery);
        break;
      case "reply":
        send(ws, outcome.message);
        break;
      case "kick":
        send(ws, outcome.message);
        close(ws, outcome.closeCode, outcome.reason);
        // Gone now, not whenever the client finishes the close handshake.
        this.depart(ws);
        break;
      case "drop":
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Finish a close the client started. Still CLOSING here means the runtime
    // did not answer it (wrangler dev does not), and without an answer the
    // browser waits out a timeout and reports 1006 instead of its own code.
    if (ws.readyState === WebSocket.CLOSING) close(ws, sendableCloseCode(code), reason);
    this.depart(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.depart(ws);
  }

  /** Tells the others once, then forgets the socket, so a later close or error is not a second exit. */
  private depart(ws: WebSocket): void {
    const left = attachmentOf(ws);
    if (!left) return;
    try {
      ws.serializeAttachment(null);
    } catch {
      // Already torn down; the runtime drops it from getWebSockets() regardless.
    }
    for (const delivery of departures(left, this.peers())) this.deliver(delivery);
  }

  /** Announces any peer whose socket stopped being open before its close event arrived. */
  private departClosed(): void {
    for (const ws of this.ctx.getWebSockets()) if (ws.readyState !== WebSocket.OPEN) this.depart(ws);
  }

  private peers(): PeerAttachment[] {
    return this.admitted().map(({ peer }) => peer);
  }

  private deliver(delivery: Delivery): void {
    for (const { ws, peer } of this.admitted()) if (peer.id === delivery.to) send(ws, delivery.message);
  }

  /** The peers: open sockets with an attachment (getWebSockets() also returns ones still closing). */
  private admitted(): { ws: WebSocket; peer: PeerAttachment }[] {
    const out: { ws: WebSocket; peer: PeerAttachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const peer = attachmentOf(ws);
      if (peer && ws.readyState === WebSocket.OPEN) out.push({ ws, peer });
    }
    return out;
  }
}

function attachmentOf(ws: WebSocket): PeerAttachment | null {
  return ws.deserializeAttachment() as PeerAttachment | null;
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // The socket is already closing; its own close handler tells the other side.
  }
}

/** The client's code when an application may send it (1000, 3000–4999), else 1000; 1005/1006/1015 can never be sent. */
function sendableCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}

function close(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closing from the other end; it is going either way.
  }
}
