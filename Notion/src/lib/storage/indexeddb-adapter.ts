/**
 * IndexedDB persistence — the default driver.
 *
 * Preferred over localStorage for two concrete reasons:
 *   • Capacity. localStorage caps at roughly 5 MiB per origin, which a
 *     document app can genuinely exceed; IndexedDB is quota-based (a large
 *     fraction of free disk).
 *   • It is asynchronous, so a large save never blocks the main thread while
 *     the user is typing.
 *
 * Written against the raw IndexedDB API rather than a wrapper so the project
 * keeps zero runtime dependencies for persistence.
 *
 * Durability caveat, stated plainly because it is a real product
 * characteristic rather than a bug: WebKit's storage policy erases all
 * script-writable storage — IndexedDB included — after seven days of Safari
 * use without interaction on the origin. `requestPersistence()` asks the
 * browser to exempt us, but Safari makes no guarantee. That is why the app
 * also ships JSON export/import.
 */

import { StorageAdapter, StorageError } from "./adapter";
import type { WorkspaceSnapshot } from "../model/types";

const STORE_NAME = "snapshots";
const RECORD_KEY = "current";

export class IndexedDbAdapter extends StorageAdapter {
  readonly name = "indexedDB";

  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly databaseName: string,
    private readonly schemaVersion: number,
  ) {
    super();
  }

  isAvailable(): boolean {
    return typeof indexedDB !== "undefined";
  }

  async load(): Promise<WorkspaceSnapshot | null> {
    if (!this.isAvailable()) return null;
    const stored = await this.withStore("readonly", (store) => store.get(RECORD_KEY));
    if (!stored) return null;
    return this.migrate(stored as WorkspaceSnapshot, this.schemaVersion);
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await this.withStore("readwrite", (store) => store.put(snapshot, RECORD_KEY));
    } catch (cause) {
      throw new StorageError("Could not save your workspace to this browser.", cause);
    }
  }

  async clear(): Promise<void> {
    if (!this.isAvailable()) return;
    await this.withStore("readwrite", (store) => store.delete(RECORD_KEY));
  }

  /**
   * Best-effort request that the browser not evict this origin's data under
   * storage pressure. Safe to call repeatedly; resolves false when refused.
   */
  async requestPersistence(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new StorageError("Could not open browser storage.", request.error));
    });

    // A failed open must not be cached, or every later call fails too.
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });

    return this.dbPromise;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.openDatabase();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new StorageError("Browser storage request failed.", request.error));
      transaction.onabort = () =>
        reject(new StorageError("Browser storage transaction aborted.", transaction.error));
    });
  }
}
