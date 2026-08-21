import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Playlist } from "./Playlist";
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
