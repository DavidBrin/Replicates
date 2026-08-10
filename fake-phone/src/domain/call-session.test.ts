import { describe, expect, it } from "vitest";

import {
  callReducer,
  elapsedSeconds,
  initialCallState,
  isOnCall,
  isRinging,
  type CallAction,
  type CallState,
} from "./call-session";

function run(actions: CallAction[], from: CallState = initialCallState): CallState {
  return actions.reduce(callReducer, from);
}

describe("callReducer", () => {
  it("walks the happy path idle → ringing → connecting → active", () => {
    const state = run([{ type: "RING" }, { type: "ANSWER" }, { type: "CONNECTED", at: 1000 }]);
    expect(state.phase).toBe("active");
    expect(state.connectedAt).toBe(1000);
  });

  it("lets the silent tier connect straight from ringing with no connecting frame", () => {
    const state = run([{ type: "RING" }, { type: "CONNECTED", at: 500 }]);
    expect(state.phase).toBe("active");
  });

  it("records why the call ended", () => {
    expect(run([{ type: "RING" }, { type: "DECLINE", at: 5 }]).endReason).toBe("declined");
    expect(run([{ type: "RING" }, { type: "MISS", at: 5 }]).endReason).toBe("missed");
    expect(
      run([{ type: "RING" }, { type: "ANSWER" }, { type: "CONNECTED", at: 1 }, { type: "HANG_UP", at: 9 }])
        .endReason,
    ).toBe("hung_up");
  });

  it("allows hanging up while still connecting", () => {
    // The user must never be trapped on a "connecting" screen waiting for a
    // provider handshake they cannot see.
    const state = run([{ type: "RING" }, { type: "ANSWER" }, { type: "HANG_UP", at: 40 }]);
    expect(state.phase).toBe("ended");
  });

  it("returns the identical object for an illegal transition", () => {
    const ringing = run([{ type: "RING" }]);
    // Identity, not just equality — a double-tapped end-call button must cost
    // nothing, and React bails out of re-rendering on an unchanged reference.
    expect(callReducer(ringing, { type: "HANG_UP", at: 1 })).toBe(ringing);
    expect(callReducer(ringing, { type: "TOGGLE_MUTE" })).toBe(ringing);
    expect(callReducer(initialCallState, { type: "ANSWER" })).toBe(initialCallState);
  });

  it("ignores a second end after the call has already ended", () => {
    const ended = run([{ type: "RING" }, { type: "DECLINE", at: 5 }]);
    expect(callReducer(ended, { type: "HANG_UP", at: 99 })).toBe(ended);
    expect(ended.endedAt).toBe(5);
  });

  it("only toggles controls during an active call", () => {
    const active = run([{ type: "RING" }, { type: "ANSWER" }, { type: "CONNECTED", at: 0 }]);
    expect(callReducer(active, { type: "TOGGLE_MUTE" }).muted).toBe(true);
    expect(callReducer(active, { type: "TOGGLE_SPEAKER" }).speaker).toBe(true);
    expect(callReducer(active, { type: "TOGGLE_KEYPAD" }).keypadOpen).toBe(true);
  });

  it("resets to a fresh idle call", () => {
    const ended = run([{ type: "RING" }, { type: "DECLINE", at: 5 }]);
    expect(callReducer(ended, { type: "RESET" })).toEqual(initialCallState);
  });
});

describe("elapsedSeconds", () => {
  it("is zero before the call connects", () => {
    expect(elapsedSeconds(run([{ type: "RING" }]), 10_000)).toBe(0);
  });

  it("derives from the wall clock rather than counted ticks", () => {
    // A backgrounded tab loses its interval ticks; recomputing from the
    // connect timestamp means the timer is correct again the moment the tab
    // comes back, instead of being short by the throttled interval.
    const active = run([{ type: "RING" }, { type: "ANSWER" }, { type: "CONNECTED", at: 1_000 }]);
    expect(elapsedSeconds(active, 1_000)).toBe(0);
    expect(elapsedSeconds(active, 8_400)).toBe(7);
    expect(elapsedSeconds(active, 61_000)).toBe(60);
  });

  it("freezes at the moment the call ended", () => {
    const ended = run([
      { type: "RING" },
      { type: "ANSWER" },
      { type: "CONNECTED", at: 1_000 },
      { type: "HANG_UP", at: 31_000 },
    ]);
    expect(elapsedSeconds(ended, 90_000)).toBe(30);
  });
});

describe("phase predicates", () => {
  it("classify the phases the skins branch on", () => {
    const ringing = run([{ type: "RING" }]);
    const connecting = run([{ type: "RING" }, { type: "ANSWER" }]);
    expect(isRinging(ringing)).toBe(true);
    expect(isOnCall(ringing)).toBe(false);
    expect(isOnCall(connecting)).toBe(true);
  });
});
