# End-to-end tests

## The test-id contract

These specs address the UI through `data-testid`, not through text or CSS
classes. Copy changes constantly in a product like this, and a suite that
asserts on prose becomes a suite that fails for the wrong reasons — the sibling
project `pufferfish` ended up with e2e specs asserting literal marketing
sentences, which made every copy edit a red build.

Components must expose these ids. They are the contract; adding to it is free,
renaming one is a breaking change.

### Shell

| id | on |
|---|---|
| `sidebar` | the navigation rail |
| `sidebar-team-{KEY}` | a team entry |
| `sidebar-teams` | the "Your teams" section |
| `workspace-switcher` | the top-left workspace button |
| `theme-toggle` | theme control |
| `command-palette` | the ⌘K overlay |
| `command-palette-input` | its search field |
| `toast` | any toast |
| `toast-undo` | a toast's undo action |

### Issues

| id | on |
|---|---|
| `issue-list` | the list container |
| `issue-row-{IDENTIFIER}` | one row, e.g. `issue-row-ENG-12` |
| `issue-row-title` | the title inside a row |
| `issue-group-{name}` | a group header |
| `issue-board` | the board container |
| `board-column-{name}` | one column |
| `new-issue-button`, `new-issue-modal`, `new-issue-title`, `new-issue-submit` | creation |
| `issue-title`, `issue-description` | detail pane |
| `issue-property-status`, `issue-property-priority`, `issue-property-assignee`, `issue-property-labels`, `issue-property-project` | the properties rail |
| `issue-activity` | the activity feed |
| `comment-composer`, `comment-submit`, `comment-{id}` | comments |
| `status-picker`, `priority-picker`, `assignee-picker`, `label-picker` | the popovers |
| `picker-option-{value}` | an option inside any picker |

### Projects, teams, members

| id | on |
|---|---|
| `project-list`, `project-card-{slug}` | project list |
| `project-header`, `project-issues`, `project-members`, `project-milestones` | project detail |
| `project-add-member`, `project-member-{email}` | project membership |
| `members-table`, `member-row-{email}`, `member-role-{email}` | workspace members |
| `invite-button`, `invite-modal`, `invite-email`, `invite-role`, `invite-submit`, `invite-link` | invitations |
| `team-settings`, `team-members`, `team-add-member` | team settings |

### `data-pending`, and why a spec has to wait for it

`members-table` and `project-members` also carry `data-pending="true" | "false"`,
and so does each of their rows. It answers one question: **is there a write on
this surface the server has not answered yet?**

Both surfaces are optimistic — the role changes, the member appears, before
anything has been asked. That is the product behaviour and specs should assert
it. What a spec must not do is treat the optimistic state as *evidence*: an added
member and an added-member-whose-`POST`-the-browser-cancelled look exactly the
same, and a spec that ends there leaves the next spec opening a project nobody
was actually added to. Anything downstream of a mutation — a reload, a different
user signing in, another spec in the same serial file — waits for:

```ts
await expect(page.getByTestId("project-members")).toHaveAttribute(
  "data-pending",
  "false",
);
```

### Auth

| id | on |
|---|---|
| `signin-email`, `signin-password`, `signin-submit`, `signin-error` | sign in |
| `signup-name`, `signup-email`, `signup-password`, `signup-submit` | sign up |
| `accept-invite-submit` | invite acceptance |

## Fixtures

`fixtures.ts` provides `signIn(page, email)`; the workspace itself is seeded by
`src/lib/seed.ts` when the server boots with `SEED_DEMO_DATA=true`, which
`playwright.config.ts` sets.

| email | workspace role | teams |
|---|---|---|
| `owner@demo.test` | owner | Engineering, Design, Operations |
| `admin@demo.test` | admin | Engineering, Design |
| `member@demo.test` | member | Engineering, Operations |
| `guest@demo.test` | guest | Engineering only |

All with password `demo1234`.

**Design (`DES`) is private**, and neither the member nor the guest is in it —
so it carries two assertions at once: a guest is scoped to their own teams, and
a private team is invisible even to a full workspace member.

### The project fixture the permission journey turns on

Every other seeded project touches Engineering, and the guest is in
Engineering, so the guest can reach them all through team membership. **Website
Redesign (`website-redesign`) lives entirely inside the private Design team**
and the guest is deliberately not a member of it.

That makes it the only project in the workspace the guest genuinely cannot see,
and therefore the test for this clone's one deliberate divergence from Linear
(`DECISIONS.md` D8): adding someone as a *project* member grants access to a
project whose team they will never join, and removing them takes it away.
