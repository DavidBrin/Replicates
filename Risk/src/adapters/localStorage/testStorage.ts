/**
 * An in-memory `Storage` for tests.
 *
 * This Node build runs jsdom **without** `--localstorage-file`, so
 * `window.localStorage` is genuinely absent — which is exactly the
 * "storage unavailable" branch every adapter already guards (§4.16). The
 * production code is therefore correct as it stands; what the suites need is
 * a storage to assert *against*, so they install this one.
 */

export interface MemoryStorage extends Storage {
  readonly entries: Map<string, string>;
}

export function createMemoryStorage(): MemoryStorage {
  const entries = new Map<string, string>();
  return {
    entries,
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
  };
}

/** Install a fresh storage on `window`, returning it. Call from `beforeEach`. */
export function installMemoryStorage(): MemoryStorage {
  const storage = createMemoryStorage();
  Object.defineProperty(window, "localStorage", {
    value: storage, configurable: true, writable: true,
  });
  return storage;
}
