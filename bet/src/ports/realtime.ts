/**
 * Realtime port (SPEC §5.4, D10). The Room needs a live tail of new
 * messages; *how* that tail arrives — 4-second polling today, SSE or a
 * hosted provider tomorrow — is an adapter concern, so the interface lives
 * here in `src/ports/**` alongside `DataStore`/`Clock`/`IdGen`/
 * `AuthProvider` and the adapter (`src/adapters/realtime/polling.ts`)
 * implements it.
 *
 * This placement is load-bearing, not cosmetic: `src/components/**` must
 * never import `src/adapters/**` (G1), so the Room component can only be
 * decoupled from polling if the *type* it programs against sits outside the
 * adapter. `src/domain/__tests__/layering.test.ts` enforces that direction.
 * Ports are interfaces and types only — no runtime logic (G1).
 */

export interface RealtimeChannel<TMessage> {
  /** Registers the (single) listener for newly-fetched message batches.
   * Starts delivering immediately if the transport considers the document
   * currently visible. */
  subscribe(onMessages: (messages: TMessage[]) => void): void;
  /** Sends one message, then immediately refreshes (rather than waiting for
   * the transport's next scheduled tick) so the sender sees their own
   * message land without a visible delay. */
  send(msg: { clientId: string; body: string }): Promise<TMessage>;
  /** Stops the transport and detaches every listener — call on unmount. */
  close(): void;
}

/** The two I/O closures a channel needs in order to run: how to fetch the
 * current "latest messages" batch, and how to send one. Both are supplied
 * by the consumer (the Room), which knows which market it is talking about;
 * the adapter only knows how to schedule them. */
export interface RealtimeChannelOptions<TMessage> {
  fetchLatest: () => Promise<TMessage[]>;
  sendMessage: (clientId: string, body: string) => Promise<TMessage>;
}

/**
 * How a `RealtimeChannel` is handed to a UI component: as a factory, not a
 * ready-made instance. A component owns the lifetime of its channel (it
 * must construct one per `marketId` inside an effect and `close()` it on
 * unmount), and it owns the `fetchLatest`/`sendMessage` closures, so what it
 * needs injected is the *choice of transport* — one function, swappable
 * with a fake in a test and with an SSE implementation in production.
 */
export type RealtimeChannelFactory<TMessage> = (
  options: RealtimeChannelOptions<TMessage>,
) => RealtimeChannel<TMessage>;
