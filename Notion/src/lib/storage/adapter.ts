/**
 * Persistence abstraction.
 *
 * The app talks only to `StorageAdapter`. Which concrete adapter it gets is
 * decided once, by configuration, in `./index.ts`. That is what lets the
 * project deploy to Vercel with no environment variables at all (browser
 * storage) while leaving a one-line path to a real database later.
 */

import type { WorkspaceSnapshot } from "../model/types";

export class StorageError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Reads and writes the whole workspace snapshot.
 *
 * Snapshot-at-a-time rather than per-entity CRUD is a deliberate trade: the
 * dataset is a single user's workspace (kilobytes, not megabytes), so the
 * simplicity of one atomic read and one debounced write is worth more than
 * granular writes. A server-backed adapter that needs finer granularity can
 * diff snapshots internally without changing this contract.
 */
export abstract class StorageAdapter {
  /** Identifier used in diagnostics and the settings UI. */
  abstract readonly name: string;

  /**
   * True when this adapter can actually run here. The localStorage adapter
   * reports false during server rendering, which is how the store knows to
   * defer hydration to the client and avoid a hydration mismatch.
   */
  abstract isAvailable(): boolean;

  /** Returns the stored snapshot, or `null` when nothing has been saved. */
  abstract load(): Promise<WorkspaceSnapshot | null>;

  /** Persists the snapshot, overwriting any previous one. */
  abstract save(snapshot: WorkspaceSnapshot): Promise<void>;

  /** Removes the stored snapshot entirely. Used by "reset workspace". */
  abstract clear(): Promise<void>;

  /**
   * Migrates a snapshot written by an older schema version.
   *
   * The default drops anything older than the current version so a breaking
   * change can never surface as a half-broken workspace. Subclasses (or a
   * future migration module) can override to upgrade in place instead.
   */
  protected migrate(
    snapshot: WorkspaceSnapshot,
    expectedVersion: number,
  ): WorkspaceSnapshot | null {
    return snapshot.schemaVersion === expectedVersion ? snapshot : null;
  }
}
