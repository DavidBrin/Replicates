/**
 * Server-backed persistence.
 *
 * Not used by default. Set `NEXT_PUBLIC_STORAGE_DRIVER=rest` (and optionally
 * `NEXT_PUBLIC_STORAGE_API_URL`) to point the same UI at a real database
 * behind a REST endpoint — Postgres, Supabase, KV, anything — without touching
 * a single component. The endpoint must accept GET/PUT/DELETE of the whole
 * snapshot at the configured URL.
 */

import { StorageAdapter, StorageError } from "./adapter";
import type { WorkspaceSnapshot } from "../model/types";

export class RestStorageAdapter extends StorageAdapter {
  readonly name = "rest";

  constructor(
    private readonly baseUrl: string,
    private readonly schemaVersion: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  isAvailable(): boolean {
    return typeof this.fetchImpl === "function" && this.baseUrl.length > 0;
  }

  async load(): Promise<WorkspaceSnapshot | null> {
    const response = await this.fetchImpl(this.baseUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    // A missing snapshot is a normal first-run state, not a failure.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new StorageError(`Could not load workspace (HTTP ${response.status})`);
    }

    const snapshot = (await response.json()) as WorkspaceSnapshot;
    return this.migrate(snapshot, this.schemaVersion);
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const response = await this.fetchImpl(this.baseUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      throw new StorageError(`Could not save workspace (HTTP ${response.status})`);
    }
  }

  async clear(): Promise<void> {
    const response = await this.fetchImpl(this.baseUrl, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new StorageError(`Could not clear workspace (HTTP ${response.status})`);
    }
  }
}
