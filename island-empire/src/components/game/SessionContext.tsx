"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";

import type { GameState } from "@/engine/types";
import type { Session, SessionUiState } from "@/game/session";

const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  return <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession outside <SessionProvider>");
  return s;
}

/** Select from the session's UI store; re-renders only when the slice changes. */
export function useUi<T>(selector: (s: SessionUiState) => T): T {
  const session = useSession();
  return useStore(session.store, selector);
}

/** The live `GameState`, re-read whenever the runner bumps `version`. */
export function useGameState(): GameState {
  const session = useSession();
  useStore(session.store, (s) => s.version);
  return session.state;
}
