/**
 * Unit tests for Neon workspace persistence.
 *
 * The Neon driver is mocked so the suite stays zero-config. Behaviour under
 * test: schema ensure-once, CRUD of the single-tenant snapshot row, and
 * rejection of malformed payloads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSnapshot } from "@/lib/model/types";
import { createDemoSnapshot } from "@/lib/seed/demo-workspace";

const store = new Map<string, unknown>();

const sqlMock = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join("?");
  if (text.includes("CREATE TABLE")) {
    return [];
  }
  if (text.includes("SELECT data")) {
    const id = values[0];
    if (typeof id !== "string" || !store.has(id)) return [];
    return [{ data: store.get(id) }];
  }
  if (text.includes("INSERT INTO workspaces")) {
    const id = values[0];
    const payload = values[1];
    if (typeof id !== "string") throw new Error("expected id");
    const data = typeof payload === "string" ? JSON.parse(payload) : payload;
    store.set(id, data);
    return [];
  }
  if (text.includes("DELETE FROM workspaces")) {
    const id = values[0];
    if (typeof id === "string") store.delete(id);
    return [];
  }
  throw new Error(`Unhandled SQL in mock: ${text}`);
});

vi.mock("@neondatabase/serverless", () => ({
  neon: () => sqlMock,
}));

import {
  WORKSPACE_ROW_ID,
  deleteSnapshot,
  readSnapshot,
  resetPersistenceForTests,
  writeSnapshot,
} from "./persistence";

describe("workspace persistence (Neon)", () => {
  beforeEach(() => {
    store.clear();
    sqlMock.mockClear();
    resetPersistenceForTests();
    process.env.DATABASE_URL = "postgres://user:pw@example.test/db";
  });

  afterEach(() => {
    resetPersistenceForTests();
    delete process.env.DATABASE_URL;
  });

  it("returns null when no snapshot row exists", async () => {
    await expect(readSnapshot()).resolves.toBeNull();
  });

  it("round-trips a workspace snapshot", async () => {
    const snapshot = createDemoSnapshot();
    await writeSnapshot(snapshot);
    await expect(readSnapshot()).resolves.toEqual(snapshot);
  });

  it("overwrites on a second write", async () => {
    const first = createDemoSnapshot();
    await writeSnapshot(first);
    const next: WorkspaceSnapshot = {
      ...first,
      workspace: { ...first.workspace, name: "Renamed" },
    };
    await writeSnapshot(next);
    const loaded = await readSnapshot();
    expect(loaded?.workspace.name).toBe("Renamed");
  });

  it("deleteSnapshot clears the row", async () => {
    await writeSnapshot(createDemoSnapshot());
    await deleteSnapshot();
    await expect(readSnapshot()).resolves.toBeNull();
  });

  it("ensures schema only once across reads/writes", async () => {
    await writeSnapshot(createDemoSnapshot());
    await readSnapshot();
    await deleteSnapshot();
    const createCalls = sqlMock.mock.calls.filter((args) => {
      const strings = args[0] as TemplateStringsArray;
      return strings.join("").includes("CREATE TABLE");
    });
    expect(createCalls).toHaveLength(1);
  });

  it("rejects writes that are not workspace snapshots", async () => {
    await expect(writeSnapshot({} as WorkspaceSnapshot)).rejects.toThrow(
      /not a WorkspaceSnapshot/,
    );
  });

  it("uses the fixed single-tenant row id", async () => {
    await writeSnapshot(createDemoSnapshot());
    expect(store.has(WORKSPACE_ROW_ID)).toBe(true);
  });

  it("throws when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    resetPersistenceForTests();
    await expect(readSnapshot()).rejects.toThrow(/DATABASE_URL/);
  });
});
