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
import type { BuildStamp, LobbyMessage, OnlineMatchConfig, ReceivedLobbyMessage } from "@/net/online/lobby";
import { getActiveSession, setActiveSession, type OnlineSessionLike, type SessionError } from "@/net/online/session";
import type { Role } from "@/net/signalProtocol";
import type { Unsubscribe } from "@/net/transport";
import { useMatchConfig, type StageForm } from "./matchConfig";

/**
 * `connected` means the channel is open, the other side has said it runs this
 * build, and nothing has gone wrong. It is the only status a match may start
 * from, so the select screens gate on it.
 */
export type OnlineStatus = "idle" | "connecting" | "waiting" | "linking" | "connected" | "error";
/** "engine-mismatch": the other player runs another build (Plan 2 Task 27). */
export type OnlineErrorReason = SessionError | "link-failed" | "engine-mismatch";

/** Shown while the seat the opponent left stands empty. */
export const PEER_LEFT_NOTICE = "The other player left the room.";

/** The select screens' status line while a newcomer's direct connection opens. */
export const LINKING_STATUS = "Connecting to the other player…";

/**
 * How long, once the channel is open, the other side has to say which build
 * it runs (`hello`, Plan 2 Task 27). A build from before the handshake never
 * says, and is refused when this runs out. A hello rides the room and takes a
 * round trip at most; until it lands, the screens show the connecting status,
 * so a quick one goes unnoticed.
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
   * Something the player should know that does not end the room: the opponent
   * left (status back to `waiting`). Stage and character select show it. It
   * clears when somebody takes the seat or the channel opens again — a refresh
   * and a rejoin with the same code is the common case.
   */
  notice: string | null;
  /** The stage the host chose, on the guest, with the host's rules when they came along. */
  hostStage: { readonly stageId: string; readonly form: StageForm; readonly rules?: MatchRules } | null;
  /** The host's start config; set on both peers when the match begins. */
  config: OnlineMatchConfig | null;
  remoteAway: boolean;
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
  hostStage: null,
  config: null,
  remoteAway: false,
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
      return "The direct connection could not be opened. Try again; strict networks need the TURN relay.";
    case "engine-mismatch":
      return "The other player is running a different version. Both reload the page.";
    case "bad-message":
    case "too-many-messages":
      return "The room closed the connection.";
  }
}

function pageHostname(): string {
  return typeof location === "undefined" ? "" : location.hostname;
}

let unbind: Unsubscribe | null = null;

/** Mirror one session into the stores. Replaces any earlier binding. */
export function bindSession(session: OnlineSessionLike): Unsubscribe {
  unbind?.();
  const online = useOnlineStore.getState;
  const match = useMatchConfig.getState;

  /**
   * The other side said it runs this build (`hello`). That belongs to whoever
   * the room seats: a newcomer, or the same player back from a reload, says it
   * again before anything can start.
   */
  let peerBuildMatches = false;
  /** Whether the channel is open, as the session last reported. */
  let linkOpen = false;
  /**
   * A start this host sent to a player who has since left the room. It stays
   * in the store (mid-match the channel decides), but nobody in the seat can
   * be refusing it any more.
   */
  let withdrawnStart: OnlineMatchConfig | null = null;
  /** Runs out `HELLO_TIMEOUT_MS` after the channel opens with no matching hello in. */
  let helloTimer: ReturnType<typeof setTimeout> | null = null;
  const stopHelloTimer = () => {
    if (helloTimer !== null) clearTimeout(helloTimer);
    helloTimer = null;
  };

  // An error outranks a notice: the screens have one thing to say.
  const fail = (reason: OnlineErrorReason) => {
    stopHelloTimer();
    online().patch({ status: "error", errorReason: reason, error: roomErrorMessage(reason, session.roomCode), notice: null });
  };

  /**
   * The other player runs another build: the two would not be playing the same
   * game, so nothing starts. Said for good, like any room error, and like the
   * session's own (`failWith`) the room is left, so the code cannot pair a
   * newcomer with this screen. A start not yet played is withdrawn.
   *
   * The player reads one sentence whatever differs; `why` is what a developer
   * reads in the console (`describeMismatch`).
   */
  const refuseBuild = (why: string) => {
    console.warn("David-Smash: not playing the other player's build:", why);
    fail("engine-mismatch");
    online().patch({ config: null });
    // Once this delivery is over, not in the middle of it (session.ts, `leaveSoon`).
    queueMicrotask(() => session.close());
  };

  const sayHello = () => session.sendLobby({ kind: "hello", ...localBuild() });

  /**
   * The channel is open: say which build this is, on the first opening and on
   * every reconnect. Nothing starts until the other side's hello matches; the
   * connecting status covers the wait, and a build that never says is refused
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
    if (peerBuildMatches) {
      online().patch({ status: "connected", notice: null });
      return;
    }
    online().patch({ status: "linking", notice: null });
    helloTimer ??= setTimeout(() => {
      helloTimer = null;
      // A start out since the channel opened is the match's to end, not this wait's.
      if (online().errorReason === null && online().config === null) {
        refuseBuild(`it sent no hello within ${HELLO_TIMEOUT_MS} ms (a build from before the handshake sends none)`);
      }
    }, HELLO_TIMEOUT_MS);
  };

  /** The other side's hello: the build it runs. */
  const heardHello = (theirs: BuildStamp) => {
    const why = buildMismatch(theirs);
    if (why !== null) {
      // Said again on the way out, in case this side's channel had not opened
      // to say it yet: the other side then refuses too, rather than only
      // seeing this one leave.
      sayHello();
      refuseBuild(describeMismatch(why, theirs));
      return;
    }
    peerBuildMatches = true;
    stopHelloTimer();
    if (linkOpen && online().status === "linking") online().patch({ status: "connected", notice: null });
  };

  /**
   * The lobby talk. The hello settles the lobby; the start's own stamp is the
   * backstop, for a host that got past it (one from before the handshake).
   */
  const onLobby = (message: ReceivedLobbyMessage) => {
    switch (message.kind) {
      case "hello":
        heardHello(message);
        return;
      case "refuse": {
        // The guest could not play the start this host sent. Only a reply to a
        // start still out to the player in the seat counts: with none out, or
        // with the one out withdrawn by its guest leaving, it is a wrong-time
        // packet and ends nothing.
        const start = online().config;
        if (session.role === "host" && start !== null && start !== withdrawnStart) {
          refuseBuild("it refused this build's start (its own console says why)");
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
        }
        // An unreadable start from this very build is dropped, as it always was.
        return;
      }
      default:
        applyLobby(message, session);
    }
  };

  /**
   * The other player's seat emptied: whoever takes it next starts from an
   * empty panel (a pick the last opponent left behind must not light up Ready
   * before they choose), and a start not yet played is withdrawn. Not an
   * error: the room offers to whoever joins next, so the same code pairs again.
   */
  const seatEmptied = () => {
    peerBuildMatches = false;
    stopHelloTimer();
    const remote = remotePort(session);
    if (remote !== null) {
      match().setFighter(remote, null);
      match().setCostume(remote, remote);
    }
    // Only the guest ever holds a `hostStage`; the host that sent it is gone.
    online().patch({ status: "waiting", config: null, notice: PEER_LEFT_NOTICE, remoteAway: false, hostStage: null });
  };

  /** Whether the room says the other player is in it, as the session last reported. */
  let peerSeated = false;

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
        online().patch({ role: event.role, status: "waiting", notice: null });
        break;
      case "peer":
        peerSeated = event.present;
        // Somebody arrived or left: whoever sits there next says its build afresh.
        peerBuildMatches = false;
        stopHelloTimer();
        if (event.present) {
          if (online().status === "connected") break;
          // Somebody took the empty seat: that the last opponent left is no longer news.
          online().patch({ status: "linking", notice: null });
        } else if (online().config === null) {
          // They left the room, whatever the channel says, and in the lobby
          // that is news. Mid-match the channel decides (session.ts).
          seatEmptied();
        } else {
          // The start went to the player who left; the session withdraws it too.
          withdrawnStart = online().config;
        }
        break;
      case "link":
        linkOpen = event.status === "open";
        // The wait for a hello runs only while the channel is open.
        if (!linkOpen) stopHelloTimer();
        if (event.status === "open") {
          channelOpened();
        } else if (event.status === "negotiating" && (online().status === "waiting" || online().status === "connected")) {
          // A fresh connection to whoever the room seats: a newcomer, or the
          // same player again after the channel was lost (session.ts). From
          // connected, it is a guest whose channel the host replaced: nobody
          // left, so the panels and the host's stage stay, but the next open
          // is a way into connected, and the pick is repeated.
          online().patch({ status: "linking", notice: null });
        } else if (event.status === "failed") {
          fail("link-failed");
        } else if (event.status === "waiting" && online().status === "connected") {
          // Only the channel was lost, with the other player still in the room,
          // and the session is getting it back: nobody left. The panels stay,
          // and starting waits for `connected`. Otherwise (they are gone, or a
          // start is out) the seat is empty.
          if (peerSeated && online().config === null) online().patch({ status: "linking" });
          else seatEmptied();
        }
        break;
      case "lobby":
        onLobby(event.message);
        break;
    }
  });
  const release = () => {
    live = false;
    stopHelloTimer();
    off();
    if (unbind === release) unbind = null;
  };
  unbind = release;
  return release;
}

/** The opponent's port: the host is 0 and the guest 1 (`ROLE_PORT`). Null before the room has answered. */
function remotePort(session: OnlineSessionLike): number | null {
  const local = session.localPort;
  return local === null ? null : local === 0 ? 1 : 0;
}

/** The lobby talk that only fills in the screens. */
function applyLobby(message: Extract<LobbyMessage, { kind: "pick" | "stage" | "away" }>, session: OnlineSessionLike): void {
  const match = useMatchConfig.getState();
  switch (message.kind) {
    case "pick": {
      const remote = remotePort(session);
      if (remote === null) return;
      match.setFighter(remote, message.fighterId);
      match.setCostume(remote, message.costume);
      return;
    }
    case "stage": {
      // Only the host picks the stage, as only the host builds the start.
      if (session.role !== "guest") return;
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
  return sendLobby({ kind: "pick", fighterId: own?.fighterId ?? null, costume: own?.costume ?? port });
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
