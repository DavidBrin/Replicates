import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { MASTER_MIXER_TRACK_ID } from "@/domain/types";
import type { EngineSnapshot } from "@/audio";
import * as audio from "@/audio";
import { IDLE_POLL_MS, IDLE_SILENCE_MS, useMeter } from "./useMeter";

/** A minimal probe that renders the hook's return value into the DOM as text. */
function Probe({ trackId }: { trackId: string }) {
  const { left, right } = useMeter(trackId);
  return <div data-testid="probe">{`${left},${right}`}</div>;
}

/** A tap whose level the test can move between reads. */
function tapReading(peak: () => number): AnalyserNode {
  return {
    fftSize: 4,
    getFloatTimeDomainData: (buffer: Float32Array) => {
      const value = peak();
      buffer.set([value * 0.5, -value, value * 0.2, 0]);
    },
  } as unknown as AnalyserNode;
}

/**
 * A tap that reads hot exactly ONCE — a preview shorter than the gap between
 * two reads. Anything that samples, throws the sample away and reads again
 * sees silence, which is precisely the defect these tests guard.
 */
function tapReadingOnce(peak: number): { tap: AnalyserNode; reads: () => number } {
  let reads = 0;
  const tap = tapReading(() => {
    reads += 1;
    return reads === 1 ? peak : 0;
  });
  return { tap, reads: () => reads };
}

let frames: FrameRequestCallback[] = [];
let listeners: ((snapshot: EngineSnapshot) => void)[] = [];

/** The engine's preview counter, so a test can announce one (round 13 #4). */
let previewRevision = 0;

function snapshot(started: boolean, playing: boolean): EngineSnapshot {
  return { started, playing, mode: "pattern", metronomeEnabled: false, previewRevision };
}

/** Point the engine seam at a fake transport state. */
function mockEngine(started: boolean, playing: boolean): void {
  vi.spyOn(audio, "getSnapshot").mockReturnValue(snapshot(started, playing));
  vi.spyOn(audio, "isPlaying").mockImplementation(() => playing);
}

/** Run every frame currently queued (one animation frame's worth). */
function flushFrame(): void {
  const queued = frames;
  frames = [];
  act(() => {
    for (const callback of queued) callback(0);
  });
}

/**
 * Fire a preview the way the engine does: bump the revision, then emit — the
 * voice is already triggered by the time a listener runs.
 */
function emitPreview(): void {
  previewRevision += 1;
  act(() => {
    for (const listener of [...listeners]) listener(snapshot(true, false));
  });
}

function emit(started: boolean, playing: boolean): void {
  vi.spyOn(audio, "isPlaying").mockImplementation(() => playing);
  act(() => {
    for (const listener of [...listeners]) listener(snapshot(started, playing));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  listeners = [];
  previewRevision = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(audio, "subscribe").mockImplementation((listener) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((entry) => entry !== listener);
    };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useMeter — no engine booted (SPEC §3.1's lazy/gesture-gated boot)", () => {
  it("renders silence without throwing when getMeterTap returns null", () => {
    mockEngine(false, false);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(null);

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);

    expect(getByTestId("probe").textContent).toBe("0,0");
  });

  it("schedules NO animation frame and NO poll before the engine has started", () => {
    mockEngine(false, false);
    const getTap = vi.spyOn(audio, "getMeterTap").mockReturnValue(null);

    render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);

    expect(frames).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    // Nine idle strips must not even be reading the engine.
    expect(getTap).not.toHaveBeenCalled();
  });
});

describe("useMeter — active while there is sound", () => {
  it("reads AnalyserNode peak data via getFloatTimeDomainData when playing", () => {
    mockEngine(true, true);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => 0.6));

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    flushFrame();

    const [left, right] = getByTestId("probe").textContent!.split(",").map(Number);
    expect(left).toBeCloseTo(0.6, 5);
    expect(right).toBeCloseTo(0.6, 5);
  });

  it("keeps the ballistic falloff smooth once the sound stops", () => {
    mockEngine(true, true);
    let peak = 0.8;
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => peak));

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    flushFrame();
    const loud = Number(getByTestId("probe").textContent!.split(",")[0]);
    peak = 0;
    flushFrame();
    const decayed = Number(getByTestId("probe").textContent!.split(",")[0]);

    expect(decayed).toBeLessThan(loud);
    expect(decayed).toBeGreaterThan(0); // a glide, not a cut
  });

  it("wakes from idle when the engine reports it started playing", () => {
    mockEngine(false, false);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => 0.5));

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    expect(frames).toHaveLength(0);

    emit(true, true); // engine.subscribe fires on play

    expect(frames).toHaveLength(1);
    flushFrame();
    expect(Number(getByTestId("probe").textContent!.split(",")[0])).toBeCloseTo(0.5, 5);
  });
});

describe("useMeter — idle suspension", () => {
  it("watches on a slow interval, not a frame loop, while started but stopped", () => {
    mockEngine(true, false);
    let peak = 0;
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => peak));

    render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);

    expect(frames).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);

    // A key preview makes sound with no transport-state change at all…
    peak = 0.4;
    act(() => {
      vi.advanceTimersByTime(IDLE_POLL_MS);
    });
    // …and the meter promotes itself to a real frame loop.
    expect(frames).toHaveLength(1);
  });

  it("SHOWS a short preview it caught, instead of discarding the sample", () => {
    mockEngine(true, false);
    // A ~40 ms key preview against a 250 ms watcher: ONE read sees it, and
    // that read is the only one that ever will. Promoting to rAF and
    // re-reading the tap (what this did) showed nothing at all.
    const { tap } = tapReadingOnce(0.4);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tap);

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    expect(getByTestId("probe").textContent).toBe("0,0");

    act(() => {
      vi.advanceTimersByTime(IDLE_POLL_MS);
    });

    const [left, right] = getByTestId("probe").textContent!.split(",").map(Number);
    expect(left).toBeCloseTo(0.4, 5);
    expect(right).toBeCloseTo(0.4, 5);
    expect(frames).toHaveLength(1); // …and it is now on the frame loop
  });

  it("decays that one-shot preview from where it was seen, not from zero", () => {
    mockEngine(true, false);
    const { tap } = tapReadingOnce(0.4);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tap);

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    act(() => {
      vi.advanceTimersByTime(IDLE_POLL_MS);
    });
    flushFrame();

    const decayed = Number(getByTestId("probe").textContent!.split(",")[0]);
    expect(decayed).toBeLessThan(0.4);
    expect(decayed).toBeGreaterThan(0); // a glide down from what was seen
  });

  it("stays parked when the watcher reads true silence", () => {
    mockEngine(true, false);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => 0));

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    act(() => {
      vi.advanceTimersByTime(IDLE_POLL_MS * 4);
    });

    expect(frames).toHaveLength(0);
    expect(getByTestId("probe").textContent).toBe("0,0");
  });

  it("parks the frame loop after sustained silence with the transport stopped", () => {
    mockEngine(true, true);
    let peak = 0.9;
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => peak));

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    flushFrame();
    expect(frames).toHaveLength(1); // still looping

    peak = 0;
    emit(true, false); // stopped
    flushFrame();
    expect(frames).toHaveLength(1); // decay still on screen, not cut short

    // Silence has to be *sustained*: the loop keeps running while the ballistic
    // falloff is still visible, and only parks once it has bottomed out AND
    // IDLE_SILENCE_MS has passed with the transport stopped.
    let framesRun = 0;
    while (frames.length > 0 && framesRun < 500) {
      framesRun += 1;
      act(() => {
        vi.advanceTimersByTime(16);
      });
      flushFrame();
    }
    expect(framesRun).toBeGreaterThan(IDLE_SILENCE_MS / 16); // it waited

    expect(frames).toHaveLength(0); // parked
    expect(getByTestId("probe").textContent).toBe("0,0");
    expect(vi.getTimerCount()).toBe(1); // …down to the slow idle watcher
  });

  it("stops everything when the hook unmounts", () => {
    mockEngine(true, true);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => 0.5));

    const { unmount } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    flushFrame();
    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(listeners).toHaveLength(0);
    // A frame that was already queued when we unmounted must be inert.
    expect(() => flushFrame()).not.toThrow();
    expect(frames).toHaveLength(0);
  });
});

/*
 * Round 13 #4. With the transport stopped the meter sat on a 250 ms poll,
 * and a preview voice lasts 40–180 ms: it could start and finish entirely
 * between two reads, so the needle never moved for the gesture the user had
 * just made. The engine announces previews on its snapshot channel now, and
 * the meter switches to the frame loop on the announcement rather than
 * hoping to catch the sound with a poll.
 */
describe("useMeter — a preview wakes the meter directly (round 13)", () => {
  /** A tap that reads silent for the first N reads, then hot — a voice ramping in. */
  function tapHotAfter(reads: number, peak: number): AnalyserNode {
    let seen = 0;
    return tapReading(() => {
      seen += 1;
      return seen > reads ? peak : 0;
    });
  }

  it("promotes to the frame loop on the announcement, not on the next poll", () => {
    mockEngine(true, false);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => 0.5));

    render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    expect(frames).toHaveLength(0); // idle: a poll, no frames

    emitPreview();

    // No timer advanced at all — the wake came from the event.
    expect(frames).toHaveLength(1);
  });

  it("shows a preview shorter than the poll interval", () => {
    mockEngine(true, false);
    // Hot for exactly one read, and that read only ever happens because the
    // preview announced itself: a 250 ms poll would sample long after the
    // 40 ms voice had gone.
    const { tap } = tapReadingOnce(0.6);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tap);

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    emitPreview();

    const [left, right] = getByTestId("probe").textContent!.split(",").map(Number);
    expect(left).toBeCloseTo(0.6, 5);
    expect(right).toBeCloseTo(0.6, 5);
  });

  it("catches a voice that has not ramped up yet, because it is now on rAF", () => {
    mockEngine(true, false);
    // Silent at the announcement — the trigger is scheduled a hair ahead of
    // `currentTime` — and hot a frame later. The poll would next look 250 ms
    // on, by which time a short preview is over.
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapHotAfter(1, 0.7));

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    emitPreview();
    expect(getByTestId("probe").textContent).toBe("0,0");

    flushFrame();

    expect(Number(getByTestId("probe").textContent!.split(",")[0])).toBeCloseTo(0.7, 5);
  });

  it("does not wake a meter whose engine has not started", () => {
    mockEngine(false, false);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => 0.5));

    render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    previewRevision += 1;
    act(() => {
      for (const listener of [...listeners]) listener(snapshot(false, false));
    });

    expect(frames).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not read a MOUNT as a preview, however many have been played", () => {
    previewRevision = 12; // previews earlier in the session
    mockEngine(true, false);
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => 0.5));

    render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);

    expect(frames).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1); // parked on the idle poll, as it should be
  });

  it("keeps the idle poll as the backstop for level with no announcement", () => {
    // A voice still ringing after the transport stopped: nothing announces it,
    // and the watcher is what has to notice.
    mockEngine(true, false);
    let peak = 0;
    vi.spyOn(audio, "getMeterTap").mockReturnValue(tapReading(() => peak));

    render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);
    peak = 0.3;
    act(() => {
      vi.advanceTimersByTime(IDLE_POLL_MS);
    });

    expect(frames).toHaveLength(1);
  });
});
