/**
 * The call state machine.
 *
 * Deliberately a pure reducer over injected timestamps rather than a class that
 * owns a `setInterval`. Three things fall out of that choice:
 *
 *   - the whole lifecycle is unit-testable with no timers and no browser;
 *   - a skin renders a `CallViewModel` and can never disagree with another skin
 *     about what "active" means, because neither of them owns the state;
 *   - elapsed time is derived from a wall-clock delta rather than accumulated
 *     from ticks, so a throttled background tab (which mobile Safari WILL do to
 *     us — research/web-platform-constraints.md §2) resumes showing the correct
 *     duration instead of a timer that silently lost thirty seconds.
 */

export type CallPhase = "idle" | "ringing" | "connecting" | "active" | "ended";

export type CallEndReason = "declined" | "hung_up" | "missed";

export interface CallState {
  readonly phase: CallPhase;
  /** Epoch ms at which the call became `active`. Null until answered. */
  readonly connectedAt: number | null;
  readonly endedAt: number | null;
  readonly endReason: CallEndReason | null;
  readonly muted: boolean;
  readonly speaker: boolean;
  readonly keypadOpen: boolean;
}

export type CallAction =
  | { type: "RING" }
  | { type: "ANSWER" }
  /** The voice provider finished connecting; `at` starts the timer. */
  | { type: "CONNECTED"; at: number }
  | { type: "DECLINE"; at: number }
  | { type: "HANG_UP"; at: number }
  | { type: "MISS"; at: number }
  | { type: "TOGGLE_MUTE" }
  | { type: "TOGGLE_SPEAKER" }
  | { type: "TOGGLE_KEYPAD" }
  | { type: "RESET" };

export const initialCallState: CallState = {
  phase: "idle",
  connectedAt: null,
  endedAt: null,
  endReason: null,
  muted: false,
  speaker: false,
  keypadOpen: false,
};

/**
 * Every transition is explicit and every illegal transition is a no-op that
 * returns the *same object reference*. That identity guarantee is load-bearing:
 * React bails out of re-rendering on an unchanged reducer result, so a stray
 * "hang up" from a double-tapped end-call button costs nothing rather than
 * re-rendering a call screen that has already ended.
 */
export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "RING":
      if (state.phase !== "idle") return state;
      return { ...state, phase: "ringing" };

    case "ANSWER":
      if (state.phase !== "ringing") return state;
      return { ...state, phase: "connecting" };

    case "CONNECTED":
      // Reachable from `ringing` too: the silent tier has nothing to connect,
      // so it answers straight through without a connecting frame.
      if (state.phase !== "connecting" && state.phase !== "ringing") return state;
      return { ...state, phase: "active", connectedAt: action.at };

    case "DECLINE":
      if (state.phase !== "ringing") return state;
      return { ...state, phase: "ended", endedAt: action.at, endReason: "declined" };

    case "MISS":
      if (state.phase !== "ringing") return state;
      return { ...state, phase: "ended", endedAt: action.at, endReason: "missed" };

    case "HANG_UP":
      // Hanging up mid-connect is legal — the user does not have to wait for a
      // provider handshake they cannot see to get out of the app.
      if (state.phase !== "active" && state.phase !== "connecting") return state;
      return { ...state, phase: "ended", endedAt: action.at, endReason: "hung_up" };

    case "TOGGLE_MUTE":
      if (state.phase !== "active") return state;
      return { ...state, muted: !state.muted };

    case "TOGGLE_SPEAKER":
      if (state.phase !== "active") return state;
      return { ...state, speaker: !state.speaker };

    case "TOGGLE_KEYPAD":
      if (state.phase !== "active") return state;
      return { ...state, keypadOpen: !state.keypadOpen };

    case "RESET":
      return initialCallState;

    default: {
      // Exhaustiveness guard: adding a `CallAction` variant without handling it
      // fails the build here rather than silently doing nothing at runtime.
      const never: never = action;
      return never;
    }
  }
}

/** Seconds since the call connected. Zero in every phase before `active`. */
export function elapsedSeconds(state: CallState, now: number): number {
  if (state.connectedAt === null) return 0;
  const end = state.phase === "ended" && state.endedAt !== null ? state.endedAt : now;
  return Math.max(0, Math.floor((end - state.connectedAt) / 1000));
}

export function isRinging(state: CallState): boolean {
  return state.phase === "ringing";
}

export function isOnCall(state: CallState): boolean {
  return state.phase === "connecting" || state.phase === "active";
}
