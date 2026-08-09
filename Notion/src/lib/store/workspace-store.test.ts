import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspace-store";
import { createDemoSnapshot, SEED_IDS } from "../seed/demo-workspace";

const store = () => useWorkspaceStore.getState();

beforeEach(() => {
  // Merge, never replace — a replacing setState would strip the actions off
  // the store along with the data.
  useWorkspaceStore.setState({ ...createDemoSnapshot(), hydrated: true });
});

/** Ordered block ids of a page or a block, whichever holds them. */
const childrenOf = (parentId: string) =>
  store().pages[parentId]?.blockIds ?? store().blocks[parentId]?.childIds ?? [];

describe("blocks", () => {
  const pageId = SEED_IDS.homePageId;

  it("appends a block to the end by default", () => {
    const before = childrenOf(pageId).length;
    const id = store().insertBlock({ parentId: pageId, text: "new" });

    expect(childrenOf(pageId)).toHaveLength(before + 1);
    expect(childrenOf(pageId).at(-1)).toBe(id);
  });

  it("inserts directly after the named block", () => {
    const siblings = childrenOf(pageId);
    const anchor = siblings[1];
    const id = store().insertBlock({ parentId: pageId, afterBlockId: anchor });

    expect(childrenOf(pageId)[2]).toBe(id);
  });

  it("removes a block from its parent's order when deleted", () => {
    const target = childrenOf(pageId)[0];
    store().deleteBlock(target);

    expect(store().blocks[target]).toBeUndefined();
    expect(childrenOf(pageId)).not.toContain(target);
  });

  it("deletes nested children along with their parent, leaving no orphans", () => {
    const parent = store().insertBlock({ parentId: pageId, type: "toggle", text: "parent" });
    const child = store().insertBlock({ parentId: parent, text: "child" });
    const grandchild = store().insertBlock({ parentId: child, text: "grandchild" });

    store().deleteBlock(parent);

    expect(store().blocks[parent]).toBeUndefined();
    expect(store().blocks[child]).toBeUndefined();
    expect(store().blocks[grandchild]).toBeUndefined();
  });

  it("reorders within a parent without changing the block count", () => {
    const before = childrenOf(pageId);
    const moved = before[3];
    store().moveBlock(moved, pageId, 0);

    const after = childrenOf(pageId);
    expect(after[0]).toBe(moved);
    expect(after).toHaveLength(before.length);
    expect(new Set(after)).toEqual(new Set(before));
  });

  it("reparents a block and updates both orders", () => {
    const host = store().insertBlock({ parentId: pageId, type: "toggle", text: "host" });
    const mover = childrenOf(pageId)[0];

    store().moveBlock(mover, host, 0);

    expect(childrenOf(pageId)).not.toContain(mover);
    expect(store().blocks[host].childIds).toEqual([mover]);
    expect(store().blocks[mover].parentId).toBe(host);
  });

  it("refuses to move a block inside its own subtree", () => {
    const parent = store().insertBlock({ parentId: pageId, type: "toggle", text: "p" });
    const child = store().insertBlock({ parentId: parent, text: "c" });

    store().moveBlock(parent, child, 0);

    // The tree must be unchanged — otherwise the branch detaches entirely.
    expect(store().blocks[parent].parentId).toBe(pageId);
    expect(store().blocks[child].parentId).toBe(parent);
  });
});

describe("indent and outdent", () => {
  const pageId = SEED_IDS.homePageId;

  it("nests a block under its previous sibling", () => {
    const first = store().insertBlock({ parentId: pageId, text: "first" });
    const second = store().insertBlock({ parentId: pageId, text: "second" });

    store().indentBlock(second);

    expect(store().blocks[second].parentId).toBe(first);
    expect(store().blocks[first].childIds).toContain(second);
    expect(childrenOf(pageId)).not.toContain(second);
  });

  it("leaves the first block of a list alone — there is nothing to nest under", () => {
    const host = store().insertBlock({ parentId: pageId, type: "toggle", text: "host" });
    const only = store().insertBlock({ parentId: host, text: "only" });

    store().indentBlock(only);

    expect(store().blocks[only].parentId).toBe(host);
  });

  it("outdent places the block directly after its former parent", () => {
    const first = store().insertBlock({ parentId: pageId, text: "first" });
    const second = store().insertBlock({ parentId: pageId, text: "second" });
    store().indentBlock(second);

    store().outdentBlock(second);

    const siblings = childrenOf(pageId);
    expect(siblings.indexOf(second)).toBe(siblings.indexOf(first) + 1);
    expect(store().blocks[second].parentId).toBe(pageId);
  });

  it("is a no-op at the top level of a page", () => {
    const id = store().insertBlock({ parentId: pageId, text: "top" });
    store().outdentBlock(id);
    expect(store().blocks[id].parentId).toBe(pageId);
  });

  it("round-trips indent then outdent back to the original order", () => {
    const before = childrenOf(pageId);
    const target = before[2];

    store().indentBlock(target);
    store().outdentBlock(target);

    expect(childrenOf(pageId)).toEqual(before);
  });
});

describe("block conversion", () => {
  const pageId = SEED_IDS.homePageId;

  it("gives a to_do the checked field it needs", () => {
    const id = store().insertBlock({ parentId: pageId, text: "task" });
    store().convertBlock(id, "to_do");
    expect(store().blocks[id]).toMatchObject({ type: "to_do", checked: false });
  });

  it("gives a callout a default emoji", () => {
    const id = store().insertBlock({ parentId: pageId, text: "note" });
    store().convertBlock(id, "callout");
    expect(store().blocks[id].emoji).toBeTruthy();
  });

  it("preserves the text across a conversion", () => {
    const id = store().insertBlock({ parentId: pageId, text: "keep me" });
    store().convertBlock(id, "heading_2");
    expect(store().blocks[id].text).toBe("keep me");
  });
});

describe("database rows", () => {
  const databaseId = SEED_IDS.databaseId;

  it("creates a row with every column initialised", () => {
    const rowId = store().createRow(databaseId);
    const row = store().pages[rowId];
    const database = store().databases[databaseId];

    for (const schema of database.properties) {
      expect(row.properties?.[schema.id]).toBeDefined();
    }
    expect(database.rowIds).toContain(rowId);
  });

  it("honours seeded values, which is how board drop sets the group", () => {
    const rowId = store().createRow(databaseId, {
      [SEED_IDS.properties.status]: { type: "status", status: "status-done" },
    });
    expect(store().pages[rowId].properties?.[SEED_IDS.properties.status]).toEqual({
      type: "status",
      status: "status-done",
    });
  });

  it("keeps the page title and the title property in step", () => {
    const rowId = store().createRow(databaseId);

    store().setPropertyValue(rowId, SEED_IDS.properties.name, {
      type: "title",
      title: "Written via the property",
    });
    expect(store().pages[rowId].title).toBe("Written via the property");

    store().renamePage(rowId, "Written via the page");
    expect(store().pages[rowId].properties?.[SEED_IDS.properties.name]).toEqual({
      type: "title",
      title: "Written via the page",
    });
  });

  it("removes a deleted row from the database order", () => {
    const rowId = store().createRow(databaseId);
    store().deleteRow(databaseId, rowId);

    expect(store().databases[databaseId].rowIds).not.toContain(rowId);
    expect(store().pages[rowId]).toBeUndefined();
  });

  it("backfills a new property onto every existing row", () => {
    const database = store().databases[databaseId];
    store().addProperty(databaseId, { id: "prop-notes", name: "Notes", type: "rich_text" });

    for (const rowId of database.rowIds) {
      expect(store().pages[rowId].properties?.["prop-notes"]).toEqual({
        type: "rich_text",
        rich_text: "",
      });
    }
  });

  it("refuses to remove the title column, which names every row", () => {
    store().removeProperty(databaseId, SEED_IDS.properties.name);
    expect(
      store().databases[databaseId].properties.some((p) => p.type === "title"),
    ).toBe(true);
  });

  it("clears grouping that pointed at a removed property", () => {
    const viewId = store().createView(databaseId, {
      name: "Grouped",
      type: "board",
      groupByPropertyId: SEED_IDS.properties.priority,
      filters: [],
      sorts: [],
      visiblePropertyIds: [],
    });

    store().removeProperty(databaseId, SEED_IDS.properties.priority);

    expect(store().views[viewId].groupByPropertyId).toBeUndefined();
  });
});

describe("views", () => {
  const databaseId = SEED_IDS.databaseId;

  it("refuses to delete the last view, which would make the data unviewable", () => {
    const database = store().databases[databaseId];
    for (const viewId of [...database.viewIds]) store().deleteView(viewId);

    expect(store().databases[databaseId].viewIds).toHaveLength(1);
  });
});

describe("pages", () => {
  it("puts a new top-level page into a sidebar section so it is reachable", () => {
    const pageId = store().createPage({ title: "Fresh" });
    const sections = store().workspace.sections;
    expect(sections.some((s) => s.pageIds.includes(pageId))).toBe(true);
  });

  it("trashes the whole subtree, not just the page you clicked", () => {
    const parent = store().createPage({ title: "Parent" });
    const child = store().createPage({ parentId: parent, title: "Child" });

    store().movePageToTrash(parent);

    expect(store().pages[parent].inTrash).toBe(true);
    expect(store().pages[child].inTrash).toBe(true);
  });

  it("restores the subtree and makes the page reachable again", () => {
    const parent = store().createPage({ title: "Parent" });
    const child = store().createPage({ parentId: parent, title: "Child" });

    store().movePageToTrash(parent);
    store().restorePage(parent);

    expect(store().pages[parent].inTrash).toBe(false);
    expect(store().pages[child].inTrash).toBe(false);
    expect(
      store().workspace.sections.some((s) => s.pageIds.includes(parent)),
    ).toBe(true);
  });

  it("leaves no dangling references after a permanent delete", () => {
    const parent = store().createPage({ title: "Parent" });
    const child = store().createPage({ parentId: parent, title: "Child" });
    const blockId = store().insertBlock({ parentId: child, text: "orphan candidate" });

    store().deletePagePermanently(parent);

    expect(store().pages[parent]).toBeUndefined();
    expect(store().pages[child]).toBeUndefined();
    expect(store().blocks[blockId]).toBeUndefined();
    for (const page of Object.values(store().pages)) {
      expect(page.childPageIds).not.toContain(parent);
      expect(page.childPageIds).not.toContain(child);
    }
  });

  it("duplicates a page with copies of its blocks, not shared references", () => {
    const source = SEED_IDS.homePageId;
    const copyId = store().duplicatePage(source);
    const copy = store().pages[copyId];

    expect(copy.blockIds).toHaveLength(store().pages[source].blockIds.length);
    expect(copy.blockIds).not.toEqual(store().pages[source].blockIds);
    // Editing the copy must not change the original.
    store().updateBlockText(copy.blockIds[0], "changed in the copy");
    expect(store().blocks[store().pages[source].blockIds[0]].text).not.toBe(
      "changed in the copy",
    );
  });

  it("adds and removes the page from Favorites when toggled", () => {
    const pageId = store().createPage({ title: "Starred" });
    const favorites = () =>
      store().workspace.sections.find((s) => s.kind === "favorites")!.pageIds;

    store().togglePageFavorite(pageId);
    expect(favorites()).toContain(pageId);

    store().togglePageFavorite(pageId);
    expect(favorites()).not.toContain(pageId);
  });
});

describe("members and invites", () => {
  it("adds an invited person as pending, with a derived display name", () => {
    const userId = store().inviteMember("jamie.chen@example.com", "can_edit");
    const membership = store().workspace.members.find((m) => m.userId === userId);

    expect(store().users[userId].name).toBe("Jamie Chen");
    expect(membership).toMatchObject({ role: "can_edit", invitePending: true });
  });

  it("derives the avatar colour from the email, so it is stable across invites", () => {
    const firstId = store().inviteMember("same@example.com", "can_view");
    const firstColor = store().users[firstId].color;

    // Start from a clean workspace, then invite the same address again.
    useWorkspaceStore.setState({ ...createDemoSnapshot(), hydrated: true });
    const secondId = store().inviteMember("same@example.com", "can_view");

    expect(secondId).not.toBe(firstId);
    expect(store().users[secondId].color).toBe(firstColor);
  });

  it("gives different addresses different colours", () => {
    const colors = new Set(
      ["a@x.io", "b@x.io", "c@x.io", "d@x.io"].map((email) => {
        // Invite first, then re-read the store — `store()` captures a
        // snapshot, so reading it in the same expression would predate
        // the new user.
        const userId = store().inviteMember(email, "can_view");
        return store().users[userId].color;
      }),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("changes and revokes a role", () => {
    const userId = store().inviteMember("temp@example.com", "can_view");

    store().setMemberRole(userId, "full_access");
    expect(store().workspace.members.find((m) => m.userId === userId)?.role).toBe(
      "full_access",
    );

    store().removeMember(userId);
    expect(store().workspace.members.some((m) => m.userId === userId)).toBe(false);
  });

  it("scopes a page invite to that page", () => {
    const pageId = SEED_IDS.homePageId;
    const userId = store().invitePageMember(pageId, "guest@example.com", "can_comment");

    expect(store().pages[pageId].members?.some((m) => m.userId === userId)).toBe(true);

    store().removePageMember(pageId, userId);
    expect(store().pages[pageId].members?.some((m) => m.userId === userId)).toBe(false);
  });
});

describe("snapshot export", () => {
  it("omits transient UI state so it can be round-tripped through storage", () => {
    const snapshot = store().exportSnapshot();
    expect(snapshot).not.toHaveProperty("hydrated");
    expect(snapshot).not.toHaveProperty("insertBlock");
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "blocks",
        "currentUserId",
        "databases",
        "pages",
        "schemaVersion",
        "users",
        "views",
        "workspace",
      ].sort(),
    );
  });
});
