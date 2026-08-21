import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDefaultProject } from "@/domain/defaultProject";
import { resetIds } from "@/domain/ids";
import { createHistory } from "@/domain/undo";
import { MASTER_MIXER_TRACK_ID } from "@/domain/types";
import type { Project } from "@/domain/types";
import { useAppStore } from "@/lib/store";
import { Mixer } from "./Mixer";

/**
 * One store holds the domain AND this surface's UI slice now (SPEC §5's
 * composition), so the per-test reset puts the strip selection back too —
 * otherwise a selection would leak into the next case.
 */
function reset(project: Project = createDefaultProject({ now: "2026-01-01T00:00:00.000Z" })): void {
  useAppStore.setState({
    project,
    history: createHistory(),
    selectedMixerTrackId: MASTER_MIXER_TRACK_ID,
  });
}

beforeEach(() => {
  resetIds(0);
  reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Mixer — strips", () => {
  it("renders the Master strip and every insert strip from the project", () => {
    render(<Mixer />);
    const { mixerTrackOrder } = useAppStore.getState().project;

    expect(screen.getByTestId(`mixer-strip-${MASTER_MIXER_TRACK_ID}`)).toBeInTheDocument();
    for (const id of mixerTrackOrder) {
      expect(screen.getByTestId(`mixer-strip-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId(`mixer-strip-${MASTER_MIXER_TRACK_ID}`)).toHaveAttribute(
      "data-master",
      "true",
    );
  });
});

describe("Mixer — fader", () => {
  it("dragging a fader dispatches updateMixerTrack and clamps to [0, 1]", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");

    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: -10000 }); // far up → clamp at max
    fireEvent.pointerUp(fader, { clientY: -10000 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(1);

    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: 10000 }); // far down → clamp at min
    fireEvent.pointerUp(fader, { clientY: 10000 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(0);
  });

  it("double-click resets a fader to unity (0.8)", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");

    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: -60 });
    fireEvent.pointerUp(fader, { clientY: -60 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).not.toBe(0.8);

    fireEvent.doubleClick(fader);
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(0.8);
  });

  it("folds a whole fader drag into a single undo entry", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");
    const before = useAppStore.getState().project;

    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: 80 });
    fireEvent.pointerMove(fader, { clientY: 60 });
    fireEvent.pointerMove(fader, { clientY: 40 });
    fireEvent.pointerUp(fader, { clientY: 40 });

    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).not.toBe(
      before.mixerTracks["mix-1"]!.volume,
    );

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });

  it("marks the fader off-default when dragged away from unity", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");
    expect(fader).toHaveAttribute("data-off-default", "false");

    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: -60 });
    fireEvent.pointerUp(fader, { clientY: -60 });

    expect(fader).toHaveAttribute("data-off-default", "true");
  });
});

describe("Mixer — mute LED", () => {
  it("toggles MixerTrack.muted through updateMixerTrack", async () => {
    const user = userEvent.setup();
    render(<Mixer />);
    const led = screen.getByTestId("mixer-strip-mute-mix-1");
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.muted).toBe(false);

    await user.click(led);

    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.muted).toBe(true);
    expect(led).toHaveAttribute("data-muted", "true");

    await user.click(led);
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.muted).toBe(false);
  });

  it("reports the mute state to assistive tech: pressed === muted, and the label flips", async () => {
    const user = userEvent.setup();
    render(<Mixer />);
    const led = screen.getByTestId("mixer-strip-mute-mix-1");

    expect(led).toHaveAttribute("aria-pressed", "false");
    expect(led).toHaveAccessibleName("Mute Insert 1");

    await user.click(led);

    expect(led).toHaveAttribute("aria-pressed", "true");
    expect(led).toHaveAccessibleName("Unmute Insert 1");
  });
});

describe("Mixer — strip selection", () => {
  it("selects a strip on click and marks it selected, deselecting the previous one", async () => {
    const user = userEvent.setup();
    render(<Mixer />);

    await user.click(screen.getByTestId("mixer-strip-name-mix-1"));

    expect(screen.getByTestId("mixer-strip-mix-1")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId(`mixer-strip-${MASTER_MIXER_TRACK_ID}`)).toHaveAttribute(
      "data-selected",
      "false",
    );
  });

  it("keeps the selection in the composed store, not in local component state", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Mixer />);

    await user.click(screen.getByTestId("mixer-strip-name-mix-2"));
    expect(useAppStore.getState().selectedMixerTrackId).toBe("mix-2");

    // Remounting must not forget it — which a `useState` fallback would.
    unmount();
    render(<Mixer />);
    expect(screen.getByTestId("mixer-strip-mix-2")).toHaveAttribute("data-selected", "true");
  });
});

describe("Mixer — pan knob", () => {
  it("dragging the pan knob dispatches updateMixerTrack and clamps to [-1, 1]", () => {
    render(<Mixer />);
    const knob = screen.getByTestId("knob-Insert 1 pan");

    fireEvent.pointerDown(knob, { clientY: 100 });
    fireEvent.pointerMove(knob, { clientY: -10000 });
    fireEvent.pointerUp(knob, { clientY: -10000 });

    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.pan).toBe(1);
  });
});
