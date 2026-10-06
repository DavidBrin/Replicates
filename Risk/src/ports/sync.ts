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
  /** The caller's masked snapshot, when the authority sent one instead of a delta (§5.5, F36). */
  onSnapshot(listener: (snapshot: GameState, snapshotSeq: number) => void): () => void;
  setIntervalMs(ms: number): void;
  readonly seq: number;
  close(): void;
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
