import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { updateProject } from "@/domain/commands";
import { createDefaultProject } from "@/domain/defaultProject";
import { resetIds } from "@/domain/ids";
import { createHistory } from "@/domain/undo";
import { TICKS_PER_STEP, type Project } from "@/domain/types";
import { __resetGestureCounterForTests, registerExternalGesture } from "@/lib/gestureHold";
import {
  __resetKeyboardRegistryForTests,
  attachKeyboardListener,
  registerBindings,
} from "@/lib/keyboard";
import { selectHasActiveGesture, useAppStore } from "@/lib/store";
import { ChannelRack } from "./ChannelRack";
import { stepHueGroup } from "./StepCell";

function reset(project: Project = createDefaultProject({ now: "2026-01-01T00:00:00.000Z" })): void {
  useAppStore.setState({ project, history: createHistory() });
}

beforeEach(() => {
  resetIds(0);
  reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function kickStep(step: number) {
  return screen.getByTestId(`channel-row-ch-kick`).querySelector(`[data-testid="step-${step}"]`) as HTMLElement;
}

describe("ChannelRack — step grid", () => {
  it("left-click on an off step dispatches a command that adds a zero-length note", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);

    const cell = kickStep(0);
    expect(cell).toHaveAttribute("data-on", "false");

    await user.click(cell);

    expect(cell).toHaveAttribute("data-on", "true");
    const notes = Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ channelId: "ch-kick", positionTicks: 0, lengthTicks: 0 });
  });

  it("left-click on an on step dispatches a command that removes the note", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);

    const cell = kickStep(2);
    await user.click(cell); // on
    expect(cell).toHaveAttribute("data-on", "true");

    await user.click(cell); // off again
    expect(cell).toHaveAttribute("data-on", "false");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });

  it("right-click deletes without toggling an off cell on", () => {
    render(<ChannelRack />);
    const cell = kickStep(5);

    fireEvent.contextMenu(cell, { buttons: 2 });
    fireEvent.pointerUp(cell);

    expect(cell).toHaveAttribute("data-on", "false");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });

  it("right-click deletes an on step", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const cell = kickStep(3);
    await user.click(cell);
    expect(cell).toHaveAttribute("data-on", "true");

    // `userEvent`'s click above pressed pointer 1, so that is the pointer the
    // sweep belongs to and the pointer whose release commits it — a stroke is
    // scoped to its own press (`ChannelRackRow`'s `PaintSession.pointerId`).
    fireEvent.contextMenu(cell, { buttons: 2 });
    fireEvent.pointerUp(cell, { pointerId: 1 });

    expect(cell).toHaveAttribute("data-on", "false");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });

  it("undo restores the exact prior project after a step toggle", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const cell = kickStep(9);
    const before = useAppStore.getState().project;

    await user.click(cell);
    expect(useAppStore.getState().project).not.toEqual(before);

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });

  it("drag-paints steps on across a pointer drag, committing one command on release", () => {
    render(<ChannelRack />);
    const cells = [0, 1, 2, 3].map((s) => kickStep(s));
    const before = useAppStore.getState().project;

    fireEvent.pointerDown(cells[0]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[1]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[2]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[3]!, { buttons: 1 });

    // Visual feedback is live mid-drag, before the store has the notes yet.
    for (const cell of cells) expect(cell).toHaveAttribute("data-on", "true");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);

    fireEvent.pointerUp(cells[3]!);

    const notes = Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes);
    expect(notes).toHaveLength(4);

    // The whole paint stroke commits (and therefore undoes) as one entry.
    useAppStore.getState().undo();
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
    expect(useAppStore.getState().project).toEqual(before);
  });

  it("drag-paints steps off when the stroke starts on a lit cell", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const cells = [4, 5, 6].map((s) => kickStep(s));
    for (const cell of cells) await user.click(cell); // turn all three on first

    fireEvent.pointerDown(cells[0]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[1]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[2]!, { buttons: 1 });
    fireEvent.pointerUp(cells[2]!);

    for (const cell of cells) expect(cell).toHaveAttribute("data-on", "false");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });

  it("re-entering an already-painted cell in the same stroke is a no-op", () => {
    render(<ChannelRack />);
    const [a, b] = [kickStep(0), kickStep(1)];

    fireEvent.pointerDown(a, { buttons: 1 });
    fireEvent.pointerEnter(b, { buttons: 1 });
    fireEvent.pointerEnter(a, { buttons: 1 }); // re-enter the origin cell
    fireEvent.pointerUp(a);

    expect(a).toHaveAttribute("data-on", "true"); // stays on, not toggled back off
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(2);
  });

  it("right-click-drag deletes multiple lit steps", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const cells = [0, 1, 2].map((s) => kickStep(s));
    for (const cell of cells) await user.click(cell); // turn all three on first

    fireEvent.contextMenu(cells[0]!, { buttons: 2 });
    fireEvent.pointerEnter(cells[1]!, { buttons: 2, pointerId: 1 });
    fireEvent.pointerEnter(cells[2]!, { buttons: 2, pointerId: 1 });
    fireEvent.pointerUp(cells[2]!, { pointerId: 1 });

    for (const cell of cells) expect(cell).toHaveAttribute("data-on", "false");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });
});

describe("a paint stroke belongs to the press that opened it (round 11 #3)", () => {
  function rowStep(channelId: string, step: number) {
    return screen
      .getByTestId(`channel-row-${channelId}`)
      .querySelector(`[data-testid="step-${step}"]`) as HTMLElement;
  }

  function noteCount(): number {
    return Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes).length;
  }

  it("ignores a release by SOME OTHER pointer, and commits on its own", () => {
    /*
     * The window backstop hears every pointer in the document — a second
     * finger lifting, a stylus the app never saw. Unfiltered, that release
     * committed the stroke from under the still-pressed button that owns it,
     * so the rest of the sweep landed in a second undo entry.
     */
    render(<ChannelRack />);
    const entriesBefore = useAppStore.getState().history.past.length;

    fireEvent.pointerDown(rowStep("ch-kick", 0), { buttons: 1, pointerId: 1 });
    fireEvent.pointerEnter(rowStep("ch-kick", 1), { buttons: 1, pointerId: 1 });

    // A different pointer's release: not this stroke's end.
    fireEvent.pointerUp(window, { pointerId: 7 });
    expect(useAppStore.getState().history.past).toHaveLength(entriesBefore);
    expect(noteCount()).toBe(0);

    // The stroke is still live and still painting.
    fireEvent.pointerEnter(rowStep("ch-kick", 2), { buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(noteCount()).toBe(3);
    expect(useAppStore.getState().history.past).toHaveLength(entriesBefore + 1);
  });

  it("commits the row it leaves when an erase sweep crosses into the next row", async () => {
    /*
     * Round 11 #3's data loss. Each row buffers its own stroke, so entering
     * the next row opens a second one — and that second `hold()` used to
     * PRE-EMPT the first, whose `onCancel` threw the buffer away. Every cell
     * erased in the row the sweep started in came back.
     *
     * The rule now is: one press, two buffers, both committed (see
     * `ChannelRackRow`'s "Crossing rows mid-stroke").
     */
    const user = userEvent.setup();
    render(<ChannelRack />);
    await user.click(rowStep("ch-kick", 0));
    await user.click(rowStep("ch-clap", 1));
    expect(noteCount()).toBe(2);

    fireEvent.contextMenu(rowStep("ch-kick", 0), { buttons: 2 });
    fireEvent.pointerEnter(rowStep("ch-clap", 1), { buttons: 2, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(noteCount()).toBe(0);
  });
});

describe("a paint stroke belongs to ONE pointer (round 12)", () => {
  function rowStep(channelId: string, step: number) {
    return screen
      .getByTestId(`channel-row-${channelId}`)
      .querySelector(`[data-testid="step-${step}"]`) as HTMLElement;
  }

  function noteCount(): number {
    return Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes).length;
  }

  it("does not let a SECOND pointer paint into the first one's stroke", () => {
    /*
     * The stroke was reused whenever its MODE matched, whoever was pressing:
     * a second finger sweeping the same row filled the owner's buffer, the
     * owner's release committed it, and everything the second pointer painted
     * afterwards belonged to a stroke that had already ended.
     */
    render(<ChannelRack />);

    fireEvent.pointerDown(rowStep("ch-kick", 0), { buttons: 1, pointerId: 1 });
    // A different pointer, same "on" mode: a different gesture.
    fireEvent.pointerEnter(rowStep("ch-kick", 5), { buttons: 1, pointerId: 2 });

    fireEvent.pointerUp(window, { pointerId: 1 });

    // Only the owner's cell. With the pointer left out of the session's
    // identity this is 2 — the intruder's cell rides along.
    expect(noteCount()).toBe(1);
    expect(
      Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes).map(
        (note) => note.positionTicks,
      ),
    ).toEqual([0]);
  });

  it("a new pointer taking the row over still paints (the onCancel ordering bug)", () => {
    /*
     * Round 12's class fix, at the surface that showed it. Pointer 1's stroke
     * leaks (its release never arrives). Pointer 2 then presses the same row:
     * the row installed its new `PaintSession` FIRST and then called `hold()`,
     * whose pre-emption of pointer 1's session ran this row's `onCancel` —
     * `cancelPaint`, which nulls `painting.current`. It nulled the session
     * that had just been installed, so pointer 2's stroke painted nothing and
     * committed nothing: the row went dead under a live press.
     */
    render(<ChannelRack />);

    // Press 1 leaks: no release ever reaches the row or the window.
    fireEvent.pointerDown(rowStep("ch-kick", 0), { buttons: 1, pointerId: 1 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    // Press 2 — a different pointer on the SAME row, which is what makes the
    // row tear the old stroke down and install a new one.
    fireEvent.pointerDown(rowStep("ch-kick", 5), { buttons: 1, pointerId: 2 });
    fireEvent.pointerEnter(rowStep("ch-kick", 6), { buttons: 1, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    const positions = Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)
      .filter((note) => note.channelId === "ch-kick")
      .map((note) => note.positionTicks)
      .sort((a, b) => a - b);
    // Pointer 2's two cells — and NOT pointer 1's, whose buffer went with its
    // pre-empted session.
    expect(positions).toEqual([5 * TICKS_PER_STEP, 6 * TICKS_PER_STEP]);
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });
});

describe("ChannelRack — cool/warm hue alternation (lane 1 §2.4)", () => {
  it("groups steps 1-4 and 9-12 (0-based 0-3, 8-11) as cool", () => {
    for (const step of [0, 1, 2, 3, 8, 9, 10, 11]) {
      expect(stepHueGroup(step)).toBe("cool");
    }
  });

  it("groups steps 5-8 and 13-16 (0-based 4-7, 12-15) as warm", () => {
    for (const step of [4, 5, 6, 7, 12, 13, 14, 15]) {
      expect(stepHueGroup(step)).toBe("warm");
    }
  });

  it("renders the data-group attribute per cell matching the hue grouping", () => {
    render(<ChannelRack />);
    for (let step = 0; step < 16; step += 1) {
      expect(kickStep(step)).toHaveAttribute("data-group", stepHueGroup(step));
    }
  });
});

describe("ChannelRack — mute LED", () => {
  it("toggles Channel.muted through updateChannel", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const led = screen.getByTestId("mute-led-ch-kick");
    expect(useAppStore.getState().project.channels["ch-kick"]!.muted).toBe(false);

    await user.click(led);

    expect(useAppStore.getState().project.channels["ch-kick"]!.muted).toBe(true);
    expect(led).toHaveAttribute("data-muted", "true");

    await user.click(led);
    expect(useAppStore.getState().project.channels["ch-kick"]!.muted).toBe(false);
  });

  it("aria-pressed reflects the muted state, and the label flips Mute/Unmute", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const led = screen.getByTestId("mute-led-ch-kick");

    expect(led).toHaveAttribute("aria-pressed", "false");
    expect(led).toHaveAccessibleName("Mute Kick");

    await user.click(led);

    expect(led).toHaveAttribute("aria-pressed", "true");
    expect(led).toHaveAccessibleName("Unmute Kick");
  });
});

/**
 * Round 6 #2. A paint stroke buffers its commands and dispatches them on
 * pointer-up, and the buffer names the pattern it was built against. The
 * pattern can go away while the button is still down — `Ctrl+Z` undoing the
 * pattern's creation is the reachable case — and the commit then dispatched
 * `addNotes` against an id that no longer exists, throwing `CommandError` out
 * of a pointer handler. A stroke whose pattern is gone is abandoned instead.
 */
describe("ChannelRack — a stroke whose pattern disappears mid-drag", () => {
  function twoPatternProject(): Project {
    const base = createDefaultProject({ now: "2026-01-01T00:00:00.000Z" });
    const first = base.patterns[base.activePatternId]!;
    const second = { ...first, id: "pat-2", name: "Pattern 2", notes: {} };
    return {
      ...base,
      patterns: { ...base.patterns, "pat-2": second },
      patternOrder: [...base.patternOrder, "pat-2"],
      activePatternId: "pat-2",
    };
  }

  /** Drop `pat-2` and fall back to `pat-1`, exactly as undoing its creation would. */
  function destroyActivePattern(): void {
    act(() => {
      useAppStore.setState((state) => {
        const patterns = { ...state.project.patterns };
        delete patterns["pat-2"];
        return {
          project: {
            ...state.project,
            patterns,
            patternOrder: state.project.patternOrder.filter((id) => id !== "pat-2"),
            activePatternId: "pat-1",
          },
        };
      });
    });
  }

  it("dispatches nothing at all when the stroke is released", () => {
    reset(twoPatternProject());
    render(<ChannelRack />);
    const cells = [0, 1, 2].map((s) => kickStep(s));

    fireEvent.pointerDown(cells[0]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[1]!, { buttons: 1 });

    destroyActivePattern();

    // The dispatch is spied *after* the pattern dies, so the only call it can
    // see is the commit. jsdom swallows an exception thrown inside an event
    // listener, so "did it throw?" is not an assertion this can make — "did it
    // dispatch a command naming a dead pattern?" is the same question asked
    // where the answer is observable.
    const real = useAppStore.getState().dispatch;
    const dispatch = vi.fn(real);
    act(() => {
      useAppStore.setState({ dispatch });
    });
    try {
      fireEvent.pointerUp(window);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      act(() => {
        useAppStore.setState({ dispatch: real });
      });
    }
    // …and nothing landed on the pattern that survived, either.
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });

  it("leaves no optimistic preview painted over the pattern that replaced it", () => {
    reset(twoPatternProject());
    render(<ChannelRack />);
    const cells = [0, 1, 2].map((s) => kickStep(s));

    fireEvent.pointerDown(cells[0]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[1]!, { buttons: 1 });
    expect(kickStep(0)).toHaveAttribute("data-on", "true");

    destroyActivePattern();

    for (const step of [0, 1, 2]) expect(kickStep(step)).toHaveAttribute("data-on", "false");
  });

  it("starts a clean stroke on the new pattern instead of extending the dead one", () => {
    reset(twoPatternProject());
    render(<ChannelRack />);

    fireEvent.pointerDown(kickStep(0), { buttons: 1 });
    destroyActivePattern();

    // A fresh press on the surviving pattern behaves like any other stroke.
    fireEvent.pointerDown(kickStep(5), { buttons: 1 });
    fireEvent.pointerUp(kickStep(5));

    const notes = Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ channelId: "ch-kick", positionTicks: 5 * TICKS_PER_STEP });
  });
});

describe("ChannelRack — paint stroke released outside the row", () => {
  it("still commits the stroke via a window-level pointerup backstop", () => {
    render(<ChannelRack />);
    const cells = [0, 1, 2].map((s) => kickStep(s));

    fireEvent.pointerDown(cells[0]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[1]!, { buttons: 1 });
    fireEvent.pointerEnter(cells[2]!, { buttons: 1 });

    // The pointer left the row without a pointerup ever landing on it —
    // released somewhere else on the page (or outside the window entirely).
    fireEvent.pointerUp(window);

    const notes = Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes);
    expect(notes).toHaveLength(3);
  });

  it("a stroke that commits normally does not leave a stray global listener double-firing", () => {
    render(<ChannelRack />);
    const cell = kickStep(0);
    const before = useAppStore.getState().project;

    fireEvent.pointerDown(cell, { buttons: 1 });
    fireEvent.pointerUp(cell);
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(1);

    // A later, unrelated pointerup anywhere on the page must not re-fire the
    // (already-committed, already-cleared) stroke.
    fireEvent.pointerUp(window);
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(1);

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });
});

describe("a knob drag belongs to ONE pointer (round 12)", () => {
  it("ignores a move and a release from a pointer that does not own the drag", () => {
    /*
     * The drag machine only ever asked "is a drag open?", never "is this the
     * pointer that opened it?". A second finger's move drove the value from
     * the OWNER's anchor — a jump to wherever that finger was — and its
     * release sealed the undo entry with the owning button still down, so the
     * rest of the drag landed in a second Ctrl+Z.
     */
    render(<ChannelRack />);
    const knob = screen.getByTestId("knob-Kick volume");
    const entriesBefore = useAppStore.getState().history.past.length;

    fireEvent.pointerDown(knob, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(knob, { clientY: 40, pointerId: 1 });
    const afterOwner = useAppStore.getState().project.channels["ch-kick"]!.volume;
    expect(afterOwner).toBeGreaterThan(0.8);

    // A stranger's move: no effect at all.
    fireEvent.pointerMove(knob, { clientY: 10_000, pointerId: 9 });
    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(afterOwner);

    // A stranger's release: the drag is still open and still coalescing.
    fireEvent.pointerUp(knob, { clientY: 10_000, pointerId: 9 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerMove(knob, { clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(knob, { clientY: 20, pointerId: 1 });

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
    // ONE undo entry for the whole drag — the stranger's release did not
    // split it in two.
    expect(useAppStore.getState().history.past).toHaveLength(entriesBefore + 1);
  });
});

describe("ChannelRack — knobs", () => {
  it("clamps a volume drag to [0, 1] and dispatches updateChannel", () => {
    render(<ChannelRack />);
    const knob = screen.getByTestId("knob-Kick volume");

    fireEvent.pointerDown(knob, { clientY: 100 });
    // Drag far up — should clamp at max (1), never overshoot.
    fireEvent.pointerMove(knob, { clientY: -10000 });
    fireEvent.pointerUp(knob, { clientY: -10000 });

    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(1);

    fireEvent.pointerDown(knob, { clientY: 100 });
    // Drag far down — should clamp at min (0).
    fireEvent.pointerMove(knob, { clientY: 10000 });
    fireEvent.pointerUp(knob, { clientY: 10000 });

    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(0);
  });

  it("double-click resets a knob to its default value", () => {
    render(<ChannelRack />);
    const panKnob = screen.getByTestId("knob-Kick pan");

    fireEvent.pointerDown(panKnob, { clientY: 100 });
    fireEvent.pointerMove(panKnob, { clientY: -60 });
    fireEvent.pointerUp(panKnob, { clientY: -60 });
    expect(useAppStore.getState().project.channels["ch-kick"]!.pan).not.toBe(0);

    fireEvent.doubleClick(panKnob);

    expect(useAppStore.getState().project.channels["ch-kick"]!.pan).toBe(0);
  });

  it("alt+click resets a knob to its default value", () => {
    render(<ChannelRack />);
    const volumeKnob = screen.getByTestId("knob-Kick volume");

    fireEvent.pointerDown(volumeKnob, { clientY: 100 });
    fireEvent.pointerMove(volumeKnob, { clientY: -60 });
    fireEvent.pointerUp(volumeKnob, { clientY: -60 });
    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).not.toBe(0.8);

    fireEvent.pointerDown(volumeKnob, { altKey: true });

    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(0.8);
  });

  /*
   * Round 6 #7. SPEC §4.4: "Alt+click (or middle-click) knob | reset to
   * default". Only Alt+click and double-click were wired.
   */
  it("middle-click resets a knob to its default value", () => {
    render(<ChannelRack />);
    const volumeKnob = screen.getByTestId("knob-Kick volume");

    fireEvent.pointerDown(volumeKnob, { clientY: 100, button: 0 });
    fireEvent.pointerMove(volumeKnob, { clientY: 60 });
    fireEvent.pointerUp(volumeKnob, { clientY: 60 });
    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).not.toBe(0.8);

    fireEvent.pointerDown(volumeKnob, { button: 1 });

    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(0.8);
  });

  it("does not start a drag from the middle button that reset it", () => {
    render(<ChannelRack />);
    const volumeKnob = screen.getByTestId("knob-Kick volume");

    fireEvent.pointerDown(volumeKnob, { clientY: 100, button: 1 });
    fireEvent.pointerMove(volumeKnob, { clientY: -500 });

    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(0.8);
  });

  /*
   * Round 6 #8. SPEC §4.4: "Ctrl-drag = fine". Read per MOVE, not per
   * gesture, so the modifier can be taken and released mid-drag.
   */
  describe("Ctrl-drag is fine adjustment", () => {
    function dragVolume(steps: { y: number; ctrlKey?: boolean }[]): number {
      const knob = screen.getByTestId("knob-Kick volume");
      fireEvent.pointerDown(knob, { clientY: 100, button: 0 });
      for (const step of steps) {
        fireEvent.pointerMove(knob, { clientY: step.y, ctrlKey: step.ctrlKey ?? false });
      }
      fireEvent.pointerUp(knob, { clientY: steps[steps.length - 1]!.y });
      return useAppStore.getState().project.channels["ch-kick"]!.volume;
    }

    it("moves a tenth as far as the same drag without Ctrl", () => {
      render(<ChannelRack />);
      const coarse = dragVolume([{ y: 88 }]); // 12 px up over a 120 px travel
      expect(coarse).toBeCloseTo(0.9, 5);

      act(() => reset());
      const fine = dragVolume([{ y: 88, ctrlKey: true }]);
      expect(fine).toBeCloseTo(0.81, 5);
    });

    it("resumes coarse travel from where the fine pass left the knob", () => {
      render(<ChannelRack />);
      // 12 px fine (+0.01), then 12 px more coarse (+0.1) — NOT 24 px coarse
      // from the start, which is what re-deriving from the origin would give.
      const value = dragVolume([{ y: 88, ctrlKey: true }, { y: 76 }]);
      expect(value).toBeCloseTo(0.91, 5);
    });
  });

  /*
   * Round 6 #9. A cancelled pointer never delivers `pointerup`; the drag left
   * behind turned later buttonless hovers into value changes.
   */
  it("stops dragging a knob when the pointer is cancelled", () => {
    render(<ChannelRack />);
    const knob = screen.getByTestId("knob-Kick volume");

    fireEvent.pointerDown(knob, { clientY: 100, button: 0 });
    fireEvent.pointerMove(knob, { clientY: 94 });
    const afterMove = useAppStore.getState().project.channels["ch-kick"]!.volume;
    fireEvent.pointerCancel(knob, {});

    fireEvent.pointerMove(knob, { clientY: 10 }); // a hover, no button held

    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(afterMove);
  });

  it("folds a whole knob drag into a single undo entry", () => {
    render(<ChannelRack />);
    const knob = screen.getByTestId("knob-Kick volume");
    const before = useAppStore.getState().project;

    fireEvent.pointerDown(knob, { clientY: 100 });
    fireEvent.pointerMove(knob, { clientY: 80 });
    fireEvent.pointerMove(knob, { clientY: 60 });
    fireEvent.pointerMove(knob, { clientY: 40 });
    fireEvent.pointerUp(knob, { clientY: 40 });

    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).not.toBe(before.channels["ch-kick"]!.volume);

    useAppStore.getState().undo();

    expect(useAppStore.getState().project).toEqual(before);
  });
});

describe("ChannelRack — channel selection / open piano roll", () => {
  it("selecting a channel via the name button fires onSelectChannel and onOpenPianoRoll", async () => {
    const onSelectChannel = vi.fn();
    const onOpenPianoRoll = vi.fn();
    const user = userEvent.setup();
    render(<ChannelRack onSelectChannel={onSelectChannel} onOpenPianoRoll={onOpenPianoRoll} />);

    await user.click(screen.getByTestId("channel-name-ch-kick"));

    expect(onSelectChannel).toHaveBeenCalledWith("ch-kick");
    expect(onOpenPianoRoll).toHaveBeenCalledWith("ch-kick");
  });

  it("marks the row selected after a name-button click even without the store slice registered", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);

    await user.click(screen.getByTestId("channel-name-ch-kick"));

    expect(screen.getByTestId("channel-row-ch-kick")).toHaveAttribute("data-selected", "true");
  });
});

describe("ChannelRack — rack swing coalescing", () => {
  it("mints a fresh coalesce key per drag gesture, so two separate drags are two undo entries", () => {
    render(<ChannelRack />);
    const slider = screen.getByLabelText("Rack swing");
    const before = useAppStore.getState().project;

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.2" } });
    fireEvent.pointerUp(slider);
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.2);

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.5" } });
    fireEvent.pointerUp(slider);
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.5);

    // One undo should only unwind the *second* drag, not both at once.
    useAppStore.getState().undo();
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.2);

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });

  it("folds multiple change events within one drag into a single undo entry", () => {
    render(<ChannelRack />);
    const slider = screen.getByLabelText("Rack swing");
    const before = useAppStore.getState().project;

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.1" } });
    fireEvent.change(slider, { target: { value: "0.3" } });
    fireEvent.change(slider, { target: { value: "0.6" } });
    fireEvent.pointerUp(slider);

    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.6);
    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });
});

describe("ChannelRack — mixer routing box", () => {
  it("cycles routedToMixerTrackId forward on click", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    expect(useAppStore.getState().project.channels["ch-kick"]!.routedToMixerTrackId).toBe("master");

    await user.click(screen.getByTestId("routing-ch-kick"));

    expect(useAppStore.getState().project.channels["ch-kick"]!.routedToMixerTrackId).toBe("mix-1");
  });
});

describe("ChannelRack — add channel", () => {
  it("opens a voice-kind picker and appends a new channel via addChannel", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const before = useAppStore.getState().project.channelOrder.length;

    await user.click(screen.getByTestId("channel-add-button"));
    await user.click(screen.getByRole("menuitem", { name: "Snare" }));

    const order = useAppStore.getState().project.channelOrder;
    expect(order).toHaveLength(before + 1);
    const added = useAppStore.getState().project.channels[order.at(-1)!]!;
    expect(added).toMatchObject({ name: "Snare", voice: "snare" });
  });

  it("undoes an added channel as one entry", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const before = useAppStore.getState().project;

    await user.click(screen.getByTestId("channel-add-button"));
    await user.click(screen.getByRole("menuitem", { name: "Lead" }));
    expect(useAppStore.getState().project).not.toEqual(before);

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });
});

describe("ChannelRack — channel context menu (rename/recolor/delete/reorder)", () => {
  it("opens on right-click and renames the channel via updateChannel", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);

    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-kick"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByTestId("channel-rename-ch-kick");
    await user.clear(input);
    await user.type(input, "808 Kick{Enter}");

    expect(useAppStore.getState().project.channels["ch-kick"]!.name).toBe("808 Kick");
    expect(screen.getByTestId("channel-name-ch-kick")).toHaveTextContent("808 Kick");
  });

  it("Escape cancels a rename without dispatching", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);

    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-kick"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByTestId("channel-rename-ch-kick");
    await user.clear(input);
    await user.type(input, "Nope{Escape}");

    expect(useAppStore.getState().project.channels["ch-kick"]!.name).toBe("Kick");
  });

  it("recolors the channel through updateChannel", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const before = useAppStore.getState().project.channels["ch-kick"]!.color;

    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-kick"));
    await user.click(screen.getByRole("menuitem", { name: "Recolor" }));

    expect(useAppStore.getState().project.channels["ch-kick"]!.color).not.toBe(before);
  });

  it("deletes the channel through removeChannel, cascading its notes, and undoes in one entry", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    await user.click(kickStep(0)); // give Kick a note so the cascade has something to restore
    const before = useAppStore.getState().project;

    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-kick"));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(useAppStore.getState().project.channels["ch-kick"]).toBeUndefined();
    expect(screen.queryByTestId("channel-row-ch-kick")).not.toBeInTheDocument();

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });

  it("moves the channel down and back up through moveChannel", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const originalOrder = useAppStore.getState().project.channelOrder;
    expect(originalOrder[0]).toBe("ch-kick");
    expect(originalOrder[1]).toBe("ch-clap");

    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-kick"));
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));

    const afterMoveDown = useAppStore.getState().project.channelOrder;
    expect(afterMoveDown[0]).toBe("ch-clap");
    expect(afterMoveDown[1]).toBe("ch-kick");

    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-kick"));
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));

    expect(useAppStore.getState().project.channelOrder).toEqual(originalOrder);
  });

  it("disables Move up for the first row and Move down for the last row", () => {
    const { container } = render(<ChannelRack />);

    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-kick"));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    // Close this row's menu before opening another — both stay mounted
    // independently, so leaving it open would make "Move down" ambiguous.
    fireEvent.click(container.querySelector(".fl-rack-menu__scrim")!);

    const order = useAppStore.getState().project.channelOrder;
    const lastChannelId = order.at(-1)!;
    fireEvent.contextMenu(screen.getByTestId(`channel-name-${lastChannelId}`));
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  });
});

/* ---------------------------------------------- alt+wheel step velocity --- */

describe("ChannelRack — alt+wheel velocity nudges", () => {
  /** Light step 0 of the kick so there is a note to nudge. */
  async function litKickStep(): Promise<HTMLElement> {
    const user = userEvent.setup();
    const cell = kickStep(0);
    await user.click(cell);
    return cell;
  }

  function velocityOfStepZero(): number {
    const notes = Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes);
    return notes.find((note) => note.channelId === "ch-kick" && note.positionTicks === 0)!.velocity;
  }

  it("folds a rapid burst on one step into a single undo entry", async () => {
    render(<ChannelRack />);
    const cell = await litKickStep();
    const entriesAfterClick = useAppStore.getState().history.past.length;

    fireEvent.wheel(cell, { altKey: true, deltaY: -100 });
    fireEvent.wheel(cell, { altKey: true, deltaY: -100 });
    fireEvent.wheel(cell, { altKey: true, deltaY: -100 });

    expect(useAppStore.getState().history.past).toHaveLength(entriesAfterClick + 1);
  });

  it("gives two SEPARATE nudging sessions on the same step two undo entries", () => {
    vi.useFakeTimers();
    try {
      render(<ChannelRack />);
      // `userEvent` needs real timers, so light the step through the store.
      const cell = kickStep(0);
      fireEvent.pointerDown(cell, { button: 0 });
      fireEvent.pointerUp(cell, { button: 0 });
      const before = useAppStore.getState().history.past.length;

      fireEvent.wheel(cell, { altKey: true, deltaY: -100 });
      // A minute of other work, then back to the same cell: the fixed key
      // this used to pass would have merged both sessions into one Ctrl+Z.
      vi.advanceTimersByTime(60_000);
      fireEvent.wheel(cell, { altKey: true, deltaY: -100 });

      expect(useAppStore.getState().history.past).toHaveLength(before + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("undoes only the LAST session, leaving the first session's nudge in place", () => {
    vi.useFakeTimers();
    try {
      render(<ChannelRack />);
      const cell = kickStep(0);
      fireEvent.pointerDown(cell, { button: 0 });
      fireEvent.pointerUp(cell, { button: 0 });

      fireEvent.wheel(cell, { altKey: true, deltaY: -100 });
      const afterFirst = velocityOfStepZero();
      vi.advanceTimersByTime(60_000);
      fireEvent.wheel(cell, { altKey: true, deltaY: -100 });
      expect(velocityOfStepZero()).toBeGreaterThan(afterFirst);

      useAppStore.getState().undo();

      expect(velocityOfStepZero()).toBeCloseTo(afterFirst, 10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps two different steps on separate entries", async () => {
    render(<ChannelRack />);
    const user = userEvent.setup();
    const first = await litKickStep();
    const second = kickStep(1);
    await user.click(second);
    const before = useAppStore.getState().history.past.length;

    fireEvent.wheel(first, { altKey: true, deltaY: -100 });
    fireEvent.wheel(second, { altKey: true, deltaY: -100 });

    expect(useAppStore.getState().history.past).toHaveLength(before + 2);
  });

  it("PREVENTS the default scroll, so the rack does not move under the nudge (round 5 #5)", async () => {
    render(<ChannelRack />);
    const cell = await litKickStep();

    // `fireEvent` returns false when the event was cancelled. React attaches
    // `wheel` PASSIVELY, so an `onWheel` prop's `preventDefault()` is ignored
    // and this returns true — the rack scrolled a notch on every nudge, and
    // the cell being nudged walked out from under the pointer. Only a native
    // `{ passive: false }` listener can cancel it.
    expect(fireEvent.wheel(cell, { altKey: true, deltaY: -100 })).toBe(false);
  });

  it("leaves a plain (unmodified) wheel alone, so the rack still scrolls", async () => {
    render(<ChannelRack />);
    const cell = await litKickStep();
    const velocityBefore = velocityOfStepZero();

    expect(fireEvent.wheel(cell, { deltaY: -100 })).toBe(true);
    expect(velocityOfStepZero()).toBe(velocityBefore);
  });
});

/*
 * Round 7 #1. The stroke's `patternId` guard catches only a stroke whose
 * PATTERN went away. `Ctrl+Z` mid-stroke undoing an earlier note edit inside
 * the SAME pattern left the id matching, so the buffer survived and pointer-up
 * dispatched `removeNotes` for a note the undo had already deleted —
 * `requireNote` threw `CommandError` out of the pointer handler.
 */
describe("ChannelRack — undo lands mid-stroke (round 7 #1)", () => {
  /** The same spy seam the pattern-death cases use — jsdom swallows the throw. */
  function withDispatchSpy(run: (dispatch: ReturnType<typeof vi.fn>) => void): void {
    const real = useAppStore.getState().dispatch;
    const dispatch = vi.fn(real);
    act(() => {
      useAppStore.setState({ dispatch });
    });
    try {
      run(dispatch);
    } finally {
      act(() => {
        useAppStore.setState({ dispatch: real });
      });
    }
  }

  it("dispatches nothing when an undo deleted a note the ERASE stroke had buffered", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    await user.click(kickStep(0)); // entry 1 — note at step 0
    await user.click(kickStep(1)); // entry 2 — note at step 1

    // A right-drag erase sweeping both lit cells, buffered, not yet committed.
    fireEvent.contextMenu(kickStep(0), { buttons: 2 });
    fireEvent.pointerEnter(kickStep(1), { buttons: 2 });

    // Ctrl+Z with the button still down: entry 2's note is gone, and the
    // buffered `removeNotes` for it now names nothing.
    act(() => {
      useAppStore.getState().undo();
    });

    withDispatchSpy((dispatch) => {
      fireEvent.pointerUp(window);
      expect(dispatch).not.toHaveBeenCalled();
    });

    // The undo's own effect stands, untouched by the abandoned stroke.
    const notes = Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ positionTicks: 0 });
  });

  it("abandons a PAINT stroke across an undo too, rather than adding to a moved project", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    await user.click(kickStep(0));

    fireEvent.pointerDown(kickStep(4), { buttons: 1, button: 0 });
    fireEvent.pointerEnter(kickStep(5), { buttons: 1 });

    act(() => {
      useAppStore.getState().undo();
    });

    withDispatchSpy((dispatch) => {
      fireEvent.pointerUp(window);
      expect(dispatch).not.toHaveBeenCalled();
    });

    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });

  it("clears the optimistic preview the abandoned stroke had painted", () => {
    render(<ChannelRack />);
    fireEvent.pointerDown(kickStep(4), { buttons: 1, button: 0 });
    fireEvent.pointerEnter(kickStep(5), { buttons: 1 });
    expect(kickStep(4)).toHaveAttribute("data-on", "true");

    act(() => {
      useAppStore.getState().dispatch(updateProject({ tempo: 128 }));
    });
    act(() => {
      useAppStore.getState().undo();
    });

    for (const step of [4, 5]) expect(kickStep(step)).toHaveAttribute("data-on", "false");
  });

  it("starts a clean stroke after the undo instead of extending the abandoned one", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    await user.click(kickStep(0));

    fireEvent.pointerDown(kickStep(4), { buttons: 1, button: 0 });
    act(() => {
      useAppStore.getState().undo();
    });

    fireEvent.pointerDown(kickStep(9), { buttons: 1, button: 0 });
    fireEvent.pointerUp(kickStep(9));

    const notes = Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ positionTicks: 9 * TICKS_PER_STEP });
  });
});

/*
 * Round 7 #7. SPEC §4.4 gives left = paint and right = delete; middle is the
 * pan/autoscroll button everywhere else in this app. It fell through to
 * `beginLeftPaint`, so a middle press opened a stroke and toggled the cell on
 * release.
 */
describe("ChannelRack — the middle button does not paint (round 7 #7)", () => {
  it("neither opens a stroke nor toggles the cell", () => {
    render(<ChannelRack />);
    const cell = kickStep(3);

    fireEvent.pointerDown(cell, { button: 1, buttons: 4 });
    fireEvent.pointerUp(cell);

    expect(cell).toHaveAttribute("data-on", "false");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
    expect(useAppStore.getState().history.past).toHaveLength(0);
  });

  it("does not paint the cells a middle-drag sweeps across either", () => {
    render(<ChannelRack />);

    fireEvent.pointerDown(kickStep(3), { button: 1, buttons: 4 });
    fireEvent.pointerEnter(kickStep(4), { buttons: 4 });
    fireEvent.pointerUp(kickStep(4));

    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });

  it("leaves the left button painting exactly as before", () => {
    render(<ChannelRack />);
    fireEvent.pointerDown(kickStep(3), { button: 0, buttons: 1 });
    fireEvent.pointerUp(kickStep(3));
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(1);
  });
});

/*
 * Round 7 #8. Only `pointerup` closed a swing drag. A CANCELLED pointer never
 * delivers one, so the dead drag's coalesce key stayed live in the ref and the
 * next change — a keyboard arrow minutes later — merged into the abandoned
 * drag's undo entry.
 */
describe("ChannelRack — a cancelled swing drag closes its coalesce key (round 7 #8)", () => {
  it("does not merge a later change into the cancelled drag's entry", () => {
    render(<ChannelRack />);
    const slider = screen.getByLabelText("Rack swing");

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.2" } });
    fireEvent.pointerCancel(slider);

    // A keyboard nudge afterwards — a separate edit, a separate entry.
    fireEvent.change(slider, { target: { value: "0.5" } });

    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.5);
    useAppStore.getState().undo();
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.2);
  });

  it("closes it on blur as well", () => {
    render(<ChannelRack />);
    const slider = screen.getByLabelText("Rack swing");

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.2" } });
    fireEvent.blur(slider);

    fireEvent.change(slider, { target: { value: "0.5" } });

    useAppStore.getState().undo();
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.2);
  });

  it("still folds one uninterrupted drag into a single entry", () => {
    render(<ChannelRack />);
    const slider = screen.getByLabelText("Rack swing");
    const before = useAppStore.getState().project;

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.1" } });
    fireEvent.change(slider, { target: { value: "0.4" } });
    fireEvent.pointerUp(slider);

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });
});

/* ------------------------------------------- the gesture class (round 8) -- */

/**
 * Rack family. The paint stroke had the hold and a window `pointerup`
 * backstop but no `pointercancel` one (rule b); the keyboard's context-menu
 * request opened a pointer-sweep session nothing could ever commit (rule e);
 * the buffered stroke watched undo/redo but not a WHOLESALE project
 * replacement (rule d); and the swing slider's coalesce counter lived in a
 * `useRef` a remount rewound (rule c).
 */
describe("ChannelRack paint stroke — the gesture class (round 8)", () => {
  beforeEach(() => {
    __resetGestureCounterForTests();
    act(() => {
      useAppStore.setState({ activeGestureIds: [] });
    });
  });

  it("holds persistence for the stroke and drops it on pointerup (rule a)", () => {
    render(<ChannelRack />);

    fireEvent.pointerDown(kickStep(0), { buttons: 1, button: 0 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerUp(window);
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("cancels the stroke and drops the hold on a window pointercancel (rule b)", () => {
    render(<ChannelRack />);

    fireEvent.pointerDown(kickStep(0), { buttons: 1, button: 0 });
    fireEvent.pointerEnter(kickStep(1), { buttons: 1 });
    expect(kickStep(1)).toHaveAttribute("data-on", "true"); // optimistic preview

    // A cancelled pointer never delivers a `pointerup`, so nothing else can
    // close this stroke: the hold stayed open for the rest of the session and
    // the preview went on painting under every later hover.
    fireEvent.pointerCancel(window);

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
    expect(kickStep(1)).toHaveAttribute("data-on", "false");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
  });

  it("drops the hold when the rack unmounts under the pointer (rule b)", () => {
    const view = render(<ChannelRack />);

    fireEvent.pointerDown(kickStep(0), { buttons: 1, button: 0 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    view.unmount();

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("abandons a buffered stroke across a WHOLESALE project replacement (rule d)", () => {
    render(<ChannelRack />);
    fireEvent.pointerDown(kickStep(4), { buttons: 1, button: 0 });
    fireEvent.pointerEnter(kickStep(5), { buttons: 1 });

    // A load (or an import) mid-stroke swaps every entity at once — and
    // because ids come from one shared counter the incoming project carries
    // the SAME `pat-1`, so the stroke's `patternId` guard passes. Only the
    // revision catches it.
    act(() => {
      useAppStore.getState().loadProject(createDefaultProject({ now: "2026-02-02T00:00:00.000Z" }));
    });
    fireEvent.pointerUp(window);

    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });
});

/*
 * Round 8, rule (e). `contextmenu` also arrives from the KEYBOARD — the
 * ContextMenu key, or Shift+F10, on a focused step — with an empty button
 * mask and no pointer-up ever to follow. It opened a sweep session all the
 * same: a hold was taken, the erase was buffered, the cell went dark in the
 * optimistic preview, and nothing committed any of it.
 */
describe("keyboard context-menu erase commits immediately (round 8, rule e)", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({ activeGestureIds: [] });
    });
  });

  it("removes the note without waiting for a pointer-up that never comes", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    const cell = kickStep(6);
    await user.click(cell);
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(1);

    // No `buttons` — that is what makes it a keyboard request.
    fireEvent.contextMenu(cell);

    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
    expect(cell).toHaveAttribute("data-on", "false");
  });

  it("leaves no persistence hold behind", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    await user.click(kickStep(7));

    fireEvent.contextMenu(kickStep(7));

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("still opens a sweep for a right-BUTTON press, committing once on release", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    for (const step of [8, 9]) await user.click(kickStep(step));
    const entriesBefore = useAppStore.getState().history.past.length;

    fireEvent.contextMenu(kickStep(8), { buttons: 2 });
    fireEvent.pointerEnter(kickStep(9), { buttons: 2, pointerId: 1 });
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(2);

    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
    expect(useAppStore.getState().history.past).toHaveLength(entriesBefore + 1);
  });
});

describe("rack swing — the gesture class (round 8)", () => {
  beforeEach(() => {
    __resetGestureCounterForTests();
    act(() => {
      useAppStore.setState({ activeGestureIds: [] });
    });
  });

  it("holds persistence for the drag (rule a)", () => {
    render(<ChannelRack />);
    const slider = screen.getByLabelText("Rack swing");

    fireEvent.pointerDown(slider, { button: 0, buttons: 1, pointerId: 1 });
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerUp(slider, { pointerId: 1 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  /*
   * Round 9 #1, rack half. The slider's `onChange` called `begin()`, which is
   * right for a drag (the pointer-down already took the hold) and wrong for a
   * keyboard arrow: nothing but `blur` closes it, so a nudged-and-left-focused
   * slider deferred every autosave for the rest of the session.
   */
  it("takes NO hold for a keyboard-only edit (round 9 #1)", () => {
    render(<ChannelRack />);
    const slider = screen.getByLabelText("Rack swing");

    fireEvent.focus(slider);
    fireEvent.change(slider, { target: { value: "0.3" } });

    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.3);
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
    expect(useAppStore.getState().activeGestureIds).toEqual([]);
  });

  it("still folds a run of keyboard edits into one undo entry (round 9 #1)", () => {
    render(<ChannelRack />);
    const slider = screen.getByLabelText("Rack swing");
    const before = useAppStore.getState().project;

    fireEvent.change(slider, { target: { value: "0.1" } });
    fireEvent.change(slider, { target: { value: "0.4" } });

    act(() => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().project).toEqual(before);
  });

  it("does not weld a drag onto the previous MOUNT's drag (rule c)", () => {
    const first = render(<ChannelRack />);
    const dragTo = (value: string) => {
      const slider = screen.getByLabelText("Rack swing");
      fireEvent.pointerDown(slider, { button: 0, buttons: 1, pointerId: 1 });
      fireEvent.change(slider, { target: { value } });
      fireEvent.pointerUp(slider, { pointerId: 1 });
    };

    dragTo("0.2");
    first.unmount();
    render(<ChannelRack />);
    dragTo("0.6");

    expect(useAppStore.getState().history.past).toHaveLength(2);
    act(() => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().project.globalSwing).toBeCloseTo(0.2);
  });
});

/*
 * Round 10 #7/#8, end to end through the real window listener.
 *
 * The knob is a `role="slider"` DIV, so `@/lib/keyboard`'s text guard cannot
 * see it at all: `Space` reset the knob AND toggled playback, and the arrows
 * nudged it AND ran whatever global binding shared the key. The rack's swing
 * slider had the mirror-image bug — it IS an input, so the guard treated it as
 * text and killed every global shortcut while it had focus.
 */
describe("a control's own keys stop at the control (round 10 #7/#8)", () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    __resetKeyboardRegistryForTests();
    detach = attachKeyboardListener(window);
  });

  afterEach(() => {
    detach?.();
    detach = null;
    __resetKeyboardRegistryForTests();
  });

  it.each([
    ["Space", " ", "Space"],
    ["ArrowUp", "ArrowUp", "ArrowUp"],
    ["ArrowDown", "ArrowDown", "ArrowDown"],
  ])("does not let a knob's %s reach the global registry", (_name, key, code) => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "global", code, handler }]);
    render(<ChannelRack />);

    fireEvent.keyDown(screen.getByTestId("knob-Kick volume"), { key, code });

    expect(handler).not.toHaveBeenCalled();
  });

  it("still lets a knob's UNhandled key through — Ctrl+Z is not the knob's", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "undo", code: "KeyZ", ctrl: true, handler }]);
    render(<ChannelRack />);

    fireEvent.keyDown(screen.getByTestId("knob-Kick volume"), {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("runs a global shortcut from the focused swing slider", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "undo", code: "KeyZ", ctrl: true, handler }]);
    render(<ChannelRack />);

    fireEvent.keyDown(screen.getByLabelText("Rack swing"), {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps the swing slider's OWN arrow keys away from the registry", () => {
    const handler = vi.fn();
    registerBindings("piano-roll", [{ id: "transpose", code: "ArrowUp", handler }]);
    render(<ChannelRack />);

    const event = fireEvent.keyDown(screen.getByLabelText("Rack swing"), {
      key: "ArrowUp",
      code: "ArrowUp",
    });

    expect(handler).not.toHaveBeenCalled();
    // The browser default is how an arrow key moves a range input at all.
    expect(event).toBe(true);
  });
});

/* ---------------------------------- click mutations join the registry (12) -- */

/**
 * Round 12 #3. A bare `dispatch` is invisible to the gesture registry, so
 * every one of these clicks landed with another surface's drag still open: the
 * hold stayed taken (autosave deferred) and the open gesture's undo entry went
 * on growing across an edit it never made.
 */
describe("the rack's click mutations pre-empt an open drag (round 12)", () => {
  function openKnobDrag(): void {
    fireEvent.pointerDown(screen.getByTestId("knob-Kick volume"), { clientY: 100, pointerId: 1 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);
  }

  it.each([
    ["mute", () => fireEvent.click(screen.getByTestId("mute-led-ch-clap"))],
    ["routing", () => fireEvent.click(screen.getByTestId("routing-ch-clap"))],
  ])("%s", (_name, click) => {
    render(<ChannelRack />);
    openKnobDrag();

    click();

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("recolor / delete, from the channel menu", async () => {
    const user = userEvent.setup();
    render(<ChannelRack />);
    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-clap"));
    openKnobDrag();

    await user.click(screen.getByRole("menuitem", { name: "Recolor" }));

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("an Alt+wheel velocity nudge pre-empts too — and still coalesces its run", () => {
    /*
     * Round 12 #2. The nudge's key comes from a keyring (target + gap), so it
     * cannot take a fresh one-shot id per notch — and it therefore dispatched
     * past the registry entirely.
     */
    render(<ChannelRack />);
    // A note to nudge: a paint stroke, committed on the release.
    fireEvent.pointerDown(kickStep(0), { buttons: 1, pointerId: 3 });
    fireEvent.pointerUp(kickStep(0), { pointerId: 3 });
    const entriesBefore = useAppStore.getState().history.past.length;
    expect(entriesBefore).toBe(1);
    openKnobDrag();

    act(() => {
      kickStep(0).dispatchEvent(
        new WheelEvent("wheel", { deltaY: -1, altKey: true, bubbles: true, cancelable: true }),
      );
      kickStep(0).dispatchEvent(
        new WheelEvent("wheel", { deltaY: -1, altKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
    // Two notches on the same cell inside the gap are still ONE undo entry —
    // the keyring's bound, which routing through the registry must not break.
    expect(useAppStore.getState().history.past).toHaveLength(entriesBefore + 1);
  });
});

/*
 * Round 14 #2, rack half. The rename box commits on blur, and `blur` is
 * delivered AFTER the `pointerdown` that moved the focus — so a pre-empting
 * commit ended the gesture that press had just opened. Clicking a knob to
 * leave the rename box left a knob that would not turn.
 */
describe("the channel rename's blur commit does not kill the new gesture", () => {
  async function openRename(): Promise<HTMLElement> {
    const user = userEvent.setup();
    render(<ChannelRack />);
    fireEvent.contextMenu(screen.getByTestId("channel-name-ch-kick"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    return screen.getByTestId("channel-rename-ch-kick");
  }

  function pressSomethingElse(): () => boolean {
    let ended = false;
    registerExternalGesture(() => { ended = true; }, { pointerId: 7 });
    return () => ended;
  }

  it("commits the new name without ending the gesture the press opened", async () => {
    const input = await openRename();
    fireEvent.change(input, { target: { value: "808 Kick" } });

    // The browser's order: the press registers, then the field blurs.
    const ended = pressSomethingElse();
    fireEvent.blur(input);

    expect(ended()).toBe(false);
    expect(useAppStore.getState().project.channels["ch-kick"]!.name).toBe("808 Kick");
  });

  it("dispatches nothing at all when the name was not changed", async () => {
    const input = await openRename();
    const before = useAppStore.getState().history.past.length;

    const ended = pressSomethingElse();
    fireEvent.blur(input);

    expect(ended()).toBe(false);
    expect(useAppStore.getState().history.past).toHaveLength(before);
  });
});

/*
 * Round 14 #4. "Reset to default" on a control that is ALREADY at its default
 * dispatched anyway: a history entry that undoes nothing (so one Ctrl+Z is
 * spent putting a value back where it already was, with the edit the user
 * meant to take back one press further down) and a store write with no change
 * in it for the autosave to persist. Every channel starts at pan 0 / volume
 * 0.8, so this is what double-clicking an untouched knob does.
 */
describe("a no-op knob edit dispatches nothing (round 14)", () => {
  it.each([
    ["double-click", (knob: HTMLElement) => fireEvent.doubleClick(knob)],
    ["alt+click", (knob: HTMLElement) => fireEvent.pointerDown(knob, { altKey: true })],
    ["middle-click", (knob: HTMLElement) => fireEvent.pointerDown(knob, { button: 1 })],
  ])("records nothing when %s resets a knob already at its default", (_name, reset_) => {
    render(<ChannelRack />);
    const before = useAppStore.getState().history.past.length;

    reset_(screen.getByTestId("knob-Kick pan"));

    expect(useAppStore.getState().project.channels["ch-kick"]!.pan).toBe(0);
    expect(useAppStore.getState().history.past).toHaveLength(before);
  });

  it("records nothing for an arrow key held at the end of the range", () => {
    render(<ChannelRack />);
    const knob = screen.getByTestId("knob-Kick volume");
    // Drive it to the top first, in its own gesture.
    fireEvent.pointerDown(knob, { clientY: 100, button: 0 });
    fireEvent.pointerMove(knob, { clientY: -10_000 });
    fireEvent.pointerUp(knob, { clientY: -10_000 });
    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(1);
    const before = useAppStore.getState().history.past.length;

    fireEvent.keyDown(knob, { key: "ArrowUp" });
    fireEvent.keyDown(knob, { key: "ArrowUp" });

    expect(useAppStore.getState().history.past).toHaveLength(before);
  });

  it("still resets a knob that is OFF its default", () => {
    render(<ChannelRack />);
    const knob = screen.getByTestId("knob-Kick pan");
    fireEvent.pointerDown(knob, { clientY: 100, button: 0 });
    fireEvent.pointerMove(knob, { clientY: 60 });
    fireEvent.pointerUp(knob, { clientY: 60 });
    expect(useAppStore.getState().project.channels["ch-kick"]!.pan).not.toBe(0);

    fireEvent.doubleClick(knob);

    expect(useAppStore.getState().project.channels["ch-kick"]!.pan).toBe(0);
  });

  it("still nudges a knob that has room to move", () => {
    render(<ChannelRack />);
    const knob = screen.getByTestId("knob-Kick volume");

    fireEvent.keyDown(knob, { key: "ArrowUp" });

    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBeCloseTo(0.81, 5);
  });
});
