/**
 * The workspace a first-time visitor lands in.
 *
 * Built as data rather than hard-coded UI so the same builders can produce a
 * blank workspace, a test fixture, or a different demo without touching any
 * component. Ids are stable strings (not random) so that deep links survive a
 * reset and tests can assert against known ids.
 */

import type {
  Block,
  BlockType,
  Database,
  Id,
  Page,
  PropertySchema,
  PropertyValue,
  StatusOption,
  User,
  View,
  Workspace,
  WorkspaceSnapshot,
} from "../model/types";
import { storage as storageConfig } from "@/config/app.config";

/** Fixed clock so the seed is deterministic and snapshot-testable. */
const SEED_EPOCH = new Date("2026-02-19T16:20:00.000Z").toISOString();

function ts(offsetMinutes = 0): string {
  return new Date(Date.parse(SEED_EPOCH) + offsetMinutes * 60_000).toISOString();
}

/* ------------------------------------------------------------------ users -- */

const USERS: User[] = [
  {
    id: "user-david",
    name: "David Brin",
    email: "david@pufferfish.io",
    avatarEmoji: "🧑🏻‍💻",
    color: "blue",
  },
  {
    id: "user-rafi",
    name: "Rafi Okonjo",
    email: "rafi@pufferfish.io",
    avatarEmoji: "🐡",
    color: "purple",
  },
  {
    id: "user-mara",
    name: "Mara Lindqvist",
    email: "mara@pufferfish.io",
    avatarEmoji: "🌊",
    color: "green",
  },
  {
    id: "user-theo",
    name: "Theo Okafor",
    email: "theo@pufferfish.io",
    avatarEmoji: "🛠️",
    color: "orange",
  },
  {
    id: "user-rin",
    name: "Rin Nakamura",
    email: "rin@pufferfish.io",
    avatarEmoji: "📐",
    color: "pink",
  },
];

const CURRENT_USER_ID = "user-david";

/* ------------------------------------------------------- database schema -- */

const STATUS_OPTIONS: StatusOption[] = [
  { id: "status-not-started", name: "Not started", color: "default", group: "to-do" },
  { id: "status-blocked", name: "Blocked", color: "red", group: "to-do" },
  { id: "status-in-progress", name: "In progress", color: "blue", group: "in-progress" },
  { id: "status-in-review", name: "In review", color: "yellow", group: "in-progress" },
  { id: "status-done", name: "Done", color: "green", group: "complete" },
];

const PRIORITY_OPTIONS = [
  { id: "priority-urgent", name: "Urgent", color: "red" as const },
  { id: "priority-high", name: "High", color: "orange" as const },
  { id: "priority-medium", name: "Medium", color: "yellow" as const },
  { id: "priority-low", name: "Low", color: "gray" as const },
];

const TAG_OPTIONS = [
  { id: "tag-research", name: "Research", color: "purple" as const },
  { id: "tag-eng", name: "Engineering", color: "blue" as const },
  { id: "tag-design", name: "Design", color: "pink" as const },
  { id: "tag-ops", name: "Ops", color: "brown" as const },
  { id: "tag-gtm", name: "Go-to-market", color: "green" as const },
];

const PROP = {
  name: "prop-name",
  status: "prop-status",
  assignee: "prop-assignee",
  priority: "prop-priority",
  due: "prop-due",
  tags: "prop-tags",
  effort: "prop-effort",
  done: "prop-done",
  created: "prop-created",
} as const;

const TASK_PROPERTIES: PropertySchema[] = [
  { id: PROP.name, name: "Task name", type: "title" },
  { id: PROP.status, name: "Status", type: "status", options: STATUS_OPTIONS },
  { id: PROP.assignee, name: "Assignee", type: "people" },
  { id: PROP.priority, name: "Priority", type: "select", options: PRIORITY_OPTIONS },
  { id: PROP.due, name: "Due", type: "date" },
  { id: PROP.tags, name: "Tags", type: "multi_select", options: TAG_OPTIONS },
  { id: PROP.effort, name: "Effort", type: "number", format: "number" },
  { id: PROP.done, name: "Verified", type: "checkbox" },
  { id: PROP.created, name: "Created", type: "created_time" },
];

/* ---------------------------------------------------------------- rows --- */

interface SeedRow {
  id: Id;
  title: string;
  icon?: string;
  status: Id;
  assignees: Id[];
  priority?: Id;
  due?: { start: string; end?: string };
  tags: Id[];
  effort?: number;
  verified?: boolean;
  body?: Array<[BlockType, string]>;
}

const TASK_ROWS: SeedRow[] = [
  {
    id: "task-gamma-inputs",
    title: "Understand exactly Gamma inputs",
    icon: "🔍",
    status: "status-not-started",
    assignees: ["user-rafi"],
    priority: "priority-high",
    due: { start: "2026-03-02" },
    tags: ["tag-research", "tag-eng"],
    effort: 5,
    body: [
      ["heading_2", "What we need to pin down"],
      ["bulleted_list_item", "The exact payload shape the ingest step accepts"],
      ["bulleted_list_item", "Which fields are required versus inferred"],
      ["to_do", "Write the findings up as a short contract doc"],
    ],
  },
  {
    id: "task-dev-iteration-docs",
    title: "Create dev iteration documentation groundwork",
    icon: "📄",
    status: "status-not-started",
    assignees: ["user-rafi"],
    priority: "priority-medium",
    due: { start: "2026-03-06" },
    tags: ["tag-ops"],
    effort: 3,
  },
  {
    id: "task-compliance",
    title: "Research SOC 2 and HIPAA compliance",
    icon: "🔐",
    status: "status-not-started",
    assignees: ["user-david"],
    priority: "priority-medium",
    due: { start: "2026-03-11" },
    tags: ["tag-research", "tag-ops"],
    effort: 8,
  },
  {
    id: "task-bugs-github",
    title: "Replace bugs list with GitHub issues",
    icon: "🐛",
    status: "status-not-started",
    assignees: ["user-theo"],
    priority: "priority-low",
    tags: ["tag-eng"],
    effort: 2,
  },
  {
    id: "task-design-tokens",
    title: "Consolidate the design tokens",
    icon: "🎨",
    status: "status-not-started",
    assignees: ["user-rin"],
    priority: "priority-medium",
    tags: ["tag-design"],
    effort: 3,
  },
  {
    id: "task-onboarding",
    title: "Draft the customer onboarding checklist",
    icon: "🧭",
    status: "status-not-started",
    assignees: ["user-mara"],
    priority: "priority-low",
    tags: ["tag-gtm"],
    effort: 2,
  },
  {
    id: "task-v1-planning",
    title: "Begin planning for v1/v2 (post-MVP)",
    icon: "🗺️",
    status: "status-in-progress",
    assignees: ["user-rafi", "user-david"],
    priority: "priority-urgent",
    due: { start: "2026-02-24", end: "2026-03-13" },
    tags: ["tag-research"],
    effort: 13,
    body: [
      ["paragraph", "Scope for the next two releases, written down before we build."],
      ["heading_3", "Open questions"],
      ["numbered_list_item", "Do we ship the agent surface in v1 or hold it for v2?"],
      ["numbered_list_item", "What is the migration story for existing workspaces?"],
      ["callout", "Decision deadline is the end of the month."],
    ],
  },
  {
    id: "task-enterprise-deploy",
    title: "Research how to deploy in enterprise environments",
    icon: "🏢",
    status: "status-in-progress",
    assignees: ["user-david"],
    priority: "priority-high",
    due: { start: "2026-03-04" },
    tags: ["tag-research", "tag-ops"],
    effort: 8,
  },
  {
    id: "task-perf-budget",
    title: "Set a performance budget for the editor",
    icon: "⚡",
    status: "status-in-review",
    assignees: ["user-theo"],
    priority: "priority-high",
    due: { start: "2026-02-27" },
    tags: ["tag-eng"],
    effort: 5,
  },
  {
    id: "task-empty-states",
    title: "Design the empty states",
    icon: "🪧",
    status: "status-in-review",
    assignees: ["user-rin"],
    priority: "priority-medium",
    tags: ["tag-design"],
    effort: 3,
  },
  {
    id: "task-vendor-review",
    title: "Vendor security review is stalled on legal",
    icon: "⛔",
    status: "status-blocked",
    assignees: ["user-mara"],
    priority: "priority-urgent",
    due: { start: "2026-02-20" },
    tags: ["tag-ops"],
    effort: 5,
  },
  {
    id: "task-dds",
    title: "Finish all DDs",
    icon: "✅",
    status: "status-done",
    assignees: ["user-david", "user-rafi", "user-mara"],
    priority: "priority-high",
    due: { start: "2026-02-14" },
    tags: ["tag-research"],
    effort: 8,
    verified: true,
  },
  {
    id: "task-org-github",
    title: "Set up org GitHub",
    icon: "🐙",
    status: "status-done",
    assignees: ["user-david"],
    priority: "priority-medium",
    due: { start: "2026-02-10" },
    tags: ["tag-eng", "tag-ops"],
    effort: 2,
    verified: true,
  },
  {
    id: "task-impl-order",
    title: "Determine order of implementation",
    icon: "🔢",
    status: "status-done",
    assignees: ["user-david", "user-rafi", "user-theo"],
    priority: "priority-high",
    due: { start: "2026-02-12" },
    tags: ["tag-research"],
    effort: 5,
    verified: true,
  },
  {
    id: "task-codebase-structure",
    title: "Determine overall project structure (codebase)",
    icon: "🏗️",
    status: "status-done",
    assignees: ["user-theo", "user-rafi"],
    priority: "priority-high",
    due: { start: "2026-02-13" },
    tags: ["tag-eng"],
    effort: 8,
    verified: true,
  },
  {
    id: "task-brand-palette",
    title: "Lock the brand palette",
    icon: "🖌️",
    status: "status-done",
    assignees: ["user-rin"],
    priority: "priority-low",
    due: { start: "2026-02-06" },
    tags: ["tag-design"],
    effort: 2,
    verified: true,
  },
  {
    id: "task-pricing-page",
    title: "Ship the pricing page",
    icon: "💳",
    status: "status-done",
    assignees: ["user-mara", "user-rin"],
    priority: "priority-medium",
    due: { start: "2026-02-17" },
    tags: ["tag-gtm", "tag-design"],
    effort: 5,
    verified: false,
  },
];

/* ---------------------------------------------------------- id factories -- */

const DB_ID = "db-priority-tasks";
const HOME_PAGE_ID = "page-pufferfish-home";

const VIEW_IDS = {
  board: "view-board",
  all: "view-all",
  byPerson: "view-by-person",
  calendar: "view-calendar",
  list: "view-list",
} as const;

/* ------------------------------------------------------------- builders -- */

function buildBlock(
  id: Id,
  parentId: Id,
  type: BlockType,
  text: string,
  extra: Partial<Block> = {},
): Block {
  return {
    id,
    type,
    parentId,
    text,
    childIds: [],
    createdAt: ts(),
    lastEditedAt: ts(),
    ...extra,
  };
}

function buildRowPage(row: SeedRow, index: number): { page: Page; blocks: Block[] } {
  const properties: Record<Id, PropertyValue> = {
    [PROP.name]: { type: "title", title: row.title },
    [PROP.status]: { type: "status", status: row.status },
    [PROP.assignee]: { type: "people", people: row.assignees },
    [PROP.priority]: { type: "select", select: row.priority ?? null },
    [PROP.due]: { type: "date", date: row.due ?? null },
    [PROP.tags]: { type: "multi_select", multi_select: row.tags },
    [PROP.effort]: { type: "number", number: row.effort ?? null },
    [PROP.done]: { type: "checkbox", checkbox: row.verified ?? false },
    [PROP.created]: { type: "created_time", created_time: ts(-index * 90) },
  };

  const blocks = (row.body ?? []).map(([type, text], i) =>
    buildBlock(
      `${row.id}-block-${i}`,
      row.id,
      type,
      text,
      type === "callout" ? { emoji: "📌", color: "yellow" } : {},
    ),
  );

  const page: Page = {
    id: row.id,
    workspaceId: "workspace-pufferfish",
    parentId: HOME_PAGE_ID,
    title: row.title,
    icon: row.icon ? { type: "emoji", emoji: row.icon } : { type: "none" },
    cover: { type: "none" },
    blockIds: blocks.map((b) => b.id),
    childPageIds: [],
    databaseId: DB_ID,
    properties,
    createdAt: ts(-index * 90),
    createdBy: row.assignees[0] ?? CURRENT_USER_ID,
    lastEditedAt: ts(-index * 12),
    lastEditedBy: row.assignees[0] ?? CURRENT_USER_ID,
  };

  return { page, blocks };
}

/* ------------------------------------------------------ narrative pages -- */

const HOME_BODY: Array<[BlockType, string, Partial<Block>?]> = [
  [
    "callout",
    "This workspace is a working replica of Notion — every page, block, board and property below is editable and persists in your browser.",
    { emoji: "🐡", color: "blue" },
  ],
  ["heading_2", "Priority Tasks (only for unspecific URGENT)"],
  ["child_database", "Priority Tasks", { targetId: DB_ID }],
  ["heading_2", "How we work"],
  ["paragraph", "Three rules, and everything else is negotiable."],
  ["numbered_list_item", "Write the decision down before you build the thing."],
  ["numbered_list_item", "Every task has an owner and a status. No orphans."],
  ["numbered_list_item", "If it is blocked for two days, it gets escalated here."],
  ["divider", ""],
  ["heading_3", "Shortcuts"],
  ["to_do", "Press / on an empty line to insert any block", { checked: true }],
  ["to_do", "Drag the ⠿ handle to reorder a block", { checked: true }],
  ["to_do", "Drag a card between board columns to change its status", { checked: false }],
  ["quote", "Move fast, but write it down."],
];

const ROADMAP_BODY: Array<[BlockType, string, Partial<Block>?]> = [
  ["paragraph", "Where the product is going over the next two quarters."],
  ["heading_2", "Now"],
  ["bulleted_list_item", "Block editor parity: slash menu, drag handles, nesting"],
  ["bulleted_list_item", "Database views: board, table, list, calendar"],
  ["heading_2", "Next"],
  ["bulleted_list_item", "Realtime presence and comments"],
  ["bulleted_list_item", "Relations and rollups between databases"],
  ["heading_2", "Later"],
  ["bulleted_list_item", "Permissions at the block level"],
  ["callout", "Nothing here is committed until it has an owner on the board.", { emoji: "⚠️", color: "orange" }],
];

const MEETING_BODY: Array<[BlockType, string, Partial<Block>?]> = [
  ["paragraph", "Weekly sync — Thursdays, 30 minutes, notes taken live."],
  ["heading_3", "Agenda"],
  ["numbered_list_item", "What shipped since last week"],
  ["numbered_list_item", "What is blocked"],
  ["numbered_list_item", "One decision we need to make today"],
  ["divider", ""],
  ["heading_3", "Notes"],
  ["paragraph", "Agreed to hold the agent surface until v2 so v1 can ship on time."],
  ["to_do", "David to write the deferral up in the roadmap", { checked: false }],
];

const ENGINEERING_BODY: Array<[BlockType, string, Partial<Block>?]> = [
  ["paragraph", "How the codebase is put together, and why."],
  ["heading_2", "Data model"],
  [
    "paragraph",
    "Everything is a block. Pages own an ordered list of block ids; blocks own an ordered list of child ids. Database rows are pages, which is why a row can be opened and written in like any other page.",
  ],
  ["code", "type Block = {\n  id: string\n  type: BlockType\n  parentId: string\n  text: string\n  childIds: string[]\n}", { language: "typescript" }],
  ["heading_2", "Storage"],
  [
    "paragraph",
    "The UI talks to a StorageAdapter, never to localStorage directly. Swap the driver and the same interface can be served by Postgres.",
  ],
];

interface SeedPageSpec {
  id: Id;
  title: string;
  emoji: string;
  cover?: string;
  body: Array<[BlockType, string, Partial<Block>?]>;
  children?: SeedPageSpec[];
  favorite?: boolean;
}

const NARRATIVE_PAGES: SeedPageSpec[] = [
  {
    id: "page-roadmap",
    title: "Product roadmap",
    emoji: "🗺️",
    cover: "linear-gradient(120deg, #f6d365 0%, #fda085 100%)",
    body: ROADMAP_BODY,
    favorite: true,
  },
  {
    id: "page-meeting-notes",
    title: "Weekly sync",
    emoji: "🗓️",
    body: MEETING_BODY,
    children: [
      {
        id: "page-meeting-feb19",
        title: "Feb 19 — v1 scope",
        emoji: "📝",
        body: [
          ["paragraph", "Locked the v1 scope. Agent surface moves to v2."],
          ["to_do", "Update the roadmap page", { checked: true }],
        ],
      },
    ],
  },
  {
    id: "page-engineering",
    title: "Engineering handbook",
    emoji: "🛠️",
    cover: "linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)",
    body: ENGINEERING_BODY,
  },
];

/* --------------------------------------------------------------- assemble -- */

export function createDemoSnapshot(): WorkspaceSnapshot {
  const pages: Record<Id, Page> = {};
  const blocks: Record<Id, Block> = {};

  // --- database rows -------------------------------------------------------
  const rowIds: Id[] = [];
  for (const [index, row] of TASK_ROWS.entries()) {
    const { page, blocks: rowBlocks } = buildRowPage(row, index);
    pages[page.id] = page;
    rowBlocks.forEach((b) => (blocks[b.id] = b));
    rowIds.push(page.id);
  }

  // --- narrative pages -----------------------------------------------------
  function addNarrative(spec: SeedPageSpec, parentId: Id | null): Id {
    const bodyBlocks = spec.body.map(([type, text, extra], i) =>
      buildBlock(`${spec.id}-block-${i}`, spec.id, type, text, extra ?? {}),
    );
    bodyBlocks.forEach((b) => (blocks[b.id] = b));

    const childIds = (spec.children ?? []).map((child) => addNarrative(child, spec.id));

    pages[spec.id] = {
      id: spec.id,
      workspaceId: "workspace-pufferfish",
      parentId,
      title: spec.title,
      icon: { type: "emoji", emoji: spec.emoji },
      cover: spec.cover ? { type: "gradient", gradient: spec.cover } : { type: "none" },
      blockIds: bodyBlocks.map((b) => b.id),
      childPageIds: childIds,
      createdAt: ts(-2880),
      createdBy: CURRENT_USER_ID,
      lastEditedAt: ts(-60),
      lastEditedBy: CURRENT_USER_ID,
      favorite: spec.favorite,
    };
    return spec.id;
  }

  const narrativeIds = NARRATIVE_PAGES.map((spec) => addNarrative(spec, HOME_PAGE_ID));

  // --- home page -----------------------------------------------------------
  const homeBlocks = HOME_BODY.map(([type, text, extra], i) =>
    buildBlock(`${HOME_PAGE_ID}-block-${i}`, HOME_PAGE_ID, type, text, extra ?? {}),
  );
  homeBlocks.forEach((b) => (blocks[b.id] = b));

  pages[HOME_PAGE_ID] = {
    id: HOME_PAGE_ID,
    workspaceId: "workspace-pufferfish",
    parentId: null,
    title: "Pufferfish Home",
    icon: { type: "emoji", emoji: "📈" },
    cover: {
      type: "gradient",
      gradient:
        "linear-gradient(105deg, #0b1026 0%, #16233f 34%, #f97316 62%, #fde68a 78%, #0b1026 100%)",
    },
    blockIds: homeBlocks.map((b) => b.id),
    childPageIds: [...narrativeIds, ...rowIds],
    createdAt: ts(-10080),
    createdBy: CURRENT_USER_ID,
    lastEditedAt: ts(),
    lastEditedBy: CURRENT_USER_ID,
    members: [
      { userId: "user-david", role: "full_access" },
      { userId: "user-rafi", role: "full_access" },
      { userId: "user-mara", role: "can_edit" },
      { userId: "user-theo", role: "can_edit" },
      { userId: "user-rin", role: "can_comment" },
    ],
  };

  // --- database + views ----------------------------------------------------
  const database: Database = {
    id: DB_ID,
    parentPageId: HOME_PAGE_ID,
    title: "Priority Tasks",
    icon: { type: "emoji", emoji: "🎯" },
    properties: TASK_PROPERTIES,
    rowIds,
    viewIds: [VIEW_IDS.board, VIEW_IDS.all, VIEW_IDS.byPerson, VIEW_IDS.calendar, VIEW_IDS.list],
    inline: true,
  };

  const allVisible = TASK_PROPERTIES.map((p) => p.id);

  const views: Record<Id, View> = {
    [VIEW_IDS.board]: {
      id: VIEW_IDS.board,
      databaseId: DB_ID,
      name: "Board view",
      type: "board",
      groupByPropertyId: PROP.status,
      filters: [],
      sorts: [],
      visiblePropertyIds: [PROP.assignee, PROP.status, PROP.due],
      hideEmptyGroups: false,
    },
    [VIEW_IDS.all]: {
      id: VIEW_IDS.all,
      databaseId: DB_ID,
      name: "All",
      type: "table",
      filters: [],
      sorts: [{ id: "sort-1", propertyId: PROP.due, direction: "ascending" }],
      visiblePropertyIds: allVisible,
      columnWidths: {
        [PROP.name]: 280,
        [PROP.status]: 140,
        [PROP.assignee]: 180,
        [PROP.priority]: 120,
        [PROP.due]: 200,
        [PROP.tags]: 220,
        [PROP.effort]: 90,
        [PROP.done]: 90,
        [PROP.created]: 200,
      },
    },
    [VIEW_IDS.byPerson]: {
      id: VIEW_IDS.byPerson,
      databaseId: DB_ID,
      name: "By Person",
      type: "board",
      groupByPropertyId: PROP.assignee,
      filters: [],
      sorts: [],
      visiblePropertyIds: [PROP.status, PROP.priority, PROP.due],
      hideEmptyGroups: true,
    },
    [VIEW_IDS.calendar]: {
      id: VIEW_IDS.calendar,
      databaseId: DB_ID,
      name: "Calendar",
      type: "calendar",
      datePropertyId: PROP.due,
      filters: [],
      sorts: [],
      visiblePropertyIds: [PROP.status],
    },
    [VIEW_IDS.list]: {
      id: VIEW_IDS.list,
      databaseId: DB_ID,
      name: "List",
      type: "list",
      filters: [],
      sorts: [],
      visiblePropertyIds: [PROP.status, PROP.assignee, PROP.due],
    },
  };

  // --- workspace -----------------------------------------------------------
  const workspace: Workspace = {
    id: "workspace-pufferfish",
    name: "Pufferfish",
    icon: { type: "emoji", emoji: "🐡" },
    plan: "Free",
    ownerId: CURRENT_USER_ID,
    members: [
      { userId: "user-david", role: "full_access" },
      { userId: "user-rafi", role: "full_access" },
      { userId: "user-mara", role: "can_edit" },
      { userId: "user-theo", role: "can_edit" },
      { userId: "user-rin", role: "can_comment" },
    ],
    sections: [
      {
        id: "section-favorites",
        kind: "favorites",
        label: "Favorites",
        pageIds: ["page-roadmap"],
      },
      {
        id: "section-shared",
        kind: "shared",
        label: "Shared",
        pageIds: [HOME_PAGE_ID],
      },
      {
        id: "section-private",
        kind: "private",
        label: "Private",
        pageIds: ["page-engineering"],
      },
    ],
  };

  return {
    schemaVersion: storageConfig.schemaVersion,
    workspace,
    users: Object.fromEntries(USERS.map((u) => [u.id, u])),
    pages,
    blocks,
    databases: { [DB_ID]: database },
    views,
    currentUserId: CURRENT_USER_ID,
  };
}

/** Ids the app needs to reference directly (default landing page, demo db). */
export const SEED_IDS = {
  homePageId: HOME_PAGE_ID,
  databaseId: DB_ID,
  properties: PROP,
  views: VIEW_IDS,
} as const;
