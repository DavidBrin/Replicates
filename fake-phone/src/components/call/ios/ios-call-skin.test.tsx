import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CALL_TEST_IDS, type CallSkinProps } from "../types";

import { IOS_TEST_IDS } from "./ids";
import { IosCallSkin } from "./ios-call-skin";

function handlers() {
  return {
    onAnswer: vi.fn(),
    onDecline: vi.fn(),
    onHangUp: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleSpeaker: vi.fn(),
    onToggleKeypad: vi.fn(),
  };
}

function props(overrides: Partial<CallSkinProps> = {}): CallSkinProps {
  return {
    phase: "ringing",
    callerName: "Priya Raman",
    callerLabel: "mobile",
    photo: "",
    elapsedSeconds: 0,
    muted: false,
    speaker: false,
    keypadOpen: false,
    subtitle: null,
    ...handlers(),
    ...overrides,
  };
}

describe("IosCallSkin — incoming", () => {
  it("renders answer and decline, and no timer", () => {
    render(<IosCallSkin {...props({ phase: "ringing" })} />);

    expect(screen.getByTestId(CALL_TEST_IDS.answer)).toBeInTheDocument();
    expect(screen.getByTestId(CALL_TEST_IDS.decline)).toBeInTheDocument();
    expect(screen.queryByTestId(CALL_TEST_IDS.timer)).not.toBeInTheDocument();
    expect(screen.getByTestId(CALL_TEST_IDS.callerName)).toHaveTextContent("Priya Raman");
    expect(screen.getByTestId(CALL_TEST_IDS.callerLabel)).toHaveTextContent("mobile");
  });

  it("keeps the primary pair icon-only and labelled for assistive tech", () => {
    render(<IosCallSkin {...props({ phase: "ringing" })} />);

    // Icon-only is the post-iOS-17 primary row (research/ios-call-ui.md §1.6):
    // no visible text, so the accessible name has to come from aria-label.
    expect(screen.getByTestId(CALL_TEST_IDS.answer)).toHaveTextContent("");
    expect(screen.getByLabelText("Answer call")).toBe(screen.getByTestId(CALL_TEST_IDS.answer));
    expect(screen.getByLabelText("Decline call")).toBe(screen.getByTestId(CALL_TEST_IDS.decline));
  });

  it("fires answer and decline", () => {
    const spies = handlers();
    render(<IosCallSkin {...props({ phase: "ringing", ...spies })} />);

    fireEvent.click(screen.getByTestId(CALL_TEST_IDS.answer));
    fireEvent.click(screen.getByTestId(CALL_TEST_IDS.decline));

    expect(spies.onAnswer).toHaveBeenCalledOnce();
    expect(spies.onDecline).toHaveBeenCalledOnce();
  });

  it("renders the initials monogram as visible text when there is no photo", () => {
    render(<IosCallSkin {...props({ phase: "ringing", photo: "" })} />);

    expect(screen.getByText("PR", { exact: true })).toBeInTheDocument();
    expect(screen.getByTestId(IOS_TEST_IDS.monogram)).toHaveTextContent("PR");
    expect(screen.queryByTestId(IOS_TEST_IDS.photo)).not.toBeInTheDocument();
  });

  it("uses the photo as a full-bleed background when one is set", () => {
    render(<IosCallSkin {...props({ phase: "ringing", photo: "data:image/png;base64,AAA" })} />);

    const layer = screen.getByTestId(IOS_TEST_IDS.photo);
    expect(layer).toHaveStyle({ backgroundImage: 'url("data:image/png;base64,AAA")' });
    expect(screen.queryByTestId(IOS_TEST_IDS.monogram)).not.toBeInTheDocument();
  });

  it("renders the background only while idle", () => {
    render(<IosCallSkin {...props({ phase: "idle" })} />);

    expect(screen.getByTestId(CALL_TEST_IDS.screen)).toBeInTheDocument();
    expect(screen.queryByTestId(CALL_TEST_IDS.answer)).not.toBeInTheDocument();
    expect(screen.queryByTestId(CALL_TEST_IDS.decline)).not.toBeInTheDocument();
  });
});

describe("IosCallSkin — in call", () => {
  it("formats the timer with no leading zero on the minutes", () => {
    // `0:01`, not `00:01` — research/ios-call-ui.md §2.2.
    const { rerender } = render(<IosCallSkin {...props({ phase: "active", elapsedSeconds: 1 })} />);
    expect(screen.getByTestId(CALL_TEST_IDS.timer)).toHaveTextContent("0:01");

    rerender(<IosCallSkin {...props({ phase: "active", elapsedSeconds: 3723 })} />);
    expect(screen.getByTestId(CALL_TEST_IDS.timer)).toHaveTextContent("1:02:03");
  });

  it("renders the timer in tabular figures so it does not jitter", () => {
    render(<IosCallSkin {...props({ phase: "active", elapsedSeconds: 65 })} />);

    expect(screen.getByTestId(CALL_TEST_IDS.timer)).toHaveClass("tabular");
  });

  it("renders the six controls plus a separate end-call button", () => {
    render(<IosCallSkin {...props({ phase: "active" })} />);

    expect(screen.getByTestId(IOS_TEST_IDS.controlGrid).children).toHaveLength(6);
    for (const id of [CALL_TEST_IDS.mute, CALL_TEST_IDS.keypad, CALL_TEST_IDS.speaker]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // End call is deliberately NOT a grid cell (research/ios-call-ui.md §2.4).
    expect(screen.getByTestId(IOS_TEST_IDS.controlGrid)).not.toContainElement(
      screen.getByTestId(CALL_TEST_IDS.hangUp),
    );
  });

  it("shows connecting… in the timer slot, without claiming a duration", () => {
    render(<IosCallSkin {...props({ phase: "connecting" })} />);

    expect(screen.getByTestId(IOS_TEST_IDS.status)).toHaveTextContent("connecting…");
    expect(screen.queryByTestId(CALL_TEST_IDS.timer)).not.toBeInTheDocument();
  });

  it("shows Call ended in the same layout", () => {
    render(<IosCallSkin {...props({ phase: "ended", elapsedSeconds: 42 })} />);

    expect(screen.getByTestId(IOS_TEST_IDS.status)).toHaveTextContent("Call ended");
    expect(screen.getByTestId(IOS_TEST_IDS.controlGrid)).toBeInTheDocument();
    expect(screen.getByTestId(CALL_TEST_IDS.hangUp)).toBeDisabled();
  });

  it("fires the toggle and hang-up handlers", () => {
    const spies = handlers();
    render(<IosCallSkin {...props({ phase: "active", ...spies })} />);

    fireEvent.click(screen.getByTestId(CALL_TEST_IDS.mute));
    fireEvent.click(screen.getByTestId(CALL_TEST_IDS.speaker));
    fireEvent.click(screen.getByTestId(CALL_TEST_IDS.keypad));
    fireEvent.click(screen.getByTestId(CALL_TEST_IDS.hangUp));

    expect(spies.onToggleMute).toHaveBeenCalledOnce();
    expect(spies.onToggleSpeaker).toHaveBeenCalledOnce();
    expect(spies.onToggleKeypad).toHaveBeenCalledOnce();
    expect(spies.onHangUp).toHaveBeenCalledOnce();
  });

  it("renders the subtitle above the controls when the caller is speaking", () => {
    const { rerender } = render(
      <IosCallSkin {...props({ phase: "active", subtitle: "I can see you, stay on the line." })} />,
    );
    expect(screen.getByTestId(CALL_TEST_IDS.subtitle)).toHaveTextContent(
      "I can see you, stay on the line.",
    );

    rerender(<IosCallSkin {...props({ phase: "active", subtitle: null })} />);
    expect(screen.queryByTestId(CALL_TEST_IDS.subtitle)).not.toBeInTheDocument();
  });
});

describe("IosCallSkin — frosted control state", () => {
  it("renders idle controls as translucent frosted glass", () => {
    render(<IosCallSkin {...props({ phase: "active", muted: false, speaker: false })} />);

    const mute = screen.getByTestId(CALL_TEST_IDS.mute);
    expect(mute).toHaveClass("bg-white/16", "backdrop-blur-[20px]", "backdrop-saturate-[180%]");
    expect(mute).toHaveAttribute("aria-pressed", "false");
  });

  it("inverts a toggled control to solid white with a dark glyph", () => {
    // The most-missed detail in a replica — research/ios-call-ui.md §7.3.
    render(<IosCallSkin {...props({ phase: "active", muted: true, speaker: true })} />);

    for (const id of [CALL_TEST_IDS.mute, CALL_TEST_IDS.speaker]) {
      const control = screen.getByTestId(id);
      expect(control).toHaveClass("bg-white", "text-black");
      expect(control).not.toHaveClass("bg-white/16");
      expect(control).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("inverts the keypad control too, and names mute by its current action", () => {
    render(<IosCallSkin {...props({ phase: "active", keypadOpen: true, muted: true })} />);

    expect(screen.getByTestId(CALL_TEST_IDS.keypad)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId(CALL_TEST_IDS.keypad)).toHaveClass("bg-white");
    expect(screen.getByTestId(CALL_TEST_IDS.mute)).toHaveAccessibleName("Unmute");
  });
});
