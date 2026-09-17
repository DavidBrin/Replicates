/**
 * Server-backed persistence.
 *
 * Not used by default. Set `NEXT_PUBLIC_STORAGE_DRIVER=rest` (and optionally
 * `NEXT_PUBLIC_STORAGE_API_URL`) to point the same UI at a real database
 * behind a REST endpoint — Postgres, Supabase, KV, anything — without touching
 * a single component. The endpoint must accept GET/PUT/DELETE of the whole
 * snapshot at the configured URL.
 *
 * If the server sets `WORKSPACE_PERSISTENCE_SECRET`, set
 * `NEXT_PUBLIC_WORKSPACE_PERSISTENCE_SECRET` to the same value so these
 * requests include `x-workspace-secret`.
 */

import { StorageAdapter, StorageError } from "./adapter";
import type { WorkspaceSnapshot } from "../model/types";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const secret = process.env.NEXT_PUBLIC_WORKSPACE_PERSISTENCE_SECRET?.trim();
  if (!secret) return extra;
  return { ...extra, "x-workspace-secret": secret };
}

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
      headers: authHeaders({ Accept: "application/json" }),
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
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      throw new StorageError(`Could not save workspace (HTTP ${response.status})`);
    }
  }

  async clear(): Promise<void> {
    const response = await this.fetchImpl(this.baseUrl, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!response.ok && response.status !== 404) {
      throw new StorageError(`Could not clear workspace (HTTP ${response.status})`);
    }
  }
}
