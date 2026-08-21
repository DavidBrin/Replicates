import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Playlist } from "./Playlist";
import { LANE_HEIGHT_PX } from "./geometry";
import { DEFAULT_PLAYLIST_UI } from "./uiState";
import { addNotes } from "@/domain/commands";
import { createHistory } from "@/domain/undo";
import { createDefaultProject } from "@/domain/defaultProject";
import { nextId, resetIds } from "@/domain/ids";
import { TICKS_PER_BAR } from "@/domain/types";
import { __resetGestureCounterForTests } from "@/lib/gestureHold";
import { selectHasActiveGesture, useAppStore } from "@/lib/store";

/**
 * One store now holds both the domain and this surface's UI slice, so the
 * per-test reset writes both through it (SPEC.md §5's composition).
 */
function resetStore() {
  useAppStore.setState({
    project: createDefaultProject({ now: "2026-01-01T00:00:00.000Z" }),
    history: createHistory(),
    ...DEFAULT_PLAYLIST_UI,
  });
}

beforeEach(() => {
  resetIds(0);
  resetStore();
  __resetGestureCounterForTests();
});

afterEach(() => {
  resetIds(0);
});

describe("Playlist", () => {
  it("paints the armed pattern as a clip, snapped to the nearest bar", () => {
    render(<Playlist />);
    const lane = screen.getByTestId("lane-trk-1");

    // 90px at the default 80px/bar zoom snaps down to bar index 1 (384 ticks).
    fireEvent.click(lane, { clientX: 90, clientY: 10 });

    const clips = Object.values(useAppStore.getState().project.clips);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      trackId: "trk-1",
      patternId: "pat-1", // default project's activePatternId
      startTick: TICKS_PER_BAR,
    });
  });

  it("does not paint a second clip on top of an existing one at the same slot", () => {
    render(<Playlist />);
    const lane = screen.getByTestId("lane-trk-1");
    fireEvent.click(lane, { clientX: 0, clientY: 10 });
    fireEvent.click(lane, { clientX: 10, clientY: 10 }); // still snaps to bar 0
    expect(Object.values(useAppStore.getState().project.clips)).toHaveLength(1);
  });

  it("moves a clip by dragging it, snapped to a bar boundary", () => {
    const clipId = "clip-existing";
    act(() => {
      useAppStore.setState((state) => ({
        project: {
          ...state.project,
          clips: { [clipId]: { id: clipId, trackId: "trk-1", patternId: "pat-1", startTick: 0 } },
        },
      }));
    });

    render(<Playlist />);
    const clip = screen.getByTestId(`clip-${clipId}`);

    fireEvent.pointerDown(clip, { clientX: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 90, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 90, pointerId: 1 });

    expect(useAppStore.getState().project.clips[clipId]?.startTick).toBe(TICKS_PER_BAR);
  });

  it("deletes a clip on right-click", () => {
    const clipId = "clip-existing";
    act(() => {
      useAppStore.setState((state) => ({
        project: {
          ...state.project,
          clips: { [clipId]: { id: clipId, trackId: "trk-1", patternId: "pat-1", startTick: 0 } },
        },
      }));
    });

    render(<Playlist />);
    fireEvent.contextMenu(screen.getByTestId(`clip-${clipId}`));

    expect(useAppStore.getState().project.clips[clipId]).toBeUndefined();
  });

  it("reflects pattern edits in a placed clip's miniature — reference semantics", () => {
    const clipId = "clip-existing";
    act(() => {
      useAppStore.setState((state) => ({
        project: {
          ...state.project,
          clips: { [clipId]: { id: clipId, trackId: "trk-1", patternId: "pat-1", startTick: 0 } },
        },
      }));
    });

    render(<Playlist />);
    const clip = screen.getByTestId(`clip-${clipId}`);
    expect(clip.querySelectorAll("rect")).toHaveLength(0);

    act(() => {
      useAppStore.getState().dispatch(
        addNotes("pat-1", [
          { id: nextId("note"), channelId: "ch-kick", positionTicks: 0, lengthTicks: 0, pitch: 60, velocity: 1 },
        ]),
      );
    });

    expect(screen.getByTestId(`clip-${clipId}`).querySelectorAll("rect")).toHaveLength(1);
  });

  it("toggles a track's mute via its header", () => {
    render(<Playlist />);
    const muteButton = screen.getByLabelText("Mute Track 1");

    fireEvent.click(muteButton);

    expect(useAppStore.getState().project.playlistTracks["trk-1"]?.muted).toBe(true);
    expect(screen.getByLabelText("Unmute Track 1")).toBeInTheDocument();
  });
});

function placeClip(clipId: string, overrides: Partial<{ trackId: string; startTick: number }> = {}) {
  act(() => {
    useAppStore.setState((state) => ({
      project: {
        ...state.project,
        clips: {
          ...state.project.clips,
          [clipId]: {
            id: clipId,
            trackId: overrides.trackId ?? "trk-1",
            patternId: "pat-1",
            startTick: overrides.startTick ?? 0,
          },
        },
      },
    }));
  });
}

describe("ClipView right-click split — header vs body (finding #1)", () => {
  it("right-click on the header opens a menu whose 'Make unique' forks the pattern", () => {
    // Past `resetIds(0)`, the very next id minted is `pat-1` — the default
    // project's own hardcoded pattern id. Bump the counter clear of it first
    // (a real session always has minted other ids by the time a user reaches
    // for "Make unique"); the collision itself is `src/domain/ids.ts`'s to fix.
    resetIds(5);
    placeClip("clip-existing");
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");
    const header = clip.querySelector(".fl-clip__header") as HTMLElement;

    fireEvent.contextMenu(header);
    expect(screen.getByTestId("clip-menu-clip-existing")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Make unique"));

    const clip1 = useAppStore.getState().project.clips["clip-existing"];
    expect(clip1?.patternId).not.toBe("pat-1");
    expect(useAppStore.getState().project.patterns["pat-1"]).toBeDefined();
    expect(useAppStore.getState().project.patterns[clip1!.patternId]).toBeDefined();
  });

  it("right-click on the body still deletes, unaffected by the header menu", () => {
    placeClip("clip-existing");
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");
    const body = clip.querySelector(".fl-clip__body") as HTMLElement;

    fireEvent.contextMenu(body);

    expect(useAppStore.getState().project.clips["clip-existing"]).toBeUndefined();
    expect(screen.queryByTestId("clip-menu-clip-existing")).not.toBeInTheDocument();
  });
});

describe("middle-drag two-axis pan (finding #2)", () => {
  it("pans both scroll axes on a middle-button drag", () => {
    render(<Playlist />);
    const main = screen.getByTestId("playlist-main");
    const scrollx = screen.getByTestId("playlist-scrollx");

    fireEvent.pointerDown(main, { button: 1, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(main, { button: 1, clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(main, { button: 1, clientX: 60, clientY: 40, pointerId: 1 });

    // Dragging left/up by 40/60px pans the view right/down by the same amount.
    expect(scrollx.scrollLeft).toBe(40);
    expect(main.scrollTop).toBe(60);
  });
});

describe("cross-track clip drag (finding #3)", () => {
  it("retargets the clip's track when the pointer crosses a lane boundary", () => {
    placeClip("clip-existing", { trackId: "trk-1", startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    fireEvent.pointerDown(clip, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 0, clientY: LANE_HEIGHT_PX, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 0, clientY: LANE_HEIGHT_PX, pointerId: 1 });

    const moved = useAppStore.getState().project.clips["clip-existing"];
    expect(moved?.trackId).toBe("trk-2");
    expect(moved?.startTick).toBe(0);
  });

  it("clamps the target track to the visible track list", () => {
    placeClip("clip-existing", { trackId: "trk-1", startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    // Only trk-1/trk-2 exist by default; a huge downward drag must not
    // produce a nonexistent trackId.
    fireEvent.pointerDown(clip, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 0, clientY: LANE_HEIGHT_PX * 10, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 0, clientY: LANE_HEIGHT_PX * 10, pointerId: 1 });

    expect(useAppStore.getState().project.clips["clip-existing"]?.trackId).toBe("trk-2");
  });
});

describe("shift+drag clones a clip (finding #4)", () => {
  it("creates a new clip instead of moving the original", () => {
    placeClip("clip-existing", { trackId: "trk-1", startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    fireEvent.pointerDown(clip, { clientX: 0, clientY: 0, pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerMove(clip, { clientX: 90, clientY: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(clip, { clientX: 90, clientY: 0, pointerId: 1, shiftKey: true });

    const clips = useAppStore.getState().project.clips;
    expect(Object.keys(clips)).toHaveLength(2);
    expect(clips["clip-existing"]?.startTick).toBe(0); // original untouched
    const clone = Object.values(clips).find((c) => c.id !== "clip-existing");
    expect(clone?.startTick).toBe(TICKS_PER_BAR); // clone carries the drag
  });

  it("undoes the clone + drag as one entry", () => {
    placeClip("clip-existing", { trackId: "trk-1", startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");
    const before = useAppStore.getState().history.past.length;

    fireEvent.pointerDown(clip, { clientX: 0, clientY: 0, pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerMove(clip, { clientX: 90, clientY: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(clip, { clientX: 90, clientY: 0, pointerId: 1, shiftKey: true });

    expect(useAppStore.getState().history.past.length).toBe(before + 1);
  });
});

describe("native non-passive Ctrl+wheel zoom (findings #5, #6)", () => {
  it("zooms on Ctrl+wheel", () => {
    render(<Playlist />);
    const scrollx = screen.getByTestId("playlist-scrollx");
    const before = useAppStore.getState().playlistZoomPxPerBar;

    fireEvent.wheel(scrollx, { ctrlKey: true, deltaY: -100, clientX: 40 });

    expect(useAppStore.getState().playlistZoomPxPerBar).toBeGreaterThan(before);
  });

  it("keeps the tick under the cursor fixed by compensating scrollLeft", () => {
    render(<Playlist />);
    const scrollx = screen.getByTestId("playlist-scrollx") as HTMLDivElement;
    Object.defineProperty(scrollx, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 800, top: 0, bottom: 400, width: 800, height: 400 }),
    });
    scrollx.scrollLeft = 0;

    const before = useAppStore.getState().playlistZoomPxPerBar; // 80
    fireEvent.wheel(scrollx, { ctrlKey: true, deltaY: -100, clientX: 40 });
    const after = useAppStore.getState().playlistZoomPxPerBar;

    // anchorTicks = pxToTicks(0 + 40, before); expected scrollLeft keeps that
    // tick at the same 40px offset under the new zoom.
    const anchorTicks = (40 / before) * TICKS_PER_BAR;
    const expectedScrollLeft = Math.max(0, (anchorTicks / TICKS_PER_BAR) * after - 40);
    expect(scrollx.scrollLeft).toBeCloseTo(expectedScrollLeft, 5);
  });
});

describe("per-gesture coalesce keys (finding #7)", () => {
  it("keeps two separate drags of the same clip as two separate undo entries", () => {
    placeClip("clip-existing", { trackId: "trk-1", startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");
    const before = useAppStore.getState().history.past.length;

    fireEvent.pointerDown(clip, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 90, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 90, clientY: 0, pointerId: 1 });

    fireEvent.pointerDown(clip, { clientX: 90, clientY: 0, pointerId: 2 });
    fireEvent.pointerMove(clip, { clientX: 180, clientY: 0, pointerId: 2 });
    fireEvent.pointerUp(clip, { clientX: 180, clientY: 0, pointerId: 2 });

    expect(useAppStore.getState().history.past.length).toBe(before + 2);
    expect(useAppStore.getState().project.clips["clip-existing"]?.startTick).toBe(2 * TICKS_PER_BAR);
  });
});

describe("the clip context menu must not leak events back into the clip (round 5 #4)", () => {
  /** Open the header menu on a placed clip and return the clip element. */
  function openMenu(clipId = "clip-existing"): HTMLElement {
    resetIds(5);
    placeClip(clipId);
    render(<Playlist />);
    const clip = screen.getByTestId(`clip-${clipId}`);
    fireEvent.contextMenu(clip.querySelector(".fl-clip__header") as HTMLElement);
    expect(screen.getByTestId(`clip-menu-${clipId}`)).toBeInTheDocument();
    return clip;
  }

  function backdrop(clip: HTMLElement): HTMLElement {
    return clip.querySelector(".fl-clip__context-menu-backdrop") as HTMLElement;
  }

  it("right-clicking the backdrop dismisses the menu WITHOUT deleting the clip", () => {
    const clip = openMenu();

    // The backdrop lives inside `.fl-clip`, so this event bubbles into the
    // clip's own contextmenu handler — which deletes, because the target is
    // not the header. `preventDefault` alone never stopped that.
    fireEvent.contextMenu(backdrop(clip));

    expect(useAppStore.getState().project.clips["clip-existing"]).toBeDefined();
    expect(screen.queryByTestId("clip-menu-clip-existing")).not.toBeInTheDocument();
  });

  it("right-clicking a menu ITEM does not delete the clip either", () => {
    openMenu();

    fireEvent.contextMenu(screen.getByText("Make unique"));

    expect(useAppStore.getState().project.clips["clip-existing"]).toBeDefined();
  });

  it("click-dismissing the backdrop does not select the clip through the drag handlers", () => {
    const clip = openMenu();
    useAppStore.setState({ playlistSelectedClipId: null });

    fireEvent.pointerDown(backdrop(clip), { button: 0, pointerId: 9, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(backdrop(clip), { button: 0, pointerId: 9, clientX: 5, clientY: 5 });
    fireEvent.click(backdrop(clip));

    expect(useAppStore.getState().playlistSelectedClipId).toBeNull();
    expect(screen.queryByTestId("clip-menu-clip-existing")).not.toBeInTheDocument();
  });

  it("SHIFT+clicking a menu item runs the item without cloning the clip", () => {
    openMenu();
    const clipsBefore = Object.keys(useAppStore.getState().project.clips).length;

    const item = screen.getByText("Make unique");
    fireEvent.pointerDown(item, { button: 0, pointerId: 7, shiftKey: true, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(item, { button: 0, pointerId: 7, shiftKey: true, clientX: 5, clientY: 5 });
    fireEvent.click(item, { shiftKey: true });

    // Shift+pointer-down on a clip clones it; the menu must not be a clip.
    expect(Object.keys(useAppStore.getState().project.clips)).toHaveLength(clipsBefore);
    expect(useAppStore.getState().project.clips["clip-existing"]?.patternId).not.toBe("pat-1");
  });

  it("double-clicking the menu does not open the clip's pattern in the piano roll", () => {
    resetIds(5);
    // A clip on a pattern that is NOT the active one, so "open it" is visible.
    act(() => {
      useAppStore.setState((state) => ({
        project: {
          ...state.project,
          patterns: {
            ...state.project.patterns,
            "pat-other": { id: "pat-other", name: "Other", color: "#888", notes: {} },
          },
          patternOrder: [...state.project.patternOrder, "pat-other"],
          clips: {
            "clip-other": {
              id: "clip-other",
              trackId: "trk-1",
              patternId: "pat-other",
              startTick: 0,
            },
          },
        },
      }));
    });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-other");
    fireEvent.contextMenu(clip.querySelector(".fl-clip__header") as HTMLElement);
    const activeBefore = useAppStore.getState().project.activePatternId;

    fireEvent.doubleClick(backdrop(clip));

    expect(useAppStore.getState().project.activePatternId).toBe(activeBefore);
  });
});

/*
 * Round 6 #4. SPEC.md §4.4: "Alt held | bypass snap for this gesture". The
 * playlist honoured it nowhere — paint and clip drags always snapped to a bar.
 */
describe("Alt bypasses snap (round 6 #4)", () => {
  it("paints a clip at the raw tick under the pointer when Alt is held", () => {
    render(<Playlist />);
    const lane = screen.getByTestId("lane-trk-1");

    // 40px at 80px/bar is half a bar — snapped that is tick 0, raw it is 192.
    fireEvent.click(lane, { clientX: 40, clientY: 10, altKey: true });

    const clips = Object.values(useAppStore.getState().project.clips);
    expect(clips).toHaveLength(1);
    expect(clips[0]?.startTick).toBe(TICKS_PER_BAR / 2);
  });

  it("still snaps the same paint without Alt", () => {
    render(<Playlist />);
    fireEvent.click(screen.getByTestId("lane-trk-1"), { clientX: 40, clientY: 10 });

    expect(Object.values(useAppStore.getState().project.clips)[0]?.startTick).toBe(0);
  });

  it("can still erase an Alt-placed clip from the lane it sits off-grid in", () => {
    placeClip("clip-existing", { startTick: 100 }); // off every bar boundary
    render(<Playlist />);

    // 30px at 80px/bar is tick 144 — inside the clip's bar-wide extent, but
    // not equal to the bar boundary a snapped lookup would have asked for.
    fireEvent.contextMenu(screen.getByTestId("lane-trk-1"), { clientX: 30, clientY: 10 });

    expect(useAppStore.getState().project.clips["clip-existing"]).toBeUndefined();
  });

  it("moves a clip by the exact dragged distance when Alt is held", () => {
    placeClip("clip-existing", { startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    // 20px at 80px/bar = 96 ticks: a quarter bar, which snap would erase.
    fireEvent.pointerDown(clip, { clientX: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 20, pointerId: 1, altKey: true });
    fireEvent.pointerUp(clip, { clientX: 20, pointerId: 1, altKey: true });

    expect(useAppStore.getState().project.clips["clip-existing"]?.startTick).toBe(
      TICKS_PER_BAR / 4,
    );
  });

  it("snaps that same 20px move away to nothing without Alt", () => {
    placeClip("clip-existing", { startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    fireEvent.pointerDown(clip, { clientX: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 20, pointerId: 1 });

    expect(useAppStore.getState().project.clips["clip-existing"]?.startTick).toBe(0);
  });
});

/*
 * Round 6 #5. A clip MOVE floored to a bar, which made the gesture
 * asymmetric: nudging four pixels left of a boundary crossed it and jumped
 * the clip a whole bar back, while four pixels right did nothing at all.
 * Nearest-bar puts the boundary where the user sees it — halfway.
 */
describe("clip moves snap to the NEAREST bar (round 6 #5)", () => {
  it("does not fall a whole bar back on a small leftward nudge", () => {
    placeClip("clip-existing", { startTick: TICKS_PER_BAR * 2 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    // 4px left at 80px/bar ≈ 19 ticks — far short of half a bar.
    fireEvent.pointerDown(clip, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 96, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 96, pointerId: 1 });

    expect(useAppStore.getState().project.clips["clip-existing"]?.startTick).toBe(
      TICKS_PER_BAR * 2,
    );
  });

  it("treats a small rightward nudge exactly the same way", () => {
    placeClip("clip-existing", { startTick: TICKS_PER_BAR * 2 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    fireEvent.pointerDown(clip, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 104, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 104, pointerId: 1 });

    expect(useAppStore.getState().project.clips["clip-existing"]?.startTick).toBe(
      TICKS_PER_BAR * 2,
    );
  });

  it("moves a whole bar once the drag passes the halfway point", () => {
    placeClip("clip-existing", { startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    // 44px of 80 is past half a bar; flooring would have kept it at bar 0.
    fireEvent.pointerDown(clip, { clientX: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 44, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 44, pointerId: 1 });

    expect(useAppStore.getState().project.clips["clip-existing"]?.startTick).toBe(TICKS_PER_BAR);
  });
});

/*
 * Round 6 #6. SPEC.md §4.4: "Right-click-drag | delete multiple". Only the
 * one clip the button went down on died — deletion hung off `contextmenu`,
 * which fires exactly once per press, so the pointer could sweep the whole
 * arrangement with the right button held and nothing else happened.
 */
describe("right-drag erases a sweep of clips (round 6 #6)", () => {
  function placeThree(): void {
    for (const [index, id] of ["clip-a", "clip-b", "clip-c"].entries()) {
      placeClip(id, { startTick: TICKS_PER_BAR * index });
    }
  }

  it("deletes every clip the sweep crosses, not just the first", () => {
    placeThree();
    render(<Playlist />);

    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    fireEvent.pointerEnter(screen.getByTestId("clip-clip-b"), { buttons: 2 });
    fireEvent.pointerEnter(screen.getByTestId("clip-clip-c"), { buttons: 2 });

    expect(Object.keys(useAppStore.getState().project.clips)).toHaveLength(0);
  });

  it("erases clips a sweep reaches even when it began on empty lane space", () => {
    placeThree();
    render(<Playlist />);

    fireEvent.pointerEnter(screen.getByTestId("clip-clip-b"), { buttons: 2 });

    expect(Object.keys(useAppStore.getState().project.clips)).toEqual(["clip-a", "clip-c"]);
  });

  it("leaves clips alone when the pointer merely hovers with no button held", () => {
    placeThree();
    render(<Playlist />);

    fireEvent.pointerEnter(screen.getByTestId("clip-clip-b"), { buttons: 0 });
    fireEvent.pointerEnter(screen.getByTestId("clip-clip-c"), { buttons: 1 }); // left-drag

    expect(Object.keys(useAppStore.getState().project.clips)).toHaveLength(3);
  });
});

/*
 * Round 7 #2. SPEC.md §7 / §2.1: a drag is ONE undo entry. The sweep deletes
 * through `ClipView`'s `onPointerEnter`, one `removeClip` dispatch per clip
 * crossed, and each landed as its own history entry — wiping eight bars took
 * eight Ctrl+Z.
 */
describe("an erase sweep is ONE undo entry (round 7 #2)", () => {
  function sweepThree(): void {
    for (const [index, id] of ["clip-a", "clip-b", "clip-c"].entries()) {
      placeClip(id, { startTick: TICKS_PER_BAR * index });
    }
    render(<Playlist />);
    const main = screen.getByTestId("playlist-main");

    fireEvent.pointerDown(main, { button: 2, buttons: 2, pointerId: 7 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    fireEvent.pointerEnter(screen.getByTestId("clip-clip-b"), { buttons: 2 });
    fireEvent.pointerEnter(screen.getByTestId("clip-clip-c"), { buttons: 2 });
    fireEvent.pointerUp(main, { pointerId: 7 });
  }

  it("records one history entry for the whole sweep, not one per clip", () => {
    sweepThree();
    expect(Object.keys(useAppStore.getState().project.clips)).toHaveLength(0);
    expect(useAppStore.getState().history.past).toHaveLength(1);
  });

  it("restores every swept clip on a SINGLE undo", () => {
    sweepThree();
    act(() => {
      useAppStore.getState().undo();
    });
    expect(Object.keys(useAppStore.getState().project.clips).sort()).toEqual([
      "clip-a",
      "clip-b",
      "clip-c",
    ]);
  });

  it("keeps two separate sweeps as two separate entries", () => {
    placeClip("clip-a", { startTick: 0 });
    placeClip("clip-b", { startTick: TICKS_PER_BAR });
    render(<Playlist />);
    const main = screen.getByTestId("playlist-main");

    fireEvent.pointerDown(main, { button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    fireEvent.pointerUp(main, { pointerId: 1 });

    fireEvent.pointerDown(main, { button: 2, buttons: 2, pointerId: 2 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-b"));
    fireEvent.pointerUp(main, { pointerId: 2 });

    expect(useAppStore.getState().history.past).toHaveLength(2);
    act(() => {
      useAppStore.getState().undo();
    });
    expect(Object.keys(useAppStore.getState().project.clips)).toEqual(["clip-b"]);
  });

  it("does not weld an unrelated delete onto a sweep the pointer never closed", () => {
    placeClip("clip-a", { startTick: 0 });
    placeClip("clip-b", { startTick: TICKS_PER_BAR });
    render(<Playlist />);
    const main = screen.getByTestId("playlist-main");

    fireEvent.pointerDown(main, { button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    fireEvent.pointerCancel(main, { pointerId: 1 });

    // A later, unrelated delete through the header menu.
    fireEvent.contextMenu(screen.getByTestId("clip-clip-b"));

    expect(useAppStore.getState().history.past).toHaveLength(2);
  });
});

/*
 * Round 7 #5, through the surface: `Math.round`'s tie-toward-+∞ made a drag of
 * exactly half a bar move the clip rightward and NOT leftward.
 */
describe("a half-bar drag moves the same distance both ways (round 7 #5)", () => {
  it("drops a clip a bar back on an exactly-half-bar leftward drag", () => {
    placeClip("clip-existing", { startTick: TICKS_PER_BAR * 2 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    // 40px of the default 80px/bar is exactly half a bar.
    fireEvent.pointerDown(clip, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 60, pointerId: 1 });

    expect(useAppStore.getState().project.clips["clip-existing"]?.startTick).toBe(TICKS_PER_BAR);
  });

  it("advances it a bar on the mirror-image rightward drag", () => {
    placeClip("clip-existing", { startTick: TICKS_PER_BAR * 2 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    fireEvent.pointerDown(clip, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 140, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 140, pointerId: 1 });

    expect(useAppStore.getState().project.clips["clip-existing"]?.startTick).toBe(
      TICKS_PER_BAR * 3,
    );
  });
});

/* ------------------------------------------- the gesture class (round 8) -- */

/**
 * The playlist's two ROOT-managed drags — the right-button erase sweep and the
 * middle-button pan — kept their state in refs the store could not see, so
 * neither took a persistence hold, neither released on unmount, and the
 * sweep's id came from a component-local `useRef` that a remount rewound.
 * All three now come from `useGestureSession` (`@/lib/gestureHold`).
 */
describe("Playlist root drags — the gesture class (round 8)", () => {
  function main(): HTMLElement {
    return screen.getByTestId("playlist-main");
  }

  it("registers a persistence hold for the whole erase sweep (rule a)", () => {
    placeClip("clip-a", { startTick: 0 });
    placeClip("clip-b", { startTick: TICKS_PER_BAR });
    render(<Playlist />);

    fireEvent.pointerDown(main(), { button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    // SPEC.md §2.2: the sweep dispatches a `removeClip` per clip crossed, so a
    // slow sweep must not let the autosave debounce expire mid-gesture.
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerUp(main(), { pointerId: 1 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("registers — and releases — a hold for the middle-drag pan (rule a)", () => {
    render(<Playlist />);

    fireEvent.pointerDown(main(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 2 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerUp(main(), { pointerId: 2 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("releases the sweep's hold on pointercancel (rule b)", () => {
    placeClip("clip-a", { startTick: 0 });
    render(<Playlist />);

    fireEvent.pointerDown(main(), { button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    fireEvent.pointerCancel(main(), { pointerId: 1 });

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("releases the sweep's hold when the surface unmounts mid-sweep (rule b)", () => {
    placeClip("clip-a", { startTick: 0 });
    const view = render(<Playlist />);

    fireEvent.pointerDown(main(), { button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    view.unmount();

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  /*
   * Round 9 #2. The sweep is a SECONDARY-button drag, so it cannot take
   * pointer capture without swallowing the context menu, and `onPointerUp` on
   * the surface only fires for a release inside its bounds. Sweeping off the
   * lanes and releasing over another panel — or losing the pointer to a
   * system gesture, which delivers `pointercancel` and no `pointerup` at all —
   * stranded the hold, and autosave stayed deferred for the rest of the
   * session. A window backstop closes both (`@/lib/gestureHold` rule (f)).
   */
  it.each([
    ["pointerup", () => fireEvent.pointerUp(window, { pointerId: 1 })],
    ["pointercancel", () => fireEvent.pointerCancel(window, { pointerId: 1 })],
  ])("releases a sweep whose %s landed OFF the playlist (round 9 #2)", (_name, terminate) => {
    placeClip("clip-a", { startTick: 0 });
    render(<Playlist />);

    fireEvent.pointerDown(main(), { button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    terminate();

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("releases a middle-drag pan that ended off the playlist too (round 9 #2)", () => {
    render(<Playlist />);

    fireEvent.pointerDown(main(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 2 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerCancel(window, { pointerId: 2 });

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  /*
   * Round 10 #2. The backstop above released the HOLD but not the pan's own
   * `middlePan` ref, which lives in this component — so the session was over
   * and the lanes still scrolled under every later HOVER, with no button
   * held. The ref now dies with the session (`@/lib/gestureHold`'s
   * `onCancel`) rather than through a second reset each release path has to
   * remember.
   */
  it.each([
    ["pointerup", () => fireEvent.pointerUp(window, { pointerId: 2 })],
    ["pointercancel", () => fireEvent.pointerCancel(window, { pointerId: 2 })],
  ])("stops panning on a hover after the backstop's %s (round 10 #2)", (_name, terminate) => {
    render(<Playlist />);
    const scrollx = screen.getByTestId("playlist-scrollx");

    fireEvent.pointerDown(main(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 2 });
    fireEvent.pointerMove(main(), { clientX: 80, clientY: 100, pointerId: 2 });
    expect(scrollx.scrollLeft).toBe(20);

    terminate();

    // A plain hover, no buttons down.
    fireEvent.pointerMove(main(), { clientX: 10, clientY: 100, buttons: 0, pointerId: 2 });
    expect(scrollx.scrollLeft).toBe(20);
  });

  it("abandons a clip drag whose project was replaced mid-gesture (round 10 #1)", () => {
    placeClip("clip-existing", { trackId: "trk-1", startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-existing");

    fireEvent.pointerDown(clip, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(clip, { clientX: 0, clientY: LANE_HEIGHT_PX, pointerId: 1 });

    act(() => {
      useAppStore.setState({ projectRevision: useAppStore.getState().projectRevision + 1 });
    });
    const before = useAppStore.getState().project.clips["clip-existing"];

    // The release the user was always going to make. Committing it would
    // write a move computed against a project that no longer exists.
    fireEvent.pointerUp(clip, { clientX: 0, clientY: LANE_HEIGHT_PX, pointerId: 1 });

    expect(useAppStore.getState().project.clips["clip-existing"]).toEqual(before);
  });

  it("stops panning when an undo replaces the project mid-pan (round 10 #1)", () => {
    render(<Playlist />);
    const scrollx = screen.getByTestId("playlist-scrollx");

    fireEvent.pointerDown(main(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 2 });
    fireEvent.pointerMove(main(), { clientX: 80, clientY: 100, pointerId: 2 });
    expect(scrollx.scrollLeft).toBe(20);

    act(() => {
      useAppStore.setState({ projectRevision: useAppStore.getState().projectRevision + 1 });
    });

    fireEvent.pointerMove(main(), { clientX: 10, clientY: 100, pointerId: 2 });
    expect(scrollx.scrollLeft).toBe(20);
  });

  it("does not weld a sweep onto the previous MOUNT's sweep (rule c)", () => {
    placeClip("clip-a", { startTick: 0 });
    placeClip("clip-b", { startTick: TICKS_PER_BAR });
    const first = render(<Playlist />);

    fireEvent.pointerDown(main(), { button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-a"));
    fireEvent.pointerUp(main(), { pointerId: 1 });
    first.unmount();

    // The remount an F5-equivalent re-render performs. The old counter lived
    // in a `useRef`, so this sweep re-minted `playlist-erase#1` and folded
    // itself onto the first sweep's entry — one Ctrl+Z took back both.
    render(<Playlist />);
    fireEvent.pointerDown(main(), { button: 2, buttons: 2, pointerId: 1 });
    fireEvent.contextMenu(screen.getByTestId("clip-clip-b"));
    fireEvent.pointerUp(main(), { pointerId: 1 });

    expect(useAppStore.getState().history.past).toHaveLength(2);
    act(() => {
      useAppStore.getState().undo();
    });
    expect(Object.keys(useAppStore.getState().project.clips)).toEqual(["clip-b"]);
  });
});

describe("ClipView drag — the gesture class (round 8)", () => {
  it("registers a hold for the primary drag and releases it on pointerup", () => {
    placeClip("clip-a", { startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-a");

    fireEvent.pointerDown(clip, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    fireEvent.pointerMove(clip, { clientX: 90, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 90, clientY: 0, pointerId: 1 });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("releases the hold on pointercancel, which never delivers a pointerup (rule b)", () => {
    placeClip("clip-a", { startTick: 0 });
    render(<Playlist />);
    const clip = screen.getByTestId("clip-clip-a");

    fireEvent.pointerDown(clip, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(clip, { clientX: 90, clientY: 0, pointerId: 1 });
    fireEvent.pointerCancel(clip, { pointerId: 1 });

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
    // A cancelled drag is abandoned, not committed.
    expect(useAppStore.getState().project.clips["clip-a"]?.startTick).toBe(0);

    // And the abandoned drag is really GONE: a stray pointer-up afterwards
    // (the cancel delivered no `pointerup`, so one can still arrive from the
    // hover that follows) must not commit the move it was holding.
    fireEvent.pointerMove(clip, { clientX: 180, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 180, clientY: 0, pointerId: 1 });
    expect(useAppStore.getState().project.clips["clip-a"]?.startTick).toBe(0);
    expect(useAppStore.getState().history.past).toHaveLength(0);
  });

  it("releases the hold when the clip unmounts under the pointer (rule b)", () => {
    placeClip("clip-a", { startTick: 0 });
    const view = render(<Playlist />);

    fireEvent.pointerDown(screen.getByTestId("clip-clip-a"), {
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: 1,
    });
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    view.unmount();

    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("does not weld a drag onto the previous MOUNT's drag (rule c)", () => {
    placeClip("clip-a", { startTick: 0 });
    const first = render(<Playlist />);
    fireEvent.pointerDown(screen.getByTestId("clip-clip-a"), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(screen.getByTestId("clip-clip-a"), { clientX: 90, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(screen.getByTestId("clip-clip-a"), { clientX: 90, clientY: 0, pointerId: 1 });
    first.unmount();

    render(<Playlist />);
    fireEvent.pointerDown(screen.getByTestId("clip-clip-a"), { button: 0, clientX: 90, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(screen.getByTestId("clip-clip-a"), { clientX: 180, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(screen.getByTestId("clip-clip-a"), { clientX: 180, clientY: 0, pointerId: 1 });

    expect(useAppStore.getState().history.past).toHaveLength(2);
  });
});

/*
 * Round 8 #9. `playlistScrollX` was declared on the slice and wired to
 * nothing: no writer, no reader, so a remount put the arrangement back at
 * bar 1 while the store still said 0 either way.
 */
describe("playlist scroll position survives a remount (round 8 #9)", () => {
  it("writes the scroller's position into the UI slice", () => {
    render(<Playlist />);
    const scroller = screen.getByTestId("playlist-scrollx");

    scroller.scrollLeft = 240;
    fireEvent.scroll(scroller);

    expect(useAppStore.getState().playlistScrollX).toBe(240);
  });

  it("restores it on the next mount", () => {
    const first = render(<Playlist />);
    const scroller = screen.getByTestId("playlist-scrollx");
    scroller.scrollLeft = 240;
    fireEvent.scroll(scroller);
    first.unmount();

    render(<Playlist />);

    expect(screen.getByTestId("playlist-scrollx").scrollLeft).toBe(240);
  });

  it("records the position a middle-drag pan scrolled to", () => {
    render(<Playlist />);
    const main = screen.getByTestId("playlist-main");

    fireEvent.pointerDown(main, { button: 1, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(main, { clientX: 40, clientY: 100, pointerId: 1 });
    fireEvent.scroll(screen.getByTestId("playlist-scrollx"));
    fireEvent.pointerUp(main, { pointerId: 1 });

    expect(useAppStore.getState().playlistScrollX).toBe(60);
  });
});
