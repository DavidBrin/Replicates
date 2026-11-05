/**
 * One online session: a room socket, the WebRTC transport it introduces, and
 * the lobby talk that rides the same socket.
 *
 * Opened from the lobby, kept alive across client-side navigation (stage →
 * fighters → play) as the active session, and closed on leaving. ICE servers
 * are fetched first so the transport exists before the room can say a word —
 * every signalling message then has somewhere to go.
 */

import {
  createDoSignalTransport,
  type DoSignalStatus,
  type DoSignalTransport,
  type PeerConfig,
  type PeerConnectionLike,
  type Route,
} from "../adapters/doSignal";
import type { IceResponse } from "../iceConfig";
import { fetchIceServers, toRtcIceServers } from "../iceServers";
import { createSignallingClient, type SignallingClient } from "../signalling";
import { isRecord, roomErrorForCloseCode, type PeerInfo, type Role, type RoomError, type RoomIntent } from "../signalProtocol";
import { createEmitter, type Emitter, type Unsubscribe } from "../transport";
import { parseLobbyMessage, type LobbyMessage, type ReceivedLobbyMessage } from "./lobby";

/**
 * Why the session cannot go on. The room's refusals; "unreachable" when no
 * room ever answered; "room-lost" when the room's socket dropped while the
 * session still needed it (to negotiate, or to carry the lobby); "bad-start"
 * when this side built a `start` the other side would refuse or read
 * differently, so it was never sent. A first channel that never opens is not
 * among them: the match goes through the room relay instead (Plan 7, D60).
 * Every one of them, and a link that fails, is final: the session leaves the
 * room right after reporting it.
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
 * would ever offer again (see `reconnectAfter`). Only for a channel that had
 * opened: a first one that never does moves to the room relay, at once
 * (`goRelay`).
 */
export const REOFFER_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

/**
 * How long a guest whose lobby channel was lost waits for its host's fresh
 * offer before calling the room lost: the host's longest backoff, and time
 * for the host to notice the loss itself, which can trail this side's.
 */
export const GUEST_REOFFER_WAIT_MS = 10_000;

/**
 * The lobby payload a side sends through the room when its first channel to
 * the other never opened: carry the match through the room instead (Plan 7,
 * D60). Whichever deadline runs out first, the other side follows at once
 * rather than waiting out its own. The session reads it, and it never reaches
 * the lobby; the room passes lobby payloads on unread.
 */
const USE_RELAY = "use-relay";

/**
 * How many seated players move a room to the relay (Plan 7, Phase B): from
 * three, every match is a star through the Durable Object, with no WebRTC
 * mesh. Only a room of two tries a direct channel first.
 */
export const RELAY_FROM_PLAYERS = 3;

export type SessionEvent =
  | { readonly type: "joined"; readonly role: Role }
  /** A seat filled or emptied: `peer` says who, and at which port. */
  | { readonly type: "peer"; readonly present: boolean; readonly peer: PeerInfo }
  | { readonly type: "link"; readonly status: DoSignalStatus }
  /** The match moves to the room relay. Said once, before the relay's `link: open`. */
  | { readonly type: "route"; readonly route: Route }
  /** `from` is the sender's peer id, as the room stamped it. */
  | { readonly type: "lobby"; readonly message: ReceivedLobbyMessage; readonly from: string }
  | { readonly type: "error"; readonly reason: SessionError };

export interface OnlineSessionLike {
  readonly roomCode: string;
  readonly role: Role | null;
  /** The room's port for this machine (its welcome's `self.port`); null before the welcome. */
  readonly seatPort: number | null;
  /** The others the room seats, by peer id. */
  readonly peers: ReadonlyMap<string, PeerInfo>;
  readonly turn: boolean;
  readonly transport: DoSignalTransport;
  /** Where the match's packets go: the transport's route. */
  readonly route: Route;
  on(cb: (event: SessionEvent) => void): Unsubscribe;
  /**
   * True when the message went to the room; false when it did not (the session
   * closed, the room gone, a `start` the other side would not read as sent, or
   * a `start` naming a player the room no longer seats). Apart from a dropped
   * `away`, the reason reaches `on()` as an `error`. With `to`, the room gives
   * it to that peer alone; without, to every other one.
   */
  sendLobby(message: LobbyMessage, to?: string): boolean;
  /**
   * The other players of a begun room, said again on every re-sent begin.
   * From then on a stranger who types the code is never counted toward the
   * relay or the two-player link, offered to, announced to the match, or
   * heard (`DoSignalTransport.lockRoster`).
   */
  lockRoster(ids: readonly string[]): void;
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
  private port: number | null = null;
  private readonly seated = new Map<string, PeerInfo>();
  /** The begun room's other players (`lockRoster`), or null before the begin. */
  private roster: ReadonlySet<string> | null = null;
  /** A start went out (host) or came in (guest): the match owns the channel now. */
  private started = false;
  /** The last link status, to tell a lost channel from a peer that never connected. */
  private link: DoSignalStatus = "waiting";
  /**
   * Whether the channel has opened since the room last seated a peer: a
   * channel lost after that is a reconnect, with re-offers; one that never
   * opened moves to the relay (`reconnectAfter`). Reset only by a
   * `peer-joined` that seats the one other player.
   */
  private linked = false;
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
  /**
   * A use-relay went out during the room message being delivered now. A host
   * with no WebRTC fails its offer inside the transport's own `peer-joined`,
   * and so tells the room before this session hears that join: the join then
   * needs no second one. Cleared once the delivery is over.
   */
  private toldRelay = false;
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
          this.port = event.self.port;
          for (const peer of event.peers) this.seated.set(peer.id, peer);
          this.events.emit({ type: "joined", role: event.self.role });
          for (const peer of event.peers) this.events.emit({ type: "peer", present: true, peer });
          // A newcomer welcomed into three seats moves without a word: the
          // members already seated each hear it join and decide for themselves.
          this.relayIfThree(false);
          break;
        case "peer-joined": {
          const relayed = this.transport.route === "relay";
          this.seated.set(event.peer.id, event.peer);
          // A newcomer the direct route is for gets the transport's ordinary
          // offer, not the old seat's retries. A third seat, or a stranger in a
          // begun room, starts no first link.
          if (this.seatedPeer === event.peer.id) {
            this.linked = false;
            this.resetReconnect();
          }
          this.events.emit({ type: "peer", present: true, peer: event.peer });
          this.relayIfThree(true);
          // The relay is sticky for the room, and only its members know it: a
          // newcomer to a relayed room of two waits for an offer that will
          // never come until it is told. The host tells it; the rest stay quiet.
          if (relayed && this.port === 0 && !this.toldRelay) this.tellRelay(event.peer.id);
          break;
        }
        case "peer-left": {
          const peer = this.seated.get(event.peerId);
          if (peer === undefined) break;
          this.seated.delete(event.peerId);
          // A stranger in a begun room was never one of its players: their
          // leave touches neither the retries nor the start.
          if (this.isPlayer(event.peerId)) {
            // `linked` stays: a held channel can outlive its peer's room socket, and a link
            // that opened and then fails is a failed link, not a first link to relay (Task
            // 40b review Minor 2). An empty seat starts no first link; the next peer-joined does.
            this.resetReconnect();
            // A start that went to (or came from) the player who left is
            // withdrawn: whoever takes the seat meets a lobby again.
            if (this.started) {
              this.started = false;
              this.transport.releaseChannel();
            }
          }
          this.events.emit({ type: "peer", present: false, peer });
          break;
        }
        case "lobby": {
          // Another player moved to the relay (a first channel that never
          // opened, or a third seat): follow it. A started match owns its
          // channel, and a stranger in a begun room is no player, so neither
          // can move it.
          if (event.payload.kind === USE_RELAY) {
            if (!this.started && this.seated.has(event.from) && this.isPlayer(event.from)) this.goRelay(false);
            break;
          }
          const message = parseLobbyMessage(event.payload);
          // Only the host starts a match: a guest drops a start from any other
          // seat, readable or not, rather than hold for it or refuse it.
          const starting = message?.kind === "start" || message?.kind === "unreadable-start";
          if (starting && this.role === "guest" && this.seated.get(event.from)?.port !== 0) break;
          // The guest follows the host into the match: the channel is the match's from here.
          if (message?.kind === "start" && this.role === "guest") this.holdForMatch();
          if (message) this.events.emit({ type: "lobby", message, from: event.from });
          break;
        }
        case "error":
          this.failWith(event.reason);
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
          else this.failWith("unreachable");
          break;
        default:
          break;
      }
    });
  }

  get role(): Role | null {
    return this.transport.role;
  }

  get seatPort(): number | null {
    return this.port;
  }

  get peers(): ReadonlyMap<string, PeerInfo> {
    return this.seated;
  }

  get route(): Route {
    return this.transport.route;
  }

  on(cb: (event: SessionEvent) => void): Unsubscribe {
    return this.events.add(cb);
  }

  sendLobby(message: LobbyMessage, to?: string): boolean {
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
      this.failWith("bad-start");
      return false;
    }
    // The room drops a message it has nobody to give to. A lost pick or stage
    // is repeated when somebody takes the seat; a lost start would leave this
    // side playing alone until the link monitor gave up, with the others still
    // waiting on their select screens. A start naming more players than the
    // room seats (strangers in a begun room not counted) names one whose room
    // socket is gone, so the room is as good as lost: everyone needs a new one.
    if (message.kind === "start" && 1 + this.seatedPlayers() < message.config.fighters.length) {
      this.loseRoom();
      return false;
    }
    this.signalling.send(to === undefined ? { t: "lobby", payload: message } : { t: "lobby", to, payload: message });
    if (message.kind === "start") this.holdForMatch();
    return true;
  }

  lockRoster(ids: readonly string[]): void {
    const before = this.seatedPeer;
    this.roster = new Set(ids);
    // A begin that seats a newcomer on a vacated port of a room of two makes them the one
    // other player: their join counted for nothing, so this is their `peer-joined`. Their
    // first link starts afresh (one that never opens moves to the relay), and the transport
    // offers it.
    const after = this.seatedPeer;
    if (after !== null && after !== before) {
      this.linked = false;
      this.resetReconnect();
    }
    this.transport.lockRoster(ids);
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
   *
   * Relayed, the room socket was the link: the room is lost whatever the
   * status. Mid-match the transport's leave has already reached the link
   * monitor (doSignal.ts), so the match ends as Connection Lost first.
   */
  private roomDropped(): void {
    if (this.transport.route === "relay") {
      this.loseRoom();
      return;
    }
    const status = this.transport.status;
    if (status === "open") return;
    if (status === "negotiating") this.grace = setTimeout(() => this.loseRoom(), ROOM_LOST_GRACE_MS);
    else this.loseRoom();
  }

  /** Every transport status passes through here, out as a `link` event and then against a lost room. */
  private linkChanged(status: DoSignalStatus): void {
    const before = this.link;
    this.link = status;
    if (status === "open") this.linked = true;
    // A first direct connection that cannot be made, with the room still there
    // to agree through, is no failure: the match goes through the room. The
    // failed status is never reported, so no screen shows it on the way.
    if (status === "failed" && !this.linked && !this.roomGone) {
      this.goRelay(true);
      return;
    }
    this.events.emit({ type: "link", status });
    // A connection that had opened and then failed: as final as any session error.
    if (status === "failed") this.leaveSoon();
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
   * asks it to (`renegotiate`: only its own side may have closed), waits for
   * that offer, and calls the room lost if none comes. A failed link is an
   * error of its own, and mid-match the link monitor decides.
   *
   * A first channel that never opened is not a reconnect (Plan 6, Task 40b).
   * Its negotiation ran its whole deadline (`NEGOTIATION_TIMEOUT_MS`), and the
   * same networks would block a fresh offer just as long: re-offering kept
   * David's testers on "Opening a direct connection…" for about 50 s, to be
   * told the room was lost. It moves to the room relay instead (`goRelay`).
   * That waits for the rest of this delivery: when the transport let the
   * negotiation go because the room says the peer left, the session's own
   * `peer-left` follows in the same delivery, and the seat it empties says the
   * peer went, not the link.
   *
   * Relayed, there is no channel to get back: the room seats the peer, and a
   * status back to `waiting` is the room saying it left (or the room gone),
   * never a lost channel to offer again or wait on.
   */
  private reconnectAfter(before: DoSignalStatus, status: DoSignalStatus): void {
    if (this.closed || this.started || this.transport.route === "relay") return;
    if (status === "open") {
      this.resetReconnect();
      return;
    }
    this.cancelReconnect();
    const lost = status === "waiting" && (before === "open" || before === "negotiating");
    const peer = this.seatedPeer;
    if (!lost || peer === null) return;
    if (!this.linked) {
      queueMicrotask(() => {
        if (this.seatedPeer === peer && !this.linked && this.link === "waiting") this.goRelay(true);
      });
      return;
    }
    if (this.role === "guest") {
      // The host may still think its side open, and only it can offer: ask it.
      // In a room of two the one other seat is the host's.
      this.signalling.send({ t: "signal", to: peer, payload: { kind: "renegotiate" } });
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
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      // The transport refuses unless the channel is still down and not held.
      if (this.seatedPeer === peer) this.transport.offerAgain(peer);
    }, delay);
  }

  /**
   * The other player while the room seats exactly one: the two-player
   * re-offer and grace logic works on them. Not whether they are there (the
   * channel decides that), but whether the room can pass them a lobby
   * message, and whom a fresh offer goes to: their room socket can drop on
   * its own while the channel stays open, and the channel can close while
   * their socket stays. Null with no player seated, or more than one.
   * Players, not seats (Task 14): a stranger who typed the code into a begun
   * room of two is neither counted nor offered to (`isPlayer`).
   */
  private get seatedPeer(): string | null {
    let only: string | null = null;
    for (const id of this.seated.keys()) {
      if (!this.isPlayer(id)) continue;
      if (only !== null) return null;
      only = id;
    }
    return only;
  }

  /** A seated peer is one of this room's players: on the roster once a begin locked it, anyone before. */
  private isPlayer(peerId: string): boolean {
    return this.roster === null || this.roster.has(peerId);
  }

  /** The others seated who are players: every seat before a lock, the roster's after. */
  private seatedPlayers(): number {
    let players = 0;
    for (const id of this.seated.keys()) if (this.isPlayer(id)) players += 1;
    return players;
  }

  /**
   * A room that seats `RELAY_FROM_PLAYERS` or more goes to the relay, for
   * good. Counted only before the start, and once a roster is locked, only
   * over its players: a stranger typing the code into a begun room of two
   * moves nobody.
   *
   * A side moved by a join tells the room (`tell`). Every member hears the
   * same joins, but not at the same point against the lock: the host locks
   * as it sends the begin and a guest as it receives it, so a stranger seated
   * in between moves the guest and not the host. Told, the host follows
   * rather than keep a direct channel the guest has let go. A member that is
   * already relayed, or moved the same way, ignores the word.
   */
  private relayIfThree(tell: boolean): void {
    if (this.started) return;
    if (1 + this.seatedPlayers() >= RELAY_FROM_PLAYERS) this.goRelay(tell);
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
    this.failWith("room-lost");
    // A negotiation left running could still open the channel and report "open" over the loss.
    if (this.transport.status === "negotiating") this.transport.close();
  }

  /**
   * The first channel to the seated peer cannot open, here or (`tell` false)
   * on the other side: carry the match through the room instead, for good
   * (D60). The side that finds out tells the other, whose own deadline may be
   * a moment behind; a side that was told says nothing back. The route is
   * announced before the transport moves, so its `link: open` comes after it
   * and nobody reads a direct link on the way to the relay.
   */
  private goRelay(tell: boolean): void {
    if (this.closed || this.roomGone || this.transport.route === "relay") return;
    if (tell) this.tellRelay();
    this.cancelReconnect();
    this.endGrace();
    this.events.emit({ type: "route", route: "relay" });
    this.transport.useRelay();
  }

  /** Tell the room's other side (or, with `to`, that newcomer alone) to use the relay; see `toldRelay`. */
  private tellRelay(to?: string): void {
    const payload = { kind: USE_RELAY };
    this.signalling.send(to === undefined ? { t: "lobby", payload } : { t: "lobby", to, payload });
    this.toldRelay = true;
    queueMicrotask(() => {
      this.toldRelay = false;
    });
  }

  /**
   * Say why the session cannot go on, then leave the room. Left open, the
   * code would stay joinable, and a newcomer could pair with a screen that
   * shows a dead error. The screens keep the error until the player leaves.
   */
  private failWith(reason: SessionError): void {
    this.events.emit({ type: "error", reason });
    this.leaveSoon();
  }

  /**
   * Close once the current delivery is over, not in the middle of it: this
   * can run inside the transport's own report of a lost channel, whose leave
   * must still reach a match's link monitor. Idempotent, as `close` is.
   */
  private leaveSoon(): void {
    queueMicrotask(() => this.close());
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
