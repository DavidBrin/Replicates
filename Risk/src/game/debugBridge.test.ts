/** `window.__riskDebug` (SPEC §11 T10, F27). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GameState } from "@/engine/types";

import { cloneState, debugEnabled, registerDebug, unregisterDebug } from "./debugBridge";
import { makeSession } from "./__fixtures__/harness";

const FLAG = "NEXT_PUBLIC_RISK_DEBUG";

beforeEach(() => {
  delete window.__riskDebug;
});

afterEach(() => {
  delete process.env[FLAG];
  delete window.__riskDebug;
});

describe("the debug flag", () => {
  it("is off unless NEXT_PUBLIC_RISK_DEBUG is exactly \"1\"", () => {
    expect(debugEnabled()).toBe(false);
    process.env[FLAG] = "true";
    expect(debugEnabled()).toBe(false);
    process.env[FLAG] = "1";
    expect(debugEnabled()).toBe(true);
  });

  it("registerDebug is a no-op while the flag is off", () => {
    registerDebug({ seq: () => 1 });
    expect(window.__riskDebug).toBeUndefined();
  });
});

describe("registerDebug", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it("creates the handle on first call", () => {
    registerDebug({ seq: () => 5 });
    expect(window.__riskDebug?.seq?.()).toBe(5);
  });

  it("MERGES rather than replaces, so two slices can contribute", () => {
    registerDebug({ seq: () => 5 });                       // S4
    registerDebug({ pollNow: async () => {} });            // S5
    expect(window.__riskDebug?.seq?.()).toBe(5);
    expect(typeof window.__riskDebug?.pollNow).toBe("function");
  });

  it("a later registration of the same key wins", () => {
    registerDebug({ seq: () => 1 });
    registerDebug({ seq: () => 2 });
    expect(window.__riskDebug?.seq?.()).toBe(2);
  });

  it("unregisterDebug drops only the named keys", () => {
    registerDebug({ seq: () => 1, pollNow: async () => {} });
    unregisterDebug(["seq"]);
    expect(window.__riskDebug?.seq).toBeUndefined();
    expect(window.__riskDebug?.pollNow).toBeDefined();
  });
});

describe("cloneState", () => {
  it("returns a deep copy, not the original", () => {
    const state = { mapSlug: "x", territories: [{ owner: 1, troops: 2, blizzard: false }] } as unknown as GameState;
    const copy = cloneState(state);
    expect(copy).toEqual(state);
    expect(copy).not.toBe(state);
    expect(copy.territories).not.toBe(state.territories);
  });
});

describe("the session's own registration", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it("start() publishes state() and seq(), and state() is the CONFIRMED state, cloned", () => {
    const h = makeSession();
    h.session.start();
    const debug = window.__riskDebug;
    expect(typeof debug?.state).toBe("function");
    expect(typeof debug?.seq).toBe("function");
    const snapshot = debug?.state?.();
    expect(snapshot?.mapSlug).toBe(h.session.confirmed().mapSlug);
    expect(snapshot).not.toBe(h.session.confirmed());
    h.destroy();
  });

  it("destroy() removes what the session registered and leaves S5's keys alone", () => {
    registerDebug({ pollNow: async () => {} });
    const h = makeSession();
    h.session.start();
    h.session.destroy();
    expect(window.__riskDebug?.state).toBeUndefined();
    expect(window.__riskDebug?.pollNow).toBeDefined();
  });
});
