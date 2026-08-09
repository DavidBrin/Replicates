"use client";

import { useSyncExternalStore } from "react";

/** Nothing ever changes after hydration, so the subscription is a no-op. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` during the server pass and the hydration render, `true` afterwards.
 *
 * Written with `useSyncExternalStore` rather than the usual
 * `useState` + `useEffect(() => setMounted(true))`, because that form is a
 * setState-in-effect and triggers a second render pass on every mount of every
 * block list. This reads the same value straight out of the two-snapshot
 * mechanism React already runs for hydration.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
