/**
 * Bytes off a data channel, in whatever shape the browser handed them over.
 *
 * Shared by both WebRTC adapters. It lives here rather than in either one so
 * the Durable Object adapter never imports webrtc.ts, which would pull
 * Trystero into its bundle. A view, not a copy: the transport port gives the
 * buffer to the callback.
 */
export function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
