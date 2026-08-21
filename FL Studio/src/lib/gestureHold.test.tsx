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
}: {
  prefix?: string;
  windowBackstop?: boolean;
  editGapMs?: number;
  /** A clock the test drives, so an edit run's time bound is testable. */
  now?: () => number;
}) {
  const gesture = useGestureSession(prefix, { windowBackstop, editGapMs });
  return (
    <div
      data-testid="probe"
      tabIndex={0}
      onPointerDown={() => opened.push(gesture.begin())}
      onDoubleClick={() => opened.push(gesture.keyFor())}
      // The keyboard-edit path every arrow-editable control uses.
      onKeyDown={() => opened.push(gesture.keyForEdit(now?.()))}
      {...gesture.terminators}
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
    fireEvent.pointerDown(first!);
    fireEvent.pointerDown(second!);

    expect(opened).toEqual(["a#1", "b#2"]);
    expect(holds()).toEqual(["a#1", "b#2"]);
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
