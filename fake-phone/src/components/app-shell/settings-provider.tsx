"use client";

/**
 * Settings state, read through the `SettingsStore` port.
 *
 * Stored settings live outside React — in `localStorage`, which does not exist
 * on the server — so they are consumed with `useSyncExternalStore`. That is the
 * API built for exactly this shape: it renders `getServerSnapshot()` (the
 * defaults) on the server and through hydration, then re-renders with the
 * stored values on the first client render afterwards. React knows about that
 * transition, so there is no hydration mismatch and no "load it in an effect"
 * round trip.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { defaultSettings, settingsSchema, type Settings } from "@/domain/settings";
import type { SettingsStore } from "@/ports";

import { useContainer, useIsClientContainer } from "./container-provider";

type DeepPartialSettings = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

interface SettingsContextValue {
  settings: Settings;
  /** Shallow-merges a patch, validates the result, and persists it. */
  update(patch: DeepPartialSettings): void;
  reset(): void;
  /** False until stored settings have been read; used to avoid flashing UI. */
  hydrated: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * The subscribable wrapper around the `SettingsStore` port.
 *
 * `getSnapshot` must return a stable reference between changes or
 * `useSyncExternalStore` re-renders forever, hence the memoized `snapshot`.
 */
class SettingsSource {
  private listeners = new Set<() => void>();
  private snapshot: Settings | null = null;

  constructor(private readonly store: SettingsStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Settings => (this.snapshot ??= this.store.load());

  // Never touches storage: this is what renders on the server and during
  // hydration, where `localStorage` does not exist.
  getServerSnapshot = (): Settings => defaultSettings;

  write(next: Settings): void {
    this.snapshot = next;
    this.store.save(next);
    for (const listener of this.listeners) listener();
  }

  reset(): void {
    this.store.clear();
    this.snapshot = this.store.load();
    for (const listener of this.listeners) listener();
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const container = useContainer();
  const hydrated = useIsClientContainer();

  const source = useMemo(() => new SettingsSource(container.settings), [container]);

  const settings = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getServerSnapshot,
  );

  const update = useCallback(
    (patch: DeepPartialSettings) => {
      const previous = source.getSnapshot();
      const merged = { ...previous, ...patch } as Record<string, unknown>;
      // Nested groups merge rather than replace, so updating one live-mode
      // field does not silently reset the rest of that group.
      if (patch.caller) merged.caller = { ...previous.caller, ...patch.caller };
      if (patch.live) merged.live = { ...previous.live, ...patch.live };

      const parsed = settingsSchema.safeParse(merged);
      // An invalid patch (a name typed empty, a viewer count out of range) is
      // dropped rather than applied: the UI keeps the last good value instead
      // of the user landing in an unrecoverable state mid-edit.
      if (!parsed.success) return;

      source.write(parsed.data);
    },
    [source],
  );

  const reset = useCallback(() => source.reset(), [source]);

  const value = useMemo(
    () => ({ settings, update, reset, hydrated }),
    [settings, update, reset, hydrated],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside a <SettingsProvider>.");
  return value;
}
