"use client";

/**
 * Hydration and persistence lifecycle.
 *
 * Two rules drive the design:
 *   1. Storage is never read during render. The server pass and the first
 *      client pass must produce identical markup, so the seeded workspace is
 *      what both render; the saved snapshot is swapped in afterwards, in an
 *      effect.
 *   2. Writes are debounced. Every keystroke touches the store, but only the
 *      last change in a burst reaches the disk.
 */

import { useEffect } from "react";
import { features, timing } from "@/config/app.config";
import { getStorageAdapter, IndexedDbAdapter } from "../storage";
import { useWorkspaceStore } from "./workspace-store";
import type { WorkspaceSnapshot } from "../model/types";

/** Strips the non-persisted UI fields off the store state. */
function toSnapshot(state: ReturnType<typeof useWorkspaceStore.getState>): WorkspaceSnapshot {
  const { schemaVersion, workspace, users, pages, blocks, databases, views, currentUserId } =
    state;
  return { schemaVersion, workspace, users, pages, blocks, databases, views, currentUserId };
}

/**
 * Loads the saved workspace once, then keeps it saved.
 *
 * Mount exactly once, high in the client tree.
 */
export function useWorkspacePersistence(): { hydrated: boolean } {
  const hydrated = useWorkspaceStore((s) => s.hydrated);

  // --- load ---------------------------------------------------------------
  // Deliberately *not* guarded by a "has run" ref. Strict Mode mounts,
  // unmounts and remounts: a ref guard would let the first pass start, its
  // cleanup cancel it, and the second pass return early — leaving `hydrated`
  // false forever and the app stuck on the skeleton. Loading is an idempotent
  // read, so running it twice in development is harmless.
  useEffect(() => {
    if (!features.persistence) {
      useWorkspaceStore.getState().markHydrated();
      return;
    }

    const adapter = getStorageAdapter();
    let cancelled = false;

    void (async () => {
      try {
        const saved = await adapter.load();
        if (cancelled) return;
        if (saved) useWorkspaceStore.getState().replaceSnapshot(saved);
        else useWorkspaceStore.getState().markHydrated();
      } catch {
        // A failed read must not block the app; fall back to the seed.
        if (!cancelled) useWorkspaceStore.getState().markHydrated();
      }

      // Best-effort: ask the browser not to evict us under storage pressure.
      if (adapter instanceof IndexedDbAdapter) void adapter.requestPersistence();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- save ---------------------------------------------------------------
  useEffect(() => {
    if (!hydrated || !features.persistence) return;

    const adapter = getStorageAdapter();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: WorkspaceSnapshot | null = null;

    const flush = () => {
      if (!pending) return;
      const snapshot = pending;
      pending = null;
      void adapter.save(snapshot).catch(() => {
        // Swallowed deliberately: a full disk should degrade to "your work
        // is not being saved", never to a crashed editor.
      });
    };

    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      pending = toSnapshot(state);
      clearTimeout(timer);
      timer = setTimeout(flush, timing.persistDebounceMs);
    });

    // Don't lose the last few hundred milliseconds of work on a tab close.
    const onHide = () => {
      clearTimeout(timer);
      flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);

    return () => {
      unsubscribe();
      clearTimeout(timer);
      flush();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [hydrated]);

  return { hydrated };
}

/** Wipes stored state and returns to the seeded demo workspace. */
export async function resetWorkspace(): Promise<void> {
  await getStorageAdapter().clear();
  useWorkspaceStore.getState().resetToSeed();
}

/** Downloads the workspace as JSON — the durability escape hatch. */
export function exportWorkspaceFile(): void {
  const snapshot = useWorkspaceStore.getState().exportSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${snapshot.workspace.name.toLowerCase().replace(/\s+/g, "-")}-workspace.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Replaces the workspace from a previously exported file. */
export async function importWorkspaceFile(file: File): Promise<void> {
  const text = await file.text();
  const snapshot = JSON.parse(text) as WorkspaceSnapshot;
  if (!snapshot.workspace || !snapshot.pages) {
    throw new Error("That file is not a workspace export.");
  }
  useWorkspaceStore.getState().replaceSnapshot(snapshot);
}
