"use client";

import { useSyncExternalStore } from "react";

import { localSettings } from "@/adapters/localStorage/settings";
import { DEFAULT_SETTINGS, type Settings } from "@/ports/settings";
import { PixelDialog } from "@/components/ui/PixelDialog";

/**
 * The settings modal (SPEC §7 "Pause/settings"): one-click-move, music and
 * sound toggles over `ports/settings.ts`. Shared by the title screen here and
 * available to the in-game gear (S2) — it owns no state of its own beyond
 * the mirror of the port.
 */

let cached: Settings = DEFAULT_SETTINGS;
let cacheLoaded = false;

function subscribe(listener: () => void): () => void {
  const unsubscribe = localSettings.subscribe((next) => {
    cached = next;
    listener();
  });
  return unsubscribe;
}

function getSnapshot(): Settings {
  if (!cacheLoaded) {
    cached = localSettings.read();
    cacheLoaded = true;
  }
  return cached;
}

function getServerSnapshot(): Settings {
  return DEFAULT_SETTINGS;
}

/** The live per-device settings, hydration-safe. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();

  const toggle = (key: keyof Settings) => {
    localSettings.write({ ...settings, [key]: !settings[key] });
  };

  return (
    <PixelDialog open={open} onClose={onClose} title="Settings">
      <ul className="flex flex-col gap-2">
        <SettingRow
          label="One-click move"
          hint="Tap an enemy tile to attack with the weakest ready knight"
          on={settings.oneClickMove}
          onToggle={() => toggle("oneClickMove")}
        />
        <SettingRow label="Music" on={settings.music} onToggle={() => toggle("music")} />
        <SettingRow label="Sound" on={settings.sound} onToggle={() => toggle("sound")} />
      </ul>
    </PixelDialog>
  );
}

function SettingRow({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) {
  return (
    <li
      className="flex items-center justify-between gap-3 rounded-md border-2 p-2"
      style={{ background: "var(--ie-card-cream)", borderColor: "var(--ie-ink)" }}
    >
      <div className="min-w-0">
        <div className="ie-caps text-sm">{label}</div>
        {hint && <div className="text-xs leading-tight opacity-80">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className="ie-btn ie-btn--sm ie-outline shrink-0"
        style={{ background: on ? "var(--ie-green)" : "var(--ie-grey)", minWidth: 64 }}
      >
        {on ? "ON" : "OFF"}
      </button>
    </li>
  );
}

export default SettingsDialog;
