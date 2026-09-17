"use client";

/**
 * Wheel handling that is actually allowed to say no.
 *
 * React attaches `wheel` at the root container as a **passive** listener, so
 * `event.preventDefault()` inside an `onWheel` prop is silently ignored and the
 * browser scrolls (or page-zooms, under Ctrl) anyway. Every surface here that
 * binds a modifier to the wheel therefore needs a real
 * `addEventListener("wheel", …, { passive: false })` on its own element — the
 * piano roll's Ctrl+wheel zoom and the playlist's both learned this the hard
 * way, and the channel rack's Alt+wheel velocity nudge shipped without it and
 * scrolled the rack out from under the pointer on every notch.
 *
 * This is the one place that pattern lives, so surface #4 cannot get it wrong.
 *
 * The handler is read from a ref, so the subscription is bound to the element
 * alone: a caller may pass a fresh closure every render (all three do — they
 * close over zoom state) without the listener being torn down and re-added, and
 * a notch is always delivered to the *current* handler.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export function useNonPassiveWheel<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onWheel: (event: WheelEvent) => void,
): void {
  const handler = useRef(onWheel);
  // Not assigned during render: under StrictMode/concurrent rendering a render
  // may be thrown away, and the discarded closure must not be what the live
  // listener calls.
  useLayoutEffect(() => {
    handler.current = onWheel;
  }, [onWheel]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const listener = (event: WheelEvent): void => handler.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, [ref]);
}
