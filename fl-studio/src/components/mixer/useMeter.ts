"use client";

/**
 * The mixer's ONE engine seam (SPEC §3.4, §8 "one file with a documented
 * seam"). Every touch of `@/audio` from this surface happens here — no other
 * file under `src/components/mixer` imports `@/audio`.
 *
 * Reads `getMeterTap(trackId)` on a `requestAnimationFrame` loop and computes
 * a 0..1 peak level per channel from `AnalyserNode.getFloatTimeDomainData()`
 * (SPEC §3.4: "reads via `getFloatTimeDomainData()` per animation frame,
 * never inline in the chain"). The engine may not be booted yet — before the
 * first Play/preview gesture `getMeterTap` returns `null` (SPEC §3.1's
 * lazy/gesture-gated boot) — so this hook tolerates a null tap at every
 * frame and simply reports silence instead of erroring.
 *
 * ## Three states, because nine meters is nine rAF loops
 *
 * The mixer renders eight inserts plus Master, so a hook that always ran a
 * frame loop would burn nine callbacks and nine `setState`s per frame forever
 * — on a page where, until the first gesture, there is provably nothing to
 * meter (SPEC §3.1: no audio exists at all). So:
 *
 * - **Off** — the engine has not started. No timer of any kind. The engine's
 *   own {@link subscribe} wakes us; polling for a boot we would be told about
 *   is exactly the waste this exists to remove.
 * - **Idle** — started but not playing. The engine announces every preview
 *   (`EngineSnapshot.previewRevision`), so the frame loop is woken by the
 *   sound itself rather than discovered by polling. A slow
 *   {@link IDLE_POLL_MS} interval stays as the backstop for level that
 *   arrives with no announcement at all — a note still ringing when the
 *   transport stopped, a decaying tail — and promotes itself the moment the
 *   tap reads non-zero.
 * - **Active** — a real rAF loop with the ballistic falloff, entered on play
 *   or on a level appearing, and left again only after
 *   {@link IDLE_SILENCE_MS} of *sustained* silence with the transport stopped
 *   — never mid-decay, so the falloff always finishes on screen.
 */

import { useEffect, useState } from "react";

import { getMeterTap, getSnapshot, isPlaying, subscribe } from "@/audio";
import type { MixerTrackId } from "@/domain/types";

export interface MeterLevels {
  /** Peak absolute sample magnitude, 0..1, left channel (or the only channel). */
  left: number;
  /** Peak absolute sample magnitude, 0..1, right channel (mono taps mirror left). */
  right: number;
}

const SILENT: MeterLevels = { left: 0, right: 0 };

/** Exponential falloff per frame so the meter reads as a ballistic peak meter, not a strobe. */
const FALLOFF = 0.85;

/** How often the idle watcher checks a stopped-but-booted engine for a level. */
export const IDLE_POLL_MS = 250;

/** How long the meter must read silence, transport stopped, before it parks. */
export const IDLE_SILENCE_MS = 700;

/** Below this a level is silence — the falloff is asymptotic and never reaches 0. */
const SILENCE_EPSILON = 1e-3;

function peakFrom(buffer: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const abs = Math.abs(buffer[i]!);
    if (abs > peak) peak = abs;
  }
  return Math.min(1, peak);
}

/**
 * Live stereo peak level for one mixer track, rAF-driven while there is sound.
 *
 * `AnalyserNode` here is fed by a stereo bus but exposes a single interleaved
 * (downmixed) channel via `getFloatTimeDomainData` — there is no per-channel
 * split available off one analyser node. Both `left`/`right` therefore read
 * the same tap; the field split exists so the strip can render FL's
 * side-by-side stereo meter body without the UI caring whether the engine
 * later grows a true per-channel pair of taps.
 */
export function useMeter(trackId: MixerTrackId): MeterLevels {
  const [levels, setLevels] = useState<MeterLevels>(SILENT);

  useEffect(() => {
    let frame = 0;
    let poll: ReturnType<typeof setInterval> | null = null;
    let disposed = false;
    /** The tap's own buffer, reused across frames — allocated per `fftSize`, not per frame. */
    let buffer: Float32Array<ArrayBuffer> | null = null;
    let left = 0;
    let right = 0;
    /** `Date.now()` of the last frame that had sound or a running transport. */
    let lastSound = 0;

    /** A frame that changed nothing must not re-render nine strips. */
    function publish(nextLeft: number, nextRight: number): void {
      setLevels((previous) =>
        previous.left === nextLeft && previous.right === nextRight
          ? previous
          : { left: nextLeft, right: nextRight },
      );
    }

    function readPeak(): number {
      const tap = getMeterTap(trackId);
      if (tap === null) return 0;
      if (buffer === null || buffer.length !== tap.fftSize) buffer = new Float32Array(tap.fftSize);
      tap.getFloatTimeDomainData(buffer);
      return peakFrom(buffer);
    }

    function stopTimers(): void {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      if (poll !== null) clearInterval(poll);
      poll = null;
    }

    function tick(): void {
      frame = 0;
      if (disposed) return;
      const peak = readPeak();
      left = Math.max(peak, left * FALLOFF);
      right = Math.max(peak, right * FALLOFF);
      publish(left, right);

      const playing = isPlaying();
      if (playing || left > SILENCE_EPSILON) lastSound = Date.now();
      if (!playing && Date.now() - lastSound >= IDLE_SILENCE_MS) {
        left = 0;
        right = 0;
        publish(0, 0);
        goIdle();
        return;
      }
      frame = requestAnimationFrame(tick);
    }

    /** Fold one sampled peak into the ballistic level and show it. */
    function render(peak: number): void {
      left = Math.max(peak, left);
      right = Math.max(peak, right);
      publish(left, right);
    }

    /**
     * Backstop watch for level the engine never announced.
     *
     * It used to be the ONLY watch, and that is what it could not do: a
     * preview lasts 40–180 ms (`PREVIEW_DURATION_SEC` through the longest
     * voice tail) against a 250 ms poll, so a preview could start and finish
     * entirely between two reads and the needle never moved for it at all.
     * Previews now wake the loop directly through the engine's snapshot
     * channel (see the subscription below), and this interval covers what no
     * event can: a voice still ringing when the transport stopped, a release
     * tail outliving the loop's own park, a tap that gains level for a reason
     * this hook has no notion of.
     *
     * The sample it takes is RENDERED, not thrown away. Promoting to a frame
     * loop and letting the first frame re-read the tap put the needle up
     * 16 ms after a short sound had already decayed to nothing. Any non-zero
     * sample is worth showing and worth waking the loop for — the loop parks
     * itself again after {@link IDLE_SILENCE_MS} of silence.
     */
    function watch(): void {
      if (disposed) return;
      const peak = readPeak();
      if (peak > 0) goActive(peak);
    }

    /**
     * Enter the frame loop, showing `seed` (or a fresh sample) immediately
     * rather than waiting a frame for the first reading.
     */
    function goActive(seed?: number): void {
      if (disposed) return;
      if (frame !== 0) {
        // Already looping: still show the sample rather than drop it.
        if (seed !== undefined) render(seed);
        return;
      }
      stopTimers();
      lastSound = Date.now();
      render(seed ?? readPeak());
      frame = requestAnimationFrame(tick);
    }

    function goIdle(): void {
      if (disposed) return;
      stopTimers();
      poll = setInterval(watch, IDLE_POLL_MS);
    }

    function goOff(): void {
      stopTimers();
      left = 0;
      right = 0;
      publish(0, 0);
    }

    function applyEngineState(started: boolean, playing: boolean): void {
      if (disposed) return;
      if (!started) {
        goOff();
        return;
      }
      if (playing) {
        goActive();
        return;
      }
      // Started but stopped: let a running falloff finish; otherwise just watch.
      if (frame === 0 && poll === null) goIdle();
    }

    const snapshot = getSnapshot();
    applyEngineState(snapshot.started, snapshot.playing);
    /**
     * The last preview this hook has already reacted to. Seeded from the
     * snapshot rather than 0, so mounting a strip after previews have been
     * played does not read as "a preview just happened".
     */
    let seenPreview = snapshot.previewRevision;

    const unsubscribe = subscribe((next) => {
      /*
       * A preview is sound with no transport state behind it, so it is the
       * one wake-up `applyEngineState` cannot derive: `started` is already
       * true and `playing` is still false, which is exactly the Idle state
       * the hook is sitting in. Handled first and by promoting straight to
       * the frame loop — the voice is already triggered by the time this
       * runs, so `goActive` samples the tap on the spot and the ballistic
       * falloff carries the peak on screen for as long as it takes to see,
       * however short the sound itself was.
       */
      if (next.previewRevision !== seenPreview) {
        seenPreview = next.previewRevision;
        if (next.started) {
          goActive();
          return;
        }
      }
      applyEngineState(next.started, next.playing);
    });

    return () => {
      disposed = true;
      unsubscribe();
      stopTimers();
    };
  }, [trackId]);

  return levels;
}
