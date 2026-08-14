# Linear — specification

A rebuild of [Linear](https://linear.app)'s core: issues, projects and teams,
with real multi-user membership and permissions. Deployable on a free host.

This document is the contract every build slice works against. Where it states
a value or a rule, the value is measured or documented and the citation points
into `research/`. Where it deviates from Linear, the deviation is marked
**[DEVIATION]** and justified.

---

## 1. Scope

### In

The daily loop, 1:1 with Linear:

- **Issues** — identifier `TEAM-123`, markdown description, workflow state,
  priority, assignee, labels, estimate, due date, sub-issues, relations,
  project, subscribers, comments, activity feed.
- **Views** — list and board, grouped by status / assignee / priority /
  project / label / none, ordered manually or by field, with display options
  and filters. Saved views.
- **Projects** — lead, members, teams, milestones, status, health, updates,
  and their issue list.
- **Teams** — key, icon, private flag, per-team workflow states, labels,
  estimation scale, triage toggle, membership.
- **Members & permissions** — workspace roles (owner/admin/member/guest), team
  roles (admin/member), project membership, invitations by link.
- **Keyboard-first interaction** — command palette, shortcut map, property
  pickers, multi-select, bulk edit.
- **Inbox** — notifications with read/unread and snooze.
- **Search** — issues and projects, by identifier and text.
- **AI connectors** — server-side calls to Anthropic and OpenAI behind one
  port. Not agents.

### Out

Deliberately cut, per the brief's "you can take out less useful features":
cycles/sprints, initiatives, SLAs, customer requests, Asks, integrations,
insights dashboards, documents, native agents, offline sync, sub-teams,
issue templates, drafts, roadmaps. `research/02-features.md` §17.

### The one thing that cannot be replicated

Linear's native agents. The brief excludes them. What ships instead is a
provider-agnostic connector port with Anthropic and OpenAI adapters, used for
issue summarisation and description drafting, and a no-op adapter that renders
the feature disabled when no key is configured.

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16.3 App Router, React 19.2 | Matches the five sibling projects; Vercel detects it with zero config |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | |
| Styling | Tailwind v4 via `@theme inline` over CSS custom properties | Two themes swap by re-pointing one block |
| Database | **PostgreSQL everywhere** — PGlite (WASM) locally and in tests, Neon in production | One dialect. See §3 |
| Data access | Raw SQL behind a `SqlDatabase` port | No ORM: one schema file, no dialect-specific model layer |
| Auth | Hand-rolled: `jose` JWT session cookie + DB session rows, scrypt via `node:crypto` | No third-party account needed to run the app |
| Mutations | **Route Handlers**, not Server Actions | Server Actions dispatch *sequentially, one at a time per client* — five bulk edits would serialise five round trips (`research/04-interaction.md`) |
| Realtime | Cursor polling over a `change_events` table, 15s | Vercel Hobby's binding limit is 360 GB-hrs of provisioned memory ≈ 180 instance-hours/month; a persistent connection per open tab exhausts it |
| Tests | Vitest (unit), Playwright (e2e) | |

### Zero-config promise

`npm install && npm run dev` must work against an empty environment. PGlite
boots an embedded Postgres into `.data/`; no service, no container, no
`DATABASE_URL`. Setting `DATABASE_URL` switches to Neon. The app refuses to
boot in production on PGlite, because Vercel's filesystem does not survive the
invocation that wrote to it.

---

## 3. Persistence

### One dialect, two engines

The repositories write Postgres once. PGlite is Postgres compiled to WASM —
same parser, same planner — so the local suite exercises the deployed engine's
semantics rather than an approximation of them.

**Measured constraints** (`src/adapters/db/schema.sql` header):

1. PGlite ships **no** `citext`, `pgcrypto` or `pg_trgm`. Case-insensitive
   uniqueness is `unique index on (lower(x))`; search is `ilike`.
   `gen_random_uuid()` needs no extension on PG13+.
2. Order-key columns are declared **`collate "C"`**. Postgres' default ICU
   collation folds case, making `Zz` — the key for "drag to top" — sort last.
   **PGlite's default collation is already byte-wise, so this bug cannot
   reproduce locally.** The collation is declared on the column so both
   engines are correct; this is the one place the "PGlite matches production"
   claim is not self-evident.
3. Enums are real Postgres types, though Linear ships several as bare
   `String!` with the legal values only in a docstring.

### Manual ordering

Base-62 **fractional index strings**, not floats. **[DEVIATION]** — Linear uses
`Float`. A double exhausts precision after ~50 inserts into one gap and the
list silently stops holding its order; Linear ships a rebalancer to cope. A
string key grows a character instead. `src/domain/ordering.ts`.

One **global** `sortOrder` per issue, shared by every user and every view —
Linear's docs are explicit that manual ordering "will update the manual order
for everyone in the workspace." Grouping partitions the same global order.

### Identifiers

`issues.number` comes from `teams.issue_counter`, bumped with
`update … set issue_counter = issue_counter + 1 … returning issue_counter`
inside the insert's transaction. Never reused. `identifier` is derived at read
time from `team.key + "-" + number` and never stored, so renaming a team key
rewrites nothing.

### Category-transition timestamps

`started_at` / `completed_at` / `canceled_at` are set on entering a state of
that type and **cleared on leaving it**. `started_at` alone is first-write-wins.
Deriving them from the activity log looks equivalent and is not — it
resurrects stale values and corrupts every rollup (`research/02-features.md` §2).

---

## 4. Permissions

Two orthogonal axes, plus one deviation the brief requires.

```
workspace role:  owner > admin > member > guest      (one per user per workspace)
team role:       admin > member                      (per user per team)
project role:    lead | member                       (per user per project)
```

Effective permission is the **union** across axes — the highest applicable
grant wins.

### Rules

- Workspace admins and owners are implicitly team admins of every team they
  can access. Guests can never be team admins.
- **Guests see only what they are explicitly added to.** No team, project or
  issue outside their memberships is listable, readable or discoverable.
- **[DEVIATION]** In Linear, project membership carries *no* permissions —
  visibility and edit rights come entirely from team membership. Here, project
  membership additionally grants edit on that project and its issues, because
  the brief requires that people added to a project can add to and edit it.
  The grant is purely additive: it never removes access Linear would give.
- **The last owner cannot be removed or demoted.** Enforced in a transaction
  that locks the workspace row first — two concurrent demotions each reading
  `count = 2` would otherwise both pass.
- A member may always remove *themselves* (leave), except the last owner.
- Nobody may promote another user above their own role.
- Deleting an issue is not role-gated; the 30-day trash window is the safety
  net, matching Linear.

### Implementation

A single pure function:

```ts
can(actor: Actor, action: Action, resource: Resource): boolean
```

backed by a declarative policy table typed as
`Record<Action, Record<RoleKey, Cell>>` applied with `satisfies`, so `tsc`
rejects a missing action row, a missing role cell, or a typo'd key. No
`if (user.role === "admin")` anywhere else in the codebase — there is a unit
test that greps for it.

The exhaustive matrix test's expectations are **hand-transcribed** from
`research/05-oss-architecture.md` §2, never derived from the policy table:
deriving them would make the test pass against any table, including an
all-deny one.

---

## 5. Design

All values measured from the running application and linear.app
(`research/01-visual-design.md`, `src/app/globals.css`).

| Token | Dark | Light |
|---|---|---|
| App background | `#08090a` | `#ffffff` |
| Sidebar | `#08090a` | `#f4f5f8` |
| Panel / elevated | `#0f1011` / `#141516` | `#ffffff` |
| Border default | `#23252a` | `#e2e2e4` |
| Text primary / tertiary | `#f7f8f8` / `#8a8f98` | `#1a1b1e` / `#6b6f76` |
| Brand | `#5e6ad2` | `#5e6ad2` |

Three details carry the resemblance:

1. **The greys are violet.** Every neutral in the app is `lch(L 0.4–1.5 272)`.
   True neutrals (`#111`, `#222`) are the most obvious tell in a clone.
2. **Body is 13px; "normal" is weight 450 and titles are 590**, not 400/600 —
   Inter Variable sits between the named weights.
3. **Backgrounds move in four ~2-point steps**; row-versus-hover contrast is
   deliberately slight.

Layout: sidebar 244px, header 48px, list row 40px, issue detail column 660px
with a 260px properties rail. Radii 4/6/8/12. Motion 100ms interaction,
250ms regular, `cubic-bezier(.25,.46,.45,.94)`.

Font: Inter Variable via `next/font` (self-hosted at build; no runtime CDN),
with `cv11` and `ss03` enabled — `cv11` gives the single-storey `l` that
disambiguates `l/I/1` in issue identifiers.

### Iconography

Drawn as SVG in code, not imported as an icon set, because the status glyph is
a progress indicator rather than a picture:

- **Backlog** — dashed circle. **Todo** — plain ring. **In progress** — ring
  with a filled pie wedge proportional to the state's position within the
  started group. **Done** — filled disc with a check. **Canceled** — filled
  disc with an ×.
- **Priority** — three ascending bars (1/2/3 filled for low/medium/high),
  an orange rounded square with `!` for urgent, three dots for none.

---

## 6. Interaction

The shortcut map is assembled from ~22 Linear docs pages and cross-checked
against third-party sheets; Linear publishes no shortcuts page
(`research/04-interaction.md` §1). Conflicts are resolved there.

Corrections worth stating because the obvious guess is wrong:

| Key | Action | Note |
|---|---|---|
| `Cmd/Ctrl+B` | toggle list ⇄ board | **not** sidebar |
| `[` | toggle sidebar | |
| `Shift+1..4` | priority urgent…low | bare `1/2/3` are Triage actions |
| `Shift+D` | due date | not `D` |
| `M` then `B`/`X`/`R` | relations | `M` is a chord prefix, never bare |
| `C` / `S` / `A` / `P` / `L` | create / status / assignee / priority / label | |
| `X` / `J` / `K` / `Esc` | select / down / up / dismiss | |
| `Cmd+K` | command palette | context-sensitive on selection |
| `G` then `I`/`B`/`P` | go to My Issues / Backlog / Projects | |

The dispatcher is a scope stack with a chord buffer, an IME guard, and an
Escape ladder. Shortcuts never fire while a text input or `contenteditable`
has focus.

### Mutations

Optimistic by default: apply to a normalised client store, POST to a Route
Handler with an idempotency key, reconcile by id, roll back **only the touched
fields** on failure. A per-entity FIFO queue prevents two edits of one issue
from landing out of order. `useOptimistic` is component-scoped and does not
survive unmount, so it is used for leaf interactions only.

---

## 7. Screens

| Route | Contents |
|---|---|
| `/` | Marketing page — hero, feature grid, sign-in / sign-up |
| `/signin`, `/signup` | Email + password |
| `/invite/[token]` | Accept an invitation, signing up if needed |
| `/[workspace]/my-issues` | Assigned / Created / Subscribed tabs |
| `/[workspace]/inbox` | Notifications |
| `/[workspace]/team/[key]/all\|active\|backlog` | The issue list |
| `/[workspace]/team/[key]/board` | Board |
| `/[workspace]/issue/[identifier]` | Issue detail |
| `/[workspace]/projects` | Project list |
| `/[workspace]/project/[slug]` | Project overview, issues, milestones, updates |
| `/[workspace]/settings/members` | Members, roles, invitations |
| `/[workspace]/settings/teams/[key]` | Team settings: states, labels, members |
| `/[workspace]/settings/ai` | Connector configuration and status |

---

## 8. Verification

- Unit: domain logic, ordering, authorization matrix, filters, repositories
  against a real PGlite instance.
- e2e: a **multi-user permission journey** — owner invites a member and a
  guest; the member edits an issue in a shared team; the guest cannot see the
  other team; a project member edits a project they were added to; the last
  owner cannot be demoted.
- `npm run verify` = typecheck + lint + unit. Build must pass.
