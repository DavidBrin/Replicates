/**
 * `RealtimeChannel` port + a polling implementation (Task 10's brief: "Put
 * the polling behind a `RealtimeChannel` port ... so SSE or a hosted
 * provider could replace it without touching the component"). The Room
 * (`src/components/room/RoomPanel.tsx`) talks only to the `RealtimeChannel`
 * interface below — it never calls `setInterval` or touches
 * `document.visibilityState` itself.
 *
 * This is an adapter (G1: "src/adapters/ implements ports. May import
 * domain + ports."), not a React hook, so it's plain, framework-free TS —
 * easy to unit test with fake timers and a fake `document`, and easy to
 * swap for an SSE-backed implementation later without any component change.
 */

export interface RealtimeChannel<TMessage> {
  /** Registers the (single) listener for newly-fetched message batches.
   * Starts polling immediately if the document is currently visible. */
  subscribe(onMessages: (messages: TMessage[]) => void): void;
  /** Sends one message, then immediately re-polls (rather than waiting for
   * the next scheduled tick) so the sender sees their own message land
   * without a visible delay. */
  send(msg: { clientId: string; body: string }): Promise<TMessage>;
  /** Stops polling and detaches every listener — call on unmount. */
  close(): void;
}

/** The subset of `Document` this adapter needs, so tests can inject a fake
 * one instead of depending on jsdom's real `document`. */
export type VisibilityHost = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

export interface PollingRealtimeChannelOptions<TMessage> {
  /** Fetches the current "latest messages" batch — the Room passes a
   * closure over `getMessages(marketId, { limit })` (no `before`: this
   * channel is for the live tail, not historical/keyset pagination, which
   * the Room's "load earlier" affordance handles directly via
   * `@/lib/api-client`). */
  fetchLatest: () => Promise<TMessage[]>;
  sendMessage: (clientId: string, body: string) => Promise<TMessage>;
  /** Poll interval while visible. Default 4000ms (SPEC §5.4). */
  intervalMs?: number;
  /** Defaults to the real `document` when available (browser), `undefined`
   * in any environment without one (SSR/tests that don't inject one) — in
   * which case polling is treated as always-visible/always-on, matching
   * `document.visibilityState`'s absence meaning "no tab to hide." */
  document?: VisibilityHost;
}

const DEFAULT_INTERVAL_MS = 4000;

/**
 * Polls `fetchLatest` every `intervalMs` while `document.visibilityState ===
 * "visible"`, pauses entirely while hidden, and resumes (with an immediate
 * poll, not waiting a full interval) the instant the tab becomes visible
 * again. A transient poll failure is swallowed — the Room's background
 * refresh doesn't need a toast for a single missed tick; the next tick
 * retries on its own.
 */
export class PollingRealtimeChannel<TMessage> implements RealtimeChannel<TMessage> {
  private readonly fetchLatest: () => Promise<TMessage[]>;
  private readonly sendMessage: (clientId: string, body: string) => Promise<TMessage>;
  private readonly intervalMs: number;
  private readonly doc: VisibilityHost | undefined;
  private listener: ((messages: TMessage[]) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly onVisibilityChange = (): void => {
    if (this.isVisible()) {
      this.start();
    } else {
      this.stop();
    }
  };

  constructor(options: PollingRealtimeChannelOptions<TMessage>) {
    this.fetchLatest = options.fetchLatest;
    this.sendMessage = options.sendMessage;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.doc = options.document ?? (typeof document !== "undefined" ? document : undefined);
  }

  private isVisible(): boolean {
    return (this.doc?.visibilityState ?? "visible") === "visible";
  }

  subscribe(onMessages: (messages: TMessage[]) => void): void {
    this.listener = onMessages;
    this.doc?.addEventListener("visibilitychange", this.onVisibilityChange);
    if (this.isVisible()) this.start();
  }

  private start(): void {
    if (this.timer) return; // already running
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const messages = await this.fetchLatest();
      this.listener?.(messages);
    } catch {
      // Swallowed — see class doc comment.
    }
  }

  async send(msg: { clientId: string; body: string }): Promise<TMessage> {
    const message = await this.sendMessage(msg.clientId, msg.body);
    void this.poll();
    return message;
  }

  close(): void {
    this.stop();
    this.doc?.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.listener = null;
  }
}
