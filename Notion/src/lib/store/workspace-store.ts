"use client";

/**
 * The document store.
 *
 * Holds the whole workspace as normalised entity maps and exposes operations
 * in Notion's vocabulary (append/convert/indent/move a block, set a property
 * value) rather than generic CRUD. Components subscribe to a single entity by
 * id, so typing in one block re-renders that block and nothing else.
 *
 * Persistence is deliberately manual rather than zustand's `persist`
 * middleware: hydration must not run during render (it would desynchronise the
 * server and client HTML), and the write must be debounced. `useHydrateStore`
 * in `./hydration.ts` owns that lifecycle.
 */

import { create } from "zustand";
import type {
  Block,
  BlockType,

  Id,
  MemberRole,
  Membership,
  NotionColor,
  Page,
  PageCover,
  PageIcon,
  PropertySchema,
  PropertyValue,
  SidebarSection,
  User,
  View,

  WorkspaceSnapshot,
} from "../model/types";
import { getPropertyHandler } from "../model/property-types";
import { createDemoSnapshot } from "../seed/demo-workspace";
import { newId } from "../utils/id";

/* --------------------------------------------------------------- helpers -- */

const now = () => new Date().toISOString();

/** Inserts `item` into `list` at `index`, appending when index is omitted. */
function insertAt<T>(list: T[], item: T, index?: number): T[] {
  const next = [...list];
  if (index === undefined || index < 0 || index > next.length) next.push(item);
  else next.splice(index, 0, item);
  return next;
}

function removeFrom<T>(list: T[], item: T): T[] {
  return list.filter((entry) => entry !== item);
}

/* ----------------------------------------------------------------- state -- */

export interface WorkspaceState extends WorkspaceSnapshot {
  /** False until the persisted snapshot has been read on the client. */
  hydrated: boolean;

  /* -- lifecycle -- */
  replaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
  markHydrated: () => void;
  resetToSeed: () => void;
  exportSnapshot: () => WorkspaceSnapshot;

  /* -- workspace -- */
  renameWorkspace: (name: string) => void;
  setWorkspaceIcon: (icon: PageIcon) => void;
  toggleSectionCollapsed: (sectionId: Id) => void;

  /* -- members and sharing -- */
  inviteMember: (email: string, role: MemberRole) => Id;
  setMemberRole: (userId: Id, role: MemberRole) => void;
  removeMember: (userId: Id) => void;
  setPageMemberRole: (pageId: Id, userId: Id, role: MemberRole) => void;
  invitePageMember: (pageId: Id, email: string, role: MemberRole) => Id;
  removePageMember: (pageId: Id, userId: Id) => void;
  setPagePublished: (pageId: Id, published: boolean) => void;

  /* -- pages -- */
  createPage: (options?: {
    parentId?: Id | null;
    title?: string;
    sectionId?: Id;
    index?: number;
  }) => Id;
  renamePage: (pageId: Id, title: string) => void;
  setPageIcon: (pageId: Id, icon: PageIcon) => void;
  setPageCover: (pageId: Id, cover: PageCover) => void;
  togglePageFavorite: (pageId: Id) => void;
  setPageFullWidth: (pageId: Id, fullWidth: boolean) => void;
  setPageSmallText: (pageId: Id, smallText: boolean) => void;
  movePageToTrash: (pageId: Id) => void;
  restorePage: (pageId: Id) => void;
  deletePagePermanently: (pageId: Id) => void;
  duplicatePage: (pageId: Id) => Id;
  movePageInSidebar: (pageId: Id, sectionId: Id, index: number) => void;

  /* -- blocks -- */
  insertBlock: (options: {
    parentId: Id;
    type?: BlockType;
    text?: string;
    afterBlockId?: Id;
    patch?: Partial<Block>;
  }) => Id;
  updateBlockText: (blockId: Id, text: string) => void;
  patchBlock: (blockId: Id, patch: Partial<Block>) => void;
  convertBlock: (blockId: Id, type: BlockType) => void;
  setBlockColor: (blockId: Id, color: NotionColor) => void;
  toggleBlockChecked: (blockId: Id) => void;
  toggleBlockExpanded: (blockId: Id) => void;
  deleteBlock: (blockId: Id) => void;
  moveBlock: (blockId: Id, newParentId: Id, index: number) => void;
  indentBlock: (blockId: Id) => void;
  outdentBlock: (blockId: Id) => void;

  /* -- databases -- */
  createRow: (databaseId: Id, seedValues?: Record<Id, PropertyValue>, index?: number) => Id;
  deleteRow: (databaseId: Id, rowId: Id) => void;
  moveRow: (databaseId: Id, rowId: Id, index: number) => void;
  setPropertyValue: (pageId: Id, propertyId: Id, value: PropertyValue) => void;
  addProperty: (databaseId: Id, schema: PropertySchema, index?: number) => void;
  updateProperty: (databaseId: Id, schema: PropertySchema) => void;
  removeProperty: (databaseId: Id, propertyId: Id) => void;
  renameDatabase: (databaseId: Id, title: string) => void;

  /* -- views -- */
  createView: (databaseId: Id, view: Omit<View, "id" | "databaseId">) => Id;
  updateView: (viewId: Id, patch: Partial<View>) => void;
  deleteView: (viewId: Id) => void;
}

/* ------------------------------------------------------------------ store -- */

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
  /** Marks a page (and the workspace) as touched by the current user. */
  const touchPage = (pages: Record<Id, Page>, pageId: Id, userId: Id) => {
    const page = pages[pageId];
    if (!page) return pages;
    return {
      ...pages,
      [pageId]: { ...page, lastEditedAt: now(), lastEditedBy: userId },
    };
  };

  return {
    ...createDemoSnapshot(),
    hydrated: false,

    /* ---------------------------------------------------------- lifecycle */

    replaceSnapshot: (snapshot) => set({ ...snapshot, hydrated: true }),

    markHydrated: () => set({ hydrated: true }),

    resetToSeed: () => set({ ...createDemoSnapshot(), hydrated: true }),

    exportSnapshot: () => {
      const { workspace, users, pages, blocks, databases, views, currentUserId, schemaVersion } =
        get();
      return { schemaVersion, workspace, users, pages, blocks, databases, views, currentUserId };
    },

    /* ---------------------------------------------------------- workspace */

    renameWorkspace: (name) =>
      set((s) => ({ workspace: { ...s.workspace, name } })),

    setWorkspaceIcon: (icon) =>
      set((s) => ({ workspace: { ...s.workspace, icon } })),

    toggleSectionCollapsed: (sectionId) =>
      set((s) => ({
        workspace: {
          ...s.workspace,
          sections: s.workspace.sections.map((section) =>
            section.id === sectionId
              ? { ...section, collapsed: !section.collapsed }
              : section,
          ),
        },
      })),

    /* ------------------------------------------------------------ members */

    inviteMember: (email, role) => {
      const userId = newId("user");
      const name = email.split("@")[0].replace(/[._-]+/g, " ").trim() || email;
      const user: User = {
        id: userId,
        name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        email,
        color: pickColorForSeed(email),
      };
      set((s) => ({
        users: { ...s.users, [userId]: user },
        workspace: {
          ...s.workspace,
          members: [
            ...s.workspace.members,
            { userId, role, invitePending: true, invitedAt: now() },
          ],
        },
      }));
      return userId;
    },

    setMemberRole: (userId, role) =>
      set((s) => ({
        workspace: {
          ...s.workspace,
          members: s.workspace.members.map((m) =>
            m.userId === userId ? { ...m, role } : m,
          ),
        },
      })),

    removeMember: (userId) =>
      set((s) => ({
        workspace: {
          ...s.workspace,
          members: s.workspace.members.filter((m) => m.userId !== userId),
        },
      })),

    setPageMemberRole: (pageId, userId, role) =>
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;
        const members = (page.members ?? []).map((m) =>
          m.userId === userId ? { ...m, role } : m,
        );
        return { pages: { ...s.pages, [pageId]: { ...page, members } } };
      }),

    invitePageMember: (pageId, email, role) => {
      const userId = get().inviteMember(email, role);
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;
        const member: Membership = { userId, role, invitePending: true, invitedAt: now() };
        return {
          pages: {
            ...s.pages,
            [pageId]: { ...page, members: [...(page.members ?? []), member] },
          },
        };
      });
      return userId;
    },

    removePageMember: (pageId, userId) =>
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;
        return {
          pages: {
            ...s.pages,
            [pageId]: {
              ...page,
              members: (page.members ?? []).filter((m) => m.userId !== userId),
            },
          },
        };
      }),

    setPagePublished: (pageId, isPublished) =>
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;
        return { pages: { ...s.pages, [pageId]: { ...page, isPublished } } };
      }),

    /* -------------------------------------------------------------- pages */

    createPage: ({ parentId = null, title = "", sectionId, index } = {}) => {
      const pageId = newId("page");
      const state = get();
      const page: Page = {
        id: pageId,
        workspaceId: state.workspace.id,
        parentId,
        title,
        icon: { type: "none" },
        cover: { type: "none" },
        blockIds: [],
        childPageIds: [],
        createdAt: now(),
        createdBy: state.currentUserId,
        lastEditedAt: now(),
        lastEditedBy: state.currentUserId,
      };

      set((s) => {
        const pages = { ...s.pages, [pageId]: page };
        if (parentId && pages[parentId]) {
          pages[parentId] = {
            ...pages[parentId],
            childPageIds: [...pages[parentId].childPageIds, pageId],
          };
        }

        // A page with no parent must land in a sidebar section, or it would
        // exist but be unreachable.
        const targetSectionId =
          sectionId ??
          (parentId
            ? undefined
            : s.workspace.sections.find((x) => x.kind === "private")?.id);

        const sections: SidebarSection[] = targetSectionId
          ? s.workspace.sections.map((section) =>
              section.id === targetSectionId
                ? { ...section, pageIds: insertAt(section.pageIds, pageId, index) }
                : section,
            )
          : s.workspace.sections;

        return { pages, workspace: { ...s.workspace, sections } };
      });

      return pageId;
    },

    renamePage: (pageId, title) =>
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;
        const updated: Page = {
          ...page,
          title,
          lastEditedAt: now(),
          lastEditedBy: s.currentUserId,
        };
        // A database row's title lives in its title property too; keep both
        // in step so the board card and the page header never disagree.
        if (page.databaseId && page.properties) {
          const database = s.databases[page.databaseId];
          const titleProp = database?.properties.find((p) => p.type === "title");
          if (titleProp) {
            updated.properties = {
              ...page.properties,
              [titleProp.id]: { type: "title", title },
            };
          }
        }
        return { pages: { ...s.pages, [pageId]: updated } };
      }),

    setPageIcon: (pageId, icon) =>
      set((s) => {
        const page = s.pages[pageId];
        return page ? { pages: { ...s.pages, [pageId]: { ...page, icon } } } : s;
      }),

    setPageCover: (pageId, cover) =>
      set((s) => {
        const page = s.pages[pageId];
        return page ? { pages: { ...s.pages, [pageId]: { ...page, cover } } } : s;
      }),

    togglePageFavorite: (pageId) =>
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;
        const favorite = !page.favorite;
        const sections = s.workspace.sections.map((section) => {
          if (section.kind !== "favorites") return section;
          return {
            ...section,
            pageIds: favorite
              ? [...new Set([...section.pageIds, pageId])]
              : removeFrom(section.pageIds, pageId),
          };
        });
        return {
          pages: { ...s.pages, [pageId]: { ...page, favorite } },
          workspace: { ...s.workspace, sections },
        };
      }),

    setPageFullWidth: (pageId, fullWidth) =>
      set((s) => {
        const page = s.pages[pageId];
        return page ? { pages: { ...s.pages, [pageId]: { ...page, fullWidth } } } : s;
      }),

    setPageSmallText: (pageId, smallText) =>
      set((s) => {
        const page = s.pages[pageId];
        return page ? { pages: { ...s.pages, [pageId]: { ...page, smallText } } } : s;
      }),

    movePageToTrash: (pageId) =>
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;

        // Trash the whole subtree — a child left behind would be orphaned.
        const pages = { ...s.pages };
        const stack = [pageId];
        while (stack.length) {
          const id = stack.pop()!;
          const target = pages[id];
          if (!target) continue;
          pages[id] = { ...target, inTrash: true };
          stack.push(...target.childPageIds);
        }

        const sections = s.workspace.sections.map((section) => ({
          ...section,
          pageIds: removeFrom(section.pageIds, pageId),
        }));

        return { pages, workspace: { ...s.workspace, sections } };
      }),

    restorePage: (pageId) =>
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;
        const pages = { ...s.pages };
        const stack = [pageId];
        while (stack.length) {
          const id = stack.pop()!;
          const target = pages[id];
          if (!target) continue;
          pages[id] = { ...target, inTrash: false };
          stack.push(...target.childPageIds);
        }

        // A restored top-level page needs a section again.
        const sections = page.parentId
          ? s.workspace.sections
          : s.workspace.sections.map((section) =>
              section.kind === "private"
                ? { ...section, pageIds: [...section.pageIds, pageId] }
                : section,
            );

        return { pages, workspace: { ...s.workspace, sections } };
      }),

    deletePagePermanently: (pageId) =>
      set((s) => {
        const pages = { ...s.pages };
        const blocks = { ...s.blocks };
        const stack = [pageId];
        const removed: Id[] = [];

        while (stack.length) {
          const id = stack.pop()!;
          const page = pages[id];
          if (!page) continue;
          removed.push(id);
          stack.push(...page.childPageIds);
          page.blockIds.forEach((blockId) => delete blocks[blockId]);
          delete pages[id];
        }

        // Unlink from any parent page and from every database that held it.
        for (const id of Object.keys(pages)) {
          const page = pages[id];
          if (page.childPageIds.some((child) => removed.includes(child))) {
            pages[id] = {
              ...page,
              childPageIds: page.childPageIds.filter((c) => !removed.includes(c)),
            };
          }
        }

        const databases = Object.fromEntries(
          Object.entries(s.databases).map(([id, db]) => [
            id,
            { ...db, rowIds: db.rowIds.filter((r) => !removed.includes(r)) },
          ]),
        );

        const sections = s.workspace.sections.map((section) => ({
          ...section,
          pageIds: section.pageIds.filter((p) => !removed.includes(p)),
        }));

        return { pages, blocks, databases, workspace: { ...s.workspace, sections } };
      }),

    duplicatePage: (pageId) => {
      const source = get().pages[pageId];
      if (!source) return pageId;
      const copyId = newId("page");

      set((s) => {
        const blocks = { ...s.blocks };
        const blockIds = source.blockIds.map((blockId) => {
          const original = s.blocks[blockId];
          if (!original) return blockId;
          const cloneId = newId("block");
          blocks[cloneId] = { ...original, id: cloneId, parentId: copyId };
          return cloneId;
        });

        const copy: Page = {
          ...source,
          id: copyId,
          title: `${source.title} (copy)`,
          blockIds,
          childPageIds: [],
          favorite: false,
          createdAt: now(),
          lastEditedAt: now(),
        };

        const pages = { ...s.pages, [copyId]: copy };
        if (source.parentId && pages[source.parentId]) {
          const parent = pages[source.parentId];
          pages[source.parentId] = {
            ...parent,
            childPageIds: insertAt(
              parent.childPageIds,
              copyId,
              parent.childPageIds.indexOf(pageId) + 1,
            ),
          };
        }

        const databases = source.databaseId
          ? {
              ...s.databases,
              [source.databaseId]: {
                ...s.databases[source.databaseId],
                rowIds: insertAt(
                  s.databases[source.databaseId].rowIds,
                  copyId,
                  s.databases[source.databaseId].rowIds.indexOf(pageId) + 1,
                ),
              },
            }
          : s.databases;

        const sections = source.parentId
          ? s.workspace.sections
          : s.workspace.sections.map((section) =>
              section.pageIds.includes(pageId)
                ? {
                    ...section,
                    pageIds: insertAt(
                      section.pageIds,
                      copyId,
                      section.pageIds.indexOf(pageId) + 1,
                    ),
                  }
                : section,
            );

        return { pages, blocks, databases, workspace: { ...s.workspace, sections } };
      });

      return copyId;
    },

    movePageInSidebar: (pageId, sectionId, index) =>
      set((s) => ({
        workspace: {
          ...s.workspace,
          sections: s.workspace.sections.map((section) => {
            const without = removeFrom(section.pageIds, pageId);
            if (section.id !== sectionId) return { ...section, pageIds: without };
            return { ...section, pageIds: insertAt(without, pageId, index) };
          }),
        },
      })),

    /* ------------------------------------------------------------- blocks */

    insertBlock: ({ parentId, type = "paragraph", text = "", afterBlockId, patch }) => {
      const blockId = newId("block");
      set((s) => {
        const block: Block = {
          id: blockId,
          type,
          parentId,
          text,
          childIds: [],
          createdAt: now(),
          lastEditedAt: now(),
          ...patch,
        };

        const blocks = { ...s.blocks, [blockId]: block };
        const parentPage = s.pages[parentId];

        if (parentPage) {
          const index =
            afterBlockId === undefined
              ? undefined
              : parentPage.blockIds.indexOf(afterBlockId) + 1;
          const pages = {
            ...s.pages,
            [parentId]: {
              ...parentPage,
              blockIds: insertAt(parentPage.blockIds, blockId, index),
              lastEditedAt: now(),
              lastEditedBy: s.currentUserId,
            },
          };
          return { blocks, pages };
        }

        // Otherwise the parent is another block (nested content).
        const parentBlock = s.blocks[parentId];
        if (!parentBlock) return { blocks };
        const index =
          afterBlockId === undefined
            ? undefined
            : parentBlock.childIds.indexOf(afterBlockId) + 1;
        blocks[parentId] = {
          ...parentBlock,
          childIds: insertAt(parentBlock.childIds, blockId, index),
        };
        return { blocks };
      });
      return blockId;
    },

    updateBlockText: (blockId, text) =>
      set((s) => {
        const block = s.blocks[blockId];
        if (!block || block.text === text) return s;
        return {
          blocks: { ...s.blocks, [blockId]: { ...block, text, lastEditedAt: now() } },
          pages: touchPage(s.pages, block.parentId, s.currentUserId),
        };
      }),

    patchBlock: (blockId, patch) =>
      set((s) => {
        const block = s.blocks[blockId];
        if (!block) return s;
        return {
          blocks: {
            ...s.blocks,
            [blockId]: { ...block, ...patch, lastEditedAt: now() },
          },
        };
      }),

    convertBlock: (blockId, type) =>
      set((s) => {
        const block = s.blocks[blockId];
        if (!block || block.type === type) return s;
        const converted: Block = { ...block, type, lastEditedAt: now() };
        // Give the new type the fields it needs and drop ones it cannot use.
        if (type === "to_do") converted.checked = block.checked ?? false;
        if (type === "toggle") converted.expanded = block.expanded ?? true;
        if (type === "callout" && !converted.emoji) converted.emoji = "💡";
        if (type === "code" && !converted.language) converted.language = "typescript";
        return { blocks: { ...s.blocks, [blockId]: converted } };
      }),

    setBlockColor: (blockId, color) => get().patchBlock(blockId, { color }),

    toggleBlockChecked: (blockId) =>
      set((s) => {
        const block = s.blocks[blockId];
        if (!block) return s;
        return {
          blocks: {
            ...s.blocks,
            [blockId]: { ...block, checked: !block.checked, lastEditedAt: now() },
          },
        };
      }),

    toggleBlockExpanded: (blockId) =>
      set((s) => {
        const block = s.blocks[blockId];
        if (!block) return s;
        return {
          blocks: {
            ...s.blocks,
            [blockId]: { ...block, expanded: !(block.expanded ?? true) },
          },
        };
      }),

    deleteBlock: (blockId) =>
      set((s) => {
        const block = s.blocks[blockId];
        if (!block) return s;

        const blocks = { ...s.blocks };
        // Remove the block and everything nested inside it.
        const stack = [blockId];
        while (stack.length) {
          const id = stack.pop()!;
          const target = blocks[id];
          if (!target) continue;
          stack.push(...target.childIds);
          delete blocks[id];
        }

        const parentPage = s.pages[block.parentId];
        if (parentPage) {
          return {
            blocks,
            pages: {
              ...s.pages,
              [block.parentId]: {
                ...parentPage,
                blockIds: removeFrom(parentPage.blockIds, blockId),
                lastEditedAt: now(),
                lastEditedBy: s.currentUserId,
              },
            },
          };
        }

        const parentBlock = blocks[block.parentId];
        if (parentBlock) {
          blocks[block.parentId] = {
            ...parentBlock,
            childIds: removeFrom(parentBlock.childIds, blockId),
          };
        }
        return { blocks };
      }),

    moveBlock: (blockId, newParentId, index) =>
      set((s) => {
        const block = s.blocks[blockId];
        if (!block) return s;

        // Refuse to move a block inside its own subtree — that would detach
        // the whole branch from the document.
        let cursor: Id | undefined = newParentId;
        while (cursor) {
          if (cursor === blockId) return s;
          cursor = s.blocks[cursor]?.parentId;
        }

        const blocks = { ...s.blocks };
        const pages = { ...s.pages };

        const detach = (parentId: Id) => {
          const page = pages[parentId];
          if (page) {
            pages[parentId] = { ...page, blockIds: removeFrom(page.blockIds, blockId) };
            return;
          }
          const parentBlock = blocks[parentId];
          if (parentBlock) {
            blocks[parentId] = {
              ...parentBlock,
              childIds: removeFrom(parentBlock.childIds, blockId),
            };
          }
        };

        const attach = (parentId: Id) => {
          const page = pages[parentId];
          if (page) {
            pages[parentId] = {
              ...page,
              blockIds: insertAt(page.blockIds, blockId, index),
              lastEditedAt: now(),
              lastEditedBy: s.currentUserId,
            };
            return;
          }
          const parentBlock = blocks[parentId];
          if (parentBlock) {
            blocks[parentId] = {
              ...parentBlock,
              childIds: insertAt(parentBlock.childIds, blockId, index),
            };
          }
        };

        detach(block.parentId);
        attach(newParentId);
        blocks[blockId] = { ...block, parentId: newParentId, lastEditedAt: now() };

        return { blocks, pages };
      }),

    indentBlock: (blockId) => {
      const s = get();
      const block = s.blocks[blockId];
      if (!block) return;
      const siblings = siblingIdsOf(s, block.parentId);
      const position = siblings.indexOf(blockId);
      // The first item in a list has nothing to nest under.
      if (position <= 0) return;
      const newParentId = siblings[position - 1];
      const newParent = s.blocks[newParentId];
      if (!newParent) return;
      get().moveBlock(blockId, newParentId, newParent.childIds.length);
    },

    outdentBlock: (blockId) => {
      const s = get();
      const block = s.blocks[blockId];
      if (!block) return;
      const parent = s.blocks[block.parentId];
      // Already at the top level of a page.
      if (!parent) return;
      const grandparentId = parent.parentId;
      const siblings = siblingIdsOf(s, grandparentId);
      get().moveBlock(blockId, grandparentId, siblings.indexOf(parent.id) + 1);
    },

    /* ---------------------------------------------------------- databases */

    createRow: (databaseId, seedValues = {}, index) => {
      const rowId = newId("page");
      set((s) => {
        const database = s.databases[databaseId];
        if (!database) return s;

        // Start every column at its type's empty value, then apply the seed.
        const properties: Record<Id, PropertyValue> = {};
        for (const schema of database.properties) {
          const handler = getPropertyHandler(schema.type);
          properties[schema.id] = handler.empty(schema as never) as PropertyValue;
        }
        Object.assign(properties, seedValues);

        const titleSchema = database.properties.find((p) => p.type === "title");
        const titleValue = titleSchema ? properties[titleSchema.id] : undefined;
        const title = titleValue?.type === "title" ? titleValue.title : "";

        const page: Page = {
          id: rowId,
          workspaceId: s.workspace.id,
          parentId: database.parentPageId,
          title,
          icon: { type: "none" },
          cover: { type: "none" },
          blockIds: [],
          childPageIds: [],
          databaseId,
          properties,
          createdAt: now(),
          createdBy: s.currentUserId,
          lastEditedAt: now(),
          lastEditedBy: s.currentUserId,
        };

        return {
          pages: { ...s.pages, [rowId]: page },
          databases: {
            ...s.databases,
            [databaseId]: { ...database, rowIds: insertAt(database.rowIds, rowId, index) },
          },
        };
      });
      return rowId;
    },

    deleteRow: (databaseId, rowId) =>
      set((s) => {
        const database = s.databases[databaseId];
        if (!database) return s;
        const pages = { ...s.pages };
        delete pages[rowId];
        return {
          pages,
          databases: {
            ...s.databases,
            [databaseId]: { ...database, rowIds: removeFrom(database.rowIds, rowId) },
          },
        };
      }),

    moveRow: (databaseId, rowId, index) =>
      set((s) => {
        const database = s.databases[databaseId];
        if (!database) return s;
        const without = removeFrom(database.rowIds, rowId);
        return {
          databases: {
            ...s.databases,
            [databaseId]: { ...database, rowIds: insertAt(without, rowId, index) },
          },
        };
      }),

    setPropertyValue: (pageId, propertyId, value) =>
      set((s) => {
        const page = s.pages[pageId];
        if (!page) return s;

        const properties = { ...(page.properties ?? {}), [propertyId]: value };
        const updated: Page = {
          ...page,
          properties,
          lastEditedAt: now(),
          lastEditedBy: s.currentUserId,
        };
        // Editing the title column renames the page itself.
        if (value.type === "title") updated.title = value.title;

        return { pages: { ...s.pages, [pageId]: updated } };
      }),

    addProperty: (databaseId, schema, index) =>
      set((s) => {
        const database = s.databases[databaseId];
        if (!database) return s;

        const handler = getPropertyHandler(schema.type);
        const pages = { ...s.pages };
        // Backfill every existing row so no cell is undefined.
        for (const rowId of database.rowIds) {
          const row = pages[rowId];
          if (!row) continue;
          pages[rowId] = {
            ...row,
            properties: {
              ...(row.properties ?? {}),
              [schema.id]: handler.empty(schema as never) as PropertyValue,
            },
          };
        }

        const views = Object.fromEntries(
          Object.entries(s.views).map(([id, view]) => [
            id,
            view.databaseId === databaseId
              ? { ...view, visiblePropertyIds: [...view.visiblePropertyIds, schema.id] }
              : view,
          ]),
        );

        return {
          pages,
          views,
          databases: {
            ...s.databases,
            [databaseId]: {
              ...database,
              properties: insertAt(database.properties, schema, index),
            },
          },
        };
      }),

    updateProperty: (databaseId, schema) =>
      set((s) => {
        const database = s.databases[databaseId];
        if (!database) return s;
        return {
          databases: {
            ...s.databases,
            [databaseId]: {
              ...database,
              properties: database.properties.map((p) => (p.id === schema.id ? schema : p)),
            },
          },
        };
      }),

    removeProperty: (databaseId, propertyId) =>
      set((s) => {
        const database = s.databases[databaseId];
        if (!database) return s;
        // The title column names every row; removing it would leave the
        // database unreadable, so it is not removable (as in Notion).
        const target = database.properties.find((p) => p.id === propertyId);
        if (!target || target.type === "title") return s;

        const views = Object.fromEntries(
          Object.entries(s.views).map(([id, view]) => [
            id,
            view.databaseId === databaseId
              ? {
                  ...view,
                  visiblePropertyIds: removeFrom(view.visiblePropertyIds, propertyId),
                  groupByPropertyId:
                    view.groupByPropertyId === propertyId ? undefined : view.groupByPropertyId,
                }
              : view,
          ]),
        );

        return {
          views,
          databases: {
            ...s.databases,
            [databaseId]: {
              ...database,
              properties: database.properties.filter((p) => p.id !== propertyId),
            },
          },
        };
      }),

    renameDatabase: (databaseId, title) =>
      set((s) => {
        const database = s.databases[databaseId];
        return database
          ? { databases: { ...s.databases, [databaseId]: { ...database, title } } }
          : s;
      }),

    /* -------------------------------------------------------------- views */

    createView: (databaseId, view) => {
      const viewId = newId("view");
      set((s) => {
        const database = s.databases[databaseId];
        if (!database) return s;
        return {
          views: { ...s.views, [viewId]: { ...view, id: viewId, databaseId } },
          databases: {
            ...s.databases,
            [databaseId]: { ...database, viewIds: [...database.viewIds, viewId] },
          },
        };
      });
      return viewId;
    },

    updateView: (viewId, patch) =>
      set((s) => {
        const view = s.views[viewId];
        return view ? { views: { ...s.views, [viewId]: { ...view, ...patch } } } : s;
      }),

    deleteView: (viewId) =>
      set((s) => {
        const view = s.views[viewId];
        if (!view) return s;
        const database = s.databases[view.databaseId];
        // A database must keep at least one view or it becomes unviewable.
        if (!database || database.viewIds.length <= 1) return s;
        const views = { ...s.views };
        delete views[viewId];
        return {
          views,
          databases: {
            ...s.databases,
            [view.databaseId]: {
              ...database,
              viewIds: removeFrom(database.viewIds, viewId),
            },
          },
        };
      }),
  };
});

/* --------------------------------------------------------------- helpers -- */

/** The ordered sibling list a block belongs to, whatever its parent kind. */
function siblingIdsOf(state: WorkspaceSnapshot, parentId: Id): Id[] {
  return state.pages[parentId]?.blockIds ?? state.blocks[parentId]?.childIds ?? [];
}

const COLOR_CYCLE: NotionColor[] = [
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "yellow",
  "red",
  "brown",
];

/** Stable per-person colour, so an invited member keeps the same avatar tint. */
function pickColorForSeed(seed: string): NotionColor {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return COLOR_CYCLE[hash % COLOR_CYCLE.length];
}
