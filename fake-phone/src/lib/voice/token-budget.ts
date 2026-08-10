/**
 * What a call has spent, and what its turns in flight are about to spend.
 *
 * The honest caveat first, in the same terms as `rate-limit.ts`:
 *
 *   **This ledger lives in one serverless instance's memory.** It is empty after
 *   a cold start and is not shared between concurrent instances, so a call whose
 *   turns land on N instances can spend up to N times its token budget. It is a
 *   real cap against the ordinary case — one browser talking to one warm
 *   instance — and it is best-effort against anything else. Exact token
 *   accounting needs shared storage (Vercel KV / Redis); that is a swap of this
 *   module's implementation and nothing else, because the routes only ever touch
 *   it through the four methods below.
 *
 * The *duration* cap does not have this weakness: it is carried in the signed
 * session token (`session-token.ts`) and is therefore exact on every instance.
 * That is the guarantee to lean on. This module bounds cost within an instance;
 * the clock is what bounds it everywhere.
 *
 * ### Reserve, then spend
 *
 * A turn takes its allowance *before* calling the model and reconciles to the
 * real figure afterwards. The obvious order — read the total, call the model,
 * then add what it cost — is wrong even in a single-threaded runtime, because
 * the model call is an `await`: three overlapping turns all resume the read
 * before any of them reaches the write, all see the same total, and all get a
 * full allowance. An 800-token call then spends 1,200. Reserving first closes
 * that window, because a reservation is a synchronous read-modify-write with no
 * `await` inside it — and in this runtime, that is atomic.
 *
 * A reservation is therefore a *worst case*, not a charge: it is swapped for the
 * turn's actual usage when the turn completes, and handed back untouched when
 * the turn fails.
 */

export interface TurnReservation {
  /** Unique per turn, so releasing twice cannot refund a budget twice. */
  readonly id: string;
  readonly sessionId: string;
  /** The most this turn is allowed to spend. */
  readonly tokens: number;
}

export interface ReserveInput {
  readonly sessionId: string;
  /** From the signed token: when this session's accounting may be dropped. */
  readonly expiresAt: number;
  /** The allowance this turn wants. Granted whole or not at all. */
  readonly tokens: number;
  /** The whole call's output-token budget. */
  readonly budget: number;
}

export interface VoiceTokenBudget {
  /** Settled usage plus everything currently reserved. The figure caps are read against. */
  spent(sessionId: string): number;
  /** `null` when the budget cannot cover the allowance — the caller must not run the turn. */
  reserve(input: ReserveInput): TurnReservation | null;
  /** The turn finished: swap its reservation for what it actually cost. */
  settle(reservation: TurnReservation, actualTokens: number): void;
  /** The turn never produced a line: give the allowance back. */
  release(reservation: TurnReservation): void;
  /** Drops all state. Exists for tests; harmless in production. */
  reset(): void;
}

export interface VoiceTokenBudgetOptions {
  /** Injected in tests so a session can be aged without waiting. */
  readonly now?: () => number;
  /** Injected in tests. Defaults to a v4 UUID. */
  readonly newId?: () => string;
}

interface Entry {
  /** Tokens this instance has watched the session actually spend. */
  used: number;
  /** Outstanding reservations by id, so each can be settled or released exactly once. */
  readonly reserved: Map<string, number>;
  reservedTotal: number;
  /** Mirrors the token's expiry: past this the session cannot spend again anyway. */
  readonly expiresAt: number;
}

/** Bounds memory if many sessions are seen between sweeps. */
const MAX_TRACKED_SESSIONS = 5000;

export function createVoiceTokenBudget(
  options: VoiceTokenBudgetOptions = {},
): VoiceTokenBudget {
  const now = options.now ?? ((): number => Date.now());
  const newId = options.newId ?? ((): string => crypto.randomUUID());
  const sessions = new Map<string, Entry>();

  function live(sessionId: string, at: number): Entry | null {
    const entry = sessions.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt <= at) {
      sessions.delete(sessionId);
      return null;
    }
    return entry;
  }

  return {
    spent(sessionId: string): number {
      const entry = live(sessionId, now());
      return entry ? entry.used + entry.reservedTotal : 0;
    },

    reserve(input: ReserveInput): TurnReservation | null {
      const at = now();
      const wanted = Math.floor(input.tokens);
      if (!Number.isFinite(wanted) || wanted <= 0) return null;
      if (input.expiresAt <= at) return null;

      let entry = live(input.sessionId, at);
      if (!entry) {
        if (sessions.size >= MAX_TRACKED_SESSIONS) sweep(sessions, at);
        entry = { used: 0, reserved: new Map(), reservedTotal: 0, expiresAt: input.expiresAt };
        sessions.set(input.sessionId, entry);
      }

      // Whole or nothing. Half an allowance buys a line that stops mid-sentence,
      // and a call that ends in persona is worth more than a call that ends in a
      // truncated word — the same reasoning as the wrap-up margins.
      if (entry.used + entry.reservedTotal + wanted > input.budget) return null;

      const reservation: TurnReservation = {
        id: newId(),
        sessionId: input.sessionId,
        tokens: wanted,
      };
      entry.reserved.set(reservation.id, wanted);
      entry.reservedTotal += wanted;
      return reservation;
    },

    settle(reservation: TurnReservation, actualTokens: number): void {
      const entry = drop(sessions, reservation);
      if (!entry) return;
      // The actual figure, even if it overshot the reservation: the point is to
      // record what was spent, and a nonsense figure must never buy budget back.
      if (Number.isFinite(actualTokens) && actualTokens > 0) {
        entry.used += Math.round(actualTokens);
      }
    },

    release(reservation: TurnReservation): void {
      drop(sessions, reservation);
    },

    reset(): void {
      sessions.clear();
    },
  };
}

/**
 * Removes a reservation from its session, returning the session it belonged to.
 *
 * `null` for a reservation that is already gone — settled, released, or swept
 * with its session — so a double release cannot refund an allowance twice.
 */
function drop(sessions: Map<string, Entry>, reservation: TurnReservation): Entry | null {
  const entry = sessions.get(reservation.sessionId);
  const held = entry?.reserved.get(reservation.id);
  if (entry === undefined || held === undefined) return null;

  entry.reserved.delete(reservation.id);
  entry.reservedTotal -= held;
  return entry;
}

function sweep(sessions: Map<string, Entry>, at: number): void {
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= at) sessions.delete(id);
  }
  // Still full of live sessions: drop the oldest insertions rather than grow
  // without bound. A dropped ledger loses that call's spend to date, which is
  // the same failure the caveat at the top already admits to.
  if (sessions.size >= MAX_TRACKED_SESSIONS) {
    const excess = sessions.size - Math.floor(MAX_TRACKED_SESSIONS / 2);
    let dropped = 0;
    for (const id of sessions.keys()) {
      if (dropped++ >= excess) break;
      sessions.delete(id);
    }
  }
}

/** The one ledger the routes share. Per-instance; see the note at the top. */
export const voiceTokenBudget = createVoiceTokenBudget();
