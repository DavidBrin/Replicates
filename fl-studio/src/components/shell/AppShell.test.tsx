import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

function pressGlobal(code: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { code, ...init });
}

import { act } from "react";

import { AppShell } from "./AppShell";
import { addNotes } from "@/domain/commands/patterns";
import { STORAGE_KEY, TICKS_PER_STEP } from "@/domain/types";
import { __resetKeyboardRegistryForTests } from "@/lib/keyboard";
import { useAppStore } from "@/lib/store";
import {
  __resetWiringForTests,
  peekTransportUi,
  startPlayback,
} from "@/components/shell/wiring";

afterEach(() => {
  __resetKeyboardRegistryForTests();
  __resetWiringForTests();
});

describe("SPEC §4.4 global bindings", () => {
  it("Ctrl+S saves and preventDefaults the browser's own save dialog", () => {
    render(<AppShell />);
    window.localStorage.removeItem(STORAGE_KEY);

    const event = new KeyboardEvent("keydown", {
      code: "KeyS",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("Ctrl+H panics: the transport stops", async () => {
    render(<AppShell />);
    await act(async () => {
      await startPlayback();
    });
    expect(peekTransportUi().isPlaying).toBe(true);

    act(() => pressGlobal("KeyH", { ctrlKey: true }));

    expect(peekTransportUi().isPlaying).toBe(false);
  });

  it("F4 moves to a fresh empty pattern once the current one has notes", () => {
    render(<AppShell />);
    const project = useAppStore.getState().project;
    act(() =>
      useAppStore.getState().dispatch(
        addNotes(project.activePatternId, [
          {
            id: "n-f4",
            channelId: project.channelOrder[0]!,
            positionTicks: 0,
            lengthTicks: TICKS_PER_STEP,
            pitch: 60,
            velocity: 0.8,
          },
        ]),
      ),
    );

    act(() => pressGlobal("F4"));

    const after = useAppStore.getState().project;
    expect(after.activePatternId).not.toBe(project.activePatternId);
    expect(Object.keys(after.patterns[after.activePatternId]!.notes)).toEqual([]);
  });

  it("F2 opens the toolbar's pattern-rename field", () => {
    render(<AppShell />);
    expect(screen.queryByTestId("pattern-rename")).not.toBeInTheDocument();

    act(() => pressGlobal("F2"));

    expect(screen.getByTestId("pattern-rename")).toBeInTheDocument();
  });

  it("no global binding fires while the BPM field is being typed in", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    const patternsBefore = useAppStore.getState().project.patternOrder.length;

    // Open the LCD's text input, then type a tempo containing a digit that is
    // also a mute shortcut and a key that is also a global binding.
    await user.click(screen.getByTestId("bpm-lcd").querySelector("span")!);
    const field = screen.getByTestId("bpm-lcd").querySelector("input")!;
    await user.clear(field);
    await user.type(field, "142");

    expect(field).toHaveValue("142");
    // `L` would have flipped the mode; F4 is not typeable, so the digits are
    // the real proof: none of them muted a channel or moved the transport.
    expect(peekTransportUi().isPlaying).toBe(false);
    expect(useAppStore.getState().project.patternOrder).toHaveLength(patternsBefore);
    expect(
      Object.values(useAppStore.getState().project.channels).some((channel) => channel.muted),
    ).toBe(false);
  });
});

describe("AppShell", () => {
  it("renders all four docked windows by default", () => {
    render(<AppShell />);
    expect(screen.getByText("Playlist")).toBeInTheDocument();
    expect(screen.getByText("Channel rack")).toBeInTheDocument();
    expect(screen.getByText("Mixer - return to new")).toBeInTheDocument();
  });

  it("F5 collapses and restores the Playlist window", () => {
    render(<AppShell />);
    expect(screen.getByText("Playlist")).toBeInTheDocument();

    pressGlobal("F5");
    expect(screen.queryByText("Playlist")).not.toBeInTheDocument();

    pressGlobal("F5");
    expect(screen.getByText("Playlist")).toBeInTheDocument();
  });

  it("F9 collapses and restores the Mixer window", () => {
    render(<AppShell />);
    expect(screen.getByText("Mixer - return to new")).toBeInTheDocument();

    pressGlobal("F9");
    expect(screen.queryByText("Mixer - return to new")).not.toBeInTheDocument();

    pressGlobal("F9");
    expect(screen.getByText("Mixer - return to new")).toBeInTheDocument();
  });

  it("F6/F7 switch the Channel Rack / Piano Roll tabbed region", () => {
    render(<AppShell />);
    expect(screen.getByText("Channel rack")).toBeInTheDocument();

    pressGlobal("F7");
    expect(screen.getByText("Piano roll - Untitled")).toBeInTheDocument();
    expect(screen.queryByText("Channel rack")).not.toBeInTheDocument();

    pressGlobal("F6");
    expect(screen.getByText("Channel rack")).toBeInTheDocument();
  });

  it("opens the Piano Roll on that channel when a rack channel name is clicked", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    // The rack tab is showing; clicking a channel's name button is SPEC §1.1's
    // "opens the Piano Roll for that channel" — a cross-surface action the
    // shell owns, since the tab is shell state.
    await user.click(screen.getByTestId("channel-name-ch-bass"));

    expect(await screen.findByText("Piano roll - Untitled")).toBeInTheDocument();
    expect(screen.queryByText("Channel rack")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Target channel" })).toHaveValue("ch-bass");
  });

  it("Space toggles play/stop via the global binding", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getByLabelText("Play")).toBeInTheDocument();

    await user.keyboard(" ");

    expect(await screen.findByLabelText("Stop")).toBeInTheDocument();
  });

  it("L toggles pattern/song mode via the global binding", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    const modeSwitch = screen.getByLabelText("Toggle pattern / song mode");
    expect(modeSwitch).toHaveTextContent("PAT");

    await user.keyboard("l");

    expect(modeSwitch).toHaveTextContent("SONG");
  });
});
