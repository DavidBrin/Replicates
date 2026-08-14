# Decisions

Numbered, dated, and honest about what was measured versus assumed. Each entry
records the alternative that was rejected, because that is the part that is
expensive to reconstruct later.

---

### D1 — One database dialect, two engines: PGlite locally, Neon deployed

**Rejected:** SQLite locally + Postgres in production (the sibling project
`dollar-pixels` does this, with every statement written twice).

The duplication was not the objection — nineteen tables of it would have been
tolerable. The objection is that the two engines disagree *quietly* about
things this schema depends on. Manual ordering compares base-62 strings
byte-wise: SQLite's default `BINARY` collation is byte-wise, Postgres' default
ICU collation folds case. And SQLite applies type affinity rather than checking,
so a column declared `integer` accepts `'yes'` where Postgres rejects it. Every
such difference is a green local suite and a 500 in production.

PGlite is Postgres compiled to WASM — same parser, same planner. A fresh clone
still runs with no service to install, and the local suite now exercises the
deployed engine's semantics.

**Verified:** PGlite 0.5.5 reports `PostgreSQL 18.3`. The full schema applies in
76 statements and is idempotent on re-apply.

### D2 — No Postgres extensions

**Measured, not assumed:** PGlite's base bundle ships none of `citext`,
`pgcrypto` or `pg_trgm` — `create extension` fails outright. Lane C's proposed
DDL used all three, and would not have booted.

So case-insensitive uniqueness is `unique index on (lower(email))` rather than a
`citext` column, and search is `ilike` rather than a trigram index.
`gen_random_uuid()` needs no extension on PG13+, so ids were never affected.

The `lower()` expression is load-bearing in both directions: every lookup must
use the same expression or it silently misses the index *and* lets
`David@x.com` and `david@x.com` both register.

### D3 — Order keys are `collate "C"`, and the local suite cannot prove it

Manual ordering uses base-62 strings compared byte-wise. Postgres' default ICU
collation folds case, so `Zz` — the key produced by dragging an item to the top
of a list — sorts **last**. The data-model lane reproduced this against a real
Postgres 16.

The trap found while implementing: **PGlite's default collation is already
byte-wise**, so the bug cannot reproduce locally. A suite run against PGlite
alone would pass with the collation omitted, and the deployment would silently
mis-sort every manually ordered list.

The columns therefore declare `collate "C"` explicitly. This is the one place
the "PGlite matches production" claim of D1 is not self-evidently true, so it is
stated in the schema header rather than relied upon.

### D4 — Fractional-index strings for manual order, not floats

**Deviation from Linear**, which uses `Issue.sortOrder: Float!`.

A double carries ~52 bits of mantissa, so repeatedly dropping an issue into the
same gap halves the interval until `(a + b) / 2 === a` — about 50 moves — after
which two rows compare equal and the list stops holding its order. There is no
error; it just stops working. Linear ships a rebalancing pass to cope, and
Vikunja's float implementation is genuinely well-engineered and *still* needs
two offline repair commands.

A variable-length key has no such point: the midpoint of two adjacent keys is
one character longer, forever. The cost is a byte per reorder; the saving is
deleting a scheduled maintenance task from a correctness-critical path.

### D5 — The order-key implementation is a wrapper, not a reimplementation

The encoding packs the length *and* sign of the integer part into a single head
character, which is what keeps `"Zz" < "a0" < … < "az" < "b00"` true under plain
`<`. That arithmetic is fiddly exactly at the magnitude boundaries, and a first
pass written here failed 8 of its own 25 tests on precisely those cases —
decrementing past the smallest head, appending past the largest.

The bugs were in the boundary arithmetic, not the design, so rather than iterate
on a reconstruction the module now delegates to `fractional-indexing` (CC0, no
dependencies, ~2 kB) — the reference port of the scheme Figma described. The
tests were written against our API first and are unchanged.

**The wrapper earns its place.** Probing the library showed
`generateKeyBetween("a1", "a0")` does not throw — it returns `"a0V"`, a key that
is *not* between the arguments as given but between them reversed. A drag
handler that got its neighbours the wrong way round would write a plausible key
in the wrong place. `keyBetween` rejects that case before delegating.

### D6 — Route Handlers for mutations, not Server Actions

Next.js documents that **Server Actions dispatch sequentially, one at a time per
client**. Selecting five issues and pressing `S` would serialise five round
trips — in an app whose entire reputation is that it responds instantly.

Mutations go to Route Handlers, applied optimistically against a normalised
client store, reconciled by id. `useOptimistic` is component-scoped and does not
survive unmount or a route change, so it is used for leaf interactions only.

### D7 — Cursor polling, not SSE or WebSockets

The received wisdom is that Vercel Hobby caps functions at 10s and forbids
WebSockets. Both are **stale**: the limit is 300s, and native WebSockets shipped
in June 2026.

The real constraint is different and harsher. Hobby provisions 360 GB-hours of
memory per month; at 2 GB per instance that is ~180 instance-hours, and a
long-lived connection bills wall-clock rather than CPU. A single tab left open
around the clock is 720 instance-hours — and the penalty for exceeding the limit
is the project being paused for up to 30 days, which no amount of money fixes on
that plan.

So: a monotonic `change_events` table and a 15s cursor poll that stops while the
tab is hidden. Linear's own sync is documented as last-write-wins rather than
CRDT, so this is the same guarantee, not a weaker one. "Push a doorbell, pull the
data" is the upgrade path if the app ever leaves the free tier.

### D8 — Project membership grants edit rights

**Deviation from Linear**, and a required one: the brief asks that people added
to a project can add to and edit it.

In Linear, project membership carries no permissions at all — lead and member
are ownership and notification signals, and visibility comes entirely from *team*
membership. Here, project membership additionally grants edit on the project and
its issues.

The grant is purely additive: it never removes access Linear would give, and
Linear's exact behaviour is recoverable by ignoring one table in the policy.

### D9 — Authorization is one table, proved exhaustive by the compiler

`can(actor, action, resource)` over a declarative
`Record<Action, Record<RoleKey, Cell>>` applied with `satisfies`, so a missing
action row, a missing role cell, or a typo'd key is a compile error rather than
a permission hole.

Plane — the closest open-source analogue — defines its role enum four times
across two languages, and one 146-line permission file contains three comments
that contradict the code beneath them. That is the failure mode this shape
exists to prevent.

The exhaustive test's expectations are **hand-transcribed** from the research
matrix and never derived from the policy table. A derived expectation passes
against any table, including an all-deny one.

### D10 — The last-owner rule locks the row first

Two concurrent demotions each read `count = 2`, each conclude they are not the
last owner, and both commit — leaving a workspace nobody can administer. The
check runs inside a transaction that takes `select … for update` on the
workspace row before counting.

### D11 — Invitations are links, and that is a stated trade

There is no email provider on a free host, so an invite is a shareable URL
carrying a high-entropy token; only its hash is stored. Whoever holds the link
may accept it. The alternative on this infrastructure is no invitations at all.

The session cookie is `sameSite: "lax"` rather than `strict` for the same
reason — an invite link is a cross-site GET, and `strict` would drop the cookie
exactly when it is needed.

### D12 — Timestamps are cleared, not sticky

`started_at` / `completed_at` / `canceled_at` are set on entering a state of that
category and **cleared on leaving it**, so a Backlog → Done → In Progress round
trip ends with `completed_at` null. `started_at` alone is first-write-wins, so
cycle time measures from first pickup.

Deriving these from the activity log — "the timestamp of the last transition
into a completed state" — looks equivalent and is not. It resurrects the old
value and corrupts every rollup that reads it.

### D13 — Duplicate is a status, not a sixth state type

Linear's SDL docstring lists `duplicate` as a legal `WorkflowState.type`, but
their user-facing docs also describe it as a canceled-type status. Rather than
branch on a seventh type in every rollup, the clone ships a system status named
*Duplicate* with `type = 'canceled'`. One less axis, same behaviour.

### D14 — AI connectors are provider-neutral raw HTTP

The `claude-api` skill's default is the official Anthropic SDK. It also
documents an exception for code that is explicitly provider-neutral, which this
is: the brief asks for GPT *and* Claude behind one interface. Two adapters
implementing one port, each a documented wire shape, stay symmetric in a way
that one SDK plus one hand-rolled client would not.

Model defaults are `claude-opus-5` and `gpt-5`, with `effort` rather than
`temperature` — both vendors' current flagships reject sampling parameters. On
Anthropic's side thinking is on by default and `max_tokens` caps thinking *plus*
output, so the default is 4096 with `effort: low`, not a 2048 ceiling that would
truncate mid-answer.

### D16 — Two layers enforce membership rules, deliberately

The authorization slice and the repository slice independently implemented the
last-owner rule and the guest/team-admin rule, and the policy module's own grep
test flagged the repositories for comparing roles outside it.

Both stay, with different jobs:

- **`domain/policy.ts` is the authorization layer.** Route handlers call it, and
  it is the only place that answers "may this actor do this". It knows about
  actor rank, so it can refuse an admin demoting an owner.
- **The repository guards are storage invariants.** "A workspace has at least
  one owner" is true regardless of who asked, in the same way a foreign key is.
  A bug in a route handler should not be able to produce a workspace nobody can
  administer.

The grep test records them as declared exceptions with written reasons rather
than being loosened, so a *new* role comparison still fails the build.

### D17 — Owners and admins can see private teams' issues

The research matrix has an apparent conflict: a footnote says owners and admins
may only *list* a private team, while the `issue.view` row grants them access
unconditionally.

Resolved in favour of the row, because it matches Linear's documented behaviour
— workspace admins are automatically team admins of every team they can access,
and can see and join private teams. Guests remain scoped strictly to their
explicit memberships, which is the case the brief actually cares about.

### D18 — A promise queue backs the row lock, because PGlite has one connection

The last-owner check runs `select … for update` on the workspace row. On Neon
that serialises two concurrent demotions. On PGlite it does nothing at all:
there is a single connection, so two overlapping `transaction()` calls land in
*one* physical transaction and the lock is taken against nobody.

Both layers ship. The row lock is what works in production; a per-database
promise queue is what works locally, and is also what makes the concurrency
test meaningful — the test was verified by breaking the queue and watching it
go red with zero owners remaining.

### D19 — Promoting someone to admin is one-way for the promoter

An admin may raise a member to admin (R1 forbids granting *above* your own rank;
equal is fine) and immediately loses the ability to demote or remove them (R2
forbids acting on an equal or higher rank). Only an owner can undo it.

The projects slice hit this and reported it as a policy bug, because an e2e test
I had written promoted a member to admin and then tried to remove them as an
admin. Checking the research settled it the other way: this is documented
Linear behaviour, R3 names the privilege-proliferation risk explicitly, and the
policy implements it deliberately.

So the test changed, not the rule — and it now pins the one-way door as a
behaviour rather than leaving it to be rediscovered as a bug report. An owner
removing an admin is a separate test.

### D20 — The seed carries a project the guest cannot see

Every seeded project touched Engineering, and the guest is in Engineering, so
the guest could reach all of them through team membership. That left this
clone's one deliberate divergence from Linear (D8) with nothing to demonstrate:
the permission journey's "add a guest to a project they cannot otherwise see"
had no such project to use.

*Website Redesign* now lives entirely inside the private Design team, with the
guest deliberately absent from its members. It is the only project in the
workspace the guest genuinely cannot reach, which is exactly what makes adding
and then removing them a real test rather than a tautology.

### D21 — Optimistic writes were being cancelled by page teardown

Found by running the permission journey against the real app: the workspace
members table and the project members panel both showed a change landing that
never reached the database.

The cause was not the error path — both had correct rollback code. `callApi`
issued an ordinary, page-bound `fetch`, and the panels committed the optimistic
UI the moment it was *issued*. Anything that tore the document down in the
window between click and response — a navigation, a closed tab, the end of a
Playwright test — cancelled the request before the server read it. Measured
rather than inferred: clicking "add member" and navigating in the same tick
leaves no `POST` line in the dev server log at all, while the row appears on
screen.

A second failure followed from the same missing acknowledgement. With nothing
distinguishing *sent* from *saved*, a dependent mutation could overtake the one
it depended on: promote-then-remove fired `PATCH` and `DELETE` concurrently,
the `DELETE` was answered first, and it removed a still-`member` account. That
is the phantom that made an earlier read of this bug look like a policy failure.

The fix is `keepalive: true` on mutation requests, plus a per-subject in-flight
set surfaced as `data-pending` and used to disable a row's own controls while
its write is unanswered. Optimistic rendering is unchanged — it is the product
behaviour, and the point was never to remove it but to stop treating it as
evidence.

`e2e/README.md` now documents `data-pending` as part of the test-id contract,
because the deeper lesson generalises: an added member and an
added-member-whose-request-was-cancelled look identical, so any spec downstream
of a mutation must wait for the acknowledgement rather than for the pixels.

### D22 — Open: `POST /api/issues` pre-gates on team membership

One e2e test remains `fixme`, and it is a genuine gap rather than a flake.

A project member who is not in the project's team can open and edit the
project, but cannot file an issue into it: `POST /api/issues` calls
`canViewTeam(actor, team)` before consulting `issue.create`, and refuses with
`403`. The policy matrix grants `proj:member` on both rows — that is D8 — so
the pre-gate is broader than the rule it guards.

Left open deliberately. Closing it means changing where team scoping is
enforced for issue creation, which is an authorization change and deserves its
own change rather than a hurried one at the end of a build.

### D15 — Research captures from the authenticated app are not committed

The visual-research lane found the browser already signed in to a real
workspace, so its highest-fidelity references are screenshots and DOM dumps of
live company issues — team names, issue titles, member avatars.

They are the best reference material in the project and the one thing that must
not be pushed, because this repository is public. They are gitignored; the
design tokens and geometry measured from them live on in
`research/01-visual-design.md`, which was the durable part anyway.
