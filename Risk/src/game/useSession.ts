"use client";

/**
 * The only way a component reads a session (SPEC §10).
 *
 * `GameState` never enters React state: components subscribe to the **UI
 * slice** in the zustand store and read `session.state` directly during
 * render. `version` bumps on every state change, so a selector that depends
 * on the board re-runs without the board itself ever being stored in React.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import type { Session, SessionUiState } from "./session";

/** Subscribe to one slice of the session's UI store. */
export function useUi<T>(session: Session, selector: (s: SessionUiState) => T): T {
  return useStore(session.store, selector);
}

/** The version counter, for a component that reads `session.state` directly. */
export function useSessionVersion(session: Session): number {
  return useStore(session.store, (s) => s.version);
}

/**
 * The dirty-flag animation loop (§10): one rAF that repaints on the session's
 * dirty flag plus a slow ~500 ms ambient bucket, never a React re-render.
 */
export const AMBIENT_MS = 500;

export function useRenderLoop(session: Session | null, paint: (now: number) => void): void {
  useEffect(() => {
    if (!session) return;
    if (typeof requestAnimationFrame !== "function") {
      paint(0);
      return;
    }
    let raf = 0;
    let lastAmbient = 0;
    let stopped = false;
    const frame = (now: number) => {
      if (stopped) return;
      const busy = session.tick(now);
      const ambient = now - lastAmbient >= AMBIENT_MS;
      if (session.takeDirty() || busy || ambient) {
        if (ambient) lastAmbient = now;
        paint(now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
    // `paint` is captured once on purpose: it reads live refs, not props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
}

/** The element's size in CSS px, tracked through a `ResizeObserver`. */
export function useElementSize(ref: { current: HTMLElement | null }): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) => (prev.w === rect.width && prev.h === rect.height
        ? prev
        : { w: rect.width, h: rect.height }));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** `prefers-reduced-motion`, as a live boolean. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    let query: MediaQueryList;
    try {
      query = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}
