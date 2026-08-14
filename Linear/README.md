# Linear

> **the issue tracker, rebuilt from measurements**

A rebuild of [Linear](https://linear.app) — issues, projects and teams, with
real multi-user membership. Four people at four permission levels, a keyboard
model, and a workspace that boots with one command and no database to install.

| Issue list | Issue detail | Board |
|---|---|---|
| <img src="docs/screenshots/issue-list.png" width="240" alt="Grouped issue list with status glyphs, priority icons, labels and assignees"> | <img src="docs/screenshots/issue-detail.png" width="240" alt="Issue detail with properties rail, activity feed and threaded comments"> | <img src="docs/screenshots/board.png" width="240" alt="Board with columns from the current grouping"> |

| Projects | Members | Marketing |
|---|---|---|
| <img src="docs/screenshots/projects.png" width="240" alt="Project list with health, lead and progress"> | <img src="docs/screenshots/members.png" width="240" alt="Workspace members with roles and invitations"> | <img src="docs/screenshots/marketing.png" width="240" alt="Marketing page"> |

Next.js 16 · PostgreSQL everywhere (WASM locally, Neon deployed) ·
**1,325 unit tests** · 13 e2e permission tests · built from six parallel
research lanes, then seven parallel build slices.

```bash
npm install && npm run dev     # http://localhost:3000 — no database to set up
```

Sign in as `owner@demo.test` / `demo1234`. Also `admin@`, `member@`, `guest@` —
each sees a different application, which is the point.

---

## What it does

**Issues** carry the identifier (`ENG-123`), a markdown description, workflow
state, priority, assignee, labels, estimate, due date, sub-issues, relations,
project, subscribers, comments and an activity feed. **Views** are list or
board, grouped by status / assignee / priority / project / label, filtered and
manually ordered. **Projects** have a lead, members, milestones, status, health
and updates. **Teams** own their workflow states, labels and membership.

**Permissions are the part that had to be real.** Workspace roles
(owner / admin / member / guest) and team roles compose with project
membership; a guest sees only what they were added to, and a private team is
invisible even to a full workspace member. `/settings/members` refuses a member
outright rather than rendering a read-only version of itself.

**Cut deliberately:** cycles, initiatives, SLAs, customer requests,
integrations, insights, documents, offline sync. The brief allowed dropping the
less-used features to get the central ones exactly right.

**The one thing that cannot be replicated** is Linear's native agents. Instead
there is a provider-agnostic connector port with Anthropic and OpenAI adapters
— and a disabled adapter, so an unconfigured clone renders an explanation
rather than an error.

---

## How it was built

### Six research lanes, in parallel

9,095 lines in `research/`, gathered before a line of application code:
visual design, product features, data model, interaction, open-source
architecture, and stack. Four findings changed the build:

**The public colour values are the wrong ones.** Almost every Linear hex in
circulation — `#08090a`, `#1c1c1f`, `#f7f8f8` — belongs to linear.app, not to
the product. The application is `#09090a` chrome around a `#121213` content
pane with `#1a1a1b` on hover. The lane pixel-sampled the running app and
corroborated it against Linear's own splash CSS.

**The status glyph is a progress indicator with exact geometry.** Two
concentric circles; the wedge is `stroke-dasharray "A 2A"` with
`A = 2π × 1.94 = 12.189379495928398` — radius **1.94, not 2**, a 3% shortfall
that stops the wedge closing into a seamless disc at 100%. Backlog's dashed
ring is exactly 12 dashes. All three checked against Linear's shipped
attributes.

**`completedAt` is cleared, not sticky.** Linear stamps it on entering a
completed state and *clears it* when the issue leaves. Deriving it from the
activity log — "the timestamp of the last transition into a completed state" —
looks equivalent and silently corrupts every rollup.

**Server Actions dispatch sequentially, one at a time per client.** Five bulk
edits would serialise five round trips in an app whose reputation is that it
responds instantly. Mutations go to Route Handlers.

### Then seven build slices, in parallel

Data layer · auth and authorization · design system · app shell and list/board ·
issue detail · projects/teams/members · marketing, palette and search. Each
owned a disjoint set of files and verified itself.

Two slices reported the same class of problem from opposite directions, and the
disagreements were the most useful output of the whole exercise — see
`DECISIONS.md` D16–D21.

---

## Decisions worth knowing

The full log is [`DECISIONS.md`](DECISIONS.md); the specification is
[`SPEC.md`](SPEC.md). The five that shaped everything else:

**One database dialect, two engines** (D1). PGlite — Postgres compiled to WASM
— runs locally and in tests; Neon runs deployed. The alternative, SQLite
locally, means writing every statement twice *and* accepting that the two
engines disagree quietly: SQLite's default collation is byte-wise and
Postgres's is not, which is precisely what manual ordering depends on.

**Order keys are strings, not floats** (D4, D5). Linear uses a float
`sortOrder`; a double exhausts precision after ~50 inserts into the same gap
and the list silently stops holding its order. A fractional-index string grows
a character instead. Written by hand first — it failed 8 of its own 25 tests on
the magnitude boundaries — then delegated to the reference implementation, with
a wrapper that rejects the swapped-neighbour case the library silently accepts.

**`collate "C"`, declared explicitly** (D3). Postgres' default ICU collation
folds case, so `Zz` — the key for "drag to top" — sorts *last*. **PGlite's
default collation is already byte-wise, so this bug cannot reproduce locally.**
It is the one place the "PGlite matches production" claim is not
self-evidently true, so the schema says so out loud.

**Authorization is one table the compiler proves exhaustive** (D9). `can(actor,
action, resource)` over a `Record<Action, Record<RoleKey, Cell>>` applied with
`satisfies` — a missing row, a missing cell or a typo'd key is a compile error.
The 416-case matrix test is hand-transcribed from the research and never
derived from the policy, because a derived expectation passes against any
table, including an all-deny one. A grep test fails the build on a role
comparison written anywhere else.

**Project membership grants edit rights** (D8). The brief's requirement, and a
deliberate divergence: in Linear, project membership carries no permissions at
all. Purely additive — it never removes access Linear would give.

---

## What is verified, and what is not

Claims here are separated by how they were checked.

**Verified against the running application**, by driving the HTTP API directly:

| | |
|---|---|
| guest opens a project behind a private team | `404` |
| owner `POST`s them into the project | `201` |
| guest opens it, then `PATCH`es its name | `200`, `200` |
| owner `DELETE`s the membership; guest retries | `404`, `404` |
| admin promotes a member to admin | `200` |
| that admin then removes their new peer | `403 RANK_NOT_ABOVE_TARGET` |

That is the brief's headline requirement and the one-way-door rule (D19),
working end to end.

**Verified by the suites:** 1,325 unit tests, `tsc --noEmit` clean, `eslint`
clean, `next build` succeeding, and **13 e2e permission tests** covering
invitation, the one-way admin promotion, last-owner protection, guest team
scoping, private-team invisibility, and the whole add-to-project → edit →
remove cycle through the UI.

**One test remains skipped** (D22), and it is a real gap rather than a flake: a
project member who is not in the project's team cannot file an issue into it.
`POST /api/issues` pre-gates on `canViewTeam` before consulting `issue.create`,
so the gate is broader than the policy row it guards. Closing it changes where
team scoping is enforced, which deserves its own change rather than a hurried
one.

**Four bugs the running app found that no unit test could:**

- Tailwind v4's content detection scanned `research/screenshots/*.png` and
  generated class names from the compressed bytes, emitting invalid CSS that
  failed to parse — every route returned 500. The error names a token that
  appears nowhere in the source.
- My base stylesheet was **unlayered**, and unlayered CSS beats layered CSS, so
  `button, input, textarea { font: inherit }` silently defeated every
  typography utility on a form element. The issue title — a `<textarea>` —
  rendered at 13px/450 instead of 24px/590.
- `isTeamView` was imported by a server component from a `"use client"` module,
  which yields a client *reference* rather than a function. It typechecks,
  lints, and throws at request time.
- Optimistic writes were being **cancelled by page teardown** (D21). `callApi`
  used an ordinary page-bound `fetch` and the panels committed the optimistic
  state the moment it was *issued*, so a navigation in the same tick killed the
  request before the server read it — the member appeared on screen and no
  `POST` line appeared in the log. Worse, with nothing distinguishing *sent*
  from *saved*, a dependent mutation could overtake the one it depended on: a
  promote and a remove raced, the remove was answered first, and it deleted a
  still-`member` account.

---

## Code index

```
SPEC.md                 the contract every slice built against
DECISIONS.md            21 numbered decisions, with the rejected alternative
research/               9,095 lines from six parallel lanes
  01-visual-design.md     measured tokens, glyph geometry, layout
  02-features.md          product behaviour, 67 features ranked MUST/SHOULD/COULD
  03-data-model.md        entities from Linear's own SDL, proposed schema
  04-interaction.md       shortcut map with confidence tags, optimistic updates
  05-oss-architecture.md  48×8 permission matrix, ordering, anti-patterns
  06-stack-deployment.md  every stack decision with a bolded verdict
```

| Path | What lives there |
|---|---|
| `src/domain/` | `entities.ts` (the vocabulary), `policy.ts` (authorization), `ordering.ts` (fractional index), `filters.ts`, `sorting.ts`, `services/membership.ts` |
| `src/ports/` | `repositories.ts`, `ai.ts` — interfaces in domain terms, no SQL |
| `src/adapters/db/` | `driver.ts` (the seam), `pglite.ts`, `neon.ts`, `schema.sql` (25 tables), `schema.ts` (generated, drift-guarded) |
| `src/adapters/repositories/` | one module per aggregate |
| `src/adapters/ai/` | `anthropic.ts`, `openai.ts`, `shared.ts` — raw HTTP, symmetric on purpose |
| `src/lib/` | `auth/` (scrypt, sessions, invites), `boot.ts`, `seed.ts`, `keyboard/`, `store/`, `ids.ts`, `markdown.ts` |
| `src/components/ui/` | 16 primitives — combobox, popover, status/priority glyphs, avatar, toast |
| `src/components/` | `app-shell` 11 · `issue-detail` 17 · `issues` 13 · `projects` 12 · `members` 8 · `marketing` 6 · `auth` 6 · `command-palette` 5 · `teams` 4 · `inbox` 4 · `search` 3 |
| `src/app/` | 14 routes + 27 API handlers |
| `e2e/` | `permissions.spec.ts` — the multi-user journey; `README.md` — the test-id contract |

### Commands

```bash
npm run dev            # PGlite, seeded on first boot
npm run verify         # typecheck + lint + 1,314 unit tests
npm run test:e2e       # Playwright
npm run build:schema   # regenerate schema.ts from schema.sql
npm run db:push        # apply the schema (Vercel build command)
```

### Deploying

Set `DATABASE_URL` to a Neon connection string and `AUTH_SECRET` to
`openssl rand -base64 32`. Everything else has a working default; the app
refuses to boot in production on PGlite rather than serving traffic from a
filesystem the platform discards. Migrations run from the build command,
because a serverless function that migrates on first request migrates once per
cold start.

`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` enable the AI connectors. Neither is
required — without them the panel explains what to set.
