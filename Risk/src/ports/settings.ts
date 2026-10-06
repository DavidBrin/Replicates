// Published verbatim from SPEC §4.16 as the cross-slice contract. S4 owns this file.

// src/ports/settings.ts
export interface Settings {
  cameraAnimations: boolean;   // default true
  phaseAnimations: boolean;    // default true
  endPhaseConfirmation: boolean; // default true
  sound: boolean; music: boolean;
  colourPatterns: boolean;     // the colour-vision pattern overlay, default false
  winChanceRamp: boolean;      // the opt-in colour ramp, default false (R-visual: gold is default)
}
export interface SettingsPort { read(): Settings; write(patch: Partial<Settings>): void;
  subscribe(fn: (s: Settings) => void): () => void }

