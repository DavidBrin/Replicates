/**
 * Each port's control options, kept between visits (Plan 5): Stick Jump and
 * the gamepad settings a player chose on /controls.
 *
 * Browser storage can be missing, full, blocked or hold anything at all, so
 * every access is guarded and everything read back is checked against the
 * schema, field by field, then rebuilt from the fields it was checked for;
 * any failure means that field's default (R-T21b), never an error a player
 * sees.
 */

import { PAD_ACTIONS, isPadSettings, type PadAction, type PadSettings } from "@/input/gamepad";
import { DEFAULT_CONTROL_OPTIONS } from "@/lib/matchConfig";

export const CONTROL_PREFS_KEY = "david-smash.controls.v1";

/** Ports a match can have, and so the ports kept: `matchConfig`'s four, with room. */
const MAX_PORTS = 8;

export interface PortPrefs {
  readonly stickJump: boolean;
  readonly pad: PadSettings;
}

/** The page's `localStorage`, or null where there is none or reading it throws. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

/** A fresh copy holding the schema's fields alone: nothing else that was stored rides along into a slot. */
function copyPad(pad: PadSettings): PadSettings {
  const buttons = {} as Record<PadAction, readonly number[]>;
  for (const a of PAD_ACTIONS) buttons[a] = [...pad.buttons[a]];
  return { buttons, rightStick: pad.rightStick };
}

/**
 * One port's saved options, field by field (R-T21b): a field whose saved
 * shape is wrong takes its default, and the other is kept, so a bad pad never
 * costs the port its Stick Jump. Null when neither field is valid.
 */
function portPrefsFrom(value: unknown): PortPrefs | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { stickJump?: unknown; pad?: unknown };
  const stickJump = typeof v.stickJump === "boolean" ? v.stickJump : null;
  const pad = isPadSettings(v.pad) ? copyPad(v.pad) : null;
  if (stickJump === null && pad === null) return null;
  return { stickJump: stickJump ?? DEFAULT_CONTROL_OPTIONS.stickJump, pad: pad ?? DEFAULT_CONTROL_OPTIONS.pad };
}

/** Every port's saved options; a port with nothing valid saved is absent. */
export function readControlPrefs(storage: Storage | null = browserStorage()): Partial<Record<number, PortPrefs>> {
  if (storage === null) return {};
  try {
    const raw = storage.getItem(CONTROL_PREFS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Partial<Record<number, PortPrefs>> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const port = Number(key);
      if (!(String(port) === key && Number.isInteger(port) && port >= 0 && port < MAX_PORTS)) continue;
      const prefs = portPrefsFrom(value);
      if (prefs !== null) out[port] = prefs;
    }
    return out;
  } catch {
    return {};
  }
}

/** Save every port's options. A storage that refuses is ignored. */
export function writeControlPrefs(prefs: Partial<Record<number, PortPrefs>>, storage: Storage | null = browserStorage()): void {
  if (storage === null) return;
  try {
    storage.setItem(CONTROL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Full, blocked or private: the options still hold for this visit.
  }
}
