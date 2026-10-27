/**
 * A room socket with nothing behind it, for tests of whatever sits on top of
 * the signalling client (the DO-signalled transport, the online session).
 *
 * It records every send and delivers whatever a test hands it, closed or not.
 * Unlike the real client it never goes quiet by itself, so a test can see
 * whether its subject stopped listening rather than lean on the client to stop
 * talking.
 */

import type { SignallingClient, SignallingEvent } from "../signalling";
import type { ClientMessage } from "../signalProtocol";
import { createEmitter, type Unsubscribe } from "../transport";

export class FakeSignalling implements SignallingClient {
  readonly url = "ws://test/ws/room/ABCD?intent=create";
  readonly sent: ClientMessage[] = [];
  closed = false;
  private readonly events = createEmitter<[SignallingEvent]>();

  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  on(cb: (event: SignallingEvent) => void): Unsubscribe {
    return this.events.add(cb);
  }
  close(): void {
    this.closed = true;
  }
  /** As though the room sent it. */
  deliver(event: SignallingEvent): void {
    this.events.emit(event);
  }
}
