"use client";

/**
 * The one game screen (SPEC §7, F26). Hour-one stub: S4 owns this file and
 * builds the HUD, dialogs, roster, timer bar, presence dots and chat drawer;
 * S5's `/play/online/[gameId]` only composes it with the online props.
 */
import type { Session } from "@/game/session";
import type { ChatLine, ChatSend, PresenceRow, SyncPort } from "@/ports/sync";

export interface GameScreenProps {
  readonly session: Session;
  // ---- online only; every one of these is absent or null offline ----
  readonly sync?: SyncPort | null;
  readonly presence?: readonly PresenceRow[];
  readonly turnDeadline?: string | null;        // ISO 8601, straight from POLL 3
  readonly chat?: readonly ChatLine[];
  readonly onChat?: (line: ChatSend) => void;
}

export default function GameScreen(_props: GameScreenProps) {
  return <div data-testid="game-screen">S4 pending: GameScreen</div>;
}
