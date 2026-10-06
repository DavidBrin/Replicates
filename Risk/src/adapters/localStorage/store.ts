/**
 * The shared localStorage discipline (SPEC §4.16).
 *
 * Every read and write is wrapped in `try/catch` behind a
 * `typeof window !== "undefined"` guard — storage can be unavailable in a
 * private window, blocked by site settings, or simply absent on the server —
 * and a module-level listener set lets every open tab react to a write.
 * The `:v1` suffix is the convention: bump, never migrate.
 */

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the feature simply does not persist */
  }
}

export function removeKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

type Listener<T> = (value: T) => void;

/** A per-key listener set, so two mounted components see one another's writes. */
export function createChannel<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(fn: Listener<T>): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit(value: T): void {
      for (const fn of [...listeners]) fn(value);
    },
    size(): number {
      return listeners.size;
    },
  };
}

/** `crypto.randomUUID()` where it exists, a `Math.random` id where it does not. */
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
