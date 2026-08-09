import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbAdapter } from "./indexeddb-adapter";
import { InMemoryWebStorage, LocalStorageAdapter } from "./local-storage-adapter";
import { MemoryStorageAdapter } from "./memory-adapter";
import { RestStorageAdapter } from "./rest-adapter";
import { StorageError, type StorageAdapter } from "./adapter";
import { createDemoSnapshot } from "../seed/demo-workspace";
import type { WorkspaceSnapshot } from "../model/types";

const SCHEMA_VERSION = createDemoSnapshot().schemaVersion;

/** Every adapter must satisfy the same contract, so run one suite over all. */
const adapters: Array<[string, () => StorageAdapter]> = [
  ["memory", () => new MemoryStorageAdapter()],
  [
    "localStorage",
    () => new LocalStorageAdapter("test:local", SCHEMA_VERSION, new InMemoryWebStorage()),
  ],
  ["indexedDB", () => new IndexedDbAdapter(`test-idb-${Math.random()}`, SCHEMA_VERSION)],
];

describe.each(adapters)("%s adapter", (_name, make) => {
  let adapter: StorageAdapter;

  beforeEach(async () => {
    adapter = make();
    await adapter.clear();
  });

  it("reports itself available in this environment", () => {
    expect(adapter.isAvailable()).toBe(true);
  });

  it("returns null before anything has been saved", async () => {
    await expect(adapter.load()).resolves.toBeNull();
  });

  it("round-trips a snapshot without losing data", async () => {
    const snapshot = createDemoSnapshot();
    await adapter.save(snapshot);
    const loaded = await adapter.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.workspace.name).toBe(snapshot.workspace.name);
    expect(Object.keys(loaded!.pages)).toHaveLength(Object.keys(snapshot.pages).length);
    expect(Object.keys(loaded!.blocks)).toHaveLength(Object.keys(snapshot.blocks).length);
    expect(loaded!.currentUserId).toBe(snapshot.currentUserId);
  });

  it("overwrites rather than merging on a second save", async () => {
    const first = createDemoSnapshot();
    await adapter.save(first);
    await adapter.save({ ...first, workspace: { ...first.workspace, name: "Renamed" } });

    const loaded = await adapter.load();
    expect(loaded!.workspace.name).toBe("Renamed");
  });

  it("returns null again after clear", async () => {
    await adapter.save(createDemoSnapshot());
    await adapter.clear();
    await expect(adapter.load()).resolves.toBeNull();
  });

  it("discards a snapshot written by an incompatible schema version", async () => {
    const stale = { ...createDemoSnapshot(), schemaVersion: SCHEMA_VERSION + 99 };
    await adapter.save(stale);

    // The memory adapter is a pass-through by design and does not migrate.
    if (adapter instanceof MemoryStorageAdapter) return;
    await expect(adapter.load()).resolves.toBeNull();
  });
});

describe("MemoryStorageAdapter", () => {
  it("isolates stored state from the caller's reference", async () => {
    const adapter = new MemoryStorageAdapter();
    const snapshot = createDemoSnapshot();
    await adapter.save(snapshot);

    snapshot.workspace.name = "Mutated after saving";

    const loaded = await adapter.load();
    expect(loaded!.workspace.name).not.toBe("Mutated after saving");
  });
});

describe("LocalStorageAdapter", () => {
  it("recovers from a corrupt payload instead of throwing", async () => {
    const key = "test:corrupt";
    const store = new InMemoryWebStorage();
    store.setItem(key, "{not json");
    const adapter = new LocalStorageAdapter(key, SCHEMA_VERSION, store);

    await expect(adapter.load()).resolves.toBeNull();
    // The unusable payload should also have been cleaned up.
    expect(store.getItem(key)).toBeNull();
  });

  it("degrades to unavailable, not to a crash, when storage is blocked", async () => {
    const adapter = new LocalStorageAdapter("test:blocked", SCHEMA_VERSION, null);

    expect(adapter.isAvailable()).toBe(false);
    await expect(adapter.save(createDemoSnapshot())).resolves.toBeUndefined();
    await expect(adapter.load()).resolves.toBeNull();
  });
});

describe("RestStorageAdapter", () => {
  const snapshot = createDemoSnapshot();

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("treats a 404 as an empty workspace, not an error", async () => {
    const adapter = new RestStorageAdapter("/api/workspace", SCHEMA_VERSION, async () =>
      new Response(null, { status: 404 }),
    );
    await expect(adapter.load()).resolves.toBeNull();
  });

  it("surfaces a server failure as a StorageError", async () => {
    const adapter = new RestStorageAdapter("/api/workspace", SCHEMA_VERSION, async () =>
      new Response(null, { status: 500 }),
    );
    await expect(adapter.load()).rejects.toBeInstanceOf(StorageError);
  });

  it("PUTs the snapshot as JSON", async () => {
    let captured: RequestInit | undefined;
    const adapter = new RestStorageAdapter(
      "/api/workspace",
      SCHEMA_VERSION,
      async (_url, init) => {
        captured = init;
        return new Response(null, { status: 204 });
      },
    );

    await adapter.save(snapshot);
    expect(captured?.method).toBe("PUT");
    expect(JSON.parse(String(captured?.body)).workspace.name).toBe(snapshot.workspace.name);
  });

  it("loads a snapshot served by the endpoint", async () => {
    const adapter = new RestStorageAdapter("/api/workspace", SCHEMA_VERSION, async () =>
      jsonResponse(snapshot),
    );
    const loaded = (await adapter.load()) as WorkspaceSnapshot;
    expect(loaded.workspace.name).toBe(snapshot.workspace.name);
  });
});
