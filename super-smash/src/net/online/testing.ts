/**
 * A stand-in online session for tests: no socket, no WebRTC, no timers.
 *
 * Shared so every test that needs a session (the online store, the lobby, the
 * select screens, the play page) drives the same fake through the same
 * `OnlineSessionLike` contract, rather than each writing its own and drifting
 * from it — `sendLobby` answering a boolean is the kind of change that would
 * otherwise have to be made in five places.
 */

import { vi, type Mock } from "vitest";

import type { DoSignalTransport, Route } from "../adapters/doSignal";
import { ROLE_PORT, type PeerInfo, type Role } from "../signalProtocol";
import { createEmitter } from "../transport";
import type { LobbyMessage } from "./lobby";
import type { OnlineSessionLike, SessionEvent } from "./session";

/** The host's seat in a room of two, as the room describes it. */
export const HOST_PEER: PeerInfo = { id: "h1", role: "host", port: 0 };

/** The guest's seat in a room of two. */
export const GUEST_PEER: PeerInfo = { id: "g1", role: "guest", port: 1 };

/** The other seat in a room of two, for the side seated as `role`: whom its `peer` and `lobby` events name. */
export function otherPeer(role: Role): PeerInfo {
  return role === "host" ? GUEST_PEER : HOST_PEER;
}

export interface FakeSession {
  readonly session: OnlineSessionLike & {
    readonly sendLobby: Mock<(message: LobbyMessage, to?: string) => boolean>;
    readonly lockRoster: Mock<(ids: readonly string[]) => void>;
    readonly close: Mock<() => void>;
  };
  /**
   * The lobby messages that went out, in order. A refused send is not here,
   * and neither is the address (see `sendLobby.mock.calls`).
   */
  readonly sent: LobbyMessage[];
  /**
   * What `session.seatPort` answers. Undefined (the default) follows the role,
   * as a room of two seats it: the host at port 0 and the guest at port 1.
   */
  seatPort: number | null | undefined;
  /** What `session.peers` answers. A `peer` event seats or unseats its peer here, as the real session does. */
  readonly peers: Map<string, PeerInfo>;
  /**
   * What `sendLobby` answers while the session is open; true by default. Set
   * it false to play a session that refuses (its room gone, or a bad start).
   */
  accepts: boolean;
  /** What `session.route` answers; `"direct"` unless a test sets it. */
  route: Route;
  /**
   * Deliver a session event to its listeners. A `joined` sets the role first,
   * as the real session's transport does, and a `peer` updates `peers`.
   */
  emit(event: SessionEvent): void;
}

/**
 * `role` is the role the session already holds; leave it null for one that
 * has not heard from the room yet. `close()` refuses later sends, as the real
 * one does, but does not silence the listeners: a test can then prove that the
 * code under test unsubscribes by itself.
 */
export function fakeSession(role: Role | null = null): FakeSession {
  const events = createEmitter<[SessionEvent]>();
  let current = role;
  let closed = false;

  const fake: FakeSession = {
    sent: [],
    accepts: true,
    route: "direct",
    seatPort: undefined,
    peers: new Map(),
    session: {
      roomCode: "ABCD",
      get role() {
        return current;
      },
      get seatPort() {
        if (fake.seatPort !== undefined) return fake.seatPort;
        return current === null ? null : ROLE_PORT[current];
      },
      get peers() {
        return fake.peers;
      },
      turn: false,
      transport: {} as unknown as DoSignalTransport,
      get route() {
        return fake.route;
      },
      on: (cb) => events.add(cb),
      sendLobby: vi.fn<(message: LobbyMessage, to?: string) => boolean>((message) => {
        if (closed || !fake.accepts) return false;
        fake.sent.push(message);
        return true;
      }),
      lockRoster: vi.fn<(ids: readonly string[]) => void>(),
      close: vi.fn(() => {
        closed = true;
      }),
    },
    emit(event) {
      if (event.type === "joined") current = event.role;
      if (event.type === "peer") {
        if (event.present) fake.peers.set(event.peer.id, event.peer);
        else fake.peers.delete(event.peer.id);
      }
      events.emit(event);
    },
  };
  return fake;
}
