"use client";

import type { Settings } from "@/ports/settings";
import { OUTLINE, UI, WHITE } from "@/render/palette";

import { useSession, useUi } from "./SessionContext";
import { TOUCH_MIN, panelBorder, pixelInk, pixelText } from "./styles";

/** Pause/settings modal: one-click-move, music, sound; Quit to menu (§7). */
export function SettingsModal({ onQuit }: { onQuit: () => void }) {
  const session = useSession();
  const modal = useUi((s) => s.modal);
  const settings = useUi((s) => s.settings);
  if (modal !== "settings") return null;
  const rows: Array<{ key: keyof Settings; label: string; testId: string }> = [
    { key: "oneClickMove", label: "One-click move", testId: "toggle-one-click" },
    { key: "music", label: "Music", testId: "toggle-music" },
    { key: "sound", label: "Sound", testId: "toggle-sound" },
  ];
  return (
    <div
      data-testid="settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={() => session.setModal(null)}
    >
      <div
        className="flex w-full max-w-sm flex-col gap-3 p-4"
        style={{ background: UI.woodPanel, ...panelBorder }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-2xl" style={pixelText}>
          Settings
        </h2>
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            role="switch"
            aria-checked={settings[r.key]}
            data-testid={r.testId}
            onClick={() => session.updateSettings({ [r.key]: !settings[r.key] })}
            className="flex items-center justify-between px-3"
            style={{ minHeight: TOUCH_MIN, background: UI.woodPanelLight, border: `3px solid ${OUTLINE}`, borderRadius: 6 }}
          >
            <span className="text-sm" style={pixelText}>
              {r.label}
            </span>
            <span
              className="px-2 text-sm"
              style={{ ...pixelInk, color: WHITE, background: settings[r.key] ? UI.buyGreen : UI.disabledGrey, border: `2px solid ${OUTLINE}`, borderRadius: 4 }}
            >
              {settings[r.key] ? "ON" : "OFF"}
            </span>
          </button>
        ))}
        <button
          type="button"
          data-testid="settings-close"
          onClick={() => session.setModal(null)}
          className="text-lg"
          style={{ minHeight: TOUCH_MIN, background: UI.buyGreen, border: `3px solid ${OUTLINE}`, borderRadius: 6, ...pixelText }}
        >
          Back to game
        </button>
        <button
          type="button"
          data-testid="settings-quit"
          onClick={onQuit}
          className="text-sm"
          style={{ minHeight: TOUCH_MIN, background: UI.unaffordableRed, border: `3px solid ${OUTLINE}`, borderRadius: 6, ...pixelText }}
        >
          Quit to menu
        </button>
      </div>
    </div>
  );
}
