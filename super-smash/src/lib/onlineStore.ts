/**
 * What the online screens show, and the glue from a session's events to the
 * two stores.
 *
 * The session (src/net/online/session.ts) knows nothing about React; this is
 * where its events become a status line, a filled opponent panel, the host's
 * stage on the guest's screen, and the start config both play pages read.
 */

import { create } from "zustand";

import type { LobbyMessage, OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, setActiveSession, type OnlineSessionLike, type SessionError } from "@/net/online/session";
import type { Role } from "@/net/signalProtocol";
import type { Unsubscribe } from "@/net/transport";
import { useMatchConfig, type StageForm } from "./matchConfig";

/**
 * `connected` means the channel is open and nothing has gone wrong. It is the
 * only status a match may start from, so the select screens gate on it.
 */
export type OnlineStatus = "idle" | "connecting" | "waiting" | "linking" | "connected" | "error";
export type OnlineErrorReason = SessionError | "link-failed" | "peer-left";

export interface OnlineFields {
  status: OnlineStatus;
  roomCode: string | null;
  role: Role | null;
  /**
   * What went wrong, in words, for the screens to show. Only a reset clears
   * it (leaving, or opening another room), and that includes the opponent
   * leaving (status `waiting`), so stage and character select can say why the
   * match can no longer start.
   */
  error: string | null;
  errorReason: OnlineErrorReason | null;
  hostStage: { readonly stageId: string; readonly form: StageForm } | null;
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
    case "peer-left":
      return "The other player left the room.";
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
  const fail = (reason: OnlineErrorReason) =>
    online().patch({ status: "error", errorReason: reason, error: roomErrorMessage(reason, session.roomCode) });

  const off = session.on((event) => {
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
        online().patch({ role: event.role, status: "waiting" });
        break;
      case "peer":
        if (online().status !== "connected") online().patch({ status: event.present ? "linking" : "waiting" });
        break;
      case "link":
        if (event.status === "open") {
          online().patch({ status: "connected" });
        } else if (event.status === "failed") {
          fail("link-failed");
        } else if (event.status === "waiting" && online().status === "connected") {
          online().patch({ status: "waiting", config: null, errorReason: "peer-left", error: roomErrorMessage("peer-left", session.roomCode) });
        }
        break;
      case "lobby":
        applyLobby(event.message, session);
        break;
    }
  });
  const release = () => {
    off();
    if (unbind === release) unbind = null;
  };
  unbind = release;
  return release;
}

function applyLobby(message: LobbyMessage, session: OnlineSessionLike): void {
  const local = session.localPort;
  const match = useMatchConfig.getState();
  switch (message.kind) {
    case "pick": {
      if (local === null) return;
      const remote = local === 0 ? 1 : 0;
      match.setFighter(remote, message.fighterId);
      match.setCostume(remote, message.costume);
      return;
    }
    case "stage":
      match.setStage(message.stageId);
      match.setStageForm(message.form);
      useOnlineStore.getState().patch({ hostStage: { stageId: message.stageId, form: message.form } });
      return;
    case "start":
      // Only the guest follows a start; the host built it.
      if (session.role === "guest") useOnlineStore.getState().patch({ config: message.config });
      return;
    case "away":
      useOnlineStore.getState().patch({ remoteAway: message.away });
      return;
  }
}

/** True when the message went to the room; false with no session, or one that refused it (see `OnlineSessionLike.sendLobby`). */
export function sendLobby(message: LobbyMessage): boolean {
  return getActiveSession()?.sendLobby(message) ?? false;
}

/** Close the room, forget the online state, and seat the offline default again. */
export function leaveOnline(): void {
  unbind?.();
  setActiveSession(null);
  useOnlineStore.getState().reset();
  useMatchConfig.getState().leaveOnline();
}
