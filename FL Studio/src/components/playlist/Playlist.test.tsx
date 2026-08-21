import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Playlist } from "./Playlist";
import { __resetClipGestureCounterForTests } from "./ClipView";
import { LANE_HEIGHT_PX } from "./geometry";
import { DEFAULT_PLAYLIST_UI } from "./uiState";
import { addNotes } from "@/domain/commands";
import { createHistory } from "@/domain/undo";
import { createDefaultProject } from "@/domain/defaultProject";
import { nextId, resetIds } from "@/domain/ids";
import { TICKS_PER_BAR } from "@/domain/types";
import { useAppStore } from "@/lib/store";

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
  __resetClipGestureCounterForTests();
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
