"use client";

import { useSyncExternalStore } from "react";

/** No client-only value ever changes, so the subscription is a no-op. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * False during server rendering and on the first client render, true after.
 *
 * Used to gate anything that cannot exist on the server — portals, `Date.now()`,
 * `window` measurements. Built on `useSyncExternalStore` rather than
 * `setState` in an effect: React treats the server/client snapshot split as a
 * first-class case here, so there is no cascading re-render and no lint
 * escape hatch.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
