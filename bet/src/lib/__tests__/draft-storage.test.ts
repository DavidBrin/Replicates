import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDraftStore, wizardDraftStorageKey } from "../draft-storage";

interface Fixture {
  question: string;
  step: number;
}

/**
 * This project's jsdom test environment (vitest.config.mts, Task 1's file —
 * not this task's to change) does not provision `window.localStorage` at
 * all (`typeof window.localStorage === "undefined"`, verified directly).
 * `draft-storage.ts` itself already treats that exactly like "storage
 * unavailable" (SSR / locked-down browser) and degrades gracefully — which
 * is real, load-bearing behavior this suite wants to exercise, not paper
 * over. So this installs a minimal spec-compliant `Storage` polyfill
 * (`getItem`/`setItem`/`removeItem`/`clear`/`length`/`key`, backed by a
 * `Map`) ONLY for this file's tests, via `Object.defineProperty` (plain
 * assignment fails — `window.localStorage` is normally a getter-only
 * accessor on `Window.prototype`), rather than touching the shared
 * `vitest.setup.ts`.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

beforeAll(() => {
  if (typeof window.localStorage === "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  }
});

afterEach(() => {
  window.localStorage.clear();
});

describe("createDraftStore", () => {
  it("returns null when nothing has been persisted yet", () => {
    const store = createDraftStore<Fixture>("bet:test:empty");
    expect(store.get()).toBeNull();
  });

  it("round-trips a value through set/get", () => {
    const store = createDraftStore<Fixture>("bet:test:roundtrip");
    store.set({ question: "Will it rain?", step: 2 });
    expect(store.get()).toEqual({ question: "Will it rain?", step: 2 });
  });

  it("overwrites a previously persisted value on a second set", () => {
    const store = createDraftStore<Fixture>("bet:test:overwrite");
    store.set({ question: "First draft", step: 1 });
    store.set({ question: "Second draft", step: 3 });
    expect(store.get()).toEqual({ question: "Second draft", step: 3 });
  });

  it("clear() removes the persisted value", () => {
    const store = createDraftStore<Fixture>("bet:test:clear");
    store.set({ question: "Anything", step: 1 });
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("clear() on an already-empty key is a no-op, not a throw", () => {
    const store = createDraftStore<Fixture>("bet:test:clear-empty");
    expect(() => store.clear()).not.toThrow();
    expect(store.get()).toBeNull();
  });

  it("two different keys never see each other's value", () => {
    const a = createDraftStore<Fixture>("bet:test:key-a");
    const b = createDraftStore<Fixture>("bet:test:key-b");
    a.set({ question: "A's draft", step: 1 });
    expect(b.get()).toBeNull();
    b.set({ question: "B's draft", step: 4 });
    expect(a.get()).toEqual({ question: "A's draft", step: 1 });
    expect(b.get()).toEqual({ question: "B's draft", step: 4 });
  });

  it("treats corrupt/unparseable stored JSON as no draft, not a throw", () => {
    window.localStorage.setItem("bet:test:corrupt", "{not valid json");
    const store = createDraftStore<Fixture>("bet:test:corrupt");
    expect(() => store.get()).not.toThrow();
    expect(store.get()).toBeNull();
  });

  it("get() never throws when localStorage.getItem itself throws", () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    try {
      const store = createDraftStore<Fixture>("bet:test:throwing-get");
      expect(() => store.get()).not.toThrow();
      expect(store.get()).toBeNull();
    } finally {
      window.localStorage.getItem = original;
    }
  });

  it("set() never throws when localStorage.setItem itself throws (private mode / quota)", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    };
    try {
      const store = createDraftStore<Fixture>("bet:test:throwing-set");
      expect(() => store.set({ question: "x", step: 1 })).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });

  it("get()/set()/clear() never throw when window.localStorage itself is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("localStorage is disabled", "SecurityError");
      },
    });
    try {
      const store = createDraftStore<Fixture>("bet:test:unavailable");
      expect(() => store.get()).not.toThrow();
      expect(store.get()).toBeNull();
      expect(() => store.set({ question: "x", step: 1 })).not.toThrow();
      expect(() => store.clear()).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    }
  });
});

describe("wizardDraftStorageKey", () => {
  it("is keyed per user, so two users never collide", () => {
    expect(wizardDraftStorageKey("usr_alice")).not.toBe(wizardDraftStorageKey("usr_bob"));
  });

  it("is deterministic for the same user", () => {
    expect(wizardDraftStorageKey("usr_alice")).toBe(wizardDraftStorageKey("usr_alice"));
  });
});
