import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDefaultProject } from "@/domain/defaultProject";
import { resetIds } from "@/domain/ids";
import { createHistory } from "@/domain/undo";
import { MASTER_MIXER_TRACK_ID } from "@/domain/types";
import type { Project } from "@/domain/types";
import {
  __resetKeyboardRegistryForTests,
  attachKeyboardListener,
  registerBindings,
} from "@/lib/keyboard";
import { selectHasActiveGesture, useAppStore } from "@/lib/store";
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

  /*
   * Round 6 #9, the fader's half of the same hole the knob had: a cancelled
   * pointer never delivers `pointerup`, and the drag state left behind made
   * every later buttonless HOVER over the fader move the level.
   */
  it("stops dragging when the pointer is cancelled", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");

    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: 90 });
    const afterMove = useAppStore.getState().project.mixerTracks["mix-1"]!.volume;
    fireEvent.pointerCancel(fader, {});

    fireEvent.pointerMove(fader, { clientY: 10 }); // a hover, no button held

    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(afterMove);
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

/*
 * Round 7 #6. Every button opened a fader drag. A right-click on the fader
 * (whose context menu swallows the `pointerup`) or a middle press (the
 * browser's autoscroll, likewise) armed a gesture that then moved the level on
 * plain buttonless hover — the knob has guarded this since round 6.
 */
describe("Mixer — only the PRIMARY button drags a fader (round 7 #6)", () => {
  for (const [name, button] of [
    ["middle", 1],
    ["right", 2],
  ] as const) {
    it(`ignores a ${name}-button press and the move that follows it`, () => {
      render(<Mixer />);
      const fader = screen.getByTestId("fader-Insert 1 volume");
      const before = useAppStore.getState().project.mixerTracks["mix-1"]!.volume;

      fireEvent.pointerDown(fader, { clientY: 100, button });
      fireEvent.pointerMove(fader, { clientY: 20 });
      fireEvent.pointerUp(fader, { clientY: 20 });

      expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(before);
      expect(useAppStore.getState().history.past).toHaveLength(0);
    });
  }

  it("still drags on the primary button", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");

    fireEvent.pointerDown(fader, { clientY: 100, button: 0 });
    fireEvent.pointerMove(fader, { clientY: 60 });
    fireEvent.pointerUp(fader, { clientY: 60 });

    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBeGreaterThan(0.8);
  });
});

/*
 * Round 10 #1. The session ends from OUTSIDE the fader — an undo/redo/import
 * under the pointer, unmount, another gesture pre-empting this one — and the
 * `dragState` ref left behind is invisible to all of it. Every later pointer
 * MOVE (a hover, no button held) then dispatched the dead drag's `startValue`
 * and coalesce key into the replacement project.
 */
describe("Mixer — a fader's drag dies with its session (round 10 #1)", () => {
  it("stops tracking hovers after an undo replaces the project mid-drag", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");

    fireEvent.pointerDown(fader, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(fader, { clientY: 80, pointerId: 1 });
    const during = useAppStore.getState().project.mixerTracks["mix-1"]!.volume;
    expect(during).not.toBe(0.8);

    act(() => {
      useAppStore.getState().undo();
    });
    const afterUndo = useAppStore.getState().project.mixerTracks["mix-1"]!.volume;

    // The button is still down as far as the DOM is concerned, but this
    // gesture is over.
    fireEvent.pointerMove(fader, { clientY: 20, pointerId: 1 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(afterUndo);
  });

  it("stops tracking hovers after another gesture pre-empts it", () => {
    render(<Mixer />);
    const first = screen.getByTestId("fader-Insert 1 volume");
    const second = screen.getByTestId("fader-Insert 2 volume");

    fireEvent.pointerDown(first, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(first, { clientY: 80, pointerId: 1 });
    const parked = useAppStore.getState().project.mixerTracks["mix-1"]!.volume;

    // A second pointer opens a gesture: the invariant ends the first one.
    fireEvent.pointerDown(second, { clientY: 100, button: 0, pointerId: 2 });

    fireEvent.pointerMove(first, { clientY: 20, pointerId: 1 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(parked);
  });

  it("does not let a fader's Space reach the global registry (round 10 #7)", () => {
    const handler = vi.fn();
    __resetKeyboardRegistryForTests();
    const detach = attachKeyboardListener(window);
    registerBindings("shell:global", [{ id: "play", code: "Space", handler }]);
    render(<Mixer />);

    fireEvent.keyDown(screen.getByTestId("fader-Insert 1 volume"), { key: " ", code: "Space" });

    expect(handler).not.toHaveBeenCalled();
    // …and the fader's own reset still ran.
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(0.8);
    detach();
    __resetKeyboardRegistryForTests();
  });
});

describe("Mixer — a fader drag belongs to ONE pointer (round 12)", () => {
  it("ignores a stranger's move and release", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");

    fireEvent.pointerDown(fader, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(fader, { clientY: 90, pointerId: 1 });
    const owned = useAppStore.getState().project.mixerTracks["mix-1"]!.volume;
    // Deliberately short of the clamp, so a stranger's far-up move would be
    // visible if it were processed.
    expect(owned).toBeGreaterThan(0.8);
    expect(owned).toBeLessThan(1);

    // A second pointer, far up the track: neither its move nor its release
    // is this drag's.
    fireEvent.pointerMove(fader, { clientY: -10_000, pointerId: 9 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(owned);

    fireEvent.pointerUp(fader, { clientY: -10_000, pointerId: 9 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerUp(fader, { clientY: 90, pointerId: 1 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(owned);
  });
});

describe("Mixer — the mute LED goes through the gesture registry (round 12)", () => {
  it("pre-empts a fader drag left open elsewhere", () => {
    render(<Mixer />);
    fireEvent.pointerDown(screen.getByTestId("fader-Insert 1 volume"), {
      clientY: 100,
      pointerId: 1,
    });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.click(screen.getByTestId("mixer-strip-mute-mix-2"));

    // A bare dispatch leaves the drag — and its hold — open across the click.
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
    expect(useAppStore.getState().project.mixerTracks["mix-2"]!.muted).toBe(true);
  });
});

/*
 * Round 14 #4, the fader's half of the knob's rule: resetting a control that
 * is already at its default costs an undo entry that undoes nothing and a
 * persistence write with no change in it. Every strip starts at unity, so
 * double-clicking an untouched fader is the ordinary case.
 */
describe("a no-op fader edit dispatches nothing (round 14)", () => {
  it("records nothing when a fader already at unity is reset", () => {
    render(<Mixer />);
    const before = useAppStore.getState().history.past.length;

    fireEvent.doubleClick(screen.getByTestId("fader-Insert 1 volume"));

    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(0.8);
    expect(useAppStore.getState().history.past).toHaveLength(before);
  });

  it("records nothing for an arrow key held at the top of the throw", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");
    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: -10_000 });
    fireEvent.pointerUp(fader, { clientY: -10_000 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(1);
    const before = useAppStore.getState().history.past.length;

    fireEvent.keyDown(fader, { key: "ArrowUp" });
    fireEvent.keyDown(fader, { key: "ArrowUp" });

    expect(useAppStore.getState().history.past).toHaveLength(before);
  });

  it("still resets a fader that is OFF unity", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");
    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: 60 });
    fireEvent.pointerUp(fader, { clientY: 60 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).not.toBe(0.8);

    fireEvent.doubleClick(fader);

    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(0.8);
  });
});

/*
 * Round 15 #3. The one-shot paths (reset, arrow keys) already refused a no-op;
 * the DRAG path did not, and the drag is where the bound is easiest to hit —
 * a fader pushed to the top and held there reports 1 on every move. The first
 * of those repeats opened an undo entry that undoes nothing, and every one
 * after it was a store write and an autosave schedule for no change.
 */
describe("a fader DRAG past its bound dispatches nothing (round 15)", () => {
  it("files no undo entry for a press-and-drag entirely past the top", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");
    // Up to the ceiling and released, so the fader is now AT the bound.
    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: -10_000 });
    fireEvent.pointerUp(fader, { clientY: -10_000 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(1);
    const before = useAppStore.getState().history.past.length;

    // A second drag that never leaves the clamped region.
    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: 0 });
    fireEvent.pointerMove(fader, { clientY: -50 });
    fireEvent.pointerUp(fader, { clientY: -50 });

    expect(useAppStore.getState().history.past).toHaveLength(before);
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(1);
  });

  it("still tracks total travel once the pointer comes back in range", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");
    fireEvent.pointerDown(fader, { clientY: 100 });
    // Far past the top — suppressed — and then back down to a real level.
    fireEvent.pointerMove(fader, { clientY: -10_000 });
    fireEvent.pointerMove(fader, { clientY: 100 });
    fireEvent.pointerUp(fader, { clientY: 100 });

    // The anchor was never disturbed by the suppressed moves.
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(0.8);
  });

  it("keeps a drag that DOES move to exactly one undo entry", () => {
    render(<Mixer />);
    const fader = screen.getByTestId("fader-Insert 1 volume");
    const before = useAppStore.getState().history.past.length;

    fireEvent.pointerDown(fader, { clientY: 100 });
    fireEvent.pointerMove(fader, { clientY: 80 });
    fireEvent.pointerMove(fader, { clientY: -10_000 });
    fireEvent.pointerMove(fader, { clientY: -10_000 });
    fireEvent.pointerUp(fader, { clientY: -10_000 });

    expect(useAppStore.getState().history.past).toHaveLength(before + 1);
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.volume).toBe(1);
  });
});

describe("a pan KNOB drag past its bound dispatches nothing (round 15)", () => {
  it("files no undo entry for a drag that stays in the clamped region", () => {
    render(<Mixer />);
    const knob = screen.getByTestId("knob-Insert 1 pan");
    fireEvent.pointerDown(knob, { clientY: 100 });
    fireEvent.pointerMove(knob, { clientY: -10_000 });
    fireEvent.pointerUp(knob, { clientY: -10_000 });
    expect(useAppStore.getState().project.mixerTracks["mix-1"]!.pan).toBe(1);
    const before = useAppStore.getState().history.past.length;

    fireEvent.pointerDown(knob, { clientY: 100 });
    fireEvent.pointerMove(knob, { clientY: 0 });
    fireEvent.pointerMove(knob, { clientY: -80 });
    fireEvent.pointerUp(knob, { clientY: -80 });

    expect(useAppStore.getState().history.past).toHaveLength(before);
  });
});
