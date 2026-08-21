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
 */

import { useEffect, useRef, useState } from "react";

import { getMeterTap } from "@/audio";
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

function peakFrom(buffer: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const abs = Math.abs(buffer[i]!);
    if (abs > peak) peak = abs;
  }
  return Math.min(1, peak);
}

/**
 * Live stereo peak level for one mixer track, rAF-driven.
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
  const levelsRef = useRef<MeterLevels>(SILENT);

  useEffect(() => {
    let frame = 0;
    let buffer: Float32Array<ArrayBuffer> | null = null;
    levelsRef.current = SILENT;

    function tick(): void {
      const tap = getMeterTap(trackId);
      if (tap === null) {
        const decayed: MeterLevels = {
          left: levelsRef.current.left * FALLOFF,
          right: levelsRef.current.right * FALLOFF,
        };
        levelsRef.current = decayed;
        setLevels(decayed);
        frame = requestAnimationFrame(tick);
        return;
      }

      if (buffer === null || buffer.length !== tap.fftSize) {
        buffer = new Float32Array(tap.fftSize);
      }
      tap.getFloatTimeDomainData(buffer);
      const peak = peakFrom(buffer);
      const next: MeterLevels = {
        left: Math.max(peak, levelsRef.current.left * FALLOFF),
        right: Math.max(peak, levelsRef.current.right * FALLOFF),
      };
      levelsRef.current = next;
      setLevels(next);
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [trackId]);

  return levels;
}
