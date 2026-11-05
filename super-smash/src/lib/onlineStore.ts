/**
 * What the online screens show, and the glue from a session's events to the
 * two stores.
 *
 * The session (src/net/online/session.ts) knows nothing about React; this is
 * where its events become a status line, a filled opponent panel, the host's
 * stage on the guest's screen, and the start config both play pages read.
 */

import { create } from "zustand";

import type { MatchRules } from "@/engine/types";
import { buildMismatch, describeMismatch, localBuild } from "@/game/onlineConfig";
import type { PadSettings } from "@/input/gamepad";
import type { Route } from "@/net/adapters/doSignal";
import type { BuildStamp, LobbyMessage, OnlineMatchConfig, ReceivedLobbyMessage, RefuseReason } from "@/net/online/lobby";
import { getActiveSession, setActiveSession, type OnlineSessionLike, type SessionError } from "@/net/online/session";
import type { PeerInfo, Role } from "@/net/signalProtocol";
import type { Unsubscribe } from "@/net/transport";
import { useMatchConfig, type StageForm } from "./matchConfig";

/**
 * `connected` means the channel is open, the others have said they run this
 * build, and nothing has gone wrong: for the host, every seat; for a guest,
 * the host's (Plan 7, Phase B). It is the only status a match may start
 * from, so the select screens gate on it. `loading` is the lobby waiting on the
 * game data (the bake) before it opens a room, and `connecting` its wait for
 * the room itself (Plan 6, Task 40b): on a slow connection the first is the
 * long one.
 */
export type OnlineStatus = "idle" | "loading" | "connecting" | "waiting" | "linking" | "connected" | "error";
/**
 * "engine-mismatch": the other player runs another build (Plan 2 Task 27).
 * "unreadable-start": a start from this very build that its parser cannot read
 * (the stamps agree, so it is not another version).
 * "host-left": a guest's host left the lobby, which closes the room (Plan 7, Phase B).
 */
export type OnlineErrorReason = SessionError | "link-failed" | "engine-mismatch" | "unreadable-start" | "host-left";

/** Shown once the player at `port` has left the room; the seat stands empty. */
export function seatLeftNotice(port: number): string {
  return `P${port + 1} left the room.`;
}

/**
 * Shown once the host has refused the player at `port` for running another
 * build (Plan 7, Phase B): the host keeps its room. It outlives that player's
 * leaving, which is why they went.
 */
export function seatMismatchNotice(port: number): string {
  return `P${port + 1} is running a different version, so they can't play in this room.`;
}

/** The select screens' status line while a newcomer's direct connection opens. */
export const LINKING_STATUS = "Connecting to the other player…";

/** The lobby's status line while the other player's link, which runs through the room, waits for their hello (Plan 7, D60). */
export const RELAY_LINKING_STATUS = "Connecting through the relay…";

/**
 * How long, once the channel is open, the other side has to say which build
 * it runs (`hello`, Plan 2 Task 27). A build from before the handshake never
 * says, and is refused when this runs out. Each seat has its own wait on the
 * host, which turns that seat away alone; a guest waits on its host's alone
 * (Plan 7, Phase B). Relayed, a wait that runs out with nothing heard (on the
 * host, from any seat) is a failed link instead (`link-failed`): the tab is
 * not running, and nothing says its build differs. A hello rides the room and
 * takes a round trip at most; until it lands, the screens show the connecting
 * status, so a quick one goes unnoticed.
 */
export const HELLO_TIMEOUT_MS = 5_000;

/**
 * How long an online result keeps the room open before leaving it. The peer
 * that ended first has nothing left to play, but the other one may still be
 * waiting on its last input packets to reach the same result over a lossy
 * link; closing the transport at once would strand it. The results screen
 * holds the room this long, and the play page's runner keeps re-sending its
 * last inputs for as long. Leaving earlier than this (Quit, Back, the screen
 * unmounting) is the player's call and is not held up.
 */
export const ONLINE_RESULT_LINGER_MS = 1_500;

/**
 * One of the others the room seats, as this side knows them (Plan 7, Phase B).
 * `build` is their hello: `"pending"` until it comes, `"ok"` when it matches
 * this build, and `"mismatch"` once it did not (or, on the host, never came).
 * A seat is said afresh by whoever takes it, so a newcomer starts pending.
 */
export interface SeatView {
  readonly peerId: string;
  readonly port: number;
  readonly build: "pending" | "ok" | "mismatch";
}

export interface OnlineFields {
  status: OnlineStatus;
  roomCode: string | null;
  role: Role | null;
  /**
   * What went wrong, in words, for the screens to show. The room cannot go on:
   * only a reset clears it (leaving, or opening another room).
   */
  error: string | null;
  errorReason: OnlineErrorReason | null;
  /**
   * Something the player should know that does not end the room: a player
   * left (`seatLeftNotice`), or the host refused one on another build
   * (`seatMismatchNotice`). The lobby, stage and character select show it. It
   * clears when somebody takes a seat or the channel opens again — a refresh
   * and a rejoin with the same code is the common case — except while a
   * refused player still sits in the host's room.
   */
  notice: string | null;
  /** The others the room seats, by port. Mid-match a leave does not change them: the link monitor decides. */
  seats: readonly SeatView[];
  /** This machine's port: the room's seat port (`session.seatPort`) from the welcome on. Null before it. */
  localPort: number | null;
  /** The stage the host chose, on the guest, with the host's rules when they came along. */
  hostStage: { readonly stageId: string; readonly form: StageForm; readonly rules?: MatchRules } | null;
  /** The host's start config; set on both peers when the match begins. */
  config: OnlineMatchConfig | null;
  remoteAway: boolean;
  /**
   * Where the match's packets go. Null until a link opens; `"direct"` from the
   * first open with no move to the room before it; `"relay"` from the session's
   * `route` event on, and for the rest of the room, as the session's own route
   * is (Plan 7, D60). It does not follow the other player's seat: it stays
   * through a leave, and a newcomer starts from it.
   */
  route: Route | null;
}

interface OnlineStoreState extends OnlineFields {
  patch(next: Partial<OnlineFields>): void;
  reset(): void;
}

const INITIAL: OnlineFields = {
  status: "idle",
  roomCode: null,
  role: null,
  error: null,
  errorReason: null,
  notice: null,
  seats: [],
  localPort: null,
  hostStage: null,
  config: null,
  remoteAway: false,
  route: null,
};

export const useOnlineStore = create<OnlineStoreState>()((set) => ({
  ...INITIAL,
  patch: (next) => set(next),
  reset: () => set(INITIAL),
}));

/**
 * The sentence a player reads. On localhost a developer's hint follows it, for
 * the one failure a developer causes: `pnpm dev` serves the app with no Worker
 * behind it, so there is no room to reach. `hostname` is the page's own unless
 * given.
 */
export function roomErrorMessage(reason: OnlineErrorReason, roomCode: string, hostname = pageHostname()): string {
  const sentence = playerSentence(reason, roomCode);
  return hostname === "localhost" && reason === "unreachable" ? `${sentence} ${UNREACHABLE_DEV_HINT}` : sentence;
}

const UNREACHABLE_DEV_HINT =
  "(Developer: `pnpm dev` has no Worker behind it. Run `pnpm preview`, which serves the build with `wrangler dev` on :8787.)";

function playerSentence(reason: OnlineErrorReason, roomCode: string): string {
  switch (reason) {
    case "full":
      return `Room ${roomCode} already has two players.`;
    case "not-found":
      return `There is no room ${roomCode}. Check the code with the host.`;
    case "taken":
      return `Room ${roomCode} is already in use.`;
    case "unreachable":
      return "Could not reach the online service. Check your connection and try again.";
    case "room-lost":
      return "Lost the room — create or join again.";
    case "bad-start":
      return "The match could not be sent to the other player. Leave the room and start again.";
    case "link-failed":
      return "The connection to the other player failed. Leave the room and try again.";
    case "engine-mismatch":
      return "The other player is running a different version. Both reload the page.";
    case "host-left":
      return "The host left, so the room has closed. Create or join another.";
    case "unreadable-start":
      return "The match settings could not be read, so leave the room and start again.";
    case "bad-message":
    case "too-many-messages":
      return "The room closed the connection.";
  }
}

function pageHostname(): string {
  return typeof location === "undefined" ? "" : location.hostname;
}

/** The host's port: the room seats the host at 0, and each guest at the lowest port free (Plan 7, Phase B). */
const HOST_PORT = 0;

let unbind: Unsubscribe | null = null;

/** Mirror one session into the stores. Replaces any earlier binding. */
export function bindSession(session: OnlineSessionLike): Unsubscribe {
  unbind?.();
  const online = useOnlineStore.getState;
  const match = useMatchConfig.getState;

  /** Whether the channel is open, as the session last reported. */
  let linkOpen = false;
  /**
   * A start this host sent to a player who has since left the room. It stays
   * in the store (mid-match the channel decides), but nobody in the seat can
   * be refusing it any more.
   */
  let withdrawnStart: OnlineMatchConfig | null = null;
  /**
   * The seats that have said anything in the lobby since the link opened or
   * they were seated. Relayed, a wait for a hello that runs out with nothing
   * heard is a link that never worked (the other tab cannot run: a phone
   * switched to another app, say), not another build.
   */
  const heardFrom = new Set<string>();
  /**
   * The waits for a hello, by peer id, each `HELLO_TIMEOUT_MS` from when its
   * seat had the link open: one per seat on the host, which plays them all,
   * and the host's alone on a guest, which plays only if its host does.
   */
  const helloTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const stopHelloTimer = (peerId: string) => {
    clearTimeout(helloTimers.get(peerId));
    helloTimers.delete(peerId);
  };
  const stopHelloTimers = () => {
    for (const timer of helloTimers.values()) clearTimeout(timer);
    helloTimers.clear();
  };

  const seatOf = (peerId: string): SeatView | undefined => online().seats.find((seat) => seat.peerId === peerId);
  /** The port the room seats `peerId` at; null for a peer it does not seat. */
  const portOf = (peerId: string): number | null => seatOf(peerId)?.port ?? null;
  const setBuild = (peerId: string, build: SeatView["build"]) =>
    online().patch({ seats: online().seats.map((seat) => (seat.peerId === peerId ? { ...seat, build } : seat)) });

  /**
   * Whether the lobby can go on: the channel open, and the builds that decide
   * it said. The host plays every seat, so every one, and at least one; a
   * guest plays only if its host does, so the host's.
   */
  const ready = (): boolean => {
    if (!linkOpen) return false;
    const { seats } = online();
    if (session.role === "host") return seats.length > 0 && seats.every((seat) => seat.build === "ok");
    return seats.some((seat) => seat.port === HOST_PORT && seat.build === "ok");
  };

  /**
   * The lobby's status once a seat has changed: `connected` when `ready`,
   * `linking` while a seat is still to say, `waiting` with nobody seated. A
   * start out is the match's, and an error stays.
   */
  const settle = () => {
    const { status, config, errorReason, seats } = online();
    if (errorReason !== null || config !== null) return;
    if (status !== "waiting" && status !== "linking" && status !== "connected") return;
    online().patch({ status: ready() ? "connected" : seats.length > 0 ? "linking" : "waiting" });
  };

  /**
   * The notice once something new happens in the room: none, unless the host
   * still seats a player it refused, whose seat holds its Start; the notice
   * says why.
   */
  const freshNotice = (): string | null =>
    session.role === "host" && online().seats.some((seat) => seat.build === "mismatch") ? online().notice : null;

  // An error outranks a notice: the screens have one thing to say.
  const fail = (reason: OnlineErrorReason) => {
    stopHelloTimers();
    online().patch({ status: "error", errorReason: reason, error: roomErrorMessage(reason, session.roomCode), notice: null });
  };

  /** Said for good, a start not yet played withdrawn, and the room left. */
  const leaveWith = (reason: RefuseReason | "link-failed" | "host-left") => {
    fail(reason);
    online().patch({ config: null });
    // Once this delivery is over, not in the middle of it (session.ts, `leaveSoon`).
    queueMicrotask(() => session.close());
  };

  /**
   * This side cannot play the room's build: a guest whose host runs another
   * (or turned this one away), or a host whose start a guest refused. The two
   * would not be playing the same game, so nothing starts. Said for good, like
   * any room error, and like the session's own (`failWith`) the room is left,
   * so the code cannot pair a newcomer with this screen. A start not yet
   * played is withdrawn.
   *
   * The player reads one sentence whatever differs; `why` is what a developer
   * reads in the console (`describeMismatch`).
   */
  const refuseBuild = (why: string) => {
    console.warn("David-Smash: not playing the other player's build:", why);
    leaveWith("engine-mismatch");
  };

  /**
   * The host turns one guest away and keeps its room (Plan 7, Phase B): that
   * guest runs another build (`why` says which part), or never said which. The
   * guest is told in a refusal only it hears, and leaves on it; until it has,
   * its seat holds the Start, and the notice says why. The console says `why`,
   * as `refuseBuild` does.
   */
  const refuseSeat = (seat: SeatView, why: string) => {
    console.warn("David-Smash: not playing the other player's build:", why);
    stopHelloTimer(seat.peerId);
    setBuild(seat.peerId, "mismatch");
    online().patch({ notice: seatMismatchNotice(seat.port) });
    settle();
    session.sendLobby({ kind: "refuse", reason: "engine-mismatch" }, seat.peerId);
  };

  /**
   * A start from this very build that this side cannot read. It is not
   * another version, so it is not said to be (the stamps agree); but nothing
   * can be played from it, and the host has sent it and waits, so it ends the
   * room as a refused build does. An honest host never sends one (`sendLobby`
   * reads a start as the guest will before it goes), so this is a corrupted
   * or tampered message, or a bug.
   */
  const refuseUnreadableStart = (why: string) => {
    // Neutral about the seat: the guest cannot read the start it was sent, the host
    // is told that it could not, and each says which in `why`.
    console.warn("David-Smash: a start from this build could not be read:", why);
    leaveWith("unreadable-start");
  };

  /** This build's hello: to everyone, or with `to`, to that newcomer alone. */
  const sayHello = (to?: string) => {
    const hello = { kind: "hello", ...localBuild() } as const;
    return to === undefined ? session.sendLobby(hello) : session.sendLobby(hello, to);
  };

  /**
   * The channel is open: say which build this is, on the first opening and on
   * every reconnect. Nothing starts until the hellos that decide it match; the
   * connecting status covers the wait, and a seat that never says is refused
   * once `HELLO_TIMEOUT_MS` runs out.
   */
  const channelOpened = () => {
    // Once a start is out the channel is the match's, and the builds were
    // settled before it: nothing to say, and nothing to wait for.
    if (online().config !== null) return;
    // First, ahead of anything a screen repeats on connecting.
    sayHello();
    // The send can find the room gone, which the session has just reported.
    if (online().errorReason !== null) return;
    online().patch({ status: ready() ? "connected" : "linking", notice: freshNotice() });
    for (const seat of online().seats) if (seat.build === "pending") startHelloTimer(seat);
  };

  /** The wait for this seat's hello, from now, if this side waits on it; one already running keeps its start. */
  const startHelloTimer = (seat: SeatView) => {
    const { peerId } = seat;
    if (helloTimers.has(peerId) || (session.role !== "host" && seat.port !== HOST_PORT)) return;
    const timer = setTimeout(() => {
      helloTimers.delete(peerId);
      // A start out since the channel opened is the match's to end, not this wait's.
      if (online().errorReason !== null || online().config !== null) return;
      const now = seatOf(peerId);
      if (now === undefined || now.build !== "pending") return;
      const why = `it sent no hello within ${HELLO_TIMEOUT_MS} ms (a build from before the handshake sends none)`;
      const relayed = online().route === "relay";
      if (session.role !== "host") {
        if (relayed && !heardFrom.has(peerId)) leaveWith("link-failed");
        else refuseBuild(why);
      } else if (relayed && !online().seats.some((other) => heardFrom.has(other.peerId))) {
        // Nobody at all has said a word through the room: it is the link that failed, not this
        // seat. With others heard, the relay works, and the silence is this player's alone.
        leaveWith("link-failed");
      } else {
        refuseSeat(now, why);
      }
    }, HELLO_TIMEOUT_MS);
    helloTimers.set(peerId, timer);
  };

  /** A seat's hello: the build it runs. One from a peer the room does not seat says nothing about the room. */
  const heardHello = (theirs: BuildStamp, from: string) => {
    const seat = seatOf(from);
    // A seat the host refused stays refused until it leaves.
    if (seat === undefined || seat.build === "mismatch") return;
    const why = buildMismatch(theirs);
    if (why === null) {
      setBuild(from, "ok");
      stopHelloTimer(from);
      if (online().status === "linking" && ready()) online().patch({ status: "connected", notice: null });
      return;
    }
    if (session.role === "host") {
      refuseSeat(seat, describeMismatch(why, theirs));
    } else if (seat.port !== HOST_PORT) {
      // Another guest on another build: the host turns it away, and this side plays on.
      setBuild(from, "mismatch");
    } else {
      // Said again on the way out, in case this side's channel had not opened
      // to say it yet: the host then refuses too, rather than only seeing this
      // one leave.
      sayHello();
      refuseBuild(describeMismatch(why, theirs));
    }
  };

  /**
   * The lobby talk. The hello settles the lobby; the start's own stamp is the
   * backstop, for a host that got past it (one from before the handshake).
   */
  const onLobby = (message: ReceivedLobbyMessage, from: string) => {
    switch (message.kind) {
      case "hello":
        heardHello(message, from);
        return;
      case "refuse": {
        const start = online().config;
        if (session.role === "host") {
          // The guest could not play the start this host sent. Only a reply to a
          // start still out to the player in the seat counts: with none out, or
          // with the one out withdrawn by its guest leaving, it is a wrong-time
          // packet and ends nothing.
          if (start !== null && start !== withdrawnStart) {
            if (message.reason === "unreadable-start") refuseUnreadableStart("the other player could not read the start this build sent (its own console says why)");
            else refuseBuild("it refused this build's start (its own console says why)");
          }
        } else if (start === null && portOf(from) === HOST_PORT) {
          // The host turned this build away in the lobby (`refuseSeat`): another guest's word, or
          // one after a start came in, ends nothing.
          refuseBuild("the host refused this build (its own console says why)");
        }
        return;
      }
      case "start":
      case "unreadable-start": {
        // Only the guest follows a start; the host built it. Its build first:
        // another build's start would desync on the first hit, or not load at
        // all, so the host is told why, and this side refuses as for a hello.
        if (session.role !== "guest") return;
        const build = message.kind === "start" ? message.config : message.build;
        const why = buildMismatch(build);
        if (why !== null) {
          session.sendLobby({ kind: "refuse", reason: "engine-mismatch" });
          refuseBuild(describeMismatch(why, build));
        } else if (message.kind === "start") {
          online().patch({ config: message.config });
        } else {
          // This very build's stamp on a start it cannot read. Dropped, the
          // guest would sit connected with no match, for good, while the host
          // plays on alone: the host is told, and the room is left.
          session.sendLobby({ kind: "refuse", reason: "unreadable-start" });
          refuseUnreadableStart("a start with this build's stamp that this build's parser cannot read");
        }
        return;
      }
      default:
        applyLobby(message, portOf(from), session);
    }
  };

  /**
   * The room seats `peer`: a newcomer, or the same player back from a reload,
   * who says its build afresh before anything can start. A seat at the same
   * port is theirs now (mid-match, the one before kept it through its leave).
   */
  const seatArrived = (peer: PeerInfo) => {
    const seat: SeatView = { peerId: peer.id, port: peer.port, build: "pending" };
    const replaced = online().seats.filter((other) => other.peerId === peer.id || other.port === peer.port);
    for (const other of replaced) {
      stopHelloTimer(other.peerId);
      heardFrom.delete(other.peerId);
    }
    const seats = [...online().seats.filter((other) => !replaced.includes(other)), seat].sort((a, b) => a.port - b.port);
    online().patch({ seats });
    // Mid-match the channel is the match's: nothing to say, and nothing to wait for.
    if (online().config !== null) return;
    // Somebody took a seat: that the last player left is no longer news.
    online().patch({ notice: freshNotice() });
    settle();
    if (!linkOpen) return;
    // An open link brings the newcomer no `link: open` of its own (relayed, the link is the
    // room's, and stays open), so nothing else would say this build to them: said to them
    // alone, as the others have heard it.
    sayHello(peer.id);
    if (online().errorReason !== null) return;
    // Relayed, the link opened before this seating reached here (`Route`), so the wait starts
    // now. Direct, an open link at this point is the last peer's, and the newcomer's own
    // opening starts the wait.
    if (online().route === "relay") startHelloTimer(seat);
  };

  /**
   * The room says `peer` left. Mid-match the link monitor decides, and the
   * seats stay as the match has them; in the lobby the seat empties, and a
   * guest whose host left has no room any more.
   */
  const seatLeft = (peer: PeerInfo) => {
    if (online().config !== null) {
      // The start went to (or came from) the player who left; the session withdraws it too.
      // A direct link outlives the host's room socket (D54): no host-left here.
      withdrawnStart = online().config;
      return;
    }
    if (session.role === "guest" && peer.port === HOST_PORT) {
      leaveWith("host-left");
      return;
    }
    seatEmptied(peer.id, peer.port);
  };

  /**
   * A seat emptied in the lobby: whoever takes it next starts from an empty
   * panel (a pick the last player left behind must not light up Ready before
   * they choose), and a start not yet played is withdrawn. Not an error: the
   * room offers to whoever joins next, so the same code pairs again. A player
   * the host refused leaves that notice standing: it says why they went.
   */
  const seatEmptied = (peerId: string, port: number) => {
    stopHelloTimer(peerId);
    heardFrom.delete(peerId);
    const refused = seatOf(peerId)?.build === "mismatch";
    match().setFighter(port, null);
    match().setCostume(port, port);
    const seats = online().seats.filter((seat) => seat.peerId !== peerId);
    online().patch({ seats, config: null, remoteAway: false });
    const notice = refused ? seatMismatchNotice(port) : (freshNotice() ?? seatLeftNotice(port));
    // Only the guest ever holds a `hostStage`, from port 0; the host that sent it is gone.
    online().patch(port === HOST_PORT ? { notice, hostStage: null } : { notice });
    settle();
  };

  /**
   * The channel went with a start out: as far as the lobby goes, every seat
   * is empty, and whoever the room still seats says its build again. Their
   * panels clear and the start is withdrawn, as for a leave.
   */
  const channelLost = () => {
    stopHelloTimers();
    const { seats } = online();
    for (const seat of seats) {
      match().setFighter(seat.port, null);
      match().setCostume(seat.port, seat.port);
    }
    const last = seats.at(-1);
    online().patch({
      status: "waiting",
      config: null,
      seats: seats.map((seat) => ({ ...seat, build: "pending" })),
      notice: last === undefined ? online().notice : seatLeftNotice(last.port),
      remoteAway: false,
      hostStage: null,
    });
  };

  // The emitter calls every listener it had when an emit began, so a leave
  // made by an earlier listener in the same pass would not stop this one.
  let live = true;
  const off = session.on((event) => {
    if (!live) return;
    // The session's own verdict always lands; it knows best why it cannot go on.
    if (event.type === "error") {
      fail(event.reason);
      return;
    }
    // Once something has gone wrong, nothing else the session reports changes
    // the screens — not a late open, not a peer arriving, not a stray start —
    // until the player leaves. A match must never start over an error.
    if (online().errorReason !== null) return;
    switch (event.type) {
      case "joined":
        match().configureOnline();
        online().patch({ role: event.role, status: "waiting", notice: null, localPort: session.seatPort });
        break;
      case "peer":
        if (event.present) seatArrived(event.peer);
        else seatLeft(event.peer);
        break;
      case "route":
        online().patch({ route: event.route });
        break;
      case "link":
        linkOpen = event.status === "open";
        // The waits for a hello run only while the channel is open.
        if (!linkOpen) stopHelloTimers();
        if (event.status === "open") {
          heardFrom.clear();
          // Direct unless the session has said the match moved to the room, which it says first.
          if (online().route === null) online().patch({ route: "direct" });
          channelOpened();
        } else if (event.status === "negotiating" && (online().status === "waiting" || online().status === "connected")) {
          // A fresh connection to whoever the room seats: a newcomer, or the
          // same player again after the channel was lost (session.ts). From
          // connected, it is a guest whose channel the host replaced: nobody
          // left, so the panels and the host's stage stay, but the next open
          // is a way into connected, and the pick is repeated.
          online().patch({ status: "linking", notice: freshNotice() });
        } else if (event.status === "failed") {
          fail("link-failed");
        } else if (event.status === "waiting" && online().status === "connected") {
          // Only the channel was lost, with the others still in the room, and
          // the session is getting it back: nobody left. The panels stay, and
          // starting waits for `connected`. With a start out, the seats are
          // empty as far as the lobby goes.
          if (online().config === null && online().seats.length > 0) online().patch({ status: "linking" });
          else channelLost();
        }
        break;
      case "lobby":
        heardFrom.add(event.from);
        onLobby(event.message, event.from);
        break;
    }
  });
  const release = () => {
    live = false;
    stopHelloTimers();
    off();
    if (unbind === release) unbind = null;
  };
  unbind = release;
  return release;
}

/** The lobby talk that only fills in the screens. `port` is the sender's seat: null for a peer the room does not seat. */
function applyLobby(
  message: Extract<LobbyMessage, { kind: "pick" | "stage" | "away" }>,
  port: number | null,
  session: OnlineSessionLike,
): void {
  const match = useMatchConfig.getState();
  switch (message.kind) {
    case "pick": {
      // Each pick fills its sender's own panel; a peer with no seat has none.
      if (port === null) return;
      match.setFighter(port, message.fighterId);
      match.setCostume(port, message.costume);
      // Plan 5: their Stick Jump, which their pick leaves out when it is on (P5-R25).
      // Theirs, so never kept on this machine (P5-R26).
      match.setPeerStickJump(port, message.stickJump ?? true);
      return;
    }
    case "stage": {
      // Only the host picks the stage, as only the host builds the start: a
      // guest takes it from the host's seat alone.
      if (session.role !== "guest" || port !== HOST_PORT) return;
      match.setStage(message.stageId);
      match.setStageForm(message.form);
      // The rules are only shown: the match is built from the start's.
      const { stageId, form, rules } = message;
      useOnlineStore.getState().patch({ hostStage: rules ? { stageId, form, rules } : { stageId, form } });
      return;
    }
    case "away":
      useOnlineStore.getState().patch({ remoteAway: message.away });
      return;
  }
}

/** True when the message went to the room; false with no session, or one that refused it (see `OnlineSessionLike.sendLobby`). */
export function sendLobby(message: LobbyMessage): boolean {
  return getActiveSession()?.sendLobby(message) ?? false;
}

/**
 * This side's own panel, as the match config now holds it, for the other
 * side's. Every pick goes out through here — a choice, a clear, a repeat for
 * a newcomer — so none of them can say it differently.
 */
export function sendOwnPick(port: number): boolean {
  const own = useMatchConfig.getState().players[port];
  const pick = { kind: "pick", fighterId: own?.fighterId ?? null, costume: own?.costume ?? port } as const;
  // Plan 5: this side's Stick Jump, said only when it is off (P5-R25): absent is on.
  return sendLobby(own?.stickJump === false ? { ...pick, stickJump: false } : pick);
}

/**
 * This machine's own Stick Jump, changed on `/controls` during an online session
 * (Plan 5, Task 20 fix round 1, ruling R-T20a). Only this machine's port is its to
 * change (`session.seatPort`): the other port is the other peer's, set by their
 * pick. The change is kept for after the session (`localOptions`) and said again in
 * this machine's pick, so the host's next start carries it. A match under way plays
 * its start's `controls` and never changes. False, changing nothing, with no session
 * or one the room has not seated.
 */
export function setOwnStickJump(on: boolean): boolean {
  const port = getActiveSession()?.seatPort ?? null;
  if (port === null) return false;
  useMatchConfig.getState().setLocalStickJump(port, on);
  sendOwnPick(port);
  return true;
}

/**
 * This machine's own pad settings, changed on `/controls` during an online
 * session (Plan 5, Task 21; ruling R-T20a, as `setOwnStickJump`): only this
 * machine's port is its to change, and the change is kept for after the
 * session (`localOptions`). Nothing is said: the pad is read on this machine,
 * and only the packed frame crosses the wire. False, changing nothing, with no
 * session or one the room has not seated.
 */
export function setOwnPad(pad: PadSettings): boolean {
  const port = getActiveSession()?.seatPort ?? null;
  if (port === null) return false;
  useMatchConfig.getState().setLocalPad(port, pad);
  return true;
}

/** The host's stage as the match config now holds it, with the rules the host will start, for the guest to see. */
export function sendHostStage(): boolean {
  const { stageId, stageForm, rules } = useMatchConfig.getState();
  return sendLobby({ kind: "stage", stageId, form: stageForm, rules });
}

/**
 * Close the room, forget the online state, and — if the match config was
 * seated for one — seat the offline default again. A local setup is left
 * alone: arriving at /online leaves first, before any room exists.
 */
export function leaveOnline(): void {
  unbind?.();
  setActiveSession(null);
  useOnlineStore.getState().reset();
  const match = useMatchConfig.getState();
  if (match.online) match.leaveOnline();
}
