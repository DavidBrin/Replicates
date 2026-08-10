"use client";

/**
 * Drives the pure live-session model from a React timer.
 *
 * The hook owns nothing but the interval and the delta. All of the interesting
 * behaviour — how a viewer count drifts, when a comment arrives — is in
 * `domain/live-session.ts` where it is testable without a browser, and time
 * comes from the `Clock` port rather than `Date.now()` so a test can drive it.
 */

import { useEffect, useRef, useState } from "react";

import { useContainer } from "@/components/app-shell/container-provider";
import {
  createLiveSession,
  tickLiveSession,
  type LiveSessionConfig,
  type LiveSessionState,
} from "@/domain/live-session";

/**
 * 200ms: fast enough that a viewer count changing on a ~2.2s mean never looks
 * stepped, slow enough that we are not re-rendering the comment stream sixty
 * times a second on a phone that is also decoding a camera feed.
 */
const TICK_MS = 200;

export function useLiveSession(config: LiveSessionConfig, running: boolean): LiveSessionState {
  const { clock } = useContainer();

  // The config is read through a ref so that changing a setting mid-stream
  // (turning the comment rate down, say) takes effect on the next tick without
  // restarting the session and resetting the viewer count.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const [state, setState] = useState<LiveSessionState>(() =>
    // Seeded from the clock so two runs are not identical, but never rendered,
    // so the server and client markup still agree.
    createLiveSession(config, clock.now() & 0x7fffffff),
  );

  // Stored settings are read in an effect (they live in `localStorage`, which
  // does not exist on the server), so the first render always sees the
  // defaults and the user's real starting viewer count arrives a tick later.
  // Without this the configured count would be silently ignored. Re-seeding is
  // deliberately limited to a session that has not started ticking yet:
  // changing the setting mid-stream must not teleport the count.
  const [seededFrom, setSeededFrom] = useState(config.startingViewers);
  if (state.elapsedMs === 0 && config.startingViewers !== seededFrom) {
    setSeededFrom(config.startingViewers);
    setState(createLiveSession(config, clock.now() & 0x7fffffff));
  }

  useEffect(() => {
    if (!running) return;
    let last = clock.now();
    const timer = setInterval(() => {
      const now = clock.now();
      const delta = now - last;
      last = now;
      setState((current) => tickLiveSession(current, delta, configRef.current));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [clock, running]);

  return state;
}
