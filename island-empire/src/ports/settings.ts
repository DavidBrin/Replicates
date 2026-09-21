/** Per-device settings (SPEC §7, D23, D34). Implemented by `adapters/localStorage/settings.ts`. */
export interface Settings {
  oneClickMove: boolean;
  music: boolean;
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = { oneClickMove: false, music: true, sound: true };

export interface SettingsPort {
  read(): Settings;
  write(next: Settings): void;
  subscribe(listener: (settings: Settings) => void): () => void;
}
