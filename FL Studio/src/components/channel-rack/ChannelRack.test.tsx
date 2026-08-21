import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDefaultProject } from "@/domain/defaultProject";
import { resetIds } from "@/domain/ids";
import { createHistory } from "@/domain/undo";
import { TICKS_PER_STEP, type Project } from "@/domain/types";
import { useAppStore } from "@/lib/store";
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

    fireEvent.contextMenu(cell);
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

    fireEvent.contextMenu(cell);
    fireEvent.pointerUp(cell);

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

    fireEvent.contextMenu(cells[0]!);
    fireEvent.pointerEnter(cells[1]!, { buttons: 2 });
    fireEvent.pointerEnter(cells[2]!, { buttons: 2 });
    fireEvent.pointerUp(cells[2]!);

    for (const cell of cells) expect(cell).toHaveAttribute("data-on", "false");
    expect(Object.values(useAppStore.getState().project.patterns["pat-1"]!.notes)).toHaveLength(0);
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
