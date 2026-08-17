/**
 * Live streaming — declared, and deliberately not implemented.
 *
 * This port has no adapter. That is the honest way to record a scope decision:
 * live ingest is a genuinely separate system, not a variation on upload. A
 * WebRTC/WHIP ingest needs ICE, DTLS-SRTP and RTP depayloading server-side
 * before a single byte reaches storage, and a low-latency HLS output needs
 * partial segments, blocking playlist reloads and preload hints on top of the
 * VOD packager. Either half is comparable in size to three of this project's
 * VOD slices.
 *
 * The interface is written out anyway, at the size it would really need to be,
 * because a port with no adapter is a claim about feasibility and an empty
 * file would be an unbacked one. Everything here is expressible in terms the
 * VOD pipeline already has — the same `BlobStore`, the same fMP4 segments, the
 * same player — which is the actual finding: live would reuse the storage and
 * playback halves, and only the ingest half is new.
 *
 * `LIVE_INGEST_ENABLED` gates the UI. With no adapter registered it is off,
 * and the broadcast affordances do not render.
 */

export type StreamState = "idle" | "connecting" | "live" | "ended" | "errored";

export interface StreamKey {
  readonly channelId: string;
  /** Secret. Presented by the broadcaster to authorise the ingest session. */
  readonly key: string;
}

export interface IngestSession {
  readonly id: string;
  readonly channelId: string;
  readonly state: StreamState;
  readonly startedAt: Date | null;
  /** Present once the first segment is packaged. */
  readonly playbackUrl: string | null;
  readonly viewerCount: number;
}

export interface LiveIngest {
  /** Mint or rotate a channel's stream key. */
  issueKey(channelId: string): Promise<StreamKey>;

  /**
   * Begin a session. The adapter is responsible for negotiating with the
   * broadcaster by whatever transport it implements, and for writing fMP4
   * segments into the blob store under a live playlist that the existing
   * player can already read.
   */
  open(key: StreamKey): Promise<IngestSession>;

  close(sessionId: string): Promise<void>;

  current(channelId: string): Promise<IngestSession | null>;
}

/**
 * There is no `liveIngest()` factory, and its absence is the point: a caller
 * cannot obtain an adapter, so nothing can be written against this port by
 * accident and later discovered to be dead code. When live is built, the
 * factory arrives with the adapter.
 */
export const LIVE_INGEST_IMPLEMENTED = false as const;
