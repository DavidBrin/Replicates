import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../editorStore";
import { indexOf } from "../editorModel";

const store = () => useEditorStore.getState();

beforeEach(() => {
  store().reset();
});

describe("editor store", () => {
  it("paints with the current tool and records one history entry per stroke", () => {
    store().setTool({ kind: "terrain", terrain: "water" });
    store().beginStroke();
    store().paintAt(0);
    store().paintAt(1);
    store().paintAt(2);
    expect(store().draft.tiles.slice(0, 3).every((t) => t.terrain === "water")).toBe(true);
    expect(store().past).toHaveLength(1);

    store().undo();
    expect(store().draft.tiles.slice(0, 3).every((t) => t.terrain === "grass")).toBe(true);
    expect(store().past).toHaveLength(0);
    expect(store().future).toHaveLength(1);

    store().redo();
    expect(store().draft.tiles[2]?.terrain).toBe("water");
    expect(store().future).toHaveLength(0);
  });

  it("paintOnce is a click: one entry, and a no-op paint records nothing", () => {
    store().setTool({ kind: "terrain", terrain: "grass" });
    store().paintOnce(0);
    expect(store().past).toHaveLength(0);
    store().setTool({ kind: "terrain", terrain: "sand" });
    store().paintOnce(0);
    expect(store().past).toHaveLength(1);
  });

  it("a new change after undo discards the redo branch", () => {
    store().setTool({ kind: "terrain", terrain: "water" });
    store().paintOnce(0);
    store().paintOnce(1);
    store().undo();
    store().paintOnce(5);
    expect(store().future).toHaveLength(0);
    expect(store().draft.tiles[1]?.terrain).toBe("grass");
    expect(store().draft.tiles[5]?.terrain).toBe("water");
  });

  it("resize preserves content and is undoable", () => {
    const before = store().draft;
    const cityIndex = before.tiles.findIndex((t) => t.building === "city");
    store().resize(20, 14);
    const after = store().draft;
    expect(after.width).toBe(20);
    expect(after.tiles).toHaveLength(280);
    const x = cityIndex % before.width;
    const y = Math.floor(cityIndex / before.width);
    expect(after.tiles[indexOf(after, x, y)]?.building).toBe("city");
    store().undo();
    expect(store().draft).toBe(before);
  });

  it("selecting an owner tool also sets the active owner, clamped by the player count", () => {
    store().setPlayers(4);
    store().setTool({ kind: "owner", owner: 3 });
    expect(store().activeOwner).toBe(3);
    store().setPlayers(2);
    expect(store().activeOwner).toBe(1);
  });

  it("name/author/biome/fill/clear are history entries; load and reset wipe history", () => {
    store().setName("Isle");
    store().setAuthor("Me");
    store().setBiome("snow");
    store().fill("water");
    store().clear();
    expect(store().past).toHaveLength(5);
    expect(store().draft.tiles[0]?.terrain).toBe("snow");

    const map = { ...store().draft, id: "abc", name: "Loaded" };
    store().load(map, "abc");
    expect(store().past).toHaveLength(0);
    expect(store().loadedFrom).toBe("abc");
    expect(store().draft.name).toBe("Loaded");

    store().reset();
    expect(store().draft.name).toBe("Untitled Island");
    expect(store().loadedFrom).toBeNull();
  });

  it("caps history at 100 entries", () => {
    store().setTool({ kind: "terrain", terrain: "water" });
    for (let i = 0; i < 120; i += 1) {
      store().setName(`n${i}`);
    }
    expect(store().past).toHaveLength(100);
  });
});
