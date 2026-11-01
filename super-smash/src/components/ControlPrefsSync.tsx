"use client";

import { useEffect } from "react";

import { readControlPrefs, writeControlPrefs } from "@/lib/controlPrefs";
import { useMatchConfig } from "@/lib/matchConfig";

/**
 * Keeps each port's Stick Jump and pad settings across visits (Plan 5): loads
 * them once the page is in the browser (after hydration, so the server render
 * and the first client render agree), then saves what the match config keeps
 * (`controlPrefs`) whenever it changes. Only the `/controls` setters change
 * that, so a change to the seats alone (an online session's, the other
 * player's pick, a player added or dropped) is never saved (P5-R26). Renders
 * nothing.
 */
export function ControlPrefsSync() {
  useEffect(() => {
    useMatchConfig.getState().applyControlPrefs(readControlPrefs());
    return useMatchConfig.subscribe((state, prev) => {
      if (state.controlPrefs !== prev.controlPrefs) writeControlPrefs(state.controlPrefs);
    });
  }, []);
  return null;
}
