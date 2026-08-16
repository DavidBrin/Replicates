# Notion

A working replica of Notion — the marketing site and the product — built in a single session with an agent team.

The app is a real project tracker, not a screenshot: pages are made of editable blocks, databases render as board / table / list / calendar views, cards drag between status columns, people can be invited with roles, and everything persists in your browser.

```bash
pnpm install
pnpm run dev      # http://localhost:3000
pnpm test         # unit tests
pnpm run build    # production build
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

**4. Review.** Type-checking, linting, the unit suite, and a browser pass driving the real app.

The two things that made the parallel phase work were **directory ownership** (no two agents could touch the same file) and **contracts written down before the fan-out** (an agent importing `DatabaseView` was told its exact signature rather than guessing).

### What the browser pass caught

Static checks passed while the app was still visibly broken, which is the argument for driving it rather than trusting a green build. Six defects, in rough order of severity:

**The app never rendered at all.** `/workspace` sat on the loading skeleton forever. The load effect had a "has already run" ref guard *and* a cancel-on-cleanup flag; under Strict Mode's mount → unmount → remount, the first pass started and was cancelled, and the second returned early at the guard. `hydrated` never flipped. Loading is an idempotent read, so the fix was to delete the guard and let it run twice in development.

**The page cover was invisible** despite occupying the right space. The style object set the `background` shorthand for gradients and `backgroundImage` for URLs; React applies both, so assigning the second as `undefined` cleared the image the first had just set, leaving only the shorthand's other resets behind. Both kinds now go through `backgroundImage`.

**The hero headline broke into three lines** instead of Notion's two, with the pill stranded on its own. Measuring showed line two needs ~1048px at 96px and the column was 960px — and that our pill carried 1.0em of dot-and-padding chrome where Notion's carries about 0.6em. The pill was also seated ~30px too low, because `overflow: hidden` (needed to clip the width morph) moves an inline box's baseline to its bottom margin edge.

**The board was squeezed into the 708px text column.** Notion lets an inline database break out to the page width. Fixed by making the editor root a size container and re-centring the block on it with symmetric negative margins — no viewport or sidebar arithmetic.

**Choosing a slash-menu item lost the caret.** The caret was restored before the conversion, and converting swaps in a different component, so the element being focused was already on its way out. It now restores after React commits.

**The calendar opened on an empty month,** because the demo data was pinned to a fixed date in the past. The seed is now anchored to today. That is safe here for a specific reason: nothing date-derived is server-rendered — `/workspace` emits the skeleton on the server and paints only after client hydration — so a server/client timezone difference cannot produce a mismatch.

Two more were caught by the linter and fixed rather than suppressed: a `setState`-in-effect in the theme provider (now an external store read through `useSyncExternalStore`, which is the right shape for a value that differs between server and client anyway), and a `useCallback` the React Compiler could not preserve in `Popover` (the callback moved inside the effect that used it, which also stopped the scroll and resize listeners re-arming every render).

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

**Three findings contradicted the starting assumptions.** The reference screenshots suggested the hero screenshot sat inside a browser-chrome mockup with traffic lights. It does not — grepping Notion's CSS and HTML for `trafficLight|browserChrome|tabStrip` returns nothing. The hero is a bordered rounded panel that **dissolves into the page** behind a 200px white gradient, and that gradient is doing more work than the border radius. Similarly, the nav CTA is black (`#191918`) while the *hero* CTA is blue (`#0075de`) — two different buttons. And the hero headline is **weight 600, not 700**, at 96px with −4.6px tracking.

Research also killed a spec item that turned out not to exist: Notion has no Short/Medium/Tall table row height (that is Airtable). Row height is content-driven off a `min-height: 36px`; what Notion actually has is per-property **Wrap text**, and Small/Medium/Large sizing on **board and gallery cards**, not table rows.

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

Vitest + React Testing Library + jsdom. **147 tests, about two seconds.**

```bash
pnpm test
pnpm run lint
pnpm run typecheck
pnpm run build
```

The suite is in two halves, because the first half alone was green while the app rendered nothing.

**Pure logic** — the view engine (filter, sort, group), the property-type registry, the storage adapters, the store's tree operations, and the seed's referential integrity. Fast, and where most of the genuinely tricky invariants live: that blanks sink in *both* sort directions, that a block cannot be moved inside its own subtree, that trashing a page trashes its whole subtree, that removing a property clears any view grouping pointing at it, that a permanent delete leaves no dangling references. Storage adapters share one `describe.each` suite, since all four must satisfy the same contract.

**Mounted components** — added specifically to close the gap the browser pass exposed. Anything whose failure mode is *"renders, but wrong"* is unreachable from a logic test:

| Suite | Guards |
|---|---|
| `providers.test.tsx` | The workspace reaches a hydrated state **under `<StrictMode>`**. This is the one that would have caught the blank app. |
| `PageEditor.test.tsx` | The cover actually paints; every block type survives the renderer registry; the inline database keeps its break-out class. |
| `Editable.test.tsx` | Typing reaches the store; markdown shortcuts convert; the slash menu opens, filters and **leaves the caret in the converted block**; Enter splits at the caret; Tab and Shift-Tab re-nest. |
| `DatabaseView.test.tsx` | All four views render their rows — including the calendar placing tasks on the grid rather than showing an empty month. |
| `SharePopover.test.tsx` | Invites land as pending members with the right role; role changes and removals write through. |
| `demo-workspace.test.ts` | No dangling ids anywhere in the seed, and the demo data stays *fresh* — enough tasks in the current month, every board column non-empty. |

### The regression tests were verified against their own bugs

A regression test that passes both before and after a fix proves nothing. Each of the three most important ones was checked by reintroducing the original defect and confirming it fails:

- restoring the ref guard in the load effect → **all 5** provider tests fail;
- restoring the `background` shorthand on the cover → the gradient test fails;
- restoring the caret-before-conversion ordering → the caret test fails with *"no editable is focused after converting"*.

### Two jsdom shims, and why they are legitimate

jsdom has no layout engine and no `contenteditable`, which silently breaks editor tests in ways that look like product bugs:

- **`Range.getBoundingClientRect` does not exist** — calling it *throws*. The editor measures the caret to anchor the slash menu, so that exception aborted the state update that opens it. The visible symptom was a menu that never appeared; the real cause surfaced only as an unhandled error. The shim returns a zero rect, which production code already treats as "fall back to the element's own box".
- **`isContentEditable` is hard-wired to `false`** — user-event reads it to decide whether an element is typable, so without the shim every editor test types into the void.

Both live in `vitest.setup.ts` with the reasoning written down. Where jsdom genuinely cannot model something — restoring a caret across a remount, so that typing *after* an Enter-split lands in the new block — the test asserts the structural outcome and places the caret explicitly rather than pretending. That behaviour is covered by the browser pass instead.

### Beyond the suite

The UI was also verified by driving the running app — including a keyboard drag of a board card from **Not started** to **Blocked**, confirmed by reading `status-blocked` back out of IndexedDB afterwards.

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
- **Timeline and gallery views** are not implemented; board, table, list and calendar are. A gallery tab falls back to the board so it is never a dead end.
- **A multi-day event repeats per day in the calendar** rather than drawing one continuous bar across the row. The dates are right; the rendering is naive.
- **Block drag reorders within one parent only.** Moving a block to a different nesting level is done with Tab and Shift-Tab.
- **The demo workspace is anchored to today**, so screenshots taken on different days show different dates. That is deliberate — see the note above.
