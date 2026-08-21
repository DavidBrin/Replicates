import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { updateProject } from "@/domain/commands";
import { useAppStore } from "@/lib/store";

import { TransportBar } from "./TransportBar";
import { __resetWiringForTests } from "@/components/shell/wiring";

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
