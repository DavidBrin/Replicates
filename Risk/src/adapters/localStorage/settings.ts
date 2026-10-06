/** `SettingsPort` over `risk:settings:v1` (SPEC §4.16). */
import type { Settings, SettingsPort } from "@/ports/settings";

import { createChannel, readJson, writeJson } from "./store";

export const SETTINGS_KEY = "risk:settings:v1";

export const DEFAULT_SETTINGS: Settings = {
  cameraAnimations: true,
  phaseAnimations: true,
  endPhaseConfirmation: true,
  sound: true,
  music: true,
  colourPatterns: false,
  winChanceRamp: false,
};

const channel = createChannel<Settings>();

/** Coerce whatever is on disk into a complete `Settings`; an old key never crashes a boot. */
function normalise(raw: Partial<Settings> | null | undefined): Settings {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

export function createSettingsAdapter(): SettingsPort {
  return {
    read(): Settings {
      return normalise(readJson<Partial<Settings> | null>(SETTINGS_KEY, null));
    },
    write(patch: Partial<Settings>): void {
      const next = normalise({ ...this.read(), ...patch });
      writeJson(SETTINGS_KEY, next);
      channel.emit(next);
    },
    subscribe(fn: (s: Settings) => void): () => void {
      return channel.subscribe(fn);
    },
  };
}

/** An in-memory port for tests and for the server render. */
export function createMemorySettings(initial: Partial<Settings> = {}): SettingsPort {
  let value = normalise({ ...DEFAULT_SETTINGS, ...initial });
  const local = createChannel<Settings>();
  return {
    read: () => value,
    write(patch) {
      value = normalise({ ...value, ...patch });
      local.emit(value);
    },
    subscribe: (fn) => local.subscribe(fn),
  };
}
