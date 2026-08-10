"use client";

/**
 * Settings state, read through the `SettingsStore` port.
 *
 * Loaded in an effect rather than during render: `localStorage` does not exist
 * on the server, and reading it during the first client render would produce
 * markup that differs from the server's. The first paint therefore always shows
 * defaults, and stored settings arrive a tick later — invisible in practice,
 * and it keeps hydration honest.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { defaultSettings, settingsSchema, type Settings } from "@/domain/settings";

import { useContainer } from "./container-provider";

interface SettingsContextValue {
  settings: Settings;
  /** Shallow-merges a patch, validates the result, and persists it. */
  update(patch: DeepPartialSettings): void;
  reset(): void;
  /** False until stored settings have been read; used to avoid flashing UI. */
  hydrated: boolean;
}

type DeepPartialSettings = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const container = useContainer();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings(container.settings.load());
    setHydrated(true);
  }, [container]);

  const update = useCallback(
    (patch: DeepPartialSettings) => {
      setSettings((previous) => {
        const merged = { ...previous, ...patch } as Record<string, unknown>;
        // Nested groups merge rather than replace, so updating one live-mode
        // field does not silently reset the rest of that group.
        if (patch.caller) merged.caller = { ...previous.caller, ...patch.caller };
        if (patch.live) merged.live = { ...previous.live, ...patch.live };

        const parsed = settingsSchema.safeParse(merged);
        // An invalid patch (a name typed empty, a viewer count out of range) is
        // dropped rather than applied: the UI keeps the last good value instead
        // of the user landing in an unrecoverable state mid-edit.
        if (!parsed.success) return previous;

        container.settings.save(parsed.data);
        return parsed.data;
      });
    },
    [container],
  );

  const reset = useCallback(() => {
    container.settings.clear();
    setSettings(defaultSettings);
  }, [container]);

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
