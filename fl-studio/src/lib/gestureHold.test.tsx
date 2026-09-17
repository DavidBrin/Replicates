import { act, useRef } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  __resetGestureCounterForTests,
  commitGestureKey,
  nextGestureId,
  oneShotGestureKey,
  preemptOpenGestures,
  registerExternalGesture,
  flushPendingCommits,
  registerPendingCommit,
  useGestureHold,
  useGestureSession,
  usePendingCommit,
  wheelEditKey,
} from "./gestureHold";
import { createWheelGestureKeyring } from "./wheelGesture";
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

/** A control whose editor commits on blur — `keyForCommit`'s only caller shape. */
function CommitProbe() {
  const gesture = useGestureSession("commit-probe");
  return (
    <input
      data-testid="commit-probe"
      onPointerDown={(event) => opened.push(gesture.begin(event))}
      onBlur={() => opened.push(gesture.keyForCommit())}
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
    // The opening pointer's own id on the release, as a browser always sends
    // it: the terminators are scoped to the owner (rule (g)), and a fixture
    // that omitted the id was firing a *foreign* pointer's release (jsdom
    // defaults `pointerId` to 0) at a session opened by pointer 4.
    [
      "the element's own terminator",
      () => fireEvent.pointerUp(screen.getByTestId("probe"), { pointerId: 4 }),
    ],
    [
      "a pointercancel",
      () => fireEvent.pointerCancel(screen.getByTestId("probe"), { pointerId: 4 }),
    ],
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

    // And the survivor is the SECOND press: its release — its OWN pointer's,
    // rule (g) — is what ends it.
    fireEvent.pointerUp(probe, { pointerId: 2 });
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
    fireEvent.pointerUp(first, { pointerId: 1 });
    expect(cancelled).toEqual(["a"]);

    fireEvent.pointerDown(second, { pointerId: 2 });
    expect(cancelled).toEqual(["a"]);
    expect(holds()).toEqual(["b#2"]);
  });
});

/* ------------------------------------------------ pointer ownership (g) -- */

/**
 * Round 12's class fix. The session already knew which pointer opened it; it
 * did not TELL anyone, so every drag machine processed events from pointers
 * that did not own the gesture.
 */
describe("useGestureSession — pointer ownership (rule g)", () => {
  function OwnerProbe() {
    const gesture = useGestureSession("owner");
    return (
      <div
        data-testid="owner-probe"
        onPointerDown={(event) => void gesture.begin(event)}
        onPointerMove={(event) => opened.push(`move:${gesture.ownsEvent(event)}`)}
        onPointerUp={() => opened.push(`open:${gesture.peek() !== null}`)}
      />
    );
  }

  it("answers TRUE for the opening pointer and FALSE for any other", () => {
    render(<OwnerProbe />);
    const probe = screen.getByTestId("owner-probe");

    fireEvent.pointerDown(probe, { pointerId: 7 });
    fireEvent.pointerMove(probe, { pointerId: 7 });
    fireEvent.pointerMove(probe, { pointerId: 8 });

    expect(opened).toEqual(["move:true", "move:false"]);
  });

  it("answers FALSE when nothing is open — there is no gesture to own", () => {
    render(<OwnerProbe />);
    fireEvent.pointerMove(screen.getByTestId("owner-probe"), { pointerId: 7 });

    expect(opened).toEqual(["move:false"]);
  });

  it("abstains — TRUE — when the session has no pointer of its own", () => {
    // A keyboard/focus open cannot claim an event belongs to somebody else.
    function KeyboardOwner() {
      const gesture = useGestureSession("kb-owner");
      return (
        <div
          data-testid="kb-owner"
          tabIndex={0}
          onFocus={() => void gesture.begin()}
          onPointerMove={(event) => opened.push(`move:${gesture.ownsEvent(event)}`)}
        />
      );
    }
    render(<KeyboardOwner />);
    const probe = screen.getByTestId("kb-owner");
    fireEvent.focus(probe);
    fireEvent.pointerMove(probe, { pointerId: 4 });

    expect(opened).toEqual(["move:true"]);
  });

  it("re-scopes to the new press when a second pointer takes the control over", () => {
    render(<OwnerProbe />);
    const probe = screen.getByTestId("owner-probe");

    fireEvent.pointerDown(probe, { pointerId: 1 });
    fireEvent.pointerDown(probe, { pointerId: 2 });
    fireEvent.pointerMove(probe, { pointerId: 1 });
    fireEvent.pointerMove(probe, { pointerId: 2 });

    expect(opened).toEqual(["move:false", "move:true"]);
  });

  it("isOwner reads the same rule from a bare id", () => {
    function Bare() {
      const gesture = useGestureSession("bare");
      return (
        <div
          data-testid="bare"
          onPointerDown={(event) => void gesture.begin(event)}
          // The three answers, read through the bare-id entry point.
          onPointerUp={() =>
            opened.push(
              `${gesture.isOwner(3)}/${gesture.isOwner(9)}/${gesture.isOwner(null)}`,
            )
          }
        />
      );
    }
    render(<Bare />);
    const bare = screen.getByTestId("bare");
    fireEvent.pointerDown(bare, { pointerId: 3 });
    fireEvent.pointerUp(bare, { pointerId: 3 });

    // Owner, stranger, and the abstention when the caller has no id.
    expect(opened).toEqual(["true/false/true"]);
  });

  /*
   * Round 13 #1. The window backstop filtered by pointer id; the SHARED
   * terminators — the ones every surface spreads — did not, so a second
   * pointer releasing over a control that was mid-drag ended the owner's
   * session from under its still-pressed button.
   */
  describe("the shared terminators belong to the owning pointer too", () => {
    it.each([
      ["pointerUp", (el: HTMLElement, pointerId: number) => fireEvent.pointerUp(el, { pointerId })],
      [
        "pointerCancel",
        (el: HTMLElement, pointerId: number) => fireEvent.pointerCancel(el, { pointerId }),
      ],
    ])("ignores a FOREIGN pointer's %s", (_name, terminate) => {
      render(<Probe />);
      const probe = screen.getByTestId("probe");
      fireEvent.pointerDown(probe, { pointerId: 1 });
      expect(holds()).toEqual(["probe#1"]);

      terminate(probe, 2);

      // Still held: the owner's button is still down.
      expect(holds()).toEqual(["probe#1"]);
    });

    it.each([
      ["pointerUp", (el: HTMLElement, pointerId: number) => fireEvent.pointerUp(el, { pointerId })],
      [
        "pointerCancel",
        (el: HTMLElement, pointerId: number) => fireEvent.pointerCancel(el, { pointerId }),
      ],
    ])("still ends on the OWNER's %s", (_name, terminate) => {
      render(<Probe />);
      const probe = screen.getByTestId("probe");
      fireEvent.pointerDown(probe, { pointerId: 1 });

      terminate(probe, 1);

      expect(holds()).toEqual([]);
    });

    it("does not run the owner's onCancel for a foreign release", () => {
      const cancels: number[] = [];
      render(<Probe onCancel={() => cancels.push(1)} />);
      const probe = screen.getByTestId("probe");
      fireEvent.pointerDown(probe, { pointerId: 1 });

      fireEvent.pointerUp(probe, { pointerId: 2 });

      // The owner's drag-state ref must survive a stranger's release.
      expect(cancels).toEqual([]);
      fireEvent.pointerUp(probe, { pointerId: 1 });
      expect(cancels).toEqual([1]);
    });

    it("still ends on blur, which carries no pointer id at all", () => {
      render(<Probe />);
      const probe = screen.getByTestId("probe");
      fireEvent.pointerDown(probe, { pointerId: 1 });

      fireEvent.blur(probe);

      expect(holds()).toEqual([]);
    });

    it("abstains — ends — when the session was opened with no pointer", () => {
      // A keyboard/focus open cannot claim a release is somebody else's.
      function FocusOpened() {
        const gesture = useGestureSession("focus-open");
        return (
          <div
            data-testid="focus-open"
            tabIndex={0}
            onFocus={() => void gesture.begin()}
            {...gesture.terminators}
          />
        );
      }
      render(<FocusOpened />);
      const probe = screen.getByTestId("focus-open");
      fireEvent.focus(probe);
      expect(holds()).toHaveLength(1);

      fireEvent.pointerUp(probe, { pointerId: 9 });

      expect(holds()).toEqual([]);
    });

    it("keeps closing a keyboard edit RUN, which holds no session to own", () => {
      // `end` is a no-op for the hold when nothing is open, but it also resets
      // the keyring — a release after an arrow-key run must still seal it, so
      // the ownership filter must not swallow the call.
      render(<Probe editGapMs={1000} now={() => 0} />);
      const probe = screen.getByTestId("probe");
      fireEvent.keyDown(probe, { key: "ArrowUp" });
      fireEvent.pointerUp(probe, { pointerId: 5 });
      fireEvent.keyDown(probe, { key: "ArrowUp" });

      // Two runs, not one folded run, despite no time passing.
      expect(opened[0]).not.toEqual(opened[1]);
    });
  });
});

/* ------------------------------ the backstop listens in the CAPTURE phase -- */

describe("useGestureSession — the window backstop cannot be swallowed", () => {
  /**
   * Round 12 #1. React attaches its listeners at the tree's root container, so
   * an overlay calling `stopPropagation` on `pointerup` — every menu in this
   * app does — stopped the native event before a BUBBLE-phase window listener
   * could hear it. The release ended nothing: the hold survived, autosave was
   * deferred for the rest of the session, and the sweep's undo entry went on
   * swallowing later edits.
   */
  function OverlayProbe() {
    const gesture = useGestureSession("overlay", { windowBackstop: true });
    return (
      <div data-testid="overlay-root" onPointerDown={(event) => void gesture.begin(event)}>
        <div
          data-testid="overlay"
          onPointerUp={(event) => event.stopPropagation()}
          onPointerCancel={(event) => event.stopPropagation()}
        />
      </div>
    );
  }

  it.each([
    ["pointerup", (element: Element) => fireEvent.pointerUp(element, { pointerId: 1 })],
    ["pointercancel", (element: Element) => fireEvent.pointerCancel(element, { pointerId: 1 })],
  ])("releases on a %s an overlay stopped from propagating", (_name, terminate) => {
    render(<OverlayProbe />);
    fireEvent.pointerDown(screen.getByTestId("overlay-root"), { pointerId: 1 });
    expect(holds()).toHaveLength(1);

    terminate(screen.getByTestId("overlay"));

    // The mutation this pins: drop the `true` from `addEventListener` in
    // `attachBackstop` and the hold is still open here.
    expect(holds()).toEqual([]);
  });
});

/* ---------------------------------------------- registry-aware wheel keys -- */

describe("preemptOpenGestures / wheelEditKey", () => {
  /**
   * Round 12 #2. A wheel run's key comes from a keyring (target + time gap) and
   * cannot be a fresh one-shot id per notch without losing the coalescing that
   * makes the run one Ctrl+Z — so the edits went straight to `dispatch`, past
   * the registry, and left another pointer's drag open across them.
   */
  it("preemptOpenGestures ends the gesture in flight", () => {
    const cancelled: string[] = [];
    render(<Probe onCancel={() => cancelled.push("drag")} />);
    fireEvent.pointerDown(screen.getByTestId("probe"), { pointerId: 1 });
    expect(holds()).toHaveLength(1);

    act(() => preemptOpenGestures());

    expect(holds()).toEqual([]);
    expect(cancelled).toEqual(["drag"]);
  });

  it("wheelEditKey pre-empts AND keeps the keyring's run key", () => {
    const cancelled: string[] = [];
    render(<Probe onCancel={() => cancelled.push("drag")} />);
    fireEvent.pointerDown(screen.getByTestId("probe"), { pointerId: 1 });

    const keyring = createWheelGestureKeyring("velocity", 500);
    let first = "";
    let second = "";
    act(() => {
      first = wheelEditKey(keyring, ["pat-1", "note-1"], 1_000);
      second = wheelEditKey(keyring, ["pat-1", "note-1"], 1_100);
    });

    expect(holds()).toEqual([]);
    expect(cancelled).toEqual(["drag"]);
    // Same target, inside the gap: still ONE undo entry.
    expect(second).toBe(first);
    // A different target is a different entry.
    expect(wheelEditKey(keyring, ["pat-1", "note-2"], 1_150)).not.toBe(first);
  });
});

/*
 * Round 14 #2. The blur-commit exemption to the single-active-mutating-gesture
 * invariant, and its EXACT width: a commit key takes an id without
 * pre-empting, and every other way of taking an id still pre-empts. The
 * ordering that forces it is the browser's — `pointerdown` on the new target,
 * then `blur` on the old one — so by the time a commit runs, the gesture it
 * would end is the one the user is holding.
 */
describe("commit keys do not pre-empt (round 14)", () => {
  function externalGesture(): { end: () => void; ended: () => boolean } {
    let ended = false;
    registerExternalGesture(() => { ended = true; }, { pointerId: 9 });
    return { end: () => {}, ended: () => ended };
  }

  it("commitGestureKey leaves the open gesture alone, and still mints a fresh id", () => {
    const gesture = externalGesture();

    const first = commitGestureKey("rename");
    const second = commitGestureKey("rename");

    expect(gesture.ended()).toBe(false);
    expect(first).not.toBe(second);
  });

  it("oneShotGestureKey — the ordinary form — still ends it", () => {
    const gesture = externalGesture();

    oneShotGestureKey("menu-item");

    expect(gesture.ended()).toBe(true);
  });

  it("keyForCommit leaves a gesture registered AFTER the edit began alive", () => {
    render(<CommitProbe />);
    const field = screen.getByTestId("commit-probe");
    // The browser's order: the new press registers first...
    const gesture = externalGesture();
    // ...and only then does the field commit.
    fireEvent.blur(field);

    expect(gesture.ended()).toBe(false);
    expect(opened).toEqual(["commit-probe#1"]);
    // No hold either — there is no pointer-up coming for a commit (rule e).
    expect(holds()).toEqual([]);
  });

  it("keyForCommit still returns the OPEN session's id when a drag is running", () => {
    render(<CommitProbe />);
    const field = screen.getByTestId("commit-probe");

    fireEvent.pointerDown(field, { pointerId: 1 });
    fireEvent.blur(field);

    expect(opened).toEqual(["commit-probe#1", "commit-probe#1"]);
  });

  it("keyFor — the pre-empting sibling — is unchanged", () => {
    render(<Probe />);
    const gesture = externalGesture();

    fireEvent.doubleClick(screen.getByTestId("probe"));

    expect(gesture.ended()).toBe(true);
  });
});

/* -------------------------------------------- pending editor commits (r15) */

/**
 * Round 15 #1. `blur` is delivered AFTER the `pointerdown` that moved the
 * focus, and a great many pointer-downs in this app MUTATE immediately — a
 * drawn note, a dragged velocity stem, a shift-clone, a painted clip. The
 * dismissed editor's commit therefore landed on TOP of the new gesture's first
 * command: the undo order read backwards (one Ctrl+Z took back the rename the
 * user had finished with and left the note they had just made), and the drag
 * stopped coalescing, because coalescing only ever extends the stack's top
 * entry (`domain/undo.ts`).
 *
 * The fix is ordering, not suppression: every gesture entry point flushes the
 * open editors before it mints an id or dispatches anything.
 */

/** What ran, in order — the whole point of this block. */
const order: string[] = [];

function EditorProbe({ open }: { open: boolean }) {
  const ref = useRef<HTMLInputElement | null>(null);
  usePendingCommit(open, () => order.push("commit"), ref);
  return open ? <input data-testid="editor" ref={ref} /> : null;
}

/** A surface that dispatches on pointer-DOWN, the shape that exposed the bug. */
function MutatingProbe() {
  const gesture = useGestureSession("mutating");
  return (
    <div
      data-testid="mutating"
      onPointerDown={(event) => {
        gesture.begin(event);
        order.push("gesture");
      }}
      onDoubleClick={() => {
        gesture.keyFor();
        order.push("one-shot");
      }}
      {...gesture.terminators}
    />
  );
}

/**
 * `TransportBar`'s shape: a capture-phase `begin` wrapped AROUND the editor,
 * so a press inside the field reaches the gesture machinery too.
 */
function WrappedEditorProbe() {
  const gesture = useGestureSession("wrapper");
  return (
    <div data-testid="wrapper" onPointerDownCapture={gesture.begin}>
      <EditorProbe open />
    </div>
  );
}

describe("pending editor commits flush BEFORE the gesture that dismissed them", () => {
  beforeEach(() => {
    order.length = 0;
  });

  it("commits the editor first, then the gesture's own dispatch", () => {
    render(
      <>
        <EditorProbe open />
        <MutatingProbe />
      </>,
    );

    fireEvent.pointerDown(screen.getByTestId("mutating"), { pointerId: 1 });

    expect(order).toEqual(["commit", "gesture"]);
  });

  it("commits exactly ONCE — the blur that follows finds nothing pending", () => {
    render(
      <>
        <EditorProbe open />
        <MutatingProbe />
      </>,
    );

    fireEvent.pointerDown(screen.getByTestId("mutating"), { pointerId: 1 });
    // The browser's real order: the press flushed, and `blur` arrives after.
    flushPendingCommits();

    expect(order).toEqual(["commit", "gesture"]);
  });

  it("flushes for a keyboard/menu ONE-SHOT too", () => {
    render(
      <>
        <EditorProbe open />
        <MutatingProbe />
      </>,
    );

    fireEvent.doubleClick(screen.getByTestId("mutating"));

    expect(order).toEqual(["commit", "one-shot"]);
  });

  it.each([
    ["oneShotGestureKey", () => void oneShotGestureKey("one-shot")],
    ["preemptOpenGestures", () => preemptOpenGestures()],
    ["wheelEditKey", () => void wheelEditKey(createWheelGestureKeyring("wheel"), "target")],
    ["registerExternalGesture", () => void registerExternalGesture(() => {}, { pointerId: 7 })],
  ])("%s flushes as well — every mutating entry point does", (_name, enter) => {
    render(<EditorProbe open />);

    act(enter);

    expect(order).toEqual(["commit"]);
  });

  it("leaves an editor alone when the press lands INSIDE it", () => {
    // Clicking into the BPM type-in to move the caret reaches
    // `tempoGesture.begin` through the wrapper's capture handler. Committing
    // there would close the field mid-edit.
    render(<WrappedEditorProbe />);

    fireEvent.pointerDown(screen.getByTestId("editor"), { pointerId: 1 });

    expect(order).toEqual([]);
  });

  it("still flushes that same editor for a press OUTSIDE it", () => {
    render(
      <>
        <WrappedEditorProbe />
        <MutatingProbe />
      </>,
    );

    fireEvent.pointerDown(screen.getByTestId("mutating"), { pointerId: 1 });

    expect(order).toEqual(["commit", "gesture"]);
  });

  it("unregisters when the editor closes", () => {
    const { rerender } = render(<EditorProbe open />);
    rerender(<EditorProbe open={false} />);

    act(() => flushPendingCommits());

    expect(order).toEqual([]);
  });

  it("registerPendingCommit's unregister is idempotent, and a flush runs each entry once", () => {
    const unregister = registerPendingCommit(() => order.push("bare"));

    act(() => flushPendingCommits());
    act(() => flushPendingCommits());
    unregister();

    expect(order).toEqual(["bare"]);
  });
});
