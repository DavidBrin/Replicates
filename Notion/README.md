# Notion

A working replica of Notion — the marketing site and the product — built in a single session with an agent team.

The app is a real project tracker, not a screenshot: pages are made of editable blocks, databases render as board / table / list / calendar views, cards drag between status columns, people can be invited with roles, and everything persists in your browser.

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests
npm run build    # production build
```

Deploys to Vercel's free tier with **no environment variables and no database**. See [Deployment](#deployment).

---

## Contents

- [What it does](#what-it-does)
- [How it was built](#how-it-was-built)
- [Research](#research)
- [Architecture](#architecture)
- [Design decisions](#design-decisions)
- [Design tokens](#design-tokens)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

---

## What it does

**Landing page** (`/`) — the marketing site: sticky nav with mega-menu dropdowns, the animated hero with its rotating word pill, the sticker rail, a logo marquee, feature sections, testimonials, a stats marquee and the footer.

**Workspace** (`/workspace`) — the product:

| Area | What works |
|---|---|
| Sidebar | Resizable and collapsible, workspace switcher, Favorites / Shared / Private sections, a nested page tree with drag-to-reorder, per-row `…` menus, trash with restore |
| Pages | Cover images, emoji icons, editable titles, breadcrumbs, favourites, full-width and small-text options |
| Block editor | 15 block types, `/` slash menu, markdown shortcuts, drag handles, Tab/Shift-Tab nesting, Enter-splits and Backspace-merges |
| Databases | Board, table, list and calendar views; filters, sorts, grouping, per-view property visibility |
| Board | Drag a card between columns to change its status; add rows per column |
| Table | Inline editing of every cell type, resizable columns, row peek panel |
| Properties | 13 Notion property types — title, text, number, select, multi-select, status, person, date, checkbox, URL, email, created time, last edited time |
| Sharing | Invite by email with Full access / Can edit / Can comment / Can view, pending-invite state, publish-to-web toggle |
| Elsewhere | ⌘K command palette, dark mode, JSON export/import |

---

## How it was built

The work was split across a team of agents rather than done linearly, borrowing the shape of a research → plan → build → review pipeline.

**1. Research (parallel, 3 agents + first-hand capture).** Before any code, three agents researched independently: the Notion product UI, the notion.com marketing site, and the architecture question (data model, free-tier persistence, editor library, DnD, state, testing). In parallel I drove a real browser to notion.com and to a published Notion page, screenshotted them, and extracted the **actual shipped CSS custom properties** from both — which is where this project's colour palette comes from.

**2. Foundation (single-threaded, deliberately).** I wrote the pieces every feature depends on myself, so four parallel agents could not each invent their own: the domain types, the property-type registry, the storage abstraction, the Zustand store, the view engine, the design tokens and the shared primitives.

**3. Implementation (parallel, 4 agents).** With the contracts fixed, four agents built disjoint surfaces simultaneously — block editor, database views, marketing site, app chrome — each confined to its own directory and each handed the exact signatures of the components it did not own.

**4. Review.** Type-checking, linting, the unit suite, an independent code review, and a browser pass over the running app.

The two things that made the parallel phase work were **directory ownership** (no two agents could touch the same file) and **contracts written down before the fan-out** (an agent importing `DatabaseView` was told its exact signature rather than guessing).

---

## Research

Research changed the build in ways worth recording, because several assumptions going in were wrong.

**The palette is Notion's real palette.** Rather than eyedropping screenshots, I pulled the custom-property blocks straight out of the stylesheets Notion serves. The app tokens came from the `.notion-light-theme` block on a published `notion.site` page — including the fact that Notion's greys are *warm*:

```
--c-texPri #2c2c2b   --c-bacPri #ffffff   --c-borPri #e6e5e3
--c-texSec #7d7a75   --c-bacSec #f9f8f7   --c-borStr #d4d3cf
--c-texTer #a19e99   --c-bacTer #f0efed
```

`#f9f8f7`, not `#f9f9f9`. That brown-yellow undertone is most of why Notion reads as paper rather than as a generic SaaS app, and it is the single easiest thing to get wrong.

The tag palette came from the same source — the familiar `#337ea9` blue, `#448361` green, `#d9730d` orange, `#cd3c3a` red — along with each colour's pill background and the faint wash used behind a board column.

**Three findings contradicted the brief.** The reference screenshots suggested the hero screenshot sat inside a browser-chrome mockup with traffic lights. It does not — grepping Notion's CSS and HTML for `trafficLight|browserChrome|tabStrip` returns nothing. The hero is a bordered rounded panel that **dissolves into the page** behind a 200px white gradient, and that gradient is doing more work than the border radius. Similarly, the nav CTA is black (`#191918`) while the *hero* CTA is blue (`#0075de`) — two different buttons. And the hero headline is **weight 600, not 700**, at 96px with −4.6px tracking.

**Notion's data model is public, so the types mirror it.** Notion's own engineering writing describes the model: everything is a block; a block has an id, a type, properties, an ordered `content[]` of child ids, and a parent. Database rows *are* pages — which is why, in this codebase, opening a board card opens a page you can write in. The `Page` type carries an optional `databaseId` and `properties` rather than there being a separate `Row` entity, and that one decision removes a whole category of syncing bugs.

**The architecture research overturned my default.** I had started with `localStorage`; the research made the case for IndexedDB (5 MiB cap versus quota-based, and asynchronous so a large save never blocks typing). It also flagged that WebKit erases *all* script-writable storage after seven days of Safari use without interaction — which is why the app ships JSON export/import rather than pretending browser storage is durable.

---

## Architecture

### Data model

Normalised entity maps, keyed by id, mirroring Notion's own vocabulary:

```ts
interface WorkspaceSnapshot {
  workspace:  Workspace;
  users:      Record<Id, User>;
  pages:      Record<Id, Page>;       // documents AND database rows
  blocks:     Record<Id, Block>;
  databases:  Record<Id, Database>;
  views:      Record<Id, View>;
}
```

Trees are ordered id arrays — `page.blockIds`, `block.childIds`, `page.childPageIds` — never `order: number` columns. Reordering a block is a splice in one array; indenting is a move between two arrays; rendering is a recursive walk. And because a component subscribes to one entity by id, typing in the fortieth block of a page re-renders that block and nothing else.

### The three abstractions that carry the design

**1. `PropertyTypeHandler` — an abstract class per column type.**

Thirteen property types differ in how they format, sort, group, and define emptiness. Encoding that as `switch (property.type)` would mean thirteen parallel switches scattered across the table, board, list, calendar and filter code, and adding a fourteenth type would mean finding all of them.

Instead each type is a subclass:

```ts
abstract class PropertyTypeHandler<T extends PropertyType> {
  abstract readonly type: T;
  abstract readonly label: string;
  abstract readonly icon: string;
  readonly canGroup: boolean = false;
  readonly isEditable: boolean = true;

  abstract empty(schema): ValueOf<T>;
  abstract toPlainText(value, schema, ctx): string;
  isEmpty(value, schema, ctx): boolean;
  sortKey(value, schema, ctx): string | number | null;
  groupKey(value): string | null;
  valueForGroup(groupId, schema): ValueOf<T>;
}
```

Consumers ask `getPropertyHandler(schema.type)` and then ask the handler. Adding a `relation` or `formula` column is one new class and one registry entry — no view code changes.

The base class also encodes decisions that would otherwise drift. `CheckboxHandler` overrides `isEmpty()` to return `false`, because unchecked is a real value and not a blank. `StatusHandler.empty()` returns the first `to-do`-group option, matching Notion's behaviour for a new row. `TimestampHandler` is itself abstract, shared by the two derived date columns.

**2. `StorageAdapter` — an abstract class per backend.**

```ts
abstract class StorageAdapter {
  abstract readonly name: string;
  abstract isAvailable(): boolean;
  abstract load(): Promise<WorkspaceSnapshot | null>;
  abstract save(snapshot: WorkspaceSnapshot): Promise<void>;
  abstract clear(): Promise<void>;
  protected migrate(snapshot, expectedVersion): WorkspaceSnapshot | null;
}
```

Four implementations: `IndexedDbAdapter` (default), `LocalStorageAdapter`, `MemoryStorageAdapter` (server rendering and tests), `RestStorageAdapter` (a real database behind `/api/workspace`). A factory picks one from config; `isAvailable()` lets it fall back rather than crash.

The interface is **async even for the synchronous backends**, specifically so swapping in the REST adapter touches no call site.

**3. Renderer registries instead of switches.**

Block types and property cells are dispatched through lookup objects, not `switch` statements in JSX. Same reasoning as the handlers: one entry to add a type.

### State

Zustand, with operations named in Notion's vocabulary — `insertBlock`, `convertBlock`, `indentBlock`, `moveBlock`, `setPropertyValue` — rather than generic CRUD. Context + `useReducer` was rejected outright: context has no selector granularity, so every keystroke would re-render every consumer.

Persistence is **manual rather than the `persist` middleware**, because two requirements conflict with it: hydration must not run during render, and writes must be debounced. `useWorkspacePersistence` owns that lifecycle — load once in an effect, then subscribe and write on a trailing 400ms debounce, flushing on `pagehide` so the last few hundred milliseconds of work survive a tab close.

### Hydration

The seeded workspace renders identically on the server and on the first client pass; the saved snapshot is swapped in one tick later, behind a skeleton. Storage is never read during render, and ids are only ever minted in event handlers. Theme is the one exception: an inline script stamps `data-theme` on `<html>` before React hydrates, which is what prevents a white flash for dark-mode users.

---

## Design decisions

### A custom block editor rather than Tiptap, Lexical or BlockNote

This was the closest call, and the deciding argument was the data model rather than bundle size.

Every ProseMirror-based option imposes one document per page with its own node schema, which forces a bidirectional mapping between Notion's `Block[]` and ProseMirror's document JSON. That mapping has to round-trip losslessly through every conversion, indent, split and merge — it is the largest bug surface in the project, and it is *more* work than writing the naive editor. BlockNote is worse for this brief: you persist BlockNote's block JSON, so the canonical type becomes theirs, not Notion's.

The editor is also only about 30% of this app. Databases with four view types, workspaces, members and sharing are the rest, and none of them benefit from an editor framework.

So: one uncontrolled `contentEditable` per block. Three rules make that tractable —

- **The DOM is written once.** Text is set on mount and never written back while the element has focus, because that destroys the caret. Commits flow the other way, on debounced `input` and on `blur`.
- **Composition is guarded.** All store writes and key handling are suppressed between `compositionstart` and `compositionend`, so IME and mobile autocorrect work.
- **The drag handle lives outside the editable.** In the gutter, wired through `activatorNodeRef` — inside, pointer-down would steal text selection.

The escape hatch is deliberate: because each block owns its editable component, upgrading one block type to Tiptap later is a local change behind the same interface.

### IndexedDB by default, with an honest durability story

Browser storage is the default because the brief is a free host with no database to provision. IndexedDB over localStorage for capacity and for not blocking the main thread.

But browser storage is device-scoped and, on Safari, evictable after seven days of disuse. Rather than paper over that, the app calls `navigator.storage.persist()` best-effort and ships **JSON export/import**. A documented product characteristic beats a silent data-loss bug.

The upgrade path is real and unobtrusive: `/api/workspace` is deployed but answers `501` until `DATABASE_URL` is set, and the database driver is `await import()`-ed *inside* the handler so it never reaches the client bundle and a missing dependency cannot break the build.

### dnd-kit for drag and drop

One API covers all three surfaces — the kanban board's cross-column moves, the block list's vertical sort, and the sidebar tree. Keyboard sensors and screen-reader announcements come built in. `react-beautiful-dnd` is deprecated and peer-caps at React 18; Pragmatic Drag and Drop is leaner but ships no sortable, no keyboard drag and no drop indicator, which would mean hand-rolling the same logic three times.

Boards use `closestCorners` collision detection — noticeably better than `closestCenter` for multi-column layouts.

### Nothing is hard-coded

Every tunable lives in `src/config/app.config.ts` and can be overridden by a `NEXT_PUBLIC_*` variable: brand copy, sidebar width, page content width, board column width, the debounce interval, the storage driver, the keyboard map, feature flags. Components read from config; they do not inline literals.

Colour works the same way. No component contains a hex value. They reference CSS custom properties, or call `tagStyle()` / `dotColor()` / `washColor()`, which is why light and dark mode are a single source of truth rather than two parallel stylesheets.

---

## Design tokens

Defined in `src/app/globals.css`, named after Notion's own grammar (`bac`kground, `tex`t, `bor`der, `ico`n × `pri`mary / `sec`ondary / `ter`tiary) so the mapping back to the captured values stays auditable.

| Role | Light | Dark |
|---|---|---|
| Page background | `#ffffff` | `#191919` |
| Sidebar background | `#f9f8f7` | `#202020` |
| Hover | `#f4f3f3` | `rgba(255,255,255,.055)` |
| Primary text | `#2c2c2b` | `rgba(255,255,255,.81)` |
| Secondary text | `#7d7a75` | `rgba(255,255,255,.46)` |
| Border | `#e6e5e3` | `rgba(255,255,255,.094)` |
| Accent | `#0075de` | `#2383e2` |

Ten tag colours, each with a pill background, a text colour, a saturated dot and a column wash, in both themes.

The marketing site carries a **second, scoped palette** — Notion runs different tokens on notion.com than in the app, and merging them would compromise both.

---

## Testing

Vitest + React Testing Library + jsdom.

The suite concentrates on the pure layer, where the bug surface actually is: the view engine (filter, sort, group), the property-type registry, the storage adapters, and the store's tree operations. These run in milliseconds and catch the things that are genuinely hard to get right — that blanks sink in *both* sort directions, that a block cannot be moved inside its own subtree, that trashing a page trashes its whole subtree, that removing a property clears any view grouping that pointed at it, that a permanent delete leaves no dangling references.

Storage adapters share one `describe.each` suite, since all four must satisfy the same contract.

```bash
npm test
```

---

## Deployment

```bash
vercel
```

That is the whole procedure. No environment variables, no database, no `vercel.json`.

It works because every route is either static or a client component reading from browser storage, so the deployment uses approximately zero function invocations — comfortably inside the Hobby tier. `output: "export"` is deliberately *not* used, because it would remove the Route Handler that the server-persistence upgrade path depends on.

To move to a real database later: provision one, implement the three functions in `src/app/api/workspace/persistence.ts`, then set `DATABASE_URL` and `NEXT_PUBLIC_STORAGE_DRIVER=rest`. No component changes.

See `.env.example` for every available override.

---

## Project layout

```
src/
├── app/
│   ├── layout.tsx              # server component: shell, font, theme script
│   ├── page.tsx                # marketing landing page
│   ├── globals.css             # design tokens
│   ├── api/workspace/          # optional server persistence (501 by default)
│   └── workspace/
│       ├── providers.tsx       # the single client boundary
│       ├── layout.tsx
│       └── [pageId]/           # page route
├── components/
│   ├── app-shell/              # the two-pane frame
│   ├── editor/                 # blocks, slash menu, contentEditable
│   ├── database/               # board / table / list / calendar + cells
│   ├── sidebar/                # tree, sections, trash
│   ├── topbar/                 # breadcrumb, share, page menu
│   ├── sharing/                # invites and roles
│   ├── search/                 # command palette
│   ├── marketing/              # landing page sections
│   └── primitives/             # Popover, Menu, Button, Avatar, Pill
├── config/app.config.ts        # every tunable, env-overridable
└── lib/
    ├── model/                  # types + the property-type registry
    ├── storage/                # StorageAdapter and its implementations
    ├── store/                  # Zustand store + hydration
    ├── database/view-engine.ts # filter / sort / group — pure
    ├── seed/                   # the demo workspace
    ├── theme/
    └── utils/
```

`src/lib/` imports nothing from React or Next. That dependency direction is load-bearing: it is what keeps the test suite fast and the storage swap possible.

---

## Known limitations

Scoped out deliberately, and worth being explicit about:

- **No authentication and no multi-user backend.** Invites create members in the local workspace; they do not send email. Real collaboration needs a server and identity, which is a different project.
- **No realtime.** No presence cursors, no operational transform.
- **Rich text is plain text plus browser-native marks.** Bold/italic/code apply through `execCommand`; there is no `RichText[]` annotation model persisted per span.
- **Undo is per-block and browser-native.** There is no application-level undo stack across blocks.
- **No relations, rollups or formulas.** The property registry is built to accept them — each is one class — but they are not implemented.
- **Timeline and gallery views** are not implemented; board, table, list and calendar are.
