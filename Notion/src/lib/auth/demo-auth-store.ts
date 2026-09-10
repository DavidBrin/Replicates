"use client";

/**
 * The ephemeral demo-login store.
 *
 * This is deliberately a *separate* Zustand store from `useWorkspaceStore`.
 * The whole point of the "demo login" feature is that the name a visitor
 * types is never saved anywhere — it disappears the moment they leave the
 * page or reload. `useWorkspaceStore` is persisted wholesale to
 * IndexedDB/localStorage (see `src/lib/store/hydration.ts`), so anything that
 * lives on it durably survives a reload. To keep the demo name ephemeral,
 * this file must NEVER:
 *
 *   (a) be merged into `WorkspaceState` / `useWorkspaceStore` — that store's
 *       `subscribe` callback snapshots and saves the state on every change;
 *   (b) use zustand's `persist` middleware (or any middleware at all) — do
 *       not `import ... from "zustand/middleware"` in this file;
 *   (c) write to `localStorage`, `sessionStorage`, or IndexedDB anywhere in
 *       this file, directly or indirectly.
 *
 * Doing any of the above would make the "demo" name durably overwrite the
 * real visitor's saved workspace data, which is exactly the bug this feature
 * exists to avoid.
 */

import { create } from "zustand";
import { demoAuth } from "@/config/app.config";

export interface DemoAuthState {
  /** The name typed at the login prompt. null = never signed in this page load. */
  demoName: string | null;
  /** True once the visitor has signed in OR dismissed the prompt this load. */
  gateResolved: boolean;
  /** Trims and caps at demoAuth.maxNameLength; a whitespace-only name is a no-op. */
  signIn: (name: string) => void;
  /** Dismiss without a name — browse as the seeded user. */
  skip: () => void;
  /** Clears the name and re-arms the gate (used by "Log out"). */
  signOut: () => void;
}

export const useDemoAuthStore = create<DemoAuthState>()((set) => ({
  demoName: null,
  gateResolved: false,
  signIn: (name) => {
    const trimmed = name.trim().slice(0, demoAuth.maxNameLength);
    if (!trimmed) return;
    set({ demoName: trimmed, gateResolved: true });
  },
  skip: () => set({ gateResolved: true }),
  signOut: () => set({ demoName: null, gateResolved: false }),
}));
