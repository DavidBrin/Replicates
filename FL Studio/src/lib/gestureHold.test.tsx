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

function Probe({ prefix = "probe" }: { prefix?: string }) {
  const gesture = useGestureSession(prefix);
  return (
    <div
      data-testid="probe"
      tabIndex={0}
      onPointerDown={() => opened.push(gesture.begin())}
      onDoubleClick={() => opened.push(gesture.keyFor())}
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
  useAppStore.setState({ activeGestureIds: [] });
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
