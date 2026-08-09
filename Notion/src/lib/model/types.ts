/**
 * Domain model.
 *
 * Deliberately mirrors the vocabulary of Notion's public API (blocks, pages,
 * databases, property schemas, property values) so the shapes are recognisable
 * and a real Notion import/export could be layered on later without a rewrite.
 *
 * Storage is normalised: every entity lives in a flat `Record<id, entity>` map
 * and references others by id. Trees are expressed as ordered `childIds`
 * arrays, exactly as Notion does with `content[]`. This keeps updates O(1) and
 * lets selectors subscribe to a single entity instead of a whole subtree.
 */

export type Id = string;
export type IsoDateString = string;

/** Notion's fixed ten-colour palette, used for tags, callouts and text. */
export const NOTION_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type NotionColor = (typeof NOTION_COLORS)[number];

/* ------------------------------------------------------------------ users -- */

export interface User {
  id: Id;
  name: string;
  email: string;
  /** Emoji or single character rendered when there is no avatar image. */
  avatarEmoji?: string;
  avatarUrl?: string;
  /** Deterministic accent behind the initials. */
  color: NotionColor;
}

/** Notion's sharing roles, most to least privileged. */
export const MEMBER_ROLES = [
  "full_access",
  "can_edit",
  "can_comment",
  "can_view",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface Membership {
  userId: Id;
  role: MemberRole;
  /** Set while an invite is outstanding; cleared once accepted. */
  invitePending?: boolean;
  invitedAt?: IsoDateString;
}

/* ------------------------------------------------------------- workspace -- */

export interface Workspace {
  id: Id;
  name: string;
  icon: PageIcon;
  /** Plan badge beside the workspace name in the sidebar switcher. */
  plan: "Free" | "Plus" | "Business" | "Enterprise" | "Guest";
  ownerId: Id;
  members: Membership[];
  /** Top-level page ids, grouped by the sidebar section they appear under. */
  sections: SidebarSection[];
}

export type SidebarSectionKind = "favorites" | "shared" | "private" | "teamspace";

export interface SidebarSection {
  id: Id;
  kind: SidebarSectionKind;
  label: string;
  pageIds: Id[];
  collapsed?: boolean;
}

/* ------------------------------------------------------------------ page -- */

export type PageIcon =
  | { type: "emoji"; emoji: string }
  | { type: "url"; url: string }
  | { type: "none" };

export type PageCover =
  | { type: "gradient"; gradient: string }
  | { type: "url"; url: string }
  | { type: "none" };

export interface Page {
  id: Id;
  /** Owning workspace. */
  workspaceId: Id;
  /** Parent page id, or null when the page sits at the top of a section. */
  parentId: Id | null;
  title: string;
  icon: PageIcon;
  cover: PageCover;
  /** Ordered ids of the blocks that make up the body. */
  blockIds: Id[];
  /** Nested pages, in sidebar order. */
  childPageIds: Id[];
  /**
   * Set when this page is a row inside a database; carries the row's property
   * values. A database row *is* a page in Notion, which is why this lives here
   * rather than in a separate `Row` entity.
   */
  databaseId?: Id;
  properties?: Record<Id, PropertyValue>;
  createdAt: IsoDateString;
  createdBy: Id;
  lastEditedAt: IsoDateString;
  lastEditedBy: Id;
  favorite?: boolean;
  /** Page-level sharing overrides; falls back to the workspace membership. */
  members?: Membership[];
  isPublished?: boolean;
  /** Soft delete — Notion keeps trashed pages recoverable. */
  inTrash?: boolean;
  /** Wide layout toggles off the 708px text column. */
  fullWidth?: boolean;
  /** Small text shrinks body copy, matching Notion's page-level option. */
  smallText?: boolean;
}

/* ----------------------------------------------------------------- block -- */

export const BLOCK_TYPES = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code",
  "divider",
  "image",
  "child_page",
  "child_database",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export interface Block {
  id: Id;
  type: BlockType;
  /** Parent page or parent block, for nested (indented) content. */
  parentId: Id;
  /** Plain-text content. Rich-text marks are carried in `annotations`. */
  text: string;
  /** Ordered child block ids — indentation and toggle contents. */
  childIds: Id[];
  color?: NotionColor;
  /** `to_do` completion state. */
  checked?: boolean;
  /** `toggle` open state. */
  expanded?: boolean;
  /** `callout` leading emoji. */
  emoji?: string;
  /** `code` language. */
  language?: string;
  /** `image` source. */
  url?: string;
  caption?: string;
  /** `child_page` / `child_database` target. */
  targetId?: Id;
  createdAt: IsoDateString;
  lastEditedAt: IsoDateString;
}

/* -------------------------------------------------------------- database -- */

export const PROPERTY_TYPES = [
  "title",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "people",
  "date",
  "checkbox",
  "url",
  "email",
  "created_time",
  "last_edited_time",
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface SelectOption {
  id: Id;
  name: string;
  color: NotionColor;
}

/**
 * Status options are grouped, which is what separates `status` from `select`
 * in Notion: the board groups by option but the UI clusters options by group.
 */
export const STATUS_GROUPS = ["to-do", "in-progress", "complete"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export interface StatusOption extends SelectOption {
  group: StatusGroup;
}

export type NumberFormat = "number" | "percent" | "dollar" | "euro";

/** The schema of one column. Discriminated on `type`. */
export type PropertySchema =
  | { id: Id; name: string; type: "title" }
  | { id: Id; name: string; type: "rich_text" }
  | { id: Id; name: string; type: "number"; format: NumberFormat }
  | { id: Id; name: string; type: "select"; options: SelectOption[] }
  | { id: Id; name: string; type: "multi_select"; options: SelectOption[] }
  | { id: Id; name: string; type: "status"; options: StatusOption[] }
  | { id: Id; name: string; type: "people" }
  | { id: Id; name: string; type: "date" }
  | { id: Id; name: string; type: "checkbox" }
  | { id: Id; name: string; type: "url" }
  | { id: Id; name: string; type: "email" }
  | { id: Id; name: string; type: "created_time" }
  | { id: Id; name: string; type: "last_edited_time" };

/** The value stored on a row for one column. Discriminated on `type`. */
export type PropertyValue =
  | { type: "title"; title: string }
  | { type: "rich_text"; rich_text: string }
  | { type: "number"; number: number | null }
  | { type: "select"; select: Id | null }
  | { type: "multi_select"; multi_select: Id[] }
  | { type: "status"; status: Id | null }
  | { type: "people"; people: Id[] }
  | { type: "date"; date: { start: IsoDateString; end?: IsoDateString } | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "url"; url: string }
  | { type: "email"; email: string }
  | { type: "created_time"; created_time: IsoDateString }
  | { type: "last_edited_time"; last_edited_time: IsoDateString };

export interface Database {
  id: Id;
  /** The page this database is embedded in (inline) or lives as (full page). */
  parentPageId: Id;
  title: string;
  icon: PageIcon;
  /** Ordered column schemas. The first `title` property names each row. */
  properties: PropertySchema[];
  /** Ordered row ids — each row is a Page with `databaseId` set. */
  rowIds: Id[];
  /** Saved views, rendered as the tab strip above the data. */
  viewIds: Id[];
  /** Rendered inline inside its parent page rather than as a full page. */
  inline?: boolean;
}

/* ------------------------------------------------------------------ view -- */

export const VIEW_TYPES = ["board", "table", "list", "calendar", "gallery"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export type FilterOperator =
  | "equals"
  | "does_not_equal"
  | "contains"
  | "does_not_contain"
  | "is_empty"
  | "is_not_empty";

export interface FilterRule {
  id: Id;
  propertyId: Id;
  operator: FilterOperator;
  value?: string | number | boolean | null;
}

export interface SortRule {
  id: Id;
  propertyId: Id;
  direction: "ascending" | "descending";
}

export interface View {
  id: Id;
  databaseId: Id;
  name: string;
  type: ViewType;
  /** Which property the board/calendar groups by. */
  groupByPropertyId?: Id;
  /** Which date property drives the calendar. */
  datePropertyId?: Id;
  filters: FilterRule[];
  sorts: SortRule[];
  /** Property visibility and order, per view. */
  visiblePropertyIds: Id[];
  /** Persisted column widths for table views, keyed by property id. */
  columnWidths?: Record<Id, number>;
  /** Group ids the user has collapsed on a board. */
  collapsedGroupIds?: Id[];
  /** Board groups hidden from view (Notion hides empty groups by default). */
  hideEmptyGroups?: boolean;
}

/* -------------------------------------------------------- root aggregate -- */

/**
 * The entire persisted state. Storage adapters read and write this shape
 * wholesale, which keeps the adapter interface tiny and makes swapping a
 * localStorage backend for a REST one a one-line change.
 */
export interface WorkspaceSnapshot {
  schemaVersion: number;
  workspace: Workspace;
  users: Record<Id, User>;
  pages: Record<Id, Page>;
  blocks: Record<Id, Block>;
  databases: Record<Id, Database>;
  views: Record<Id, View>;
  /** Id of the user acting in this session. */
  currentUserId: Id;
}
