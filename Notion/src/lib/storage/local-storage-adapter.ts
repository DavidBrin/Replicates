/**
 * Browser-local persistence backed by `localStorage`.
 *
 * Not the default — see `IndexedDbAdapter`, which is preferred for capacity
 * and for not blocking the main thread. This adapter exists because
 * localStorage is synchronous and universally available, which makes it a
 * useful fallback and a simple target for tests.
 *
 * The backing `Storage` is injected rather than reached for globally: it keeps
 * the adapter testable, and some runtimes (Node 26 among them) expose a
 * `localStorage` global that is not usable without extra flags.
 */

import { StorageAdapter, StorageError } from "./adapter";
import type { WorkspaceSnapshot } from "../model/types";

/** Resolves the browser's localStorage, or null when it cannot be used. */
export function detectLocalStorage(): Storage | null {
  try {
    const candidate = typeof window === "undefined" ? null : window.localStorage;
    if (!candidate) return null;
    // Safari in private mode exposes the object but throws on write.
    const probe = "__notion_clone_probe__";
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

export class LocalStorageAdapter extends StorageAdapter {
  readonly name = "localStorage";

  private readonly store: Storage | null;

  constructor(
    private readonly storageKey: string,
    private readonly schemaVersion: number,
    store: Storage | null = detectLocalStorage(),
  ) {
    super();
    this.store = store;
  }

  isAvailable(): boolean {
    return this.store !== null;
  }

  async load(): Promise<WorkspaceSnapshot | null> {
    if (!this.store) return null;
    const raw = this.store.getItem(this.storageKey);
    if (!raw) return null;

    let parsed: WorkspaceSnapshot;
    try {
      parsed = JSON.parse(raw) as WorkspaceSnapshot;
    } catch {
      // A corrupt payload is unrecoverable. Drop it and fall back to the
      // seed rather than crashing the app on boot.
      this.store.removeItem(this.storageKey);
      return null;
    }

    return this.migrate(parsed, this.schemaVersion);
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    if (!this.store) return;
    try {
      this.store.setItem(this.storageKey, JSON.stringify(snapshot));
    } catch (cause) {
      throw new StorageError(
        "Could not save your workspace — browser storage is full.",
        cause,
      );
    }
  }

  async clear(): Promise<void> {
    this.store?.removeItem(this.storageKey);
  }
}

/** A `Storage` implementation held entirely in memory. Used by tests. */
export class InMemoryWebStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
