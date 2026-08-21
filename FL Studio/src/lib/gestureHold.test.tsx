import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  __resetGestureCounterForTests,
  nextGestureId,
  useGestureHold,
  useGestureSession,
} from "./gestureHold";
import { selectHasActiveGesture, useAppStore } from "./store";

/**
 * The shared gesture machinery every drag surface routes through
 * (`gestureHold.ts`'s checklist a–e). The surfaces' own suites prove each rule
 * where it is USED; this one proves the helper cannot be used wrongly.
 */

const opened: string[] = [];

function Probe({
  prefix = "probe",
  windowBackstop = false,
  editGapMs,
  now,
  onCancel,
}: {
  prefix?: string;
  windowBackstop?: boolean;
  editGapMs?: number;
  /** A clock the test drives, so an edit run's time bound is testable. */
  now?: () => number;
  onCancel?: () => void;
}) {
  const gesture = useGestureSession(prefix, { windowBackstop, editGapMs, onCancel });
  return (
    <div
      data-testid="probe"
      tabIndex={0}
      onPointerDown={(event) => opened.push(gesture.begin(event))}
      onDoubleClick={() => opened.push(gesture.keyFor())}
      // The keyboard-edit path every arrow-editable control uses.
      onKeyDown={() => opened.push(gesture.keyForEdit(now?.()))}
      {...gesture.terminators}
    />
  );
}

/** A session opened by FOCUS — no pointer to scope the backstop to. */
function KeyboardOpenedProbe() {
  const gesture = useGestureSession("keyboard", { windowBackstop: true });
  return (
    <div
      data-testid="keyboard-probe"
      tabIndex={0}
      onFocus={() => void gesture.begin()}
      onPointerUp={gesture.end}
      onPointerCancel={gesture.end}
    />
  );
}

function HoldProbe() {
  const gesture = useGestureHold("hold-probe");
  return (
    <div
      data-testid="hold-probe"
      onPointerDown={gesture.hold}
      onPointerUp={gesture.release}
    />
  );
}

function holds(): readonly string[] {
  return useAppStore.getState().activeGestureIds;
}

beforeEach(() => {
  opened.length = 0;
  __resetGestureCounterForTests();
  useAppStore.setState({ activeGestureIds: [], projectRevision: 0 });
});

describe("useGestureSession — the hold (rule a)", () => {
  it("registers a store hold on begin, so autosave can see the drag", () => {
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("probe"));

    expect(holds()).toEqual(["probe#1"]);
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);
  });
});

describe("useGestureSession — every terminator releases (rule b)", () => {
  it.each([
    ["pointerUp", (el: HTMLElement) => fireEvent.pointerUp(el)],
    ["pointerCancel", (el: HTMLElement) => fireEvent.pointerCancel(el)],
    ["blur", (el: HTMLElement) => fireEvent.blur(el)],
  ])("releases the hold on %s", (_name, terminate) => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");
    fireEvent.pointerDown(probe);
    expect(holds()).toHaveLength(1);

    terminate(probe);

    expect(holds()).toEqual([]);
  });

  it("releases the hold when the component unmounts mid-gesture", () => {
    const view = render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("probe"));
    expect(holds()).toHaveLength(1);

    view.unmount();

    expect(holds()).toEqual([]);
  });

  it("is idempotent: two terminators for one gesture release it once", () => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");
    fireEvent.pointerDown(probe);
    fireEvent.pointerUp(probe);
    fireEvent.pointerCancel(probe);

    expect(holds()).toEqual([]);
  });

  it("is re-entrant: a second begin returns the SAME id and takes no second hold", () => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");
    fireEvent.pointerDown(probe);
    fireEvent.pointerDown(probe);

    expect(opened).toEqual(["probe#1", "probe#1"]);
    expect(holds()).toEqual(["probe#1"]);

    fireEvent.pointerUp(probe);
    expect(holds()).toEqual([]);
  });
});

describe("useGestureSession — ids come from a module counter (rule c)", () => {
  it("does NOT re-mint an id a previous MOUNT already used", () => {
    const first = render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("probe"));
    fireEvent.pointerUp(screen.getByTestId("probe"));
    first.unmount();

    // The remount an F5-equivalent re-render, a tab flip or a keyed re-order
    // performs. A component-local counter restarts at 0 here and hands the
    // second mount's first gesture the first mount's id — which
    // `domain/undo.ts` would then fold into one entry.
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("probe"));

    expect(opened).toEqual(["probe#1", "probe#2"]);
  });

  it("keeps two concurrently mounted surfaces on distinct ids", () => {
    render(
      <>
        <Probe prefix="a" />
        <Probe prefix="b" />
      </>,
    );
    const [first, second] = screen.getAllByTestId("probe");
    fireEvent.pointerDown(first!, { pointerId: 1 });
    fireEvent.pointerDown(second!, { pointerId: 2 });

    expect(opened).toEqual(["a#1", "b#2"]);
    // …and only ONE of them is open: the single-active-mutating-gesture
    // invariant. `b` starting ended `a`, so the ids are distinct AND the
    // holds do not stack.
    expect(holds()).toEqual(["b#2"]);
  });

  it("mints monotonically from the bare helper too", () => {
    expect(nextGestureId("x")).toBe("x#1");
    expect(nextGestureId("x")).toBe("x#2");
  });
});

describe("useGestureSession — one-shot keys take no hold (rule e)", () => {
  it("mints a FRESH id per call when no session is open, and holds nothing", () => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");

    fireEvent.doubleClick(probe);
    fireEvent.doubleClick(probe);

    expect(opened).toEqual(["probe#1", "probe#2"]);
    // The whole point: a keyboard/menu one-shot has no pointer-up coming, so
    // it must never leave a hold behind.
    expect(holds()).toEqual([]);
  });

  it("returns the OPEN session's id while a gesture is in flight", () => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");

    fireEvent.pointerDown(probe);
    fireEvent.doubleClick(probe);

    expect(opened).toEqual(["probe#1", "probe#1"]);
  });
});

describe("useGestureHold", () => {
  it("is the same machinery: holds, releases, and releases on unmount", () => {
    const view = render(<HoldProbe />);
    const probe = screen.getByTestId("hold-probe");

    fireEvent.pointerDown(probe);
    expect(holds()).toEqual(["hold-probe#1"]);
    fireEvent.pointerUp(probe);
    expect(holds()).toEqual([]);

    fireEvent.pointerDown(probe);
    expect(holds()).toHaveLength(1);
    view.unmount();
    expect(holds()).toEqual([]);
  });
});

/* --------------------------------------------------- keyboard edits (e) -- */

/**
 * Round 9 #1. A control that is edited by BOTH pointer and keyboard used to
 * call `begin()` from its `onChange`, so an arrow press on a focused slider
 * opened a hold whose only terminator is `blur`. Nudge the slider, leave it
 * focused, and every autosave from then on was deferred — indefinitely.
 */
describe("useGestureSession — keyForEdit (rule e)", () => {
  it("takes NO hold when the edit came from the keyboard", () => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");

    fireEvent.keyDown(probe, { key: "ArrowUp" });
    fireEvent.keyDown(probe, { key: "ArrowUp" });

    // The mutation this pins: swap `keyForEdit` back to `begin` and this is
    // `["probe#1"]` — a hold nothing but a blur can close.
    expect(holds()).toEqual([]);
  });

  it("folds a RUN of keyboard edits into one key, and starts a new one after the gap", () => {
    let clock = 1_000;
    render(<Probe editGapMs={500} now={() => clock} />);
    const probe = screen.getByTestId("probe");

    fireEvent.keyDown(probe, { key: "ArrowUp" });
    clock += 200;
    fireEvent.keyDown(probe, { key: "ArrowUp" });
    clock += 5_000; // the user stopped
    fireEvent.keyDown(probe, { key: "ArrowUp" });

    expect(opened[0]).toBe(opened[1]);
    expect(opened[2]).not.toBe(opened[0]);
    expect(holds()).toEqual([]);
  });

  it("returns the OPEN drag's id instead, so a pointer gesture is unchanged", () => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");

    fireEvent.pointerDown(probe);
    fireEvent.keyDown(probe, { key: "ArrowUp" });

    expect(opened).toEqual(["probe#1", "probe#1"]);
    expect(holds()).toEqual(["probe#1"]);
  });

  it("does not let a keyboard edit join the drag that JUST ended", () => {
    let clock = 1_000;
    render(<Probe editGapMs={500} now={() => clock} />);
    const probe = screen.getByTestId("probe");

    fireEvent.keyDown(probe, { key: "ArrowUp" }); // an edit run...
    clock += 10;
    fireEvent.pointerDown(probe); // ...interrupted by a drag
    fireEvent.pointerUp(probe);
    clock += 10; // still inside the gap
    fireEvent.keyDown(probe, { key: "ArrowUp" });

    // Three distinct gestures: the first run, the drag, the run after it.
    expect(new Set(opened).size).toBe(3);
  });
});

/* ------------------------------------------------- window backstop (f) -- */

describe("useGestureSession — windowBackstop (rule f)", () => {
  it.each([
    ["pointerup", () => fireEvent.pointerUp(window)],
    ["pointercancel", () => fireEvent.pointerCancel(window)],
  ])("releases a session whose %s landed off the element", (_name, terminate) => {
    render(<Probe windowBackstop />);
    fireEvent.pointerDown(screen.getByTestId("probe"));
    expect(holds()).toHaveLength(1);

    terminate();

    expect(holds()).toEqual([]);
  });

  it("detaches the listeners once the session closes", () => {
    render(<Probe windowBackstop />);
    const probe = screen.getByTestId("probe");
    fireEvent.pointerDown(probe);
    fireEvent.pointerUp(probe);
    expect(holds()).toEqual([]);

    // A one-shot key takes no hold; a window pointerup afterwards must not be
    // able to end anything (and the listener should be gone).
    fireEvent.doubleClick(probe);
    fireEvent.pointerUp(window);
    expect(holds()).toEqual([]);
  });

  /**
   * Round 10 #3. The backstop listens on the WINDOW, which hears every
   * pointer in the document — a second touch, a stylus the app never saw, the
   * OS releasing one. Any of them ended the gesture from under the button
   * still holding it, sealing the undo entry so the rest of one drag became a
   * second Ctrl+Z.
   */
  describe("the backstop belongs to the pointer that opened the session", () => {
    it("ignores another pointer's release", () => {
      render(<Probe windowBackstop />);
      fireEvent.pointerDown(screen.getByTestId("probe"), { pointerId: 7 });
      expect(holds()).toEqual(["probe#1"]);

      fireEvent.pointerUp(window, { pointerId: 9 });
      expect(holds()).toEqual(["probe#1"]);
      fireEvent.pointerCancel(window, { pointerId: 9 });
      expect(holds()).toEqual(["probe#1"]);

      // …and its OWN release still ends it.
      fireEvent.pointerUp(window, { pointerId: 7 });
      expect(holds()).toEqual([]);
    });

    it("ends on ANY release when the session was opened without a pointer", () => {
      // A keyboard/focus open has no pointer to compare against, and a hold
      // that nothing can close is the worse failure.
      render(<KeyboardOpenedProbe />);
      fireEvent.focus(screen.getByTestId("keyboard-probe"));
      expect(holds()).toHaveLength(1);

      fireEvent.pointerUp(window, { pointerId: 3 });
      expect(holds()).toEqual([]);
    });
  });

  it("is opt-in: without it, a release off the element does NOT reach the session", () => {
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("probe"));

    fireEvent.pointerUp(window);

    expect(holds()).toEqual(["probe#1"]);
  });
});

/* ------------------------------------ the project underneath it (rule d) -- */

/**
 * Round 9 #3. Sessions released on unmount but not on a project replacement,
 * so a control that stays mounted across an undo/redo/import — a `ClipView`
 * whose id survived a same-id re-import, a knob on a channel the new project
 * names the same — kept a hold taken against a project that no longer exists.
 */
describe("useGestureSession — a session dies with its project (rule d)", () => {
  it("cancels itself when projectRevision moves", () => {
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("probe"));
    expect(holds()).toEqual(["probe#1"]);

    act(() => {
      useAppStore.setState({ projectRevision: useAppStore.getState().projectRevision + 1 });
    });

    expect(holds()).toEqual([]);
  });

  it("survives store writes that are NOT project replacements", () => {
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("probe"));

    act(() => {
      useAppStore.setState({ playlistScrollX: 42 });
    });

    expect(holds()).toEqual(["probe#1"]);
  });

  it("re-opens against the CURRENT revision, so one bump cannot cancel twice", () => {
    render(<Probe />);
    const probe = screen.getByTestId("probe");
    act(() => {
      useAppStore.setState({ projectRevision: 7 });
    });

    fireEvent.pointerDown(probe);
    expect(holds()).toHaveLength(1);
    act(() => {
      useAppStore.setState({ playlistScrollX: 1 });
    });
    expect(holds()).toHaveLength(1);

    act(() => {
      useAppStore.setState({ projectRevision: 8 });
    });
    expect(holds()).toEqual([]);
  });

  it("cancels a real undo mid-drag", () => {
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId("probe"));

    act(() => {
      useAppStore.getState().undo();
    });

    expect(holds()).toEqual([]);
  });
});

/* ------------------------------------------------- owner state (round 10) -- */

/**
 * Round 10 #1/#2. A session ending is not always the owner's idea — the
 * revision watcher, the window backstop, unmount and pre-emption all end it
 * from outside — and the hold is only half the state a gesture holds. The
 * other half is the owner's own `useRef`, and left set it made the next
 * pointer MOVE (a hover, no button down) dispatch the dead gesture's values
 * into the replacement project.
 */
describe("useGestureSession — onCancel clears the owner's state", () => {
  it.each([
    [
      "a project replacement under the pointer",
      () => {
        act(() => {
          useAppStore.setState({ projectRevision: useAppStore.getState().projectRevision + 1 });
        });
      },
    ],
    ["the element's own terminator", () => fireEvent.pointerUp(screen.getByTestId("probe"))],
    ["a pointercancel", () => fireEvent.pointerCancel(screen.getByTestId("probe"))],
    ["a blur", () => fireEvent.blur(screen.getByTestId("probe"))],
    ["the window backstop", () => fireEvent.pointerUp(window, { pointerId: 4 })],
  ])("fires on %s", (_name, terminate) => {
    const cancelled: number[] = [];
    render(<Probe windowBackstop onCancel={() => cancelled.push(1)} />);
    fireEvent.pointerDown(screen.getByTestId("probe"), { pointerId: 4 });

    terminate();

    expect(cancelled).toHaveLength(1);
    expect(holds()).toEqual([]);
  });

  it("fires on unmount", () => {
    const cancelled: number[] = [];
    const view = render(<Probe onCancel={() => cancelled.push(1)} />);
    fireEvent.pointerDown(screen.getByTestId("probe"));

    view.unmount();

    expect(cancelled).toHaveLength(1);
  });

  it("does NOT fire when there was no open session to close", () => {
    const cancelled: number[] = [];
    render(<Probe onCancel={() => cancelled.push(1)} />);

    // Terminators arrive defensively all the time (a surface releases on
    // pointerup AND pointercancel); a cleanup that ran on each of them would
    // clear state a LATER gesture had legitimately set.
    fireEvent.pointerUp(screen.getByTestId("probe"));
    fireEvent.blur(screen.getByTestId("probe"));
    expect(cancelled).toEqual([]);

    fireEvent.pointerDown(screen.getByTestId("probe"));
    fireEvent.pointerUp(screen.getByTestId("probe"));
    fireEvent.pointerUp(screen.getByTestId("probe"));
    expect(cancelled).toHaveLength(1);
  });

  it("reads the LATEST callback without re-subscribing the session", () => {
    // An inline arrow is a new function every render. If the session keyed
    // anything off its identity, the effect that ends on unmount would tear
    // down and re-run on every render — releasing the hold mid-drag.
    const cancelled: string[] = [];
    const view = render(<Probe onCancel={() => cancelled.push("first")} />);
    fireEvent.pointerDown(screen.getByTestId("probe"));
    view.rerender(<Probe onCancel={() => cancelled.push("second")} />);

    expect(holds()).toEqual(["probe#1"]);
    fireEvent.pointerUp(screen.getByTestId("probe"));
    expect(cancelled).toEqual(["second"]);
  });
});

/**
 * The single-active-mutating-gesture invariant (module header). Multi-pointer
 * simultaneous editing is out of scope; beginning a new mutating gesture ends
 * the one in flight, which is what keeps the undo stack from ever holding two
 * open entries.
 */
describe("useGestureSession — one mutating gesture at a time", () => {
  function twoProbes(onCancel?: () => void) {
    render(
      <>
        <Probe prefix="a" onCancel={onCancel} />
        <Probe prefix="b" />
      </>,
    );
    const [first, second] = screen.getAllByTestId("probe");
    return { first: first!, second: second! };
  }

  it("ends the gesture in flight — and runs its owner's cleanup", () => {
    const cancelled: string[] = [];
    const { first, second } = twoProbes(() => cancelled.push("a"));

    fireEvent.pointerDown(first, { pointerId: 1 });
    expect(holds()).toEqual(["a#1"]);

    fireEvent.pointerDown(second, { pointerId: 2 });

    expect(holds()).toEqual(["b#2"]);
    expect(cancelled).toEqual(["a"]);
  });

  it("a keyboard edit run pre-empts a drag", () => {
    const cancelled: string[] = [];
    const { first, second } = twoProbes(() => cancelled.push("a"));
    fireEvent.pointerDown(first, { pointerId: 1 });

    // `keyForEdit` — the arrow-key path on a focused control elsewhere.
    fireEvent.keyDown(second);

    expect(holds()).toEqual([]);
    expect(cancelled).toEqual(["a"]);
  });

  it("a one-shot pre-empts a drag", () => {
    const cancelled: string[] = [];
    const { first, second } = twoProbes(() => cancelled.push("a"));
    fireEvent.pointerDown(first, { pointerId: 1 });

    fireEvent.doubleClick(second); // `keyFor`

    expect(holds()).toEqual([]);
    expect(cancelled).toEqual(["a"]);
  });

  it("does NOT pre-empt a session opened by the SAME pointer", () => {
    // Nested surfaces on one press: `TransportBar` wraps `BpmLcd` in a
    // session that owns the tempo's undo identity while the plate's own
    // session owns the hold. Pre-empting there would make the outer session
    // mint a fresh id per pointermove — one undo entry per pixel.
    const cancelled: string[] = [];
    const { first, second } = twoProbes(() => cancelled.push("a"));

    fireEvent.pointerDown(first, { pointerId: 5 });
    fireEvent.pointerDown(second, { pointerId: 5 });

    expect(holds()).toEqual(["a#1", "b#2"]);
    expect(cancelled).toEqual([]);
  });

  it("re-entrant begin on the SAME session is still a no-op", () => {
    const cancelled: string[] = [];
    render(<Probe onCancel={() => cancelled.push("self")} />);
    const probe = screen.getByTestId("probe");

    fireEvent.pointerDown(probe, { pointerId: 1 });
    fireEvent.pointerDown(probe, { pointerId: 1 });

    expect(opened).toEqual(["probe#1", "probe#1"]);
    expect(holds()).toEqual(["probe#1"]);
    expect(cancelled).toEqual([]);
  });

  it("serializes a SECOND pointer pressing the same control: seal, then a fresh session", () => {
    /*
     * Round 11 #4. A second finger landing on a control whose first finger is
     * still down used to be handed the running session's id back: two
     * pointers drove one gesture, the first release ended it under the
     * second, and the second's edits went on extending an entry that had
     * already been sealed. One gesture at a time means the first is closed —
     * hold dropped, `onCancel` run — and the new press gets its own id.
     */
    const cancelled: string[] = [];
    render(<Probe onCancel={() => cancelled.push("self")} />);
    const probe = screen.getByTestId("probe");

    fireEvent.pointerDown(probe, { pointerId: 1 });
    fireEvent.pointerDown(probe, { pointerId: 2 });

    expect(opened).toEqual(["probe#1", "probe#2"]);
    expect(holds()).toEqual(["probe#2"]);
    expect(cancelled).toEqual(["self"]);

    // And the survivor is the SECOND press: its release is what ends it.
    fireEvent.pointerUp(probe);
    expect(holds()).toEqual([]);
  });

  it("scopes the same-pointer exemption to ONE press, so a leaked session cannot ride along", () => {
    /*
     * Round 11 #5. A mouse keeps `pointerId === 1` for life, so an exemption
     * keyed on the id alone also exempted a session that leaked from an
     * earlier press — it survived every later click of that mouse, kept its
     * hold, and went on coalescing under whatever the user was really
     * editing. The press token is what separates them: same id, different
     * press, no exemption.
     */
    const cancelled: string[] = [];
    const { first, second } = twoProbes(() => cancelled.push("a"));

    // Press 1 opens `a` and leaks: the release never reaches its element
    // (dragged off, a swallowed pointercancel), so the session stays open.
    fireEvent.pointerDown(first, { pointerId: 1 });
    expect(holds()).toEqual(["a#1"]);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(holds()).toEqual(["a#1"]);

    // Press 2 — the same physical mouse, an unrelated control.
    fireEvent.pointerDown(second, { pointerId: 1 });

    expect(cancelled).toEqual(["a"]);
    expect(holds()).toEqual(["b#2"]);
  });

  it("leaves the registry empty once every gesture has ended", () => {
    // A stale registry entry would let a dead session be "pre-empted" — and
    // its `onCancel` re-run — long after it closed.
    const cancelled: string[] = [];
    const { first, second } = twoProbes(() => cancelled.push("a"));
    fireEvent.pointerDown(first, { pointerId: 1 });
    fireEvent.pointerUp(first);
    expect(cancelled).toEqual(["a"]);

    fireEvent.pointerDown(second, { pointerId: 2 });
    expect(cancelled).toEqual(["a"]);
    expect(holds()).toEqual(["b#2"]);
  });
});
