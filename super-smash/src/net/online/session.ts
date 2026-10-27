/**
 * One online session: a room socket, the WebRTC transport it introduces, and
 * the lobby talk that rides the same socket.
 *
 * Opened from the lobby, kept alive across client-side navigation (stage →
 * fighters → play) as the active session, and closed on leaving. ICE servers
 * are fetched first so the transport exists before the room can say a word —
 * every signalling message then has somewhere to go.
 */

import { createDoSignalTransport, type DoSignalStatus, type DoSignalTransport, type PeerConfig, type PeerConnectionLike } from "../adapters/doSignal";
import type { IceResponse } from "../iceConfig";
import { fetchIceServers, toRtcIceServers } from "../iceServers";
import { createSignallingClient, type SignallingClient } from "../signalling";
import { ROLE_PORT, roomErrorForCloseCode, type Role, type RoomError, type RoomIntent } from "../signalProtocol";
import { createEmitter, type Emitter, type Unsubscribe } from "../transport";
import { parseLobbyMessage, type LobbyMessage } from "./lobby";

/**
 * Why the session cannot go on. The room's refusals; "unreachable" when no
 * room ever answered; "room-lost" when the room's socket dropped before the
 * data channel could carry the match; "bad-start" when this side built a
 * `start` the other side's parser would refuse, so it was never sent.
 */
export type SessionError = RoomError | "unreachable" | "room-lost" | "bad-start";

/**
 * How long a negotiation already under way when the room drops gets to open
 * the channel on its own. With offer and answer across, only ICE remains,
 * and that takes seconds; past this, the player is better off with a new room.
 */
export const ROOM_LOST_GRACE_MS = 15_000;

export type SessionEvent =
  | { readonly type: "joined"; readonly role: Role }
  | { readonly type: "peer"; readonly present: boolean }
  | { readonly type: "link"; readonly status: DoSignalStatus }
  | { readonly type: "lobby"; readonly message: LobbyMessage }
  | { readonly type: "error"; readonly reason: SessionError };

export interface OnlineSessionLike {
  readonly roomCode: string;
  readonly role: Role | null;
  readonly localPort: number | null;
  readonly turn: boolean;
  readonly transport: DoSignalTransport;
  on(cb: (event: SessionEvent) => void): Unsubscribe;
  sendLobby(message: LobbyMessage): void;
  close(): void;
}

export interface OpenSessionOptions {
  readonly forceRelay?: boolean;
  readonly openSignalling?: (roomCode: string, intent: RoomIntent) => SignallingClient;
  readonly fetchIce?: () => Promise<IceResponse>;
  readonly createPeerConnection?: (config: PeerConfig) => PeerConnectionLike;
}

export class OnlineSession implements OnlineSessionLike {
  static async open(roomCode: string, intent: RoomIntent, options: OpenSessionOptions = {}): Promise<OnlineSession> {
    const ice = await (options.fetchIce ?? (() => fetchIceServers()))();
    const openSignalling =
      options.openSignalling ?? ((code: string, i: RoomIntent) => createSignallingClient({ roomCode: code, intent: i }));
    // Nothing awaits between opening the socket and the two subscriptions
    // below: the client never replays an event, so a late listener misses it.
    const signalling = openSignalling(roomCode, intent);
    // The transport reports no status until the room speaks, and by then the session exists.
    let session: OnlineSession | null = null;
    const transport = createDoSignalTransport({
      signalling,
      iceServers: toRtcIceServers(ice),
      forceRelay: options.forceRelay,
      createPeerConnection: options.createPeerConnection,
      onStatus: (status) => session?.linkChanged(status),
    });
    session = new OnlineSession(roomCode, signalling, transport, ice.turn);
    return session;
  }

  private readonly events: Emitter<[SessionEvent]> = createEmitter();
  private welcomed = false;
  private roomGone = false;
  /** Running while a negotiation outlives the room; see `roomDropped`. */
  private grace: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly off: Unsubscribe;

  private constructor(
    readonly roomCode: string,
    private readonly signalling: SignallingClient,
    readonly transport: DoSignalTransport,
    readonly turn: boolean,
  ) {
    // Subscribed after the transport, so the transport has its role before
    // anybody hears "joined".
    this.off = signalling.on((event) => {
      switch (event.t) {
        case "welcome":
          this.welcomed = true;
          this.events.emit({ type: "joined", role: event.self.role });
          if (event.peer) this.events.emit({ type: "peer", present: true });
          break;
        case "peer-joined":
          this.events.emit({ type: "peer", present: true });
          break;
        case "peer-left":
          this.events.emit({ type: "peer", present: false });
          break;
        case "lobby": {
          const message = parseLobbyMessage(event.payload);
          if (message) this.events.emit({ type: "lobby", message });
          break;
        }
        case "error":
          this.events.emit({ type: "error", reason: event.reason });
          break;
        case "closed":
          // A refusal already arrived as an `error`. Before a welcome, nobody
          // answered; after one, a drop is a Worker deploy restarting the room.
          if (this.closed || this.roomGone || roomErrorForCloseCode(event.code) !== null) break;
          if (this.welcomed) this.roomDropped();
          else this.events.emit({ type: "error", reason: "unreachable" });
          break;
        default:
          break;
      }
    });
  }

  get role(): Role | null {
    return this.transport.role;
  }

  get localPort(): number | null {
    const role = this.role;
    return role === null ? null : ROLE_PORT[role];
  }

  on(cb: (event: SessionEvent) => void): Unsubscribe {
    return this.events.add(cb);
  }

  sendLobby(message: LobbyMessage): void {
    if (this.closed) return;
    // The guest drops a `start` its parser refuses, then waits for one that
    // never comes while the host plays alone. So a start is read here first,
    // exactly as the guest will read it off the wire, and a refusal is this
    // side's error rather than a silence on the other. A refused pick, stage
    // or away costs only a stale lobby screen: the start carries the match.
    if (message.kind === "start" && parseLobbyMessage(JSON.parse(JSON.stringify(message))) === null) {
      this.events.emit({ type: "error", reason: "bad-start" });
      return;
    }
    this.signalling.send({ t: "lobby", payload: message });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.endGrace();
    this.off();
    // Listeners first: closing the transport reports a final "closed" link
    // status, and nobody who called close() wants to hear it.
    this.events.clear();
    this.transport.close();
    this.signalling.close();
  }

  /**
   * The room is gone and will not come back: the socket never reconnects.
   * An open channel needs nothing more from it — the match is peer to peer and
   * carries on (spec review focus). A negotiation under way may still open the
   * channel on its own, so it gets a grace. Anything else needs the room to
   * introduce a peer, and that will not happen now.
   */
  private roomDropped(): void {
    this.roomGone = true;
    const status = this.transport.status;
    if (status === "open") return;
    if (status === "negotiating") this.grace = setTimeout(() => this.loseRoom(), ROOM_LOST_GRACE_MS);
    else this.loseRoom();
  }

  /** Every transport status passes through here, out as a `link` event and then against a grace. */
  private linkChanged(status: DoSignalStatus): void {
    this.events.emit({ type: "link", status });
    if (this.grace === null || status === "negotiating") return;
    if (status === "open") this.endGrace();
    // Failed, or the channel gave up before opening: with no room, nothing renegotiates.
    else this.loseRoom();
  }

  private loseRoom(): void {
    this.endGrace();
    this.events.emit({ type: "error", reason: "room-lost" });
  }

  private endGrace(): void {
    if (this.grace !== null) clearTimeout(this.grace);
    this.grace = null;
  }
}

/* ------------------------------------------------------- the active session -- */

/**
 * The one live session, held outside React so it survives `router.push`
 * between /online, /stage, /fighters and /play. A full page load drops it,
 * which the play page treats as "no online match".
 */
let active: OnlineSessionLike | null = null;

export function getActiveSession(): OnlineSessionLike | null {
  return active;
}

export function setActiveSession(next: OnlineSessionLike | null): void {
  if (active && active !== next) active.close();
  active = next;
}
