import { describe, expect, it } from "vitest";
import { createMemoryDataStore } from "@/adapters/memory";
import { brand } from "@/domain/entities";
import { credits } from "@/domain/money";
import { runDataStoreContract } from "./data-store-contract";

runDataStoreContract("in-memory adapter", () => createMemoryDataStore());

describe("createMemoryDataStore", () => {
  it("starts empty", async () => {
    const store = createMemoryDataStore();
    expect(await store.users.list()).toEqual([]);
  });

  it("returns independent stores on each call", async () => {
    const a = createMemoryDataStore();
    const b = createMemoryDataStore();
    await a.users.insert({
      id: brand("user_1"),
      handle: "only-in-a",
      displayName: "A",
      avatarColor: "#000",
      avatarInitials: "A",
      balance: credits(0),
      createdAt: new Date(),
    });
    expect(await a.users.list()).toHaveLength(1);
    expect(await b.users.list()).toHaveLength(0);
  });
});
