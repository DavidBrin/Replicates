"use client";

import { DEFAULT_SETTINGS, type Settings, type SettingsPort } from "@/ports/settings";

const KEY = "island-empire:settings:v1";
const listeners = new Set<(s: Settings) => void>();

function safeRead(): Settings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Per-device settings in localStorage; every read/write is guarded (private mode, SSR). */
export const localSettings: SettingsPort = {
  read: safeRead,
  write(next) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — the in-memory value still reaches listeners */
    }
    for (const l of listeners) l(next);
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
