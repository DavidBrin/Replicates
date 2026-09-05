# Spike: "New account" → blank, fully-featured workspace

**Ask:** a visitor should be able to start a genuinely blank workspace — not the
pre-seeded Pufferfish demo — and use every feature from an empty state, the
way a real Notion signup works.

**Status:** research only, nothing implemented. This document lays out the
current architecture, the constraint that shapes the design space, two
implementation options, and a recommendation.

## 1. What happens today

There is no account concept anywhere in the app. `useWorkspaceStore` boots
with `createDemoSnapshot()` unconditionally
(`src/lib/store/workspace-store.ts:151`), and every storage adapter reads and
writes exactly one snapshot behind one fixed key,
`notion-clone:workspace:v1` (`src/config/app.config.ts`, `storage.key`).
`useWorkspacePersistence` (`src/lib/store/hydration.ts`) loads that one
snapshot on mount and overwrites the seeded state if something was saved —
so a *returning* visitor sees their own edits, but a *first* visitor, in any
browser, always lands in the same demo: five Pufferfish teammates, a
"Priority Tasks" database with rows, a roadmap page, an engineering handbook.

"Get Notion free" (`Nav.tsx`, `CtaPair.tsx`), "Log in" (`Nav.tsx`), and the
pricing CTAs all point at the same `routes.workspace` (`/workspace`) — there
is no distinct signup path, so there is nothing today that *could* produce a
blank start. `resetWorkspace()` exists (`hydration.ts:116`) but resets back
to the seed, not to empty — it's a "start the demo over" button, not a "start
fresh" one.

The seed builder's own docstring already gestures at this
(`src/lib/seed/demo-workspace.ts:1-8`): "Built as data rather than
hard-coded UI so the same builders can produce a blank workspace, a test
fixture, or a different demo without touching any component." That blank
builder was never written — only `createDemoSnapshot()` exists.

## 2. The constraint that shapes everything: the demo is load-bearing

This app isn't only reachable at `/workspace` — it's indexed. David's
Internet's search results, the knowledge panel, and the wiki all deep-link
into *specific seeded page ids*: `/workspace/page-roadmap` is a named result
today (`David-Internet/content/notion/site.ts`), and `SEED_IDS`
(`demo-workspace.ts:757`) exists specifically so those ids stay stable across
resets. If the default `/workspace` route stopped returning the seeded
Pufferfish content, every one of those search results and deep links would
resolve to an empty page instead of the thing they were indexed as.

So "blank workspace" cannot mean *replacing* the seed — it has to be a
**second path that coexists with it**. Whatever ships, a cold visit to
`/workspace` (or a click from David's Internet search) must keep showing the
curated demo unchanged.

## 3. What "every feature" honestly covers today

Worth being upfront about, since a blank workspace built to "showcase every
feature" will surface these immediately (all pre-existing, documented scope
cuts — not part of this spike):

- **No comments.** The topbar has a Comments icon; there is no comment model,
  no store action, and no panel behind it (confirmed while auditing unwired
  buttons in this session — it's the one button that was left unwired because
  there's nothing to wire it to).
- **Gallery view falls back to board** (`DatabaseView.tsx:13,46`) — not a bug,
  a documented stand-in for an unimplemented view.
- **No relations, rollups, or formulas** — the property registry is built to
  accept them but they aren't implemented (README, "Known limitations").
- **No realtime, no true multi-user backend** — invites create local members;
  no email is sent (same section).

None of this blocks a blank-workspace flow, but the spike for *that* is
scoped to storage/routing, not to closing these gaps.

## 4. Design options

### Option A — "Reset to blank" (single workspace per browser)

Add `createBlankSnapshot()` next to `createDemoSnapshot()`, and a
`resetToBlank()` store action mirroring `resetToSeed()`. Wire a new "Start
blank" entry point (settings menu, or a confirmation-gated marketing CTA) that
calls it. The browser still has exactly one workspace at the one fixed
storage key — "starting fresh" means replacing whatever's currently stored.

- **Cost:** smallest possible — one seed builder, one store action, one
  button. No routing changes, no storage-key changes.
- **Risk:** destructive. If a visitor already customized the demo (or a
  previous blank start), "Start blank" silently deletes it unless gated
  behind a confirm dialog — and even then, there's no way to get back
  whichever workspace you didn't keep.
- **Verdict:** doesn't actually satisfy "new account" — there's still only
  ever one workspace per browser, so it's more "wipe" than "new account."

### Option B — Namespaced local "workspaces," demo included (recommended)

Stop treating `storage.key` as a single global constant. Namespace it by a
workspace id: `notion-clone:workspace:v1:{workspaceId}`, plus one more key
holding "which id is active,"
`notion-clone:active-workspace:v1`. Two fixed ids are always present:

- `demo` → seeded via `createDemoSnapshot()`, exactly as now. `/workspace`
  with no active-id override, and every deep link David's Internet already
  has, keep resolving here unchanged.
- Every "Get Notion free" click generates a new id (`newId("ws")`), seeds it
  via a new `createBlankSnapshot()`, sets it active, and redirects into
  `/workspace`. The workspace shell exists (a `Workspace` with the visitor as
  sole member/owner, one empty "Getting started" home page so the UI isn't a
  blank void with nowhere to click) but zero Pufferfish content.

`getStorageAdapter()` (`src/lib/storage/index.ts`) becomes
`getStorageAdapter(workspaceId)`, threading the active id into the adapter's
key. `useWorkspacePersistence` reads the active-workspace pointer once on
mount to decide which snapshot to load — everything downstream (the store,
every component) is unchanged, because they only ever see one hydrated
snapshot, exactly like today.

A lightweight switcher (the topbar already has the visual real estate for a
workspace-name control — currently non-interactive chrome) lists locally
known workspace ids by name and lets a visitor flip between "Pufferfish
(example)" and whatever they've created, without losing either.

- **Cost:** moderate. Storage-key threading through `index.ts` and
  `hydration.ts`, a new seed builder, a small id-registry (just an array of
  `{id, name}` in one more localStorage key — doesn't need IndexedDB), a new
  redirect step behind the CTA, and a switcher UI.
- **Risk:** low. The demo path is untouched by construction — new code only
  runs for a workspace id that isn't `demo`. Nothing about `/workspace/*`
  page components changes.
- **Verdict:** this is the one that actually matches "new account" — each
  click produces an isolated, blank, fully-interactive workspace, and the
  indexed demo keeps working forever regardless of how many blank ones pile
  up.

### Option C — Real accounts on the existing server seam (not now)

The app already has a designed upgrade path for this: `RestStorageAdapter`
(`src/lib/storage/rest-adapter.ts`) plus the three stub functions in
`src/app/api/workspace/persistence.ts`, switched on with
`NEXT_PUBLIC_STORAGE_DRIVER=rest`. A real version of "new account" would put
identity (even something as light as an email + magic link, or just a
generated shareable token) behind that seam, backed by a database, so a
workspace survives across browsers and devices instead of living in one
browser's IndexedDB.

Explicitly **not recommended for this pass**: it reintroduces the database +
environment-variable + hosting cost that this project's whole design
(`README.md`, "Deployment") was built to avoid, for a hobby demo that doesn't
need cross-device durability. Worth revisiting only if "new account" is
meant to produce something a visitor comes back to next week on a different
machine.

One durability note that applies regardless of A vs. B: WebKit clears all
script-writable storage after seven days of unused Safari (already the
justification for this app's JSON export/import feature, per the README's
Research section). A brand-new blank workspace has exactly the same exposure
— worth surfacing "export your workspace" more prominently for anyone who
actually invests time in a from-scratch one, since unlike the demo there is
no seed to fall back to if it's evicted.

## 5. Recommended plan (Option B)

1. `src/lib/seed/blank-workspace.ts` — `createBlankSnapshot(name?: string)`,
   built the same way `createDemoSnapshot()` is (data tables → assemble), just
   with one user (the visitor), one workspace, one starter page, no database,
   no seeded rows.
2. `src/lib/storage/index.ts` — `getStorageAdapter(workspaceId: string)`,
   threading the id into the key each adapter is constructed with
   (`${storage.key}:${workspaceId}`); keep the current key as the literal
   value for `workspaceId === "demo"` so existing demo saves in visitors'
   browsers aren't orphaned by the migration.
3. A tiny new module for the active-id pointer and the local registry (id +
   display name + created-at), read/written via the same
   `LocalStorageAdapter`/`IndexedDbAdapter` primitives — no new persistence
   abstraction needed.
4. `hydration.ts` — resolve the active id before calling
   `getStorageAdapter()`; unchanged otherwise.
5. Point `Nav.tsx`'s "Get Notion free" and the pricing CTAs at a
   `/workspace/new` handshake route (or a client action fired before
   navigating) that mints the id, seeds it, registers it, sets it active,
   then pushes to `/workspace`. "Log in" keeps going straight to
   `/workspace` (active id = whatever was last set, defaulting to `demo`).
6. Topbar workspace-name control becomes a real switcher: lists the registry,
   swapping the active id and reloading the store from the corresponding
   adapter.
7. Tests: a `blank-workspace.test.ts` mirroring
   `demo-workspace.test.ts`'s shape assertions; a hydration test asserting
   that two different active ids load two independent snapshots without
   cross-contamination.

Everything downstream of hydration — every component, every store action —
needs zero changes, because they've only ever operated on "the one hydrated
snapshot." That's the part of the existing architecture (per-entity store,
snapshot-shaped storage contract) that makes this cheap.

## 6. Open questions for David

- Should a brand-new blank workspace ask anything up front (a name, an
  avatar) before dropping the visitor into it, or start completely silent
  like clicking "Get Notion free" today does?
- Is a workspace switcher worth building in this pass, or is "one blank
  workspace replaces the previous blank one, demo stays separate" (registry
  of size ≤ 2: demo + latest) an acceptable first slice, with the switcher as
  a follow-up?
- Should "Log in" behave differently from "Get Notion free" at all (e.g.
  return to whatever workspace id was last active), or is that distinction
  not worth making without real authentication behind it?
