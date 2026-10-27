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
import { ROLE_PORT, isRecord, roomErrorForCloseCode, type Role, type RoomError, type RoomIntent } from "../signalProtocol";
import { createEmitter, type Emitter, type Unsubscribe } from "../transport";
import { parseLobbyMessage, type LobbyMessage } from "./lobby";

/**
 * Why the session cannot go on. The room's refusals; "unreachable" when no
 * room ever answered; "room-lost" when the room's socket dropped while the
 * session still needed it (to negotiate, or to carry the lobby); "bad-start"
 * when this side built a `start` the other side would refuse or read
 * differently, so it was never sent.
 */
export type SessionError = RoomError | "unreachable" | "room-lost" | "bad-start";

/**
 * How long a negotiation under way when the room drops gets to open the
 * channel without it. "Negotiating" starts before the offer exists, and ICE
 * candidates ride the room socket too, so the grace only helps when the offer,
 * the answer and enough candidates crossed before the drop. When they did, ICE
 * finishes in seconds; past this, the player is better off with a new room.
 */
export const ROOM_LOST_GRACE_MS = 15_000;

/**
 * The host's waits before each fresh offer once the lobby channel is lost
 * with both players still in the room: three tries, backing off, and then the
 * room is lost. Nobody joins or leaves in that case, so without these nothing
 * would ever offer again (see `reconnectAfter`).
 */
export const REOFFER_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

/**
 * How long a guest whose lobby channel was lost waits for its host's fresh
 * offer before calling the room lost: the host's longest backoff, and time
 * for the host to notice the loss itself, which can trail this side's.
 */
export const GUEST_REOFFER_WAIT_MS = 10_000;

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
  /**
   * True when the message went to the room; false when it did not (the session
   * closed, the room gone, a `start` the other side would not read as sent, or
   * a `start` with nobody in the room to give it to). Apart from a dropped
   * `away`, the reason reaches `on()` as an `error`.
   */
  sendLobby(message: LobbyMessage): boolean;
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
  /**
   * The other player, while the room says it seats them. Not whether they are
   * there (the channel decides that), but whether the room can pass them a
   * lobby message, and whom a fresh offer goes to: their room socket can drop
   * on its own while the channel stays open, and the channel can close while
   * their socket stays.
   */
  private seatedPeer: string | null = null;
  /** A start went out (host) or came in (guest): the match owns the channel now. */
  private started = false;
  /** The last link status, to tell a lost channel from a peer that never connected. */
  private link: DoSignalStatus = "waiting";
  /** Fresh offers the host has left for this outage; see `REOFFER_DELAYS_MS`. */
  private reoffersLeft = REOFFER_DELAYS_MS.length;
  /** The host's next fresh offer, or the guest's wait for one. */
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  /** The room socket closed, for whatever reason; it never reconnects. */
  private roomGone = false;
  private roomLost = false;
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
          this.seatedPeer = event.peer?.id ?? null;
          this.events.emit({ type: "joined", role: event.self.role });
          if (event.peer) this.events.emit({ type: "peer", present: true });
          break;
        case "peer-joined":
          // A newcomer gets the transport's ordinary offer, not the old seat's retries.
          this.seatedPeer = event.peer.id;
          this.resetReconnect();
          this.events.emit({ type: "peer", present: true });
          break;
        case "peer-left":
          this.seatedPeer = null;
          this.resetReconnect();
          this.events.emit({ type: "peer", present: false });
          break;
        case "lobby": {
          const message = parseLobbyMessage(event.payload);
          // The guest follows the host into the match: the channel is the match's from here.
          if (message?.kind === "start" && this.role === "guest") this.holdForMatch();
          if (message) this.events.emit({ type: "lobby", message });
          break;
        }
        case "error":
          this.events.emit({ type: "error", reason: event.reason });
          break;
        case "closed":
          if (this.closed || this.roomGone) break;
          this.roomGone = true;
          // Fresh offers ride the room socket; with it gone there are none.
          this.cancelReconnect();
          // A refusal already arrived as an `error`. Before a welcome, nobody
          // answered; after one, a drop is a Worker deploy restarting the room.
          if (roomErrorForCloseCode(event.code) !== null) break;
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

  sendLobby(message: LobbyMessage): boolean {
    if (this.closed) return false;
    if (this.roomGone) {
      // The socket would swallow it. The lobby cannot go on without the room —
      // the stage, the picks and the start all ride it — so that is the room
      // lost. An `away` lost this way only costs the peer some patience.
      if (message.kind !== "away" && this.welcomed) this.loseRoom();
      return false;
    }
    // The guest drops a `start` its parser refuses, then waits for one that
    // never comes while the host plays alone; a field the parser does not read
    // would desync the match instead. So a start is read here first, exactly
    // as the guest will read it off the wire, and anything but the same config
    // is this side's error rather than a silence or a desync on the other. A
    // refused pick, stage or away costs only a stale lobby screen.
    if (message.kind === "start" && !arrivesAsSent(message)) {
      this.events.emit({ type: "error", reason: "bad-start" });
      return false;
    }
    // The room drops a message it has nobody to give to. A lost pick or stage
    // is repeated when somebody takes the seat; a lost start would leave this
    // side playing alone until the link monitor gave up, with the other still
    // waiting on its select screen. Their room socket is gone, so the room is
    // as good as lost: both need a new one.
    if (message.kind === "start" && this.seatedPeer === null) {
      this.loseRoom();
      return false;
    }
    this.signalling.send({ t: "lobby", payload: message });
    if (message.kind === "start") this.holdForMatch();
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.endGrace();
    this.cancelReconnect();
    this.off();
    // Listeners first: closing the transport reports a final "closed" link
    // status, and nobody who called close() wants to hear it.
    this.events.clear();
    this.transport.close();
    this.signalling.close();
  }

  /**
   * The room is gone after the welcome, and will not come back. An open
   * channel says nothing yet: mid-match it needs nothing more from the room
   * (spec review focus). In the lobby it still does, and the next lobby
   * message, or the channel closing, reports the loss. A negotiation under way
   * gets a grace to open the channel without the room. Anything else needs
   * the room to introduce a peer, and that will not happen now.
   */
  private roomDropped(): void {
    const status = this.transport.status;
    if (status === "open") return;
    if (status === "negotiating") this.grace = setTimeout(() => this.loseRoom(), ROOM_LOST_GRACE_MS);
    else this.loseRoom();
  }

  /** Every transport status passes through here, out as a `link` event and then against a lost room. */
  private linkChanged(status: DoSignalStatus): void {
    const before = this.link;
    this.link = status;
    this.events.emit({ type: "link", status });
    if (!this.roomGone) this.reconnectAfter(before, status);
    if (!this.roomGone || this.closed || status === "negotiating") return;
    if (status === "open") this.endGrace();
    // Failed, closed, or back to waiting: with no room, nothing renegotiates.
    else this.loseRoom();
  }

  /**
   * The lobby channel went down with the other player still seated: no join
   * or leave will follow to start another negotiation. The host offers again,
   * backing off, and calls the room lost when its tries run out; the guest
   * waits for that offer, and calls the room lost if none comes. A failed link
   * is an error of its own, and mid-match the link monitor decides.
   */
  private reconnectAfter(before: DoSignalStatus, status: DoSignalStatus): void {
    if (this.closed || this.started) return;
    if (status === "open") {
      this.resetReconnect();
      return;
    }
    this.cancelReconnect();
    const lost = status === "waiting" && (before === "open" || before === "negotiating");
    if (!lost || this.seatedPeer === null) return;
    if (this.role === "guest") {
      this.reconnect = setTimeout(() => this.loseRoom(), GUEST_REOFFER_WAIT_MS);
      return;
    }
    if (this.role !== "host") return;
    const delay = REOFFER_DELAYS_MS[REOFFER_DELAYS_MS.length - this.reoffersLeft];
    if (delay === undefined) {
      this.loseRoom();
      return;
    }
    this.reoffersLeft -= 1;
    const peer = this.seatedPeer;
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      // The transport refuses unless the channel is still down and not held.
      if (this.seatedPeer === peer) this.transport.offerAgain(peer);
    }, delay);
  }

  /** The match has started: no fresh offer may replace its channel, on either side. */
  private holdForMatch(): void {
    this.started = true;
    this.cancelReconnect();
    this.transport.holdChannel();
  }

  private resetReconnect(): void {
    this.cancelReconnect();
    this.reoffersLeft = REOFFER_DELAYS_MS.length;
  }

  private cancelReconnect(): void {
    if (this.reconnect !== null) clearTimeout(this.reconnect);
    this.reconnect = null;
  }

  private loseRoom(): void {
    this.endGrace();
    this.cancelReconnect();
    if (this.roomLost) return;
    this.roomLost = true;
    this.events.emit({ type: "error", reason: "room-lost" });
    // A negotiation left running could still open the channel and report "open" over the loss.
    if (this.transport.status === "negotiating") this.transport.close();
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

/* ----------------------------------------------------------------- helpers -- */

/** Whether the other side, parsing this off the wire, ends up holding exactly this message. */
function arrivesAsSent(message: LobbyMessage): boolean {
  const received = parseLobbyMessage(JSON.parse(JSON.stringify(message)));
  return received !== null && sameJson(received, message);
}

/** Structural equality over the plain objects, arrays and primitives a lobby message is made of. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJson(value, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
  }
  return a === b;
}
