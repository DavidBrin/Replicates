/**
 * What these tests are protecting.
 *
 * The swipe pill is the only place in the app where a gesture stands between a
 * frightened user and an answered call, so both routes through it are pinned:
 * the drag has to fire at the right distance, and a plain click has to work
 * without any drag at all. Everything else here guards a detail that a redesign
 * would silently break — the two-digit timer, the pill-shaped end-call button,
 * and `aria-pressed` on the toggles.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CALL_TEST_IDS, type CallSkinProps } from "../types";
import { AndroidCallSkin } from "./android-call-skin";

function renderSkin(overrides: Partial<CallSkinProps> = {}) {
  const handlers = {
    onAnswer: vi.fn(),
    onDecline: vi.fn(),
    onHangUp: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleSpeaker: vi.fn(),
    onToggleKeypad: vi.fn(),
  };

  const props: CallSkinProps = {
    phase: "ringing",
    callerName: "Priya Raman",
    callerLabel: "Mobile",
    photo: "",
    elapsedSeconds: 0,
    muted: false,
    speaker: false,
    keypadOpen: false,
    subtitle: null,
    ...handlers,
    ...overrides,
  };

  render(<AndroidCallSkin {...props} />);
  return handlers;
}

/**
 * jsdom has no layout, so the pill measures 0 wide and the component falls back
 * to a nominal 120px of travel — meaning the snap threshold is 72px.
 */
function drag(distancePx: number) {
  const track = screen.getByTestId("android-swipe-track");
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: 200 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 200 + distancePx });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 200 + distancePx });
}

describe("AndroidCallSkin — incoming", () => {
  it("offers both affordances of the swipe pill", () => {
    renderSkin();

    const answer = screen.getByTestId(CALL_TEST_IDS.answer);
    const decline = screen.getByTestId(CALL_TEST_IDS.decline);

    expect(answer).toHaveTextContent("Answer");
    expect(decline).toHaveTextContent("Decline");
    expect(screen.getByTestId("android-swipe-track")).toBeInTheDocument();
    // The ringing screen must not offer a way to hang up a call that has not
    // started, or the e2e suite would find two exits and pick the wrong one.
    expect(screen.queryByTestId(CALL_TEST_IDS.hangUp)).not.toBeInTheDocument();
  });

  it("answers on a plain click, with no drag at all", async () => {
    const user = userEvent.setup();
    const { onAnswer, onDecline } = renderSkin();

    await user.click(screen.getByTestId(CALL_TEST_IDS.answer));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("declines on a plain click", async () => {
    const user = userEvent.setup();
    const { onAnswer, onDecline } = renderSkin();

    await user.click(screen.getByTestId(CALL_TEST_IDS.decline));

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("answers when the handle is dragged past the snap threshold", () => {
    const { onAnswer } = renderSkin();

    drag(100);

    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("declines when the handle is dragged the other way", () => {
    const { onDecline, onAnswer } = renderSkin();

    drag(-100);

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("springs back and does nothing when the drag stops short", () => {
    const { onAnswer, onDecline } = renderSkin();

    drag(30);

    expect(onAnswer).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("does not also fire the click under the finger when a drag completes", () => {
    const { onAnswer } = renderSkin();

    drag(100);
    // A real pointer that lands on the Answer half raises `click` there too.
    fireEvent.click(screen.getByTestId(CALL_TEST_IDS.answer));

    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("shows the initials monogram as text when there is no photo", () => {
    renderSkin({ photo: "" });

    expect(screen.getByText("PR")).toBeInTheDocument();
  });

  it("renders the spoken line when there is one", () => {
    renderSkin({ subtitle: "I'm two minutes away." });

    expect(screen.getByTestId(CALL_TEST_IDS.subtitle)).toHaveTextContent("I'm two minutes away.");
  });
});

describe("AndroidCallSkin — in call", () => {
  it("shows a two-digit-minute timer", () => {
    renderSkin({ phase: "active", elapsedSeconds: 65 });

    expect(screen.getByTestId(CALL_TEST_IDS.timer)).toHaveTextContent("01:05");
  });

  it("shows the four-up control row and an end-call button", () => {
    renderSkin({ phase: "active" });

    for (const id of [
      CALL_TEST_IDS.keypad,
      CALL_TEST_IDS.mute,
      CALL_TEST_IDS.speaker,
      CALL_TEST_IDS.hangUp,
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("More options")).toBeInTheDocument();
    // The swipe pill belongs to the ringing screen only.
    expect(screen.queryByTestId(CALL_TEST_IDS.answer)).not.toBeInTheDocument();
  });

  it("shapes end-call as a stadium pill, not a circle", () => {
    renderSkin({ phase: "active" });

    const endCall = screen.getByTestId(CALL_TEST_IDS.hangUp);
    // Full radius on a full-width, fixed-height element: a pill. The iOS skin's
    // equivalent is a circle, and one e2e test compares the two.
    expect(endCall.className).toContain("rounded-full");
    expect(endCall.className).toContain("w-full");
    expect(endCall.className).toContain("h-[68px]");
  });

  it("reflects mute state on the button and reports taps", async () => {
    const user = userEvent.setup();
    const { onToggleMute } = renderSkin({ phase: "active", muted: true });

    const mute = screen.getByTestId(CALL_TEST_IDS.mute);
    expect(mute).toHaveAttribute("aria-pressed", "true");
    expect(mute).toHaveAttribute("aria-label", "Unmute");

    await user.click(mute);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("reports the toggles as unpressed when they are off", () => {
    renderSkin({ phase: "active" });

    expect(screen.getByTestId(CALL_TEST_IDS.mute)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId(CALL_TEST_IDS.speaker)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId(CALL_TEST_IDS.keypad)).toHaveAttribute("aria-pressed", "false");
  });

  it("reflects speaker and keypad state", () => {
    renderSkin({ phase: "active", speaker: true, keypadOpen: true });

    expect(screen.getByTestId(CALL_TEST_IDS.speaker)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId(CALL_TEST_IDS.keypad)).toHaveAttribute("aria-pressed", "true");
  });

  it("hangs up when the end-call pill is tapped", async () => {
    const user = userEvent.setup();
    const { onHangUp } = renderSkin({ phase: "active" });

    await user.click(screen.getByTestId(CALL_TEST_IDS.hangUp));

    expect(onHangUp).toHaveBeenCalledTimes(1);
  });

  it("waits on the connecting frame instead of showing a timer that has not started", () => {
    renderSkin({ phase: "connecting" });

    expect(screen.getByTestId(CALL_TEST_IDS.timer)).toHaveTextContent("Calling…");
  });
});

describe("AndroidCallSkin — other phases", () => {
  it("renders the ended frame with the final duration", () => {
    renderSkin({ phase: "ended", elapsedSeconds: 3661 });

    expect(screen.getByText("Call ended")).toBeInTheDocument();
    expect(screen.getByTestId(CALL_TEST_IDS.timer)).toHaveTextContent("1:01:01");
  });

  it("renders nothing but the surface while idle", () => {
    renderSkin({ phase: "idle" });

    const surface = screen.getByTestId(CALL_TEST_IDS.screen);
    expect(surface).toBeInTheDocument();
    expect(screen.queryByTestId(CALL_TEST_IDS.callerName)).not.toBeInTheDocument();
    expect(screen.queryByTestId(CALL_TEST_IDS.answer)).not.toBeInTheDocument();
  });

  it("always names the caller and the line it came in on", () => {
    renderSkin({ phase: "active" });

    expect(screen.getByTestId(CALL_TEST_IDS.callerName)).toHaveTextContent("Priya Raman");
    expect(screen.getByTestId(CALL_TEST_IDS.callerLabel)).toHaveTextContent("Mobile");
  });
});
