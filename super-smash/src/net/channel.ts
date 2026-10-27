/**
 * The unreliable input channel both WebRTC adapters open.
 *
 * Shared so the Trystero adapter and the Durable Object adapter agree on the
 * one thing two peers must agree on out of band: the SCTP stream id of a
 * `negotiated: true` channel. Neither side announces it; both use 42, and the
 * channel is `{ ordered: false, maxRetransmits: 0 }` — see the header of
 * adapters/webrtc.ts for why inputs must not be retransmitted.
 */
export const INPUT_CHANNEL_LABEL = "smash-input";
/** Any id both peers agree on and Trystero does not use (it takes 0). */
export const DEFAULT_UNRELIABLE_CHANNEL_ID = 42;
