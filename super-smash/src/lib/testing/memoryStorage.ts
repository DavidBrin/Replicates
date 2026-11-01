/**
 * A `Storage` held in a map, for tests of what the browser keeps between
 * visits (Plan 5's control options): this test environment's window has no
 * usable `localStorage` of its own, and each test wants a fresh one.
 */
export function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}
