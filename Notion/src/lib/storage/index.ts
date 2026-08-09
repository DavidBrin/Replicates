/**
 * Storage factory — the single place that decides which adapter the app uses.
 */

import { storage as storageConfig, type StorageDriver } from "@/config/app.config";
import { StorageAdapter } from "./adapter";
import { IndexedDbAdapter } from "./indexeddb-adapter";
import { LocalStorageAdapter } from "./local-storage-adapter";
import { MemoryStorageAdapter } from "./memory-adapter";
import { RestStorageAdapter } from "./rest-adapter";

export { StorageAdapter, StorageError } from "./adapter";
export { IndexedDbAdapter } from "./indexeddb-adapter";
export { LocalStorageAdapter } from "./local-storage-adapter";
export { MemoryStorageAdapter } from "./memory-adapter";
export { RestStorageAdapter } from "./rest-adapter";

/** Builds the adapter named by `driver`, defaulting to the configured one. */
export function createStorageAdapter(
  driver: StorageDriver = storageConfig.driver,
): StorageAdapter {
  switch (driver) {
    case "rest":
      return new RestStorageAdapter(
        storageConfig.apiUrl,
        storageConfig.schemaVersion,
      );
    case "memory":
      return new MemoryStorageAdapter();
    case "local":
      return new LocalStorageAdapter(
        storageConfig.key,
        storageConfig.schemaVersion,
      );
    case "indexeddb":
    default:
      return new IndexedDbAdapter(
        storageConfig.key,
        storageConfig.schemaVersion,
      );
  }
}

let singleton: StorageAdapter | null = null;

/**
 * The process-wide adapter.
 *
 * Falls back to in-memory storage whenever the configured adapter cannot run
 * (server rendering, private-mode Safari, storage disabled), so the app always
 * has somewhere to write and never crashes on boot.
 */
export function getStorageAdapter(): StorageAdapter {
  if (singleton) return singleton;
  const configured = createStorageAdapter();
  singleton = configured.isAvailable() ? configured : new MemoryStorageAdapter();
  return singleton;
}

/** Test seam: forces the next `getStorageAdapter()` call to rebuild. */
export function resetStorageAdapter(next: StorageAdapter | null = null): void {
  singleton = next;
}
