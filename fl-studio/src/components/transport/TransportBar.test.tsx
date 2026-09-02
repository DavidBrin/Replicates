import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { updateProject } from "@/domain/commands";
import { createHistory } from "@/domain/undo";
import { __resetGestureCounterForTests, registerExternalGesture } from "@/lib/gestureHold";
import { selectHasActiveGesture, useAppStore } from "@/lib/store";

import { ARM_TIMEOUT_MS, TransportBar } from "./TransportBar";
import { __resetWiringForTests, requestPatternRename } from "@/components/shell/wiring";

afterEach(() => {
  __resetWiringForTests();
});

describe("TransportBar", () => {
  it("renders play/stop, mode switch, tempo LCD, and pattern selector", () => {
    render(<TransportBar />);
    expect(screen.getByLabelText("Play")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle pattern / song mode")).toBeInTheDocument();
    expect(screen.getByTestId("bpm-lcd")).toBeInTheDocument();
    expect(screen.getByTestId("pattern-selector")).toBeInTheDocument();
  });

  it("fires the onPlayStop callback instead of the default wiring when provided", async () => {
    const onPlayStop = vi.fn();
    const user = userEvent.setup();
    render(<TransportBar onPlayStop={onPlayStop} />);

    await user.click(screen.getByLabelText("Play"));

    expect(onPlayStop).toHaveBeenCalledTimes(1);
  });

  it("fires the onModeToggle callback", async () => {
    const onModeToggle = vi.fn();
    const user = userEvent.setup();
    render(<TransportBar onModeToggle={onModeToggle} />);

    await user.click(screen.getByLabelText("Toggle pattern / song mode"));

    expect(onModeToggle).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default wiring and flips PAT -> SONG when no override is given", async () => {
    const user = userEvent.setup();
    render(<TransportBar />);

    const modeSwitch = screen.getByLabelText("Toggle pattern / song mode");
    expect(modeSwitch).toHaveTextContent("PAT");

    await user.click(modeSwitch);

    expect(modeSwitch).toHaveTextContent("SONG");
  });

  it("fires onTempoChange when the BPM spinner is used", async () => {
    const onTempoChange = vi.fn();
    const user = userEvent.setup();
    render(<TransportBar onTempoChange={onTempoChange} />);

    await user.click(screen.getByLabelText("Increase tempo"));

    expect(onTempoChange).toHaveBeenCalledWith(141);
  });

  it("greys out undo/redo while the command stack is empty", () => {
    render(<TransportBar />);
    expect(screen.getByLabelText("Undo")).toBeDisabled();
    expect(screen.getByLabelText("Redo")).toBeDisabled();
  });

  it("fires onUndo / onRedo callbacks once the stack has depth", async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const user = userEvent.setup();

    // Two edits then one undo leaves BOTH directions available, which is what
    // enables both buttons — they report the real stack now (SPEC §2.1).
    act(() => {
      const store = useAppStore.getState();
      store.dispatch(updateProject({ tempo: 150 }));
      store.dispatch(updateProject({ tempo: 160 }));
      useAppStore.getState().undo();
    });

    render(<TransportBar onUndo={onUndo} onRedo={onRedo} />);

    await user.click(screen.getByLabelText("Undo"));
    await user.click(screen.getByLabelText("Redo"));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("fires onSave / onExportWav / onExportJson callbacks", async () => {
    const onSave = vi.fn();
    const onExportWav = vi.fn();
    const onExportJson = vi.fn();
    const user = userEvent.setup();
    render(
      <TransportBar
        onSave={onSave}
        onExportWav={onExportWav}
        onExportJson={onExportJson}
      />,
    );

    await user.click(screen.getByText("Save"));
    await user.click(screen.getByText("Export WAV"));
    await user.click(screen.getByText("Export JSON"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onExportWav).toHaveBeenCalledTimes(1);
    expect(onExportJson).toHaveBeenCalledTimes(1);
  });

  it("adds a pattern and switches the selector to it", async () => {
    const user = userEvent.setup();
    render(<TransportBar />);

    expect(screen.getByTestId("pattern-selector")).toHaveTextContent(
      "Pattern 1",
    );

    await user.click(screen.getByLabelText("Add pattern"));

    expect(screen.getByTestId("pattern-selector")).toHaveTextContent(
      "Pattern 2",
    );
  });
});

/* --------------------------------------------- New / Load (arm + confirm) */

describe("New and Load arm before they fire", () => {
  it("needs two clicks, and the first only arms", async () => {
    const user = userEvent.setup();
    const onNewProject = vi.fn();
    render(<TransportBar onNewProject={onNewProject} />);

    const button = screen.getByTestId("new-project");
    expect(button).toHaveTextContent("New");
    expect(button).toHaveAttribute("data-armed", "false");

    await user.click(button);
    expect(onNewProject).not.toHaveBeenCalled();
    expect(button).toHaveTextContent("Sure?");
    expect(button).toHaveAttribute("data-armed", "true");

    await user.click(button);
    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(button).toHaveTextContent("New");
  });

  describe("with the clock under test control", () => {
    // Set up and torn down around EVERY test in this block, so a failing
    // assertion can never leave fake timers installed for the next file —
    // which is exactly how one broken test becomes eight timeouts.
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("disarms itself after the timeout rather than staying hot", async () => {
      const onNewProject = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TransportBar onNewProject={onNewProject} />);

      const button = screen.getByTestId("new-project");
      await user.click(button);
      expect(button).toHaveAttribute("data-armed", "true");

      await act(async () => {
        vi.advanceTimersByTime(ARM_TIMEOUT_MS + 10);
      });
      expect(button).toHaveAttribute("data-armed", "false");

      // A click on a disarmed button arms it again; it does not fire.
      await user.click(button);
      expect(onNewProject).not.toHaveBeenCalled();
    });
  });

  it("arming Load disarms New — only one destructive action is ever hot", async () => {
    const user = userEvent.setup();
    render(<TransportBar onNewProject={vi.fn()} onLoadProject={vi.fn()} />);

    await user.click(screen.getByTestId("new-project"));
    await user.click(screen.getByTestId("load-project"));

    expect(screen.getByTestId("new-project")).toHaveAttribute("data-armed", "false");
    expect(screen.getByTestId("load-project")).toHaveAttribute("data-armed", "true");
  });

  it("opens no browser dialog — nothing calls window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<TransportBar />);

    await user.click(screen.getByTestId("new-project"));
    await user.click(screen.getByTestId("new-project"));

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("really resets the project when confirmed through the default wiring", async () => {
    const user = userEvent.setup();
    render(<TransportBar />);
    await user.click(screen.getByLabelText("Add pattern"));
    expect(useAppStore.getState().project.patternOrder).toHaveLength(2);

    await user.click(screen.getByTestId("new-project"));
    await user.click(screen.getByTestId("new-project"));

    expect(useAppStore.getState().project.patternOrder).toHaveLength(1);
  });
});

/* ------------------------------------------------------------- notices --- */

describe("the toolbar status line", () => {
  it("exists as a live region before it has anything to say", () => {
    render(<TransportBar />);
    const notice = screen.getByTestId("toolbar-notice");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveAttribute("data-visible", "false");
  });

  it("shows a failed Save instead of looking like it worked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const user = userEvent.setup();
    render(<TransportBar />);

    await user.click(screen.getByText("Save"));

    const notice = await screen.findByTestId("toolbar-notice");
    expect(notice).toHaveAttribute("data-visible", "true");
    expect(notice).toHaveTextContent(/could not save/i);
    vi.restoreAllMocks();
  });
});

/* ------------------------------------------------------- F2 rename ------- */

describe("pattern rename (F2)", () => {
  it("swaps the name label for an input when the shell asks, and commits", async () => {
    const user = userEvent.setup();
    render(<TransportBar />);
    expect(screen.getByTestId("pattern-name")).toHaveTextContent("Pattern 1");

    act(() => requestPatternRename());

    const field = screen.getByTestId("pattern-rename");
    expect(field).toHaveValue("Pattern 1");
    await user.clear(field);
    await user.type(field, "Verse{Enter}");

    expect(useAppStore.getState().project.patterns[
      useAppStore.getState().project.activePatternId
    ]!.name).toBe("Verse");
    expect(screen.getByTestId("pattern-name")).toHaveTextContent("Verse");
  });

  it("Escape cancels without renaming", async () => {
    const user = userEvent.setup();
    render(<TransportBar />);
    act(() => requestPatternRename());

    await user.type(screen.getByTestId("pattern-rename"), "Nope{Escape}");

    expect(screen.getByTestId("pattern-name")).toHaveTextContent("Pattern 1");
  });
});

/* ---------------------------------------------------- tempo gestures ----- */

describe("tempo edits are one undo entry per gesture", () => {
  it("does not weld two separate spinner clicks into one entry", async () => {
    const user = userEvent.setup();
    render(<TransportBar />);

    await user.click(screen.getByLabelText("Increase tempo"));
    await user.click(screen.getByLabelText("Increase tempo"));

    expect(useAppStore.getState().history.past).toHaveLength(2);

    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().project.tempo).toBe(141);
  });

  /*
   * One PRESS opens two sessions here: the wrapper around the LCD owns the
   * tempo's undo identity (`tempoGesture`), the plate's own session owns the
   * persistence hold (`bpm-lcd`). The single-active-mutating-gesture
   * invariant must not read that as two gestures — pre-empting the wrapper
   * would leave `keyFor()` minting a fresh id on every pointermove, i.e. one
   * undo entry per pixel dragged (`@/lib/gestureHold`).
   */
  it("folds one LCD drag into one undo entry, both of its sessions notwithstanding", () => {
    render(<TransportBar />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(lcd, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(lcd, { clientY: 90, pointerId: 1 });
    fireEvent.pointerMove(lcd, { clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(lcd, { clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(lcd, { clientY: 70, pointerId: 1 });

    expect(useAppStore.getState().project.tempo).toBe(170);
    expect(useAppStore.getState().history.past).toHaveLength(1);

    // One Ctrl+Z takes the whole drag back.
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().project.tempo).toBe(140);
  });

  it("does not weld a second LCD drag onto the first", () => {
    render(<TransportBar />);
    const lcd = screen.getByTestId("bpm-lcd");
    const drag = (to: number) => {
      fireEvent.pointerDown(lcd, { clientY: 100, button: 0, pointerId: 1 });
      fireEvent.pointerMove(lcd, { clientY: to, pointerId: 1 });
      fireEvent.pointerUp(lcd, { clientY: to, pointerId: 1 });
    };

    drag(90);
    drag(80);

    expect(useAppStore.getState().history.past).toHaveLength(2);
  });
});

/* ------------------------------------------------- swing gesture class ---- */

/**
 * Round 8's class sweep, transport family. The swing slider had three of the
 * five holes at once: no persistence hold (rule a), no `pointercancel`
 * terminator (rule b), and — shared with the tempo LCD — ids from a source
 * that a remount could rewind (rule c). All three now come from
 * `useGestureSession` (`@/lib/gestureHold`).
 */
describe("TransportBar swing — the gesture class (round 8)", () => {
  function reset(): void {
    act(() => {
      useAppStore.setState({
        project: { ...useAppStore.getState().project, globalSwing: 0 },
        history: createHistory(),
        activeGestureIds: [],
      });
    });
    __resetGestureCounterForTests();
  }

  function slider(): HTMLElement {
    return screen.getByLabelText("Global swing");
  }

  function drag(values: number[]): void {
    fireEvent.pointerDown(slider(), { button: 0, buttons: 1, pointerId: 1 });
    for (const value of values) fireEvent.change(slider(), { target: { value: String(value) } });
  }

  beforeEach(reset);

  it("registers a persistence hold for the whole drag (rule a)", () => {
    render(<TransportBar />);

    drag([0.3]);
    // SPEC §2.2: an autosave flush coming due here must be deferred. Before
    // the sweep this slider took no hold at all, so a slow drag wrote
    // mid-gesture.
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerUp(slider(), { pointerId: 1 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("folds one drag into one undo entry", () => {
    render(<TransportBar />);

    drag([0.2, 0.4, 0.6]);
    fireEvent.pointerUp(slider(), { pointerId: 1 });

    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.6);
    expect(useAppStore.getState().history.past).toHaveLength(1);
  });

  it("releases the hold — and seals the entry — on pointercancel (rule b)", () => {
    render(<TransportBar />);

    drag([0.2]);
    fireEvent.pointerCancel(slider(), { pointerId: 1 });

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);

    // A later, unrelated change must not join the abandoned drag's entry.
    fireEvent.change(slider(), { target: { value: "0.5" } });
    fireEvent.blur(slider());
    expect(useAppStore.getState().history.past).toHaveLength(2);
  });

  it("releases the hold when the toolbar unmounts mid-drag (rule b)", () => {
    const view = render(<TransportBar />);

    drag([0.3]);
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    view.unmount();

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("does not weld a drag onto the previous MOUNT's drag (rule c)", () => {
    const first = render(<TransportBar />);
    drag([0.2]);
    fireEvent.pointerUp(slider(), { pointerId: 1 });
    first.unmount();

    render(<TransportBar />);
    drag([0.4]);
    fireEvent.pointerUp(slider(), { pointerId: 1 });

    // Two gestures, two entries — a component-local counter would have
    // re-minted the first mount's id and folded them into one.
    expect(useAppStore.getState().history.past).toHaveLength(2);
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.2);
  });

  /*
   * Round 9 #1. A keyboard edit used to `begin()` the session, and the only
   * terminator a keyboard gesture ever reaches is `blur`: arrow the slider
   * once, leave it focused, and autosave was deferred for as long as the
   * control kept focus — which is forever, if nothing else is clicked.
   */
  it("takes NO hold for a keyboard-only edit, so a focused slider cannot block autosave", () => {
    render(<TransportBar />);

    fireEvent.focus(slider());
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false); // focus alone does not
    fireEvent.change(slider(), { target: { value: "0.25" } });

    // The edit committed...
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.25);
    // ...and left nothing open behind it. Still focused, still no hold.
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("still folds a RUN of keyboard edits into one undo entry", () => {
    render(<TransportBar />);

    fireEvent.focus(slider());
    fireEvent.change(slider(), { target: { value: "0.1" } });
    fireEvent.change(slider(), { target: { value: "0.2" } });
    fireEvent.change(slider(), { target: { value: "0.3" } });

    expect(useAppStore.getState().history.past).toHaveLength(1);
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0);
  });

  it("does not fold a keyboard edit into the drag that just ended", () => {
    render(<TransportBar />);

    drag([0.2]);
    fireEvent.pointerUp(slider(), { pointerId: 1 });
    fireEvent.change(slider(), { target: { value: "0.5" } });

    expect(useAppStore.getState().history.past).toHaveLength(2);
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.2);
  });
});

/* -------------------------------------------- blur commits do not pre-empt */

/*
 * Round 14 #2. Every mutating gesture pre-empts the one in flight
 * (`@/lib/gestureHold`'s invariant) — except a BLUR COMMIT, which is the tail
 * of an editing session that has already ended.
 *
 * The event order is the browser's and cannot be worked around at the call
 * site: pressing a knob while the tempo box is focused delivers `pointerdown`
 * FIRST — the knob's session is open and registered — and `blur` only after.
 * A pre-empting commit therefore reached the registry one step too late and
 * ended the gesture the press had just opened, wiping its drag state under a
 * button the user was still holding. `registerExternalGesture` stands in for
 * that knob here: it is the same registry entry a `useGestureSession` makes.
 */
describe("a field's blur commit does not kill the gesture that caused the blur", () => {
  beforeEach(() => {
    __resetGestureCounterForTests();
    act(() => {
      useAppStore.setState({ history: createHistory() });
    });
  });

  function pressSomethingElse(): { end: ReturnType<typeof vi.fn>; unregister: () => void } {
    const end = vi.fn();
    const unregister = registerExternalGesture(end, { pointerId: 7 });
    return { end, unregister };
  }

  it("keeps the fresh gesture alive across a tempo commit that changed the value", () => {
    render(<TransportBar />);
    fireEvent.click(screen.getByText("140"), { detail: 1 });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "150" } });

    // The browser's order: the new press registers, THEN the field blurs.
    const { end, unregister } = pressSomethingElse();
    fireEvent.blur(input);

    expect(end).not.toHaveBeenCalled();
    expect(useAppStore.getState().project.tempo).toBe(150);
    unregister();
  });

  it("keeps it alive across a pattern-rename commit too", () => {
    render(<TransportBar />);
    act(() => requestPatternRename());
    const field = screen.getByTestId("pattern-rename");
    fireEvent.change(field, { target: { value: "Verse" } });

    const { end, unregister } = pressSomethingElse();
    fireEvent.blur(field);

    expect(end).not.toHaveBeenCalled();
    const state = useAppStore.getState();
    expect(state.project.patterns[state.project.activePatternId]!.name).toBe("Verse");
    unregister();
  });

  /*
   * The other half of the fix, and the one that makes the common case free: a
   * commit with nothing to say dispatches nothing at all, so it cannot reach
   * the registry however it is keyed.
   */
  it("dispatches nothing when the blurred field's value is unchanged", () => {
    render(<TransportBar />);
    const before = useAppStore.getState().history.past.length;
    fireEvent.click(screen.getByText("140"), { detail: 1 });

    const { end, unregister } = pressSomethingElse();
    fireEvent.blur(screen.getByRole("textbox"));

    expect(end).not.toHaveBeenCalled();
    expect(useAppStore.getState().history.past).toHaveLength(before);
    unregister();
  });

  /*
   * The exemption is for the COMMIT, not for the surface. A real spinner click
   * is a press, and a press still ends whatever gesture was open — through
   * `begin` on the wrapper, before the click handler runs at all — so the
   * invariant is untouched everywhere a pointer is actually involved.
   */
  it("still pre-empts when the tempo is changed by a real PRESS", () => {
    render(<TransportBar />);
    const { end, unregister } = pressSomethingElse();
    const spinner = screen.getByLabelText("Increase tempo");

    fireEvent.pointerDown(spinner, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(spinner, { button: 0, pointerId: 1 });
    fireEvent.click(spinner);

    expect(end).toHaveBeenCalled();
    expect(useAppStore.getState().project.tempo).toBe(141);
    unregister();
  });
});

/* -------------------------------------- presses that open nothing (r19) --- */

/*
 * Round 19 #2/#3. Both toolbar controls opened a persistence hold from a press
 * that nothing downstream was ever going to act on, and neither could hear the
 * release.
 *
 * The tempo plate's `onPointerDownCapture` fires for every press anywhere
 * inside it, including the ▲/▼ spinner and the type-in field — and neither of
 * those takes pointer capture (`BpmLcd` deliberately ignores them, and a
 * `<button>`/`<input>` does not capture on its own), so a press that drifts off
 * the plate before letting go delivered the wrapper's `onPointerUpCapture`
 * nothing at all. The swing slider is the same shape one step further out: a
 * native range takes implicit capture for a PRIMARY drag only, so its
 * `terminators` cover that release however far away it lands and cover nothing
 * at all for the right or middle button, which start no drag on it.
 */
describe("toolbar presses that cannot be released (round 19)", () => {
  function reset(): void {
    act(() => {
      useAppStore.setState({
        project: { ...useAppStore.getState().project, globalSwing: 0 },
        history: createHistory(),
        activeGestureIds: [],
      });
    });
    __resetGestureCounterForTests();
  }

  const held = (): boolean => selectHasActiveGesture(useAppStore.getState());

  beforeEach(reset);

  it("closes a spinner-opened tempo hold from the window when the release lands off the plate", () => {
    render(<TransportBar />);

    // The wrapper opens `tempo` for this press; the spinner takes no capture.
    fireEvent.pointerDown(screen.getByLabelText("Increase tempo"), { button: 0, pointerId: 1 });
    expect(held()).toBe(true);

    // Released 500px away: the plate hears nothing, the window backstop does.
    fireEvent.pointerUp(document.body, { pointerId: 1 });

    expect(held()).toBe(false);
  });

  it("closes a tempo hold opened by a press into the type-in field the same way", () => {
    render(<TransportBar />);
    fireEvent.click(screen.getByText("140"), { detail: 1 });
    const input = screen.getByRole("textbox");

    // A press into an open editor still opens the wrapper's session by design
    // (it is how the caret is placed without committing) — and a text-selection
    // drag that ends outside the plate takes no capture either.
    fireEvent.pointerDown(input, { button: 0, pointerId: 3 });
    expect(held()).toBe(true);

    fireEvent.pointerUp(document.body, { pointerId: 3 });

    expect(held()).toBe(false);
  });

  it("opens NO tempo gesture for a non-primary press on the plate", () => {
    render(<TransportBar />);
    const external = vi.fn();
    const unregister = registerExternalGesture(external, { pointerId: 7 });

    fireEvent.pointerDown(screen.getByTestId("bpm-lcd"), { button: 2, buttons: 2, pointerId: 1 });

    // Nothing held, and — the stricter half — nothing pre-empted: a right-press
    // that opens a session ENDS whatever gesture was running elsewhere, which
    // is a real edit lost for a button no tempo control acts on.
    expect(held()).toBe(false);
    expect(external).not.toHaveBeenCalled();
    unregister();
  });

  it.each([
    ["right", 2, 2],
    ["middle", 1, 4],
  ])("opens NO swing gesture for a %s press on the slider", (_name, button, buttons) => {
    render(<TransportBar />);
    const external = vi.fn();
    const unregister = registerExternalGesture(external, { pointerId: 7 });

    fireEvent.pointerDown(screen.getByLabelText("Global swing"), { button, buttons, pointerId: 1 });

    expect(held()).toBe(false);
    expect(external).not.toHaveBeenCalled();
    unregister();
  });

  /*
   * The backstop's own case, and the reason the primary filter alone is not
   * the whole fix. Chromium and WebKit both give a native range implicit
   * pointer capture for a primary drag, so the release comes home by itself
   * there; that is measured, not assumed, and it is measured on two engines
   * out of the three this could ship to. jsdom takes no implicit capture at
   * all, which makes this test the engine that does not — release off the
   * slider and only the window hears it.
   */
  it("closes a primary swing drag whose release lands off the slider", () => {
    render(<TransportBar />);
    const slider = screen.getByLabelText("Global swing");

    fireEvent.pointerDown(slider, { button: 0, buttons: 1, pointerId: 4 });
    fireEvent.change(slider, { target: { value: "0.4" } });
    expect(held()).toBe(true);

    fireEvent.pointerUp(document.body, { pointerId: 4 });

    expect(held()).toBe(false);
  });

  it("still opens — and still closes — a PRIMARY swing drag", () => {
    render(<TransportBar />);
    const slider = screen.getByLabelText("Global swing");

    fireEvent.pointerDown(slider, { button: 0, buttons: 1, pointerId: 1 });
    fireEvent.change(slider, { target: { value: "0.4" } });
    expect(held()).toBe(true);

    fireEvent.pointerUp(slider, { pointerId: 1 });

    expect(held()).toBe(false);
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.4);
    expect(useAppStore.getState().history.past).toHaveLength(1);
  });
});
