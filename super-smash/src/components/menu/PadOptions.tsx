"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  DEFAULT_PAD_SETTINGS,
  PAD_ACTIONS,
  PAD_BUTTON_LIMIT,
  RIGHT_STICK_MODES,
  padButtonName,
  padsInOrder,
  rebind,
  type PadAction,
  type PadSettings,
  type RightStickMode,
} from "@/input/gamepad";
import { portColour, portTag, useMatchConfig } from "@/lib/matchConfig";
import { setOwnPad, useOnlineStore } from "@/lib/onlineStore";
import { ROLE_PORT } from "@/net/signalProtocol";

const ACTION_NAMES: Readonly<Record<PadAction, string>> = {
  attack: "attack",
  special: "special",
  jump: "jump",
  shield: "shield",
  grab: "grab",
};

const STICK_NAMES: Readonly<Record<RightStickMode, string>> = {
  smash: "Smash attack",
  special: "Special",
  off: "Off",
};

/** How often the capture looks at the pads: once a frame. */
const CAPTURE_POLL_MS = 16;

/** The pads a capture hears: one, by its place in connection order (`padsInOrder`), or every pad. */
type PadSource = number | "every";

function padsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.getGamepads === "function";
}

/** Support never changes while the page is open. */
function noSubscription(): () => void {
  return () => {};
}

/**
 * Every button down right now on the pads `source` names (another player's
 * pad is theirs), among the button numbers settings may hold
 * (`PAD_BUTTON_LIMIT`): one past them would be saved, then refused on reload.
 */
function buttonsDown(source: PadSource): Set<number> {
  const down = new Set<number>();
  padsInOrder(navigator.getGamepads()).forEach((pad, ordinal) => {
    if (source !== "every" && ordinal !== source) return;
    pad.buttons.forEach((b, i) => {
      if (b.pressed && i < PAD_BUTTON_LIMIT) down.add(i);
    });
  });
  return down;
}

/**
 * Calls `onPick` with the first button pressed after it starts. A button held
 * when it starts counts only once let go and pressed again. The Gamepad API
 * has no button events, so this polls, as `GamepadInput` does.
 */
function useButtonCapture(source: PadSource | null, onPick: (button: number) => void): void {
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    if (source === null || !padsSupported()) return;
    let held = buttonsDown(source);
    const timer = setInterval(() => {
      const now = buttonsDown(source);
      for (const b of now) {
        if (!held.has(b)) {
          clearInterval(timer);
          pick.current(b);
          return;
        }
      }
      held = now;
    }, CAPTURE_POLL_MS);
    return () => clearInterval(timer);
  }, [source]);
}

/**
 * Per-player gamepad options (Plan 5): rebind the five action buttons, and set
 * the right stick to a smash attack (its main use in Ultimate), a special, or
 * nothing. Kept on the player's slot; the match's `GamepadInput` reads it
 * through `padMappingOf`.
 *
 * Offline every human has a row, and a capture hears only that human's own
 * pad: the first connected pad is the first human's (`padPortMap`). Online
 * (ruling R-T20a) only this machine's port has a row, the host P1 and the
 * guest P2; every pad on this machine drives it, so a capture hears them all,
 * and a change is kept for after the session (`setOwnPad`).
 */
export function PadOptions() {
  const players = useMatchConfig((s) => s.players);
  const setPad = useMatchConfig((s) => s.setPad);
  const online = useMatchConfig((s) => s.online);
  const role = useOnlineStore((s) => s.role);
  const ownPort = role === null ? null : ROLE_PORT[role];
  const humans = players.filter((p) => p.kind === "human");
  const shown = online ? players.filter((p) => p.port === ownPort) : humans;
  const change = (port: number, pad: PadSettings) => {
    if (online) setOwnPad(pad);
    else setPad(port, pad);
  };
  const [capturing, setCapturing] = useState<{ port: number; action: PadAction } | null>(null);
  // The server render assumes support; the browser says, without a mismatch.
  const supported = useSyncExternalStore(noSubscription, padsSupported, () => true);

  const ordinal = capturing === null ? -1 : humans.findIndex((p) => p.port === capturing.port);
  const source: PadSource | null = capturing === null ? null : online ? "every" : ordinal < 0 ? null : ordinal;
  useButtonCapture(source, (button) => {
    if (capturing === null) return;
    const slot = useMatchConfig.getState().players.find((p) => p.port === capturing.port);
    if (slot) change(slot.port, rebind(slot.pad, capturing.action, button));
    setCapturing(null);
  });

  return (
    <section aria-label="Gamepad" className="mt-5">
      <h2 className="font-display text-sm tracking-[0.14em] text-white/70 uppercase">Gamepad</h2>
      {!supported && <p className="mt-2 text-xs text-white/45">This browser has no gamepad support; the keyboard still works.</p>}
      {capturing !== null && (
        <p className="mt-2 text-sm text-white" role="status">
          Press a button on your gamepad…
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-3">
        {shown.map((p) => (
          <li key={p.port} className="flex flex-wrap items-center gap-2">
            <span className="font-display w-20 text-sm" style={{ color: portColour(p.port) }}>
              Player {p.port + 1}
            </span>
            {PAD_ACTIONS.map((action) => {
              const names = p.pad.buttons[action].map(padButtonName).join("/") || "none";
              const label = `${portTag(p.port)} ${ACTION_NAMES[action]}: ${names}`;
              const waiting = capturing?.port === p.port && capturing.action === action;
              return (
                <button
                  key={action}
                  type="button"
                  aria-label={label}
                  disabled={!supported}
                  onClick={() => setCapturing(waiting ? null : { port: p.port, action })}
                  className="border-2 border-white/30 px-2 py-1 text-xs text-white/80 hover:border-white"
                >
                  {ACTION_NAMES[action]} <span className="font-display">{waiting ? "…" : names}</span>
                </button>
              );
            })}
            <label className="flex items-center gap-1 text-xs text-white/70">
              Right stick
              <select
                aria-label={`${portTag(p.port)} right stick`}
                value={p.pad.rightStick}
                onChange={(e) => change(p.port, { ...p.pad, rightStick: e.target.value as RightStickMode })}
                className="bg-[#2a2d33] px-1 py-1 text-white"
              >
                {RIGHT_STICK_MODES.map((m) => (
                  <option key={m} value={m}>
                    {STICK_NAMES[m]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={`${portTag(p.port)} reset gamepad`}
              onClick={() => change(p.port, DEFAULT_PAD_SETTINGS)}
              className="text-xs text-white/50 underline"
            >
              Reset
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/45">
        {online ? "Every pad on this machine plays as you." : "The first pad connected plays as the first human, and each next pad as the next human."} A
        d-pad button given an action no longer moves you. A flick of the right stick is a smash attack, or a special, in
        its direction.
      </p>
    </section>
  );
}
