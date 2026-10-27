/**
 * A peer connection and data channels with no WebRTC behind them, for tests
 * of whatever sits on the DO-signalled transport (the online session, and the
 * screens a real session drives).
 *
 * Nothing here opens by itself: a test opens the channel, as the browser does
 * once ICE connects, or drops it.
 */

import type { DataChannelLike, PeerConnectionLike } from "../adapters/doSignal";

/** A channel that never opens. */
export const inertChannel = (): DataChannelLike => ({
  readyState: "connecting",
  binaryType: "blob",
  onopen: null,
  onclose: null,
  onerror: null,
  onmessage: null,
  send() {},
  close() {},
});

/** A peer connection that negotiates nothing and never connects. */
export const inertPeer = (): PeerConnectionLike => ({
  connectionState: "new",
  onicecandidate: null,
  onconnectionstatechange: null,
  createDataChannel: inertChannel,
  createOffer: async () => ({ sdp: "o" }),
  createAnswer: async () => ({ sdp: "a" }),
  setLocalDescription: async () => {},
  setRemoteDescription: async () => {},
  addIceCandidate: async () => {},
  close() {},
});

/** A data channel the test opens, as the browser does once ICE connects. */
export class OpenableChannel implements DataChannelLike {
  readyState = "connecting";
  binaryType = "blob";
  onopen: DataChannelLike["onopen"] = null;
  onclose: DataChannelLike["onclose"] = null;
  onerror: DataChannelLike["onerror"] = null;
  onmessage: DataChannelLike["onmessage"] = null;
  readonly sent: Uint8Array[] = [];
  send(data: Uint8Array<ArrayBuffer>): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = "closed";
  }
  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }
  /** The channel gives up before it ever opened. */
  drop(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}
