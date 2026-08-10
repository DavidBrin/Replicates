/**
 * The server's own record of the voice sessions it has minted.
 *
 * `/api/voice/session` is the only thing that opens a session; `/api/voice/turn`
 * can only read one. That asymmetry is the entire point. Before this existed the
 * turn route took `elapsedSeconds` and `tokensUsed` straight off the wire and
 * never checked `sessionId` against anything, so a caller that posted zeroes and
 * an invented id was never capped and never rate-limited — an unbounded, billable
 * loop through somebody else's key. The caps are only caps if the server is the
 * one counting.
 *
 * **This counter lives in one serverless instance's memory** — the same honest
 * caveat `rate-limit.ts` states, for the same reason and with the same shape:
 * it is lost on a cold start and is not shared between concurrent instances, so
 * a session minted on instance A is simply unknown to instance B and that call
 * ends cleanly instead of running uncapped. Failing *closed* is the right way
 * for a spend guard to fail, which is why this one does and the rate limiter
 * does not. Production wants a shared store (Vercel KV / Redis); that is a swap
 * of this module's implementation and nothing else.
 *
 * Records are handed out as copies. A caller that wants to change a session's
 * usage has to say so through `recordUsage`, so there is exactly one line in the
 * codebase where spend goes up.
 */

/** What the server knows about a call it agreed to run. Never leaves the server. */
export interface VoiceSessionRecord {
  readonly id: string;
  /** Which persona was requested at mint time. Carried for log correlation. */
  readonly personaId: string;
  /** Epoch ms. The only clock the duration cap trusts. */
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** Output tokens this session has actually been observed to spend. */
  readonly tokensUsed: number;
}

export interface OpenSessionInput {
  readonly personaId: string;
  readonly ttlMs: number;
}

export interface VoiceSessionStore {
  open(input: OpenSessionInput): VoiceSessionRecord;
  /** `null` for an id that was never minted here, or has expired. */
  find(id: string): VoiceSessionRecord | null;
  /** Adds to a session's spend. `null` if the session is gone; never throws. */
  recordUsage(id: string, outputTokens: number): VoiceSessionRecord | null;
  /** Drops all state. Exists for tests; harmless in production. */
  reset(): void;
}

export interface VoiceSessionStoreOptions {
  /** Injected in tests so a session can be aged without waiting. */
  readonly now?: () => number;
  /** Injected in tests. Defaults to a v4 UUID — unguessable, so ids are the credential. */
  readonly newId?: () => string;
}

interface Entry {
  readonly id: string;
  readonly personaId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  tokensUsed: number;
}

/** Bounds memory if many sessions are minted between sweeps. */
const MAX_TRACKED_SESSIONS = 5000;

export function createVoiceSessionStore(
  options: VoiceSessionStoreOptions = {},
): VoiceSessionStore {
  const now = options.now ?? ((): number => Date.now());
  const newId = options.newId ?? ((): string => crypto.randomUUID());
  const sessions = new Map<string, Entry>();

  function live(id: string, at: number): Entry | null {
    const entry = sessions.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= at) {
      sessions.delete(id);
      return null;
    }
    return entry;
  }

  return {
    open(input: OpenSessionInput): VoiceSessionRecord {
      const at = now();
      if (sessions.size >= MAX_TRACKED_SESSIONS) sweep(sessions, at);

      const entry: Entry = {
        id: newId(),
        personaId: input.personaId,
        issuedAt: at,
        expiresAt: at + input.ttlMs,
        tokensUsed: 0,
      };
      sessions.set(entry.id, entry);
      return snapshot(entry);
    },

    find(id: string): VoiceSessionRecord | null {
      const entry = live(id, now());
      return entry ? snapshot(entry) : null;
    },

    recordUsage(id: string, outputTokens: number): VoiceSessionRecord | null {
      const entry = live(id, now());
      if (!entry) return null;
      // A negative or nonsense figure must never *buy back* budget.
      if (Number.isFinite(outputTokens) && outputTokens > 0) {
        entry.tokensUsed += Math.round(outputTokens);
      }
      return snapshot(entry);
    },

    reset(): void {
      sessions.clear();
    },
  };
}

function snapshot(entry: Entry): VoiceSessionRecord {
  return {
    id: entry.id,
    personaId: entry.personaId,
    issuedAt: entry.issuedAt,
    expiresAt: entry.expiresAt,
    tokensUsed: entry.tokensUsed,
  };
}

function sweep(sessions: Map<string, Entry>, at: number): void {
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= at) sessions.delete(id);
  }
  // Still full of live sessions: drop the oldest insertions rather than grow
  // without bound. A dropped session ends its call cleanly on the next turn,
  // which is the safe direction for a store that exists to stop spending.
  if (sessions.size >= MAX_TRACKED_SESSIONS) {
    const excess = sessions.size - Math.floor(MAX_TRACKED_SESSIONS / 2);
    let dropped = 0;
    for (const id of sessions.keys()) {
      if (dropped++ >= excess) break;
      sessions.delete(id);
    }
  }
}

/** Wall-clock seconds since the server minted the session. Not the client's view. */
export function elapsedSecondsFor(session: VoiceSessionRecord, at: number): number {
  return Math.max(0, Math.floor((at - session.issuedAt) / 1000));
}

/** The one store the routes share. Per-instance; see the note at the top. */
export const voiceSessions = createVoiceSessionStore();
