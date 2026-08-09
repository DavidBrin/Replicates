/**
 * In-memory persistence.
 *
 * Used during server rendering (where there is no browser storage) and by the
 * test suite, which needs a clean, synchronous adapter with no globals.
 */

import { StorageAdapter } from "./adapter";
import type { WorkspaceSnapshot } from "../model/types";

export class MemoryStorageAdapter extends StorageAdapter {
  readonly name = "memory";

  private snapshot: WorkspaceSnapshot | null;

  constructor(initial: WorkspaceSnapshot | null = null) {
    super();
    this.snapshot = initial;
  }

  isAvailable(): boolean {
    return true;
  }

  async load(): Promise<WorkspaceSnapshot | null> {
    return this.snapshot;
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    // Deep-copied so callers cannot mutate stored state through a held
    // reference — the same isolation a real backend would give.
    this.snapshot = structuredClone(snapshot);
  }

  async clear(): Promise<void> {
    this.snapshot = null;
  }
}
