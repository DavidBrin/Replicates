// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createVoiceSessionStore, elapsedSecondsFor } from "./session-store";

const TTL_MS = 600_000;

function fixedStore(startAt = 1_000_000) {
  let at = startAt;
  const store = createVoiceSessionStore({
    now: () => at,
    newId: (() => {
      let n = 0;
      return () => `session-${(n += 1)}`;
    })(),
  });
  return { store, advance: (ms: number): void => void (at += ms), at: () => at };
}

describe("createVoiceSessionStore", () => {
  it("mints a session the server can find again", () => {
    const { store } = fixedStore();

    const opened = store.open({ personaId: "friend-nearby", ttlMs: TTL_MS });

    expect(store.find(opened.id)).toMatchObject({
      id: opened.id,
      personaId: "friend-nearby",
      tokensUsed: 0,
    });
  });

  it("does not know an id it never minted", () => {
    const { store } = fixedStore();
    store.open({ personaId: "p", ttlMs: TTL_MS });

    // The forged-session case: well-formed, plausible, and worth nothing.
    expect(store.find("cf1f4b1e-0000-4000-8000-000000000000")).toBeNull();
  });

  it("forgets a session once it has expired", () => {
    const { store, advance } = fixedStore();
    const opened = store.open({ personaId: "p", ttlMs: TTL_MS });

    advance(TTL_MS + 1);

    expect(store.find(opened.id)).toBeNull();
  });

  it("accumulates usage across turns rather than replacing it", () => {
    const { store } = fixedStore();
    const opened = store.open({ personaId: "p", ttlMs: TTL_MS });

    store.recordUsage(opened.id, 30);
    store.recordUsage(opened.id, 45);

    expect(store.find(opened.id)?.tokensUsed).toBe(75);
  });

  it("never lets a nonsense figure buy budget back", () => {
    const { store } = fixedStore();
    const opened = store.open({ personaId: "p", ttlMs: TTL_MS });

    store.recordUsage(opened.id, 100);
    store.recordUsage(opened.id, -1000);
    store.recordUsage(opened.id, Number.NaN);
    store.recordUsage(opened.id, Number.POSITIVE_INFINITY);

    expect(store.find(opened.id)?.tokensUsed).toBe(100);
  });

  it("reports rather than throws when usage is recorded against a dead session", () => {
    const { store, advance } = fixedStore();
    const opened = store.open({ personaId: "p", ttlMs: TTL_MS });
    advance(TTL_MS + 1);

    expect(store.recordUsage(opened.id, 10)).toBeNull();
  });

  it("hands out copies, so a caller cannot edit its own spend", () => {
    const { store } = fixedStore();
    const opened = store.open({ personaId: "p", ttlMs: TTL_MS });

    const found = store.find(opened.id) as { tokensUsed: number };
    store.recordUsage(opened.id, 60);
    found.tokensUsed = 0;

    expect(store.find(opened.id)?.tokensUsed).toBe(60);
  });

  it("measures elapsed time from the mint, not from anything a client says", () => {
    const { store, advance, at } = fixedStore();
    const opened = store.open({ personaId: "p", ttlMs: TTL_MS });

    advance(45_000);

    expect(elapsedSecondsFor(opened, at())).toBe(45);
  });

  it("never reports negative elapsed time if the clock steps backwards", () => {
    const { store } = fixedStore();
    const opened = store.open({ personaId: "p", ttlMs: TTL_MS });

    expect(elapsedSecondsFor(opened, opened.issuedAt - 60_000)).toBe(0);
  });

  it("drops everything on reset", () => {
    const { store } = fixedStore();
    const opened = store.open({ personaId: "p", ttlMs: TTL_MS });

    store.reset();

    expect(store.find(opened.id)).toBeNull();
  });
});
