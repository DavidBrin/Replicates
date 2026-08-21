import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { updateProject } from "@/domain/commands";
import { useAppStore } from "@/lib/store";

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
});
