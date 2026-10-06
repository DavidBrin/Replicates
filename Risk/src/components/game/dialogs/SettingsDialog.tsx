"use client";

/**
 * In-game settings (SPEC §7.2) — **a modal, not a route**, opened from the ⚙
 * button on any in-game screen and reading/writing `SettingsPort`.
 *
 * Camera Animations, Phase Change Animations and End Phase Confirmation all
 * default ON: their existence in the original proves the default experience
 * has a camera pan, an animated phase transition and an end-phase confirm.
 */

import { IconButton } from "@/components/ui/IconButton";
import { Pill } from "@/components/ui/Pill";
import type { Settings } from "@/ports/settings";

import { at, atTopLeft, outlined, Stage } from "./stage";

export interface SettingsDialogProps {
  readonly settings: Settings;
  readonly onChange: (patch: Partial<Settings>) => void;
  readonly onChangeName: () => void;
  readonly onResign: () => void;
  readonly onLeave: () => void;
  readonly onClose: () => void;
}

const ROWS: readonly { readonly key: keyof Settings; readonly label: string }[] = [
  { key: "cameraAnimations", label: "Camera Animations" },
  { key: "phaseAnimations", label: "Phase Change Animations" },
  { key: "endPhaseConfirmation", label: "End Phase Confirmation" },
  { key: "sound", label: "Sound" },
  { key: "music", label: "Music" },
  { key: "colourPatterns", label: "Colour-vision patterns" },
  { key: "winChanceRamp", label: "Win-chance colour ramp" },
];

function Toggle({ on, label, onToggle, testId }: {
  readonly on: boolean; readonly label: string; readonly onToggle: () => void;
  readonly testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
        width: "100%", minHeight: 56, padding: "0 18px", borderRadius: 12,
        background: "var(--chrome-800)", border: "2px solid var(--chrome-line)",
        cursor: "pointer",
      }}
    >
      <span style={{ fontFamily: "var(--font-body), system-ui, sans-serif", fontSize: 24,
        fontWeight: 600, color: "var(--text)" }}>
        {label}
      </span>
      <span
        aria-hidden
        style={{
          width: 72, height: 36, borderRadius: 18, flex: "0 0 auto",
          background: on ? "var(--cyan)" : "var(--disabled)",
          border: `2px solid ${on ? "var(--cyan)" : "var(--disabled-line)"}`,
          display: "flex", alignItems: "center",
          justifyContent: on ? "flex-end" : "flex-start", padding: 3,
        }}
      >
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--text)" }} />
      </span>
    </button>
  );
}

export function SettingsDialog({
  settings, onChange, onChangeName, onResign, onLeave, onClose,
}: SettingsDialogProps) {
  return (
    <Stage testId="settings-dialog" label="Settings" z="var(--z-modal)">
      <div
        style={{
          ...atTopLeft(460, 70), width: 680, height: 760, borderRadius: 20,
          background: "var(--chrome-900)", border: "3px solid var(--chrome-line)",
          boxShadow: "var(--sh-panel)", padding: "22px 26px",
          display: "flex", flexDirection: "column", gap: 10, overflowY: "auto",
        }}
      >
        <div style={{ ...outlined(44), alignSelf: "center", marginBottom: 6 }}>Settings</div>

        {ROWS.map((row) => (
          <Toggle
            key={row.key}
            label={row.label}
            on={settings[row.key]}
            testId={`setting-${row.key}`}
            onToggle={() => onChange({ [row.key]: !settings[row.key] } as Partial<Settings>)}
          />
        ))}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10,
          alignItems: "center" }}>
          <Pill label="Change display name" onClick={onChangeName} testId="settings-change-name" />
          <Pill variant="danger" label="Resign" onClick={onResign} testId="settings-resign" />
          <Pill variant="danger" label="Leave Game" onClick={onLeave} testId="settings-leave" />
        </div>
      </div>

      <div style={at(1180, 86)}>
        <IconButton chassis="circle" tone="danger" icon="cross" size={60} label="Close settings"
          onClick={onClose} testId="settings-close" />
      </div>
    </Stage>
  );
}

export default SettingsDialog;
