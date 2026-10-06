// Published verbatim from SPEC §4.16 as the cross-slice contract. S4 owns this file.
import type { Action, AttackIntent, GameState, Seat, Standing } from "@/engine/types";

// src/ports/sync.ts — the INTERFACE and its data shapes, owned by S4 (F30).
// The polling ADAPTER is src/net/pollingSync.ts, owned by S5. S4 never imports src/net/**.

export type SyncStatus = "offline" | "idle" | "polling" | "behind" | "desynced";   // (F31)

export interface SyncPort {
  /** One poll. Resolves when the response has been folded in. */
  poll(): Promise<void>;
  /** Submit an already-resolved action; resolves with the authoritative action(s). */
  submit(action: Action, clientActionId: string): Promise<readonly LoggedAction[]>;
  /**
   * Submit an ATTACK **intent** and let the authority roll (F11). The client must not predict dice
   * (§5.5), so this — not `submit` — is the attack path online. Resolves with the authoritative
   * ATTACK action carrying the numbers.
   */
  submitIntent(intent: AttackIntent, clientActionId: string): Promise<readonly LoggedAction[]>;
  onActions(listener: (actions: readonly LoggedAction[]) => void): () => void;
  onStatus(listener: (status: SyncStatus) => void): () => void;
  /**
   * The caller's masked snapshot, when the authority sent one instead of a delta (§5.5, F36).
   *
   * The third argument is optional and additive: rows the listener should play the **events** of
   * without folding them. A fog game's snapshot is a masked view, and the actions behind it are
   * sent alongside purely so the board can animate what just happened; folding them would
   * double-apply what the snapshot already contains. An adapter that has no such rows calls the
   * listener with two arguments, exactly as before.
   */
  onSnapshot(
    listener: (snapshot: GameState, snapshotSeq: number, animate?: readonly LoggedAction[]) => void,
  ): () => void;
  setIntervalMs(ms: number): void;
  readonly seq: number;
  close(): void;

  /* ---- added after S5 shipped; both OPTIONAL so the existing adapter still satisfies the type -- */

  /**
   * Throw this client's folded state away and start again from the authority (§5.8, D16).
   *
   * **Expected semantics, for the adapter to implement:**
   * 1. reset the action cursor to **0** (and the chat cursor, if it keeps one), so the next poll is
   *    a cold read rather than a delta the client can no longer apply;
   * 2. poll once, immediately, and let the authority answer with a **masked snapshot** — which the
   *    session folds through `ingestSnapshot(snapshot, snapshotSeq)` and nothing else;
   * 3. resolve once that response has been delivered to `onSnapshot` / `onActions`.
   *
   * It must be idempotent and safe to call while a poll is in flight: the session calls it from a
   * desync, which is exactly when several polls may be racing. If the authority answers with a
   * delta instead of a snapshot, the adapter should treat that as a failed resync and surface
   * `"desynced"` rather than folding it.
   *
   * Absent (an adapter built before this was added), the session falls back to
   * `setIntervalMs(…) + poll()` via optional chaining. That nudges the cadence but **cannot** reset
   * the cursor, so a desynced client will keep rejecting deltas until a snapshot happens to arrive:
   * it is a graceful degradation, not a fix.
   */
  resync?(): Promise<void>;

  /**
   * Resign this seat (D76). The authority owns the action — `SEAT_TO_BOT { reason: "resigned" }` —
   * because it has to re-seat the bot and re-time the turn, so this goes to its own route and
   * **not** through `submit`, which refuses a `SEAT_TO_BOT` from a client.
   *
   * Resolves with the authoritative rows, if the adapter has them, so the caller may fold them
   * straight away; returning nothing is equally fine, since the next poll carries them.
   */
  resign?(): Promise<readonly LoggedAction[] | void>;
}

export interface LoggedAction {
  readonly seq: number; readonly seat: Seat; readonly action: Action;
  readonly actor: "human" | "bot" | "server";
  readonly clientActionId: string | null; readonly stateHash: string;
}

/** One roster row's online-ness, straight off POLL 3's `presence` (F26). */
export interface PresenceRow {
  readonly seat: Seat; readonly standing: Standing;
  readonly online: boolean; readonly missedTurns: number;
}

/** One chat line as it is READ. Shared verbatim by all three polls (§6). (F26) */
export interface ChatLine {
  readonly id: number;
  readonly scope: "global" | "lobby" | "game";
  readonly displayName: string;
  readonly lineId: number | null;      // the 42-line roster index (§7.3)
  readonly emoji: string | null;       // or one of the 8 glyph ids; exactly one of the two
  readonly createdAt: string;          // ISO 8601
}

/** One chat line as it is WRITTEN — exactly one of the two fields, never free text (F26, R-chat). */
export type ChatSend = { readonly lineId: number } | { readonly emoji: string };
