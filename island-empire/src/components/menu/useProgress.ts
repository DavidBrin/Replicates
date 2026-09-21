"use client";

import { useEffect, useState } from "react";

import { localProgress } from "@/adapters/localStorage/progress";
import type { Progress } from "@/ports/localProgress";

export const readLocalProgress = (): Progress => localProgress.read();

/**
 * Campaign progress from the device, read after mount so server and first
 * client render agree (`null`), then the real value. `onLoaded` runs once
 * with the loaded snapshot — the overworld uses it to place the avatar.
 *
 * The read happens in a microtask rather than the effect body: the value is
 * external state (localStorage), and React's lint rule wants external reads
 * to reach `setState` through a callback rather than a synchronous effect.
 */
export function useProgress(read: () => Progress, onLoaded?: (p: Progress) => void): Progress | null {
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const p = read();
      setProgress(p);
      onLoaded?.(p);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on mount; callers pass stable readers
  }, []);
  return progress;
}
