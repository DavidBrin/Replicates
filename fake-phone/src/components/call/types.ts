/**
 * The skin contract.
 *
 * A skin is a pure renderer: it receives this view model and returns markup. It
 * owns no state, starts no timers, and knows nothing about audio, personas or
 * settings. Adding a third skin means adding one component that takes these
 * props — nothing else in the app changes.
 */

import type { CallPhase } from "@/domain/call-session";

export interface CallSkinProps {
  readonly phase: CallPhase;
  readonly callerName: string;
  readonly callerLabel: string;
  /** Data/object URL, or "" to render the initials monogram instead. */
  readonly photo: string;
  readonly elapsedSeconds: number;
  readonly muted: boolean;
  readonly speaker: boolean;
  readonly keypadOpen: boolean;
  /** The line the caller is speaking right now, or null when silent. */
  readonly subtitle: string | null;

  readonly onAnswer: () => void;
  readonly onDecline: () => void;
  readonly onHangUp: () => void;
  readonly onToggleMute: () => void;
  readonly onToggleSpeaker: () => void;
  readonly onToggleKeypad: () => void;
}

/**
 * Stable hooks for tests and e2e. Skins MUST put these on the corresponding
 * controls, and both skins must use the same ones — that is what lets one e2e
 * suite drive every skin.
 */
export const CALL_TEST_IDS = {
  screen: "call-screen",
  callerName: "caller-name",
  callerLabel: "caller-label",
  timer: "call-timer",
  subtitle: "call-subtitle",
  answer: "answer-button",
  decline: "decline-button",
  hangUp: "end-call-button",
  mute: "mute-button",
  speaker: "speaker-button",
  keypad: "keypad-button",
} as const;
