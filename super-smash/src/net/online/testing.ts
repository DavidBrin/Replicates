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

import type { DoSignalTransport } from "../adapters/doSignal";
import { ROLE_PORT, type Role } from "../signalProtocol";
import { createEmitter } from "../transport";
import type { LobbyMessage } from "./lobby";
import type { OnlineSessionLike, SessionEvent } from "./session";

export interface FakeSession {
  readonly session: OnlineSessionLike & {
    readonly sendLobby: Mock<(message: LobbyMessage) => boolean>;
    readonly close: Mock<() => void>;
  };
  /** The lobby messages that went out, in order. A refused send is not here (see `sendLobby.mock.calls`). */
  readonly sent: LobbyMessage[];
  /**
   * What `sendLobby` answers while the session is open; true by default. Set
   * it false to play a session that refuses (its room gone, or a bad start).
   */
  accepts: boolean;
  /** Deliver a session event to its listeners. A `joined` sets the role first, as the real session's transport does. */
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
    session: {
      roomCode: "ABCD",
      get role() {
        return current;
      },
      get localPort() {
        return current === null ? null : ROLE_PORT[current];
      },
      turn: false,
      transport: {} as unknown as DoSignalTransport,
      on: (cb) => events.add(cb),
      sendLobby: vi.fn((message: LobbyMessage) => {
        if (closed || !fake.accepts) return false;
        fake.sent.push(message);
        return true;
      }),
      close: vi.fn(() => {
        closed = true;
      }),
    },
    emit(event) {
      if (event.type === "joined") current = event.role;
      events.emit(event);
    },
  };
  return fake;
}
