/**
 * Test-only: an in-memory `Storage` installed on `window` when the runtime
 * leaves `window.localStorage` undefined. Node 22+ defines an experimental
 * global `localStorage` (undefined without `--localstorage-file`), and the
 * jsdom environment keeps the existing global rather than jsdom's own, so
 * component tests that exercise the localStorage adapters need this shim.
 * Not a test file itself (`.test-support.ts` is outside vitest's include).
 */
export function installMemoryLocalStorage(): Storage {
  const existing = (window as { localStorage?: Storage }).localStorage;
  if (existing && typeof existing.getItem === "function") return existing;
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, String(v));
    },
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  return storage;
}
