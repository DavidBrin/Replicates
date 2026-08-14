# Lane E — Open-source architecture & permissions

Research for the Linear clone (Next.js App Router + Postgres, Vercel free tier).
Everything below is read from the actual source of the projects cited, not from
their marketing pages. File paths and line numbers refer to the commits fetched
on 2026-08-13.

---

## 1. Landscape comparison

### 1.1 The hierarchy, product by product

| Product | Top scope | Middle scope | Container | Leaf | Membership tables | Role enum |
|---|---|---|---|---|---|---|
| **Linear** (target) | Workspace | **Team** — owns issue identifier prefix, workflow states, cycles, labels, triage | Project (may span several teams) | Issue — belongs to exactly one team, optionally one project | workspace member + team member + project member | Owner / Admin / Member / Guest, plus a team-level **Team Owner** |
| **Plane** | `workspaces` | *(none)* — `teams` exists but is a flat **member group**, not an issue container | `projects` — owns `identifier`, `states`, `labels`, `cycles`, `modules` | `issues` — FK to project + workspace | `workspace_members`, `project_members`, `project_public_members`, `workspace_member_invites`, `project_member_invites` | `(20 Admin, 15 Member, 5 Guest)` — the **same enum at both scopes** |
| **Tegon** | `Workspace` | `Team` — owns `identifier`, `Workflow` (states), `Cycle`, `Label` | `Project` — workspace-scoped, links to teams via `teams String[]` | `Issue` — required `teamId`, optional `projectId` | `UsersOnWorkspaces` **only**; team membership is `teamIds String[]` on that row | `Role { ADMIN, USER, BOT, AGENT }`, `@default(ADMIN)` |
| **Huly / Tracker** | Workspace (separate account service) | `Project extends TaskProject extends Space` — the project *is* the security space; owns `identifier` + `sequence` | Component / Milestone | `Issue extends Task` | Space members + `RolesAssignment = Record<Ref<Role>, AccountUuid[]>` | `AccountRole` ×7 + per-space `Role` docs + `Permission` docs |
| **Vikunja** | *(user)* | `Project` — self-nesting via `parent_project_id` | `ProjectView` (list / gantt / table / kanban) + `Bucket` | `Task` | `users_projects`, `team_projects`, `team_members` | `Permission int`: Read=0, Write=1, Admin=2 |
| **Focalboard** | Team (Mattermost team) | `Board` | *(card groups are just property values)* | Card (a `block`) | `board_members` | **four booleans** + a board-level `MinimumRole` |
| **OpenProject** | *(instance)* | `Project` (nestable) | Type / Version | Work package | `members` + `member_roles` | DB rows: `roles` + `role_permissions` |
| **Taiga** | *(user)* | `Project` | Milestone / Sprint | US / Task / Issue | `memberships` → per-project `roles` | Roles are **per-project rows**, plus `anon_permissions` / `public_permissions` arrays on the project |
| **Notion** | Workspace | **Teamspace** | Page tree | Block | workspace members, teamspace members, page permissions | Owner / Membership admin / Member / Guest, plus page-level Full access / Edit / Comment / View |
| **Jira** | Site | Project | Board / Sprint | Issue | project **roles** (per-project actor lists) | Permission **scheme**: permission key → list of grant types (role, group, user, "reporter", "assignee") |
| **GitHub Projects (v2)** | Org | Project | View | Item | project collaborators | org **base role** (none/read/write/admin) ∪ individual read/write/admin |
| **GitLab** | Group (nestable) | Project | — | Issue | group members + project members | Guest 10 / Planner / Reporter 20 / Developer 30 / Maintainer 40 / Owner 50 |

### 1.2 Where each diverges from Linear, and what it costs them

**Plane has no team layer.** `Project` hangs directly off `Workspace`
(`apps/api/plane/db/models/project.py:75`). Everything Linear puts on a team —
workflow states, labels, cycles, the issue-key prefix — Plane puts on the
project: `State(ProjectBaseModel)` with `unique_together = ["name", "project"]`
(`state.py:79,104`), `identifier` unique per `(identifier, workspace)`
(`project.py:76,151`). The consequence: **you cannot have two projects share a
workflow**, and an issue can never move between projects without a state
remap. Plane's `teams` table (`workspace.py:261`) is a name + description with
no issues, no states and no membership FK reachable from `Issue` — it is a
grouping of humans for mentions, not a scope.

For our clone this is the single most important structural decision: **keep
Linear's team layer**. Team owns states/labels/identifier/cycle; project is a
cross-team container; issue has a required `team_id` and an optional
`project_id` (exactly Tegon's `Issue.teamId String` / `projectId String?`,
`schema.prisma:327-331`).

**Tegon got the hierarchy right and the membership wrong.** `Team` is a real
scope with its own `Workflow` (states) — `Workflow { position Int, category
WorkflowCategory, teamId }`, unique `(name, teamId)` (`schema.prisma:810-826`).
But there is **no team-membership table at all**: `UsersOnWorkspaces.teamIds
String[]` (line 778) and `Project.teams String[]` (line 583). No FK, no role
per team, no `joinedAt`, no `addedBy`. "Who is in team X" is an array-containment
scan. Adding a team role later is a data migration, not a column.

**Huly collapses project and security scope.** A tracker `Project` *is* a
`Space`, and access control is `RolesAssignment = Record<Ref<Role>,
AccountUuid[]>` stored on the space, with `Permission` documents
(`foundations/core/packages/core/src/classes.ts:570-600`) matched against
transaction classes. It is genuinely flexible and completely unanswerable at
compile time — you cannot ask "what can a Guest do?" without booting the model
graph.

**Vikunja and Focalboard have no workspace tier at all**, so they solve a
different problem (`Project` is the only scope; sharing is per-project ACL).
Their value to us is elsewhere: Vikunja for **ordering** (§5) and Focalboard for
what *not* to do with a role type.

**GitLab gives us the inheritance rule we should copy**: "Users always retain
the permissions for their highest role" — a Maintainer of the parent group is a
Maintainer of every child project even if assigned lower there. That is *union /
max* semantics, and it is what makes a permission table with one column per role
scope evaluable by simple OR. GitHub Projects does the same thing with a
different vocabulary: an org **base role** for every member, unioned with
individual collaborator grants.

**Notion and Linear both agree on the guest shape**: a guest is not a
lesser workspace member, it is a principal with *no workspace-scope grants at
all* whose entire access comes from explicit container membership. Linear's docs:
guests "access issues, projects, and documents for the teams they are explicitly
added to" and cannot "view workspace-wide features such as workspace views,
customer requests, or initiatives." We model that literally in §2 — the
`ws:GUEST` column is denied nearly everywhere, and guests draw their power from
the `team:MEMBER` / `proj:MEMBER` columns. The requirement "a guest can only see
teams/projects they're explicitly added to" then falls out of the table instead
of being a special case in code.

### 1.3 Two Plane details worth stealing outright

1. **Soft delete with partial unique indexes.** Every Plane model carries
   `deleted_at` and pairs `unique_together = [..., "deleted_at"]` with a real
   partial constraint:
   ```python
   models.UniqueConstraint(
       fields=["workspace", "member"],
       condition=models.Q(deleted_at__isnull=True),
       name="workspace_member_unique_workspace_member_when_deleted_at_null",
   )
   ```
   (`workspace.py:217-223`). This is the correct way to let a removed member be
   re-invited without resurrecting the old row. Copy it for
   `workspace_members`, `team_members`, `project_members`, `invitations`.

2. **Soft-deleting the workspace renames the slug.** `Workspace.delete()`
   appends the deletion epoch to the slug (`workspace.py:156-176`) so the slug
   is immediately reusable. Cheap, and it removes a whole class of "slug is
   taken by a workspace you can't see" support tickets.

---

## 2. Recommended permission model

### 2.1 Scopes and role enums

Three membership tables, three enums. Nothing else grants anything.

```
workspace_members (workspace_id, user_id, role, status, joined_at, invited_by)
    role   ∈ OWNER | ADMIN | MEMBER | GUEST
    status ∈ ACTIVE | SUSPENDED          -- Plane's `is_active`, named honestly

team_members     (team_id, user_id, role, joined_at, added_by)
    role   ∈ ADMIN | MEMBER              -- "Team owner" in the UI = ADMIN here

project_members  (project_id, user_id, role, joined_at, added_by)
    role   ∈ LEAD | MEMBER
```

Ranks, used only by the escalation rules (§2.3), never by the matrix:

| scope | rank |
|---|---|
| workspace | `GUEST 0 < MEMBER 10 < ADMIN 20 < OWNER 30` |
| team | `MEMBER 10 < ADMIN 20` |
| project | `MEMBER 10 < LEAD 20` |

Numeric ranks are deliberately *sparse* (Huly's `roleOrder`, GitLab's 10/20/30/40/50)
so a tier can be inserted later without a data migration. Unlike Plane, the rank
is **not** the stored value — the column stores the string enum, and the rank is
a derived lookup. Plane stores `20 / 15 / 5` in the database and has to keep four
copies of the mapping in sync (§7.1).

**Effective grant = union over held roles** (GitLab's "highest role wins"). An
actor's held role keys for a given resource are: their workspace role, plus their
team role in the resource's team if any, plus their project role in the
resource's project if any. If *any* held key grants the action, it is allowed.
Deny by default.

Two things sit outside the union and are checked first, as preconditions:

- `workspace_members.status = SUSPENDED` → deny everything, always.
- No `workspace_members` row at all → deny everything, always. (Not even a
  project membership rescues you; there is no such thing as a project member who
  is not a workspace principal.)

### 2.2 The full permission matrix

Columns are role keys. A cell answers **"does holding *only* this role grant
this action?"** Grant the action if any column the actor holds says ✅.

`–` means the role does not reach this resource kind at all. It behaves exactly
like ⛔ in code; it is shown separately so the table reads as intent rather than
oversight.

| # | Action | `ws:OWNER` | `ws:ADMIN` | `ws:MEMBER` | `ws:GUEST` | `team:ADMIN` | `team:MEMBER` | `proj:LEAD` | `proj:MEMBER` |
|---|---|---|---|---|---|---|---|---|---|
| | **Workspace** | | | | | | | | |
| 1 | `workspace.view` | ✅ | ✅ | ✅ | ✅ ¹ | – | – | – | – |
| 2 | `workspace.update` (name, logo, slug) | ✅ | ✅ | ⛔ | ⛔ | – | – | – | – |
| 3 | `workspace.delete` | ✅ | ⛔ | ⛔ | ⛔ | – | – | – | – |
| 4 | `workspace.transfer_ownership` | ✅ | ⛔ | ⛔ | ⛔ | – | – | – | – |
| 5 | `workspace.view_members` | ✅ | ✅ | ✅ | ⛔ | – | – | – | – |
| 6 | `workspace.view_audit_log` | ✅ | ✅ | ⛔ | ⛔ | – | – | – | – |
| 7 | `workspace_label.manage` | ✅ | ✅ | ⛔ | ⛔ | – | – | – | – |
| | **Membership** | | | | | | | | |
| 8 | `member.invite` | ✅ | ✅ | ✅ ² | ⛔ | – | – | – | – |
| 9 | `member.remove` | ✅ | ✅ ³ | ⛔ | ⛔ | – | – | – | – |
| 10 | `member.change_role` | ✅ | ✅ ³ | ⛔ | ⛔ | – | – | – | – |
| 11 | `member.leave` (self) | ✅ ⁴ | ✅ | ✅ | ✅ | – | – | – | – |
| 12 | `invite.revoke` | ✅ | ✅ | ✅ ⁵ | ⛔ | – | – | – | – |
| | **Team** | | | | | | | | |
| 13 | `team.create` | ✅ | ✅ | ✅ ⁶ | ⛔ | – | – | – | – |
| 14 | `team.view` — public team | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | – | – |
| 15 | `team.view` — private team | ✅ ⁷ | ✅ ⁷ | ⛔ | ⛔ | ✅ | ✅ | – | – |
| 16 | `team.join` (self, public team) | ✅ | ✅ | ✅ | ⛔ | – | – | – | – |
| 17 | `team.update` (settings, identifier) | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | – | – |
| 18 | `team.set_private` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | – | – |
| 19 | `team.delete` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | – | – |
| 20 | `team.add_member` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ ⁸ | – | – |
| 21 | `team.add_guest` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | – | – |
| 22 | `team.remove_member` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | – | – |
| 23 | `team.change_member_role` | ✅ | ✅ | ⛔ | ⛔ | ✅ ⁹ | ⛔ | – | – |
| 24 | `state.manage` (workflow states) | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | – | – |
| 25 | `label.create` (team label) | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ | – | – |
| 26 | `label.update_delete` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | – | – |
| 27 | `cycle.manage` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | – | – |
| | **Project** | | | | | | | | |
| 28 | `project.create` | ✅ | ✅ | ⛔ ¹⁰ | ⛔ | ✅ | ✅ | – | – |
| 29 | `project.view` | ✅ | ✅ | ✅ ¹¹ | ⛔ | ✅ | ✅ | ✅ | ✅ |
| 30 | **`project.update`** | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | ✅ | **✅** |
| 31 | `project.archive` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | ✅ | ⛔ |
| 32 | `project.delete` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | ✅ | ⛔ |
| 33 | **`project.add_member`** | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | ✅ | **✅ ¹²** |
| 34 | `project.remove_member` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | ✅ | ⛔ |
| 35 | `project.change_member_role` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | ✅ | ⛔ |
| 36 | `project.add_team` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | ✅ | ⛔ |
| 37 | `project.reorder` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ⛔ | ✅ | ✅ |
| | **Issue** | | | | | | | | |
| 38 | `issue.view` | ✅ | ✅ | ✅ ¹¹ | ⛔ | ✅ | ✅ | ✅ | ✅ |
| 39 | `issue.create` | ✅ | ✅ | ✅ ¹¹ | ⛔ | ✅ | ✅ | ✅ | ✅ |
| 40 | `issue.update_own` (author or assignee) | ✅ | ✅ | ✅ ¹³ | ⛔ | ✅ | ✅ | ✅ | ✅ |
| 41 | `issue.update_any` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ | ✅ | ✅ |
| 42 | `issue.reorder` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ | ✅ | ✅ |
| 43 | `issue.delete` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ ¹⁴ | ✅ | ✅ ¹⁴ |
| 44 | `comment.create` | ✅ | ✅ | ✅ ¹¹ | ⛔ | ✅ | ✅ | ✅ | ✅ |
| 45 | `comment.update_delete` | ✅ | ✅ | ✅ ¹⁵ | ⛔ | ✅ | ✅ ¹⁵ | ✅ | ✅ ¹⁵ |
| | **Views** | | | | | | | | |
| 46 | `view.create_personal` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 47 | `view.create_shared` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ | ✅ | ✅ |
| 48 | `view.update_delete_shared` | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ ¹⁵ | ✅ | ✅ ¹⁵ |

**Footnotes (these are the conditions; each becomes a predicate function, §3.3)**

1. The app shell and their own account settings only. A guest has **no**
   workspace-scope read: no member list, no workspace views, no search across
   teams they are not in.
2. Governed by `workspace.settings.memberInvitePolicy` — `ADMINS_ONLY`
   (default) | `ANY_MEMBER`. A member may only ever invite at rank ≤ `MEMBER`
   (never ADMIN, never OWNER, never GUEST — guests are invited by admins or
   team admins so the team scoping is decided at invite time).
3. Never against a principal whose workspace rank ≥ the actor's own, and never
   the last `OWNER`. See §2.3.
4. Only if another `ACTIVE` `OWNER` remains.
5. Only invitations the member themselves created.
6. Governed by `workspace.settings.teamCreatePolicy` — `ANY_MEMBER` (default) |
   `ADMINS_ONLY`. The creator becomes `team:ADMIN` of the new team.
7. May *list* the private team in admin settings and may self-join
   (audit-logged, and the team admins are notified). May **not** read its
   issues, projects, comments or activity until a `team_members` row exists.
   This is Linear's paid-plan behaviour and it is the honest compromise: an
   admin who can grant themselves access should have to take the action and
   leave a trace, rather than reading silently.
8. Governed by `team.settings.membershipPolicy` — `ANY_MEMBER` (default) |
   `ADMINS_ONLY`. A `team:MEMBER` may only add an existing workspace `MEMBER`,
   at `team:MEMBER`. Never a guest, never at `team:ADMIN`.
9. Never the last `team:ADMIN` of that team.
10. A workspace member who belongs to no team has no project scope. Joining a
    public team (row 16) grants it. This is intentional: projects are owned by
    teams, so "create a project" is a team-scope action.
11. Only where **every** team attached to the resource is public. A single
    private team on a project makes the project invisible to non-members.
12. May add existing workspace `MEMBER`s at `proj:MEMBER` only. May not grant
    `proj:LEAD`, may not add a guest, may not add a team. This is the
    narrowest grant that satisfies "they can both add to and edit the project
    if added to it" without letting a project member quietly hand out lead.
13. Only issues they authored or are assigned to, in a public team.
14. Only issues they authored.
15. Only their own comments / their own shared views.

**Design principles the table encodes**, stated so future rows are decidable:

- **Read follows visibility; write follows membership.** A workspace member can
  read and file into any public team, but editing someone else's issue or
  reordering a board requires being in the team or the project.
- **Destructive actions need an admin or the author.** Delete is never a plain
  member grant except for your own objects.
- **A guest's column is empty by construction.** Every guest capability arrives
  through `team:*` / `proj:*`.
- **Policy toggles are settings, not code.** Rows 8, 13 and 20 read a stored
  workspace/team setting. Those settings are the *only* configurable cells; the
  rest are fixed so the matrix stays a matrix.

### 2.3 Escalation rules and edge cases

These are **not** matrix cells — they are invariants on role *transitions*, and
they need their own function returning a *reason*, not a boolean, because the UI
has to explain the refusal.

**R1 — No grant above your own rank.**
`rank(newRole) ≤ rank(actorRole)` at the same scope. An `ADMIN` cannot mint an
`OWNER`. A `team:MEMBER` acting under footnote 8 cannot mint a `team:ADMIN`.

**R2 — No action against an equal or higher rank.**
For `member.remove` and `member.change_role`: `rank(actorRole) > rank(targetCurrentRole)`.
Consequence: an `ADMIN` may not remove or demote another `ADMIN` or the `OWNER`.
Only an `OWNER` can act on an `ADMIN`.

**R3 — Admin-to-admin promotion is allowed but one-way.**
An `ADMIN` may promote a `MEMBER` to `ADMIN` (R1 holds: equal rank), and by R2
immediately loses power over them. This is Linear's behaviour and it is a real
privilege-proliferation risk. Expose it as
`workspace.settings.adminCanPromoteToAdmin` (default `true`); when `false`, only
an `OWNER` may create admins.

**R4 — The last owner is immovable.**
`OWNER` count in a workspace must never reach zero. Concretely, all four of
these must fail when `activeOwnerCount === 1` and the target is that owner:
`member.remove`, `member.change_role` (to anything lower), `member.leave`, and
deleting the user account. GitLab states the same rule: "Any user can remove
themselves from a group, unless they are the only Owner of the group."

> **Concurrency, and this is the bug everyone ships:** two simultaneous
> "demote owner A" / "demote owner B" requests each read `count = 2`, each
> pass the check, and the workspace ends with zero owners. The check must run
> inside the same transaction as the write, serialized on the parent:
> `SELECT id FROM workspaces WHERE id = $1 FOR UPDATE` before counting. This
> is exactly Vikunja's `lockPositionsForViewUpdate` pattern
> (`pkg/models/task_position.go:162-170`) applied to membership. Back it with a
> `CHECK`-equivalent trigger or a deferred constraint as a second line of
> defence, and write a concurrent test that runs both demotions in parallel.

**R5 — The last team admin is immovable, per team.** Same mechanic, same lock,
scoped to `team_id`. Rationale: a team with no admin cannot change its own
states or membership and needs a workspace admin to rescue it.

**R6 — There is no "last project lead" rule.** `proj:LEAD` is optional; a
project may legitimately have zero leads because team admins and workspace
admins can still administer it. Do not invent a rule here; it only produces
un-deletable memberships.

**R7 — Guests cannot hold `team:ADMIN` or `proj:LEAD`.** Enforced on the
transition, not on read: promoting a principal whose workspace role is `GUEST`
to a container admin role is rejected with `GUEST_CANNOT_HOLD_ROLE`. Conversely,
demoting a workspace `MEMBER` who holds `team:ADMIN` down to `GUEST` must
simultaneously demote those container roles to `MEMBER` in the same transaction
— otherwise the demotion silently leaves an escalated principal.

**R8 — Leaving is a distinct action from being removed.**
`member.leave` / `team.leave` / `project.leave` take no target; the target is
always the actor. Keeping them separate means R2 never needs a "unless it's
yourself" carve-out, which is the usual source of the "an admin can demote
themselves but not another admin, except sometimes" bug. Rules on leaving:
- Anyone may leave a workspace except the last owner (R4).
- Anyone may leave a team except the last team admin (R5).
- Anyone may leave a project, always.
- Leaving a **private** team means you cannot rejoin without a new invite —
  there is no self-join path for private teams (row 16 is public-only). Linear
  behaves the same way: "Members of a private team can leave the team on their
  own, but they won't be able to re-join the team without an explicit invite."

**R9 — Suspension beats everything.** A `SUSPENDED` workspace membership denies
every action including `member.leave`, and its container memberships are left
intact so reinstating is one column update. Plane models this as
`is_active` on both `WorkspaceMember` and `ProjectMember`
(`workspace.py:210`, `project.py:224`) and it is genuinely useful — but Plane
checks it in every single query by hand, which is exactly the mistake §3 avoids.

**R10 — Ownership transfer is atomic.** `workspace.transfer_ownership` is one
transaction: target → `OWNER`, actor → `ADMIN` (not `MEMBER`; demoting yourself
out of admin during a transfer is a footgun). Two owners existing simultaneously
is fine and is in fact how you get a second owner: promote to `OWNER` (R1
requires the actor be `OWNER`), which is a separate action from transfer.

**R11 — Removing a member cascades, softly.** Removing someone from a workspace
soft-deletes their `team_members` and `project_members` rows in the same
transaction, reassigns nothing, and leaves authored issues/comments intact with
the author FK pointing at a still-existing user row. Never hard-delete a user
who authored anything. (Plane's `Workspace.owner` FK is
`on_delete=models.CASCADE` — deleting the owner user deletes the workspace.
Don't.)

---

## 3. Authorization module design

### 3.1 Shape

One module, `src/domain/authz/`, four files, zero I/O:

```
src/domain/authz/
  roles.ts      role enums, rank tables, RoleKey union
  actions.ts    the Action union
  facts.ts      AuthzFacts — every membership fact can() may need
  policy.ts     the POLICY table (the §2.2 matrix, transcribed)
  can.ts        can(), assertCan(), the transition rules (R1–R11)
  scope.ts      readScopeFor() — the list-query counterpart to can()
```

`can()` is **pure and synchronous**. Route handlers do the I/O, assemble
`AuthzFacts`, and pass plain data in. This is the same split the sibling `bet`
project uses (`src/domain/authz.ts`: *"`can()` is pure: no I/O, no store access.
Every fact it needs about membership/ownership/state is precomputed by the
caller"*) and we should stay consistent with it.

### 3.2 Roles and actions as closed unions

```ts
// src/domain/authz/roles.ts
export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'GUEST'] as const;
export const TEAM_ROLES      = ['ADMIN', 'MEMBER'] as const;
export const PROJECT_ROLES   = ['LEAD', 'MEMBER'] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type TeamRole      = (typeof TEAM_ROLES)[number];
export type ProjectRole   = (typeof PROJECT_ROLES)[number];

/** Sparse on purpose: a tier can be inserted without renumbering. */
export const WORKSPACE_RANK = { GUEST: 0, MEMBER: 10, ADMIN: 20, OWNER: 30 }
  as const satisfies Record<WorkspaceRole, number>;
export const TEAM_RANK    = { MEMBER: 10, ADMIN: 20 } as const satisfies Record<TeamRole, number>;
export const PROJECT_RANK = { MEMBER: 10, LEAD: 20 }  as const satisfies Record<ProjectRole, number>;

/** One column of the §2.2 matrix. Template-literal types keep it in lockstep
 *  with the three enums above — add a role, get a compile error in policy.ts. */
export type RoleKey =
  | `ws:${WorkspaceRole}`
  | `team:${TeamRole}`
  | `proj:${ProjectRole}`;

export const ROLE_KEYS = [
  ...WORKSPACE_ROLES.map((r) => `ws:${r}` as const),
  ...TEAM_ROLES.map((r) => `team:${r}` as const),
  ...PROJECT_ROLES.map((r) => `proj:${r}` as const),
] as const satisfies readonly RoleKey[];
```

```ts
// src/domain/authz/actions.ts — rows of the matrix, in matrix order
export const ACTIONS = [
  'workspace.view', 'workspace.update', 'workspace.delete',
  'workspace.transfer_ownership', 'workspace.view_members',
  'workspace.view_audit_log', 'workspace_label.manage',
  'member.invite', 'member.remove', 'member.change_role', 'member.leave',
  'invite.revoke',
  'team.create', 'team.view', 'team.view_private', 'team.join',
  'team.update', 'team.set_private', 'team.delete',
  'team.add_member', 'team.add_guest', 'team.remove_member',
  'team.change_member_role',
  'state.manage', 'label.create', 'label.update_delete', 'cycle.manage',
  'project.create', 'project.view', 'project.update', 'project.archive',
  'project.delete', 'project.add_member', 'project.remove_member',
  'project.change_member_role', 'project.add_team', 'project.reorder',
  'issue.view', 'issue.create', 'issue.update_own', 'issue.update_any',
  'issue.reorder', 'issue.delete',
  'comment.create', 'comment.update_delete',
  'view.create_personal', 'view.create_shared', 'view.update_delete_shared',
] as const;

export type Action = (typeof ACTIONS)[number];
```

### 3.3 Facts

```ts
// src/domain/authz/facts.ts
export interface AuthzFacts {
  readonly actorId: UserId | null;

  /** null = no workspace_members row at all. */
  readonly workspaceRole: WorkspaceRole | null;
  readonly membershipStatus: 'ACTIVE' | 'SUSPENDED' | null;
  readonly settings: WorkspacePolicySettings;

  /** Present when the resource lives in (or is) a team. */
  readonly team?: {
    readonly id: TeamId;
    readonly actorRole: TeamRole | null;
    readonly isPrivate: boolean;
    readonly membershipPolicy: 'ANY_MEMBER' | 'ADMINS_ONLY';
    /** For R5. */
    readonly adminCount: number;
  };

  /** Present when the resource lives in (or is) a project. */
  readonly project?: {
    readonly id: ProjectId;
    readonly actorRole: ProjectRole | null;
    /** Footnote 11: a single private team hides the project. */
    readonly allTeamsPublic: boolean;
  };

  /** Present for issue/comment/view resources. */
  readonly object?: {
    readonly authorId: UserId;
    readonly assigneeId: UserId | null;
  };

  /** Present only for member.* actions. */
  readonly target?: {
    readonly userId: UserId;
    readonly workspaceRole: WorkspaceRole;
    readonly isSelf: boolean;
  };

  /** For R4. Counts ACTIVE OWNER rows, read under the workspace row lock. */
  readonly activeOwnerCount?: number;
}
```

Every optional field is optional because *some* actions do not need it. A cell
predicate that reads a missing fact must fail closed, never throw — so
predicates take `AuthzFacts` and use optional chaining with an explicit
`?? false`.

### 3.4 The policy table — every cell filled, enforced by tsc

This is the load-bearing trick. Type the table as
`Record<Action, Record<RoleKey, Cell>>` and apply it with `satisfies`. TypeScript
then rejects:

- a **missing action row** (a new action with no policy),
- a **missing role cell** (a new role with no decision in some row),
- an **unknown action or role key** (a typo, or a role that was deleted).

```ts
// src/domain/authz/policy.ts
export const ALLOW = 'allow' as const;
export const DENY  = 'deny'  as const;

/** A cell is a constant or a named predicate. Predicates are the footnotes. */
export type Predicate = (f: AuthzFacts) => boolean;
export type Cell = typeof ALLOW | typeof DENY | Predicate;

export type PolicyRow = Readonly<Record<RoleKey, Cell>>;

// --- the footnote predicates, one exported const each, individually testable
export const inPublicTeam: Predicate = (f) =>
  f.team?.isPrivate === false;                                       // fn 11
export const projectFullyPublic: Predicate = (f) =>
  (f.project?.allTeamsPublic ?? false) && f.team?.isPrivate !== true; // fn 11
export const isAuthor: Predicate = (f) =>
  f.actorId !== null && f.object?.authorId === f.actorId;            // fn 14, 15
export const isAuthorOrAssignee: Predicate = (f) =>
  isAuthor(f) || (f.actorId !== null && f.object?.assigneeId === f.actorId);
export const authorInPublicTeam: Predicate = (f) =>
  isAuthorOrAssignee(f) && inPublicTeam(f);                          // fn 13
export const memberInvitesAllowed: Predicate = (f) =>
  f.settings.memberInvitePolicy === 'ANY_MEMBER';                    // fn 2
export const memberTeamCreateAllowed: Predicate = (f) =>
  f.settings.teamCreatePolicy === 'ANY_MEMBER';                      // fn 6
export const teamOpenMembership: Predicate = (f) =>
  f.team?.membershipPolicy === 'ANY_MEMBER';                         // fn 8
export const adminMayListPrivateTeam: Predicate = () => true;        // fn 7 — read-listing only

const NOBODY: PolicyRow = {
  'ws:OWNER': DENY, 'ws:ADMIN': DENY, 'ws:MEMBER': DENY, 'ws:GUEST': DENY,
  'team:ADMIN': DENY, 'team:MEMBER': DENY, 'proj:LEAD': DENY, 'proj:MEMBER': DENY,
};
/** Spread helpers keep the 48×8 literal readable without hiding any cell —
 *  every row still lists every key it overrides, and `satisfies` still checks
 *  the merged object. */
const row = (overrides: Partial<PolicyRow>): PolicyRow => ({ ...NOBODY, ...overrides });

export const POLICY = {
  'workspace.view': row({
    'ws:OWNER': ALLOW, 'ws:ADMIN': ALLOW, 'ws:MEMBER': ALLOW, 'ws:GUEST': ALLOW,
  }),
  'workspace.delete': row({ 'ws:OWNER': ALLOW }),
  'member.invite': row({
    'ws:OWNER': ALLOW, 'ws:ADMIN': ALLOW, 'ws:MEMBER': memberInvitesAllowed,
  }),
  'team.add_member': row({
    'ws:OWNER': ALLOW, 'ws:ADMIN': ALLOW,
    'team:ADMIN': ALLOW, 'team:MEMBER': teamOpenMembership,
  }),
  'project.update': row({
    'ws:OWNER': ALLOW, 'ws:ADMIN': ALLOW,
    'team:ADMIN': ALLOW, 'proj:LEAD': ALLOW, 'proj:MEMBER': ALLOW,   // ← the requirement
  }),
  'project.add_member': row({
    'ws:OWNER': ALLOW, 'ws:ADMIN': ALLOW,
    'team:ADMIN': ALLOW, 'proj:LEAD': ALLOW, 'proj:MEMBER': ALLOW,   // ← the requirement
  }),
  'issue.update_own': row({
    'ws:OWNER': ALLOW, 'ws:ADMIN': ALLOW, 'ws:MEMBER': authorInPublicTeam,
    'team:ADMIN': ALLOW, 'team:MEMBER': ALLOW,
    'proj:LEAD': ALLOW, 'proj:MEMBER': ALLOW,
  }),
  'issue.delete': row({
    'ws:OWNER': ALLOW, 'ws:ADMIN': ALLOW,
    'team:ADMIN': ALLOW, 'team:MEMBER': isAuthor,
    'proj:LEAD': ALLOW, 'proj:MEMBER': isAuthor,
  }),
  // … one entry per Action, in matrix order …
} as const satisfies Record<Action, PolicyRow>;
```

> **Why `satisfies` and not a type annotation.** `const POLICY: Record<Action,
> PolicyRow> = {…}` also catches missing keys, but it *widens* the value type,
> so you lose the literal types and cannot derive anything from `POLICY`.
> `satisfies` checks the constraint and keeps the literal. Use it.

> **Why `row()` and not eight literal cells per row.** 48 rows × 8 cells written
> out is 384 lines of noise where a wrong cell hides easily. `row()` merges over
> an all-DENY base, and because the *result* is still `satisfies`-checked, a new
> `RoleKey` still breaks the build (in `NOBODY`, one place, which is where you
> want to be forced to make the decision). If the team prefers full explicitness,
> write the cells out — the type does not care.

### 3.5 `can()`

```ts
// src/domain/authz/can.ts
function heldRoleKeys(f: AuthzFacts): RoleKey[] {
  const keys: RoleKey[] = [];
  if (f.workspaceRole) keys.push(`ws:${f.workspaceRole}`);
  if (f.team?.actorRole) keys.push(`team:${f.team.actorRole}`);
  if (f.project?.actorRole) keys.push(`proj:${f.project.actorRole}`);
  return keys;
}

/** Pure. Never throws. Deny by default. */
export function can(action: Action, f: AuthzFacts): boolean {
  // Preconditions (§2.1) — outside the matrix on purpose.
  if (f.actorId === null) return false;
  if (f.workspaceRole === null) return false;
  if (f.membershipStatus !== 'ACTIVE') return false;

  const rowPolicy = POLICY[action];
  for (const key of heldRoleKeys(f)) {
    const cell = rowPolicy[key];
    if (cell === DENY) continue;
    if (cell === ALLOW) return true;
    if (cell(f)) return true;          // predicate cell
  }
  return false;
}
```

Note what is *not* here: no database, no `await`, no `request`, no HTTP verb.
Plane's permission classes branch on `request.method in SAFE_METHODS` and
`request.method == "POST"` (`apps/api/plane/app/permissions/project.py:19,25,62,70`)
— the policy is expressed in terms of the transport. Ours is expressed in terms
of domain actions, so a new endpoint cannot accidentally inherit a policy that
was written for a different verb.

### 3.6 Denials with reasons, and the transition rules

`can()` returns a boolean because the matrix is a boolean table. The transition
rules (R1–R11) need to explain themselves:

```ts
export type Denial =
  | { code: 'NOT_A_MEMBER' }
  | { code: 'MEMBERSHIP_SUSPENDED' }
  | { code: 'INSUFFICIENT_ROLE'; action: Action }
  | { code: 'RANK_NOT_ABOVE_TARGET'; targetRole: WorkspaceRole }
  | { code: 'CANNOT_GRANT_ABOVE_OWN_RANK'; requested: WorkspaceRole }
  | { code: 'LAST_OWNER' }
  | { code: 'LAST_TEAM_ADMIN'; teamId: TeamId }
  | { code: 'GUEST_CANNOT_HOLD_ROLE'; role: TeamRole | ProjectRole };

export type Authorized<T = void> =
  | { ok: true; value: T }
  | { ok: false; denial: Denial };

/** R1–R4, R7. Pure; `activeOwnerCount` must be read under the workspace lock. */
export function checkWorkspaceRoleChange(
  actorRole: WorkspaceRole,
  target: { currentRole: WorkspaceRole; isSelf: boolean },
  nextRole: WorkspaceRole,
  activeOwnerCount: number,
  settings: WorkspacePolicySettings,
): Authorized {
  const a = WORKSPACE_RANK[actorRole];

  // R4 — last owner, checked first so it wins over every other message.
  if (target.currentRole === 'OWNER' && nextRole !== 'OWNER' && activeOwnerCount <= 1)
    return { ok: false, denial: { code: 'LAST_OWNER' } };

  // R2 — never act on an equal or higher rank (self-demotion is R8's `leave`
  // or an explicit self-change, handled by the isSelf carve-out below).
  if (!target.isSelf && WORKSPACE_RANK[target.currentRole] >= a)
    return { ok: false, denial: { code: 'RANK_NOT_ABOVE_TARGET', targetRole: target.currentRole } };

  // R1 — never grant above your own rank.
  if (WORKSPACE_RANK[nextRole] > a)
    return { ok: false, denial: { code: 'CANNOT_GRANT_ABOVE_OWN_RANK', requested: nextRole } };

  // R3 — optional tightening.
  if (nextRole === 'ADMIN' && actorRole === 'ADMIN' && !settings.adminCanPromoteToAdmin)
    return { ok: false, denial: { code: 'CANNOT_GRANT_ABOVE_OWN_RANK', requested: nextRole } };

  return { ok: true, value: undefined };
}
```

`assertCan(action, facts)` throws a typed `AuthzError(denial)`; the route layer
maps it. Follow the sibling `bet` convention: the *route* decides 403 vs 404, not
the policy (`src/lib/http.ts`'s `authorizeOr404`). Rule of thumb: for
existence-sensitive resources (a private team, an issue in a team you cannot
see) a denial must render as **404**, or the API becomes an existence oracle.
For resources the actor can already see (demoting an admin you can list) it is
**403** with the `Denial.code` in the body.

### 3.7 The other half: read scope

`can()` answers a question about **one** resource. Every list endpoint needs the
*set*. If you only build `can()`, someone will fetch all issues and filter in
JavaScript — which leaks through pagination counts and is O(workspace).

```ts
// src/domain/authz/scope.ts
export type ReadScope =
  /** Workspace member or above: everything except private teams they're not in. */
  | { kind: 'workspaceWide'; workspaceId: WorkspaceId; extraPrivateTeamIds: TeamId[] }
  /** Guest: exactly these containers, nothing else. */
  | { kind: 'explicit'; teamIds: TeamId[]; projectIds: ProjectId[] };

export function readScopeFor(f: AuthzFacts, memberships: Memberships): ReadScope { … }
```

Every repository list method takes a `ReadScope` and **never a bare `UserId`**.
That makes "a guest sees only their teams" an obligation the type system puts on
every query, instead of a rule someone has to remember. Plane gets this right in
spirit — its permission classes comment *"Safe Methods -> Handle the filtering
logic in queryset"* — but the coupling is by convention only: the permission
class and the queryset filter are two independent hand-written predicates that
must agree.

---

## 4. Invitations without an email provider

Vercel free tier means no SMTP, no background worker, no Redis. Everything below
runs in a request handler against Postgres.

### 4.1 Schema

```sql
CREATE TABLE invitations (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('DIRECT','LINK')),
  email          citext,                        -- NULL for LINK invites
  role           text NOT NULL,                 -- workspace role to grant
  token_hash     bytea NOT NULL,                -- sha256(raw token)
  token_cipher   bytea,                         -- LINK only; see §4.3
  created_by     uuid NOT NULL REFERENCES users(id),
  expires_at     timestamptz NOT NULL,
  max_uses       integer,                       -- NULL = unlimited (LINK only)
  use_count      integer NOT NULL DEFAULT 0,
  accepted_at    timestamptz,
  accepted_by    uuid REFERENCES users(id),
  revoked_at     timestamptz,
  deleted_at     timestamptz
);
CREATE UNIQUE INDEX invitations_token_hash_key ON invitations (token_hash);
-- one live DIRECT invite per (email, workspace) — Plane's partial-index pattern
CREATE UNIQUE INDEX invitations_unique_live_direct
  ON invitations (workspace_id, email)
  WHERE kind = 'DIRECT' AND accepted_at IS NULL AND revoked_at IS NULL AND deleted_at IS NULL;

-- which containers the invitee lands in; a real table, not Tegon's `teamIds String[]`
CREATE TABLE invitation_teams (
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_role     text NOT NULL DEFAULT 'MEMBER',
  PRIMARY KEY (invitation_id, team_id)
);
CREATE TABLE invitation_projects ( … same shape … );
```

Plane's `WorkspaceMemberInvite` (`workspace.py:234-255`) has exactly
`email / accepted / token / responded_at / role` and a unique
`(email, workspace)` partial index — that part is right and we copy it. Tegon's
`Invite` adds `sentAt / expiresAt / status` (`schema.prisma:292-308`) — expiry is
right and we copy that too. Both put team assignment in the wrong place (Plane:
nowhere, so an accepted invite lands you in a workspace with no team; Tegon: a
string array).

### 4.2 Token minting

Follow the sibling `bet` project exactly (`src/app/api/invites/route.ts`):

```ts
export function mintInviteToken(): { token: string; tokenHash: Buffer } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);                 // 256 bits, Web Crypto — edge-safe
  const token = base64url(bytes);                // 43 chars, URL-safe
  return { token, tokenHash: sha256(bytes) };
}
```

- 32 bytes, `crypto.getRandomValues` — never `Math.random`, never a uuid.
- Store `sha256`, look up by hash. A database dump is then not a set of working
  invite links.
- Compare in constant time is unnecessary here **because the lookup is by hash
  index**, not by comparing a stored plaintext — the index lookup is the compare.
- The raw token is returned to the creator exactly once, in the 201 response.

### 4.3 The re-display problem, and the honest answer

Hash-only storage means the link cannot be shown again. That is fine for a
one-shot personal invite and wrong for a shareable team link, which exists
precisely to be copied repeatedly. Split the two:

| | `DIRECT` invite | `LINK` invite |
|---|---|---|
| Storage | `token_hash` only | `token_hash` **and** `token_cipher` |
| Re-display | impossible; "Regenerate link" mints a new token and revokes the old | any admin may re-copy it |
| Role it may grant | any role ≤ the inviter's rank | capped at `MEMBER` — never ADMIN, never OWNER |
| Expiry default | 7 days (`INVITE_EXPIRY_DAYS`) | 30 days or `max_uses`, whichever first |
| Revocation | `revoked_at` | `revoked_at`, plus rotate on any admin removal |

`token_cipher` is AES-GCM under a key from `INVITE_LINK_KEY` (server config,
never `NEXT_PUBLIC_*`). If you would rather not hold reversible secrets at all,
the alternative is to accept that link re-display is not supported and make
"Copy link" always mint-and-replace. Either is defensible; pick one and write it
down. What is **not** defensible is storing the raw token in a plain column and
calling it hashed.

### 4.4 Accepting

`GET /invite/[token]` — a public route, no session required.

1. `sha256(token)` → index lookup. **Any** failure (not found, expired, revoked,
   `use_count >= max_uses`) returns the *same* generic "This invite link is no
   longer valid" page. No distinction, or you have built an oracle for guessing
   workspace slugs.
2. On success render a **preview only**: workspace name, workspace avatar,
   inviter display name, the role being offered, and the team names. Never the
   member list, never issue counts.
3. Signed out → put the raw token in an `httpOnly`, `SameSite=Lax`, 15-minute
   `pending_invite` cookie and redirect to `/signup?next=/invite/<token>`.
   After signup completes, the signup handler reads the cookie, redeems, and
   clears it. This is what "accepting on signup" means concretely, and the
   cookie is why it survives an OAuth round-trip.
4. Signed in as an account whose email does not match a `DIRECT` invite's email
   → do **not** auto-accept. Show "This invite was sent to a@b.com. You are
   signed in as c@d.com." with *Switch account* and *Accept anyway* (the latter
   only if workspace settings allow it; default off).
5. `POST /invite/[token]/accept` — one transaction:
   ```
   BEGIN
     SELECT * FROM invitations WHERE token_hash = $1 FOR UPDATE;   -- serializes double-click
     re-check expiry / revoked / use_count
     INSERT INTO workspace_members (...) ON CONFLICT DO NOTHING;   -- idempotent
     INSERT INTO team_members    SELECT ... FROM invitation_teams   ON CONFLICT DO NOTHING;
     INSERT INTO project_members SELECT ... FROM invitation_projects ON CONFLICT DO NOTHING;
     UPDATE invitations SET use_count = use_count + 1,
            accepted_at = now(), accepted_by = $2                   -- DIRECT only
     INSERT INTO audit_log (...)
   COMMIT
   ```
   The `ON CONFLICT DO NOTHING` against the partial unique index makes a
   double-submit a no-op rather than a duplicate-membership error. Re-accepting
   as an existing member returns 200 and redirects to the workspace.
6. **Role at acceptance is the role stored on the invite**, re-validated against
   R1 using the *inviter's current* rank. An invite minted by an admin who has
   since been demoted must not still grant ADMIN.

### 4.5 Rate limiting without Redis

Token guessing against a 256-bit space is not a real threat, but enumeration
attempts are noise and a free-tier function budget is finite. A Postgres table
is enough:

```sql
CREATE TABLE rate_events (bucket text, window_start timestamptz, count int,
                          PRIMARY KEY (bucket, window_start));
-- INSERT ... ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_events.count + 1
-- RETURNING count;   -- one round trip, atomic
```
Bucket by `invite:<ip>` and `invite:<token_prefix>`, 1-minute windows, 20/min.
Sweep rows older than an hour opportunistically on write. No cron needed.

### 4.6 The mailer is a port from day one

Even with no provider, define it:

```ts
// src/ports/mailer.ts
export interface Mailer {
  send(msg: { to: string; subject: string; body: string }): Promise<void>;
}
// src/adapters/mailer/console.ts   -> logs; the default in the container
// src/adapters/mailer/resend.ts    -> added later, container change only
```

The invite flow calls `mailer.send(...)` and **also** returns the link. With the
console adapter the UI's success state *is* the copyable link, which is the
product on a free host. Swapping in Resend later touches
`src/lib/container.ts` and nothing else.

---

## 5. Ordering / ranking

### 5.1 What the field actually does in these tools

| Tool | Field | Type | Insert strategy | Failure handling |
|---|---|---|---|---|
| Linear | `sortOrder` | float | midpoint | (opaque; the public API exposes the float, and `linear/linear#170` is people asking how to set it safely) |
| Plane | `Issue.sort_order` | `FloatField(default=65535)` | on create: `max(sort_order) + 10000` **within `(project, state)`** (`issue.py:206-210`) | none |
| Plane | `State.sequence` | `FloatField(default=65535)` | `max(sequence) + 15000` (`state.py:121-124`) | none |
| Vikunja | `task_positions.position` | `float64`, own table keyed `(task_id, project_view_id)` | midpoint; `positionAfter/2` at the head; `positionBefore + 2^16` at the tail (`calculateItemPosition.ts`) | `MinPositionSpacing = 0.01` triggers a full-view recalculation to `2^32/n·(i+1)` under a `FOR UPDATE` view lock; plus duplicate detection, conflict resolution, and **two offline repair commands** |
| Huly | `Issue.rank` | **LexoRank string** (`lexorank` npm, base-36, bucket 0) | `makeRank(prev, next)` → `between` / `genNext` / `genPrev` / `middle` (`foundations/core/packages/rank/src/utils.ts`) | equal neighbours → `genNext()`; bulk seeding via `genRanks(n)` splitting `36^6` into `n+2` gaps |
| Tegon | `Issue.sortOrder` | **`Int?`** — nullable integer | no midpoint possible at all | none; ordering is undefined for null rows |
| Jira | `Rank` | LexoRank string `0\|hzzzzz:` | `between` | 3 buckets (`0\|`,`1\|`,`2\|`) so a rebalance can run online while ranking continues |
| Focalboard | card order | array of ids on the view block | rewrite the array | the array is the bottleneck |

### 5.2 Recommendation: string fractional indexing (base62), not floats

**Use a `sort_key TEXT` with lexicographic ordering. Do not use a float.**

The argument is empirical, not aesthetic. Vikunja's float implementation is
careful and well-engineered — it locks the view, it detects duplicates, it
recalculates — and it *still* ships `pkg/cmd/repair_task_positions.go` and
`pkg/cmd/repair_orphan_positions.go`, because floats degrade in production. Every
one of those mechanisms exists to compensate for a 53-bit mantissa. A string key
needs none of them.

The precision math: an IEEE-754 double has a 52-bit mantissa. Repeatedly
inserting at the *same* position halves the gap each time, so after roughly **52
consecutive inserts between the same two neighbours**, `(a + b) / 2 === a` and
the new item silently collides with its predecessor. Starting from Vikunja's
`2^16` initial gap buys you about 68. That is not a theoretical number: a
designer dragging cards to the top of a board hits it in an afternoon.

A base62 string key grows by at most one character per pathological insert and
never collides.

### 5.3 The algorithm

```
DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"   // base62, ASCII order
```

`keyBetween(a: string | null, b: string | null): string` where `a` is the
predecessor's key (`null` = list head) and `b` the successor's (`null` = tail):

```
keyBetween(null, null)  ->  "a0"          // the middle of the space
keyBetween(a,    null)  ->  incrementKey(a)
keyBetween(null, b)     ->  decrementKey(b)
keyBetween(a,    b)     ->  midpoint(a, b)     // requires a < b

midpoint(a, b):                 // b may be "" meaning +infinity
  n = length of the common prefix of a and b
  if n > 0:
      return a[0..n] + midpoint(a[n..], b[n..])

  digitA = a === "" ? 0    : indexOf(a[0])
  digitB = b === "" ? BASE : indexOf(b[0])

  if digitB - digitA > 1:
      return DIGITS[round((digitA + digitB) / 2)]        // room between them

  // adjacent digits: descend
  if b.length > 1:
      return b[0]                                        // b has a tail; take its head
  return DIGITS[digitA] + midpoint(a.slice(1), "")       // borrow from a
```

Two invariants that are easy to get wrong and expensive to discover later:

- **A key must never end in the lowest digit `'0'`.** If it does, no key can be
  generated immediately before it without growing without bound. `decrementKey`
  and `midpoint` must both preserve this.
- **Order is byte order.** In Postgres, `TEXT` sorts by the database collation,
  and `en_US.UTF-8` is *not* byte order — it case-folds, so `'a'` sorts before
  `'B'` and your base62 ordering is wrong in a way that only shows up with mixed
  case. Declare the column
  `sort_key text COLLATE "C" NOT NULL` (or index it `(scope_id, sort_key COLLATE "C")`)
  and add a test that inserts `Z`, `a`, `0` and asserts the order.

**Do not hand-write this.** Use `fractional-indexing` (rocicorp, MIT, no
dependencies, ~1 KB) which implements exactly the above with the integer-part
length header that makes `incrementKey`/`decrementKey` unbounded in both
directions. It also exposes `generateNKeysBetween(a, b, n)`, which produces
evenly spaced keys and therefore *shorter* keys than n pairwise inserts — use it
for bulk operations (paste, import, rebalance). Vendor it with its test suite if
you must vendor.

### 5.4 Concurrency

Two clients dropping into the same gap compute the **same** key. Handle it, do
not prevent it:

- **`(scope_id, sort_key)` is NOT unique.** Duplicates are legal.
- **Sort deterministically:** `ORDER BY sort_key COLLATE "C", id`. Without the
  `id` tiebreak, two rows with equal keys swap order between page loads.
- **Optionally, jitter on the server.** Figma's note applies: *"The server can
  avoid ever having two objects with an identical position by just generating and
  assigning a unique position to the second insert operation."* Concretely: on
  write, if a row already exists with that exact key in that scope, call
  `keyBetween(collidingKey, nextKeyAfterIt)` once. One extra query, only on
  collision.
- Huly's `makeRank` does the same thing more bluntly: if `prev` equals `next` it
  returns `prevLexoRank.genNext()`.

### 5.5 Rebalancing

With strings you should essentially never need it. Define the guard anyway,
because "never" is doing a lot of work in that sentence:

- **Trigger:** on write, if `sort_key.length > SORT_KEY_MAX_LENGTH` (config,
  default `40`), flag the scope. 40 characters means ~40 pathological inserts at
  one point; a normal list never approaches it.
- **Action:** in one transaction, `SELECT id FROM teams WHERE id = $1 FOR UPDATE`
  (the Vikunja lock-the-parent pattern, `task_position.go:162-170`), read the
  scope's rows in current order, `generateNKeysBetween(null, null, n)`, write
  them back, commit.
- **Do not build buckets.** Jira's `0|`/`1|`/`2|` prefixes exist so a rebalance
  can run *online* across millions of issues while users keep ranking. Our
  rebalance is a single transaction over a few thousand rows and finishes inside
  a Vercel function's budget. Buckets would be complexity paid for a problem we
  do not have.
- **No cron.** Free tier has no reliable scheduler; do it inline on the write
  that trips the threshold. It is rare and it is fast.

### 5.6 Where the key lives — one column is not enough

Plane stores a single `Issue.sort_order` and computes new values as
`max(sort_order) + 10000` **filtered by `(project, state)`** (`issue.py:206-210`).
So the column is simultaneously "the global order" and "the order within a
state," and the moment you group the board by assignee or priority instead, the
manual ordering is meaningless. This is the mistake to avoid, and retrofitting it
means backfilling every row.

Vikunja got this right: positions live in their own table keyed
`(task_id, project_view_id)` with `unique(task_view)` and a `(view, position)`
index, so a task has an independent manual order in every view
(`task_position.go:38-55`).

Recommendation:

```sql
CREATE TABLE issue_sort_keys (
  issue_id   uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  scope_kind text NOT NULL,             -- 'TEAM_BACKLOG' | 'PROJECT' | 'CYCLE' | 'VIEW'
  scope_id   uuid NOT NULL,             -- team_id / project_id / cycle_id / view_id
  sort_key   text COLLATE "C" NOT NULL,
  PRIMARY KEY (issue_id, scope_kind, scope_id)
);
CREATE INDEX ON issue_sort_keys (scope_kind, scope_id, sort_key);
```

Grouping (by state, assignee, priority, label) does **not** get its own scope
row — grouping partitions a list that is already ordered by the scope's key, so
one key per scope is correct and a key per `(scope × group)` is not.

---

## 6. Codebase architecture recommendations

The sibling `bet` project already uses this layering and it works; stay
consistent with it rather than inventing a second convention in the same repo.

### 6.1 Layers

| Directory | Contains | May import from | Must never import |
|---|---|---|---|
| `src/domain/` | Entities, value objects, `authz/`, pure services (state machines, ordering, filters) | `src/domain/**` only | React, Next, `pg`, `process.env`, anything async |
| `src/ports/` | Interfaces only: `data-store.ts`, `clock.ts`, `id.ts`, `auth.ts`, `mailer.ts` | `src/domain/**` (types) | any implementation |
| `src/adapters/` | Implementations: `postgres/`, `memory/`, `auth/`, `mailer/` | `src/ports`, `src/domain` | `src/app`, `src/components` |
| `src/app/` | App Router routes, route handlers, server actions | everything below, plus `src/lib/container` | another route's internals |
| `src/components/` | React. Presentational + descriptor-driven generics | `src/domain` (types), `src/config` | `src/adapters`, `src/ports` |
| `src/config/` | `app.config.ts` (public), `server.config.ts` (secret), `tokens.ts` | nothing | everything |
| `src/lib/` | `container.ts` (composition root), `http.ts`, `cn.ts` | all | — |
| `src/test-support/` | Fixtures, builders, the adapter contract suite | all | — |

Enforce it, do not document it. `eslint-plugin-boundaries` with element types per
directory and an explicit `rules` allow-list turns every one of those "must
never" cells into a lint error. A layering rule that is only in a README is a
layering rule that is already violated.

### 6.2 Repository ports that do not leak SQL

One port per aggregate, plus a `DataStore` that composes them and provides
`transact`. Copy the `bet` contract verbatim — it is already written down in
`src/ports/data-store.ts` and it is good: everything returns `Promise`, misses
return `undefined` rather than throwing, reads return defensive clones, and
`transact` nests by reusing the outer staging layer.

The leak to avoid is the ORM type in the signature:

```ts
// ✗ the interface is now a Prisma interface; the memory adapter cannot implement it
listIssues(where: Prisma.IssueWhereInput, orderBy: Prisma.IssueOrderByInput): Promise<Issue[]>;

// ✗ still leaking — SQL fragments as strings
listIssues(scopeSql: string, order: 'sort_key ASC'): Promise<Issue[]>;
```

Take a **domain query object** instead, and let the adapter compile it:

```ts
// src/ports/repos/issue-repo.ts
export interface IssueFilter {
  readonly stateIds?: readonly StateId[];
  readonly assigneeIds?: readonly (UserId | 'unassigned')[];
  readonly labelIds?: readonly LabelId[];
  readonly priority?: readonly Priority[];
  readonly search?: string;
  readonly includeArchived?: boolean;
}
export interface IssueSort {
  readonly by: 'manual' | 'priority' | 'createdAt' | 'updatedAt' | 'dueDate';
  readonly direction: 'asc' | 'desc';
  /** required when by === 'manual' */
  readonly scope?: { kind: SortScopeKind; id: string };
}
export interface Page { readonly cursor?: string; readonly limit: number }

export interface IssueRepo {
  get(id: IssueId, scope: ReadScope): Promise<Issue | undefined>;
  list(scope: ReadScope, filter: IssueFilter, sort: IssueSort, page: Page): Promise<Paged<Issue>>;
  create(issue: NewIssue): Promise<Issue>;
  update(id: IssueId, patch: IssuePatch): Promise<Issue>;
  setSortKey(id: IssueId, scope: SortScope, key: string): Promise<void>;
  /** Neighbours for keyBetween(); the adapter picks the index, not the caller. */
  neighbours(scope: SortScope, index: number): Promise<{ before?: string; after?: string }>;
}
```

Every parameter is a domain type. `ReadScope` (§3.7) is a required argument on
every read, so a query that forgets the guest restriction does not compile. The
Postgres adapter builds the `WHERE` clause; the in-memory adapter runs the same
predicates as array filters. Neither escapes the interface.

`DataStore.transact(fn)` is where the last-owner check and the invite acceptance
live. The `bet` port doc already warns: *"every caller that mutates more than one
thing MUST route every one of those writes through `store.transact(fn)`, never a
bare sequence of repo calls."* That warning is load-bearing for R4.

### 6.3 Two adapters, one contract test

```
src/adapters/memory/    -> the default in dev and in every unit/route test
src/adapters/postgres/  -> production, and CI when DATABASE_URL_TEST is set
```

The in-memory adapter is only useful if it behaves identically. Guarantee it with
a **shared contract suite** rather than hope:

```ts
// src/test-support/contracts/issue-repo.contract.ts
export function issueRepoContract(name: string, make: () => Promise<IssueRepo>) {
  describe(`IssueRepo contract: ${name}`, () => {
    it('list() honours an explicit ReadScope and never returns out-of-scope rows', …);
    it('list() with sort.by=manual orders by (sort_key, id)', …);
    it('get() returns undefined for a miss, never throws', …);
    it('update() on a missing id rejects with NotFound', …);
    it('a caller mutating a returned entity does not corrupt the store', …);
  });
}
// invoked twice
issueRepoContract('memory', makeMemoryIssueRepo);
if (process.env.DATABASE_URL_TEST) issueRepoContract('postgres', makePgIssueRepo);
```

Any behaviour the two adapters disagree on is a bug in one of them, and the
contract is where you find out.

### 6.4 Configuration

Two files, and `process.env` appears nowhere else in the codebase (enforce with
an eslint `no-restricted-properties` rule on `process.env`).

```ts
// src/config/server.config.ts — secrets, server-only, validated at import
import 'server-only';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL:      z.string().url(),
  SESSION_SECRET:    z.string().min(32),
  INVITE_LINK_KEY:   z.string().length(64).optional(),
  INVITE_EXPIRY_DAYS:      z.coerce.number().int().positive().default(7),
  INVITE_LINK_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
  SORT_KEY_MAX_LENGTH:     z.coerce.number().int().positive().default(40),
  RATE_LIMIT_PER_MINUTE:   z.coerce.number().int().positive().default(20),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid server config:\n${parsed.error.issues.map(i => `  ${i.path}: ${i.message}`).join('\n')}`);
}
export const serverConfig = Object.freeze(parsed.data);
```

Fail at import, with the field names. A `DATABASE_URL` that is undefined must
not become a connection error 40 frames deep at 2am.

`src/config/app.config.ts` follows the sibling Notion project's shape exactly —
`env()` / `envInt()` helpers over `NEXT_PUBLIC_*` with literal fallbacks, and
one exported `as const` object per concern (`brand`, `routes`, `layout`,
`limits`, `defaults`). Its doc comment states the rule we want here too:
*"Components must read from here rather than inlining literals."*

Things that belong in `app.config.ts` and are otherwise guaranteed to end up
hardcoded in a component: sidebar width, board column width, page size, the
default workflow-state seed set, the priority labels and their order, the
issue-identifier max length, keyboard shortcut bindings, the avatar colour
palette, debounce intervals.

**Design tokens** get their own module so Tailwind and runtime code cannot
disagree:

```ts
// src/config/tokens.ts   — plain data, no imports
export const color   = { … } as const;
export const space    = { … } as const;
export const radius   = { … } as const;
export const type     = { … } as const;
export const duration = { fast: 120, base: 200, slow: 320 } as const;
```
`tailwind.config.ts` imports this module and spreads it into `theme.extend`;
components that need a value at runtime (a spring animation, a canvas) import
the same module. One source, two consumers.

### 6.5 Entity-agnostic UI: field descriptors

The requirement "adding a field shouldn't mean touching ten files" has one
reliable answer: **describe fields as data, render generically.**

```ts
// src/domain/fields/types.ts
export interface FieldDescriptor<T, V = unknown> {
  readonly id: string;                       // stable; persisted in saved views
  readonly label: string;                    // from i18n/app.config, not a literal
  readonly group: 'core' | 'planning' | 'meta';
  readonly get: (row: T) => V;

  readonly Cell: ComponentType<{ value: V; row: T }>;
  readonly Editor?: ComponentType<{ value: V; row: T; onChange: (v: V) => void }>;

  /** Present ⇒ the column is sortable, and this is how. */
  readonly sort?: { readonly compare: (a: V, b: V) => number };
  /** Present ⇒ the board can group by this field. */
  readonly groupBy?: {
    readonly bucketOf: (row: T) => GroupBucketId;
    readonly buckets: (ctx: WorkspaceCtx) => readonly GroupBucket[];   // incl. empty ones
  };
  /** Present ⇒ the filter bar offers it, with this control. */
  readonly filter?: FilterSpec<V>;

  readonly width: number;            // from tokens.layout, never a literal
  readonly defaultVisible: boolean;
  readonly minRole?: RoleKey;        // optional: hide a column the actor can't read
}

export const ISSUE_FIELDS = [ … ] as const satisfies readonly FieldDescriptor<Issue>[];
```

Then three generic components carry every list surface:

- `<EntityTable descriptors={ISSUE_FIELDS} visible={view.columns} rows={…} />`
- `<EntityBoard descriptors={ISSUE_FIELDS} groupByFieldId={view.groupBy} rows={…} />`
- `<EntityFilterBar descriptors={ISSUE_FIELDS} value={view.filter} onChange={…} />`

The board is generic **because it asks the descriptor for its buckets** rather
than switch-casing on `'state' | 'assignee' | 'priority' | 'label'`. That switch
is the thing that makes every new groupable field a four-file change.

Adding `estimate` becomes: one `FieldDescriptor` entry, one DB column, one line
in the row mapper. Three files, none of them a component.

Plane arrived at the data-driven half of this and stopped: `display_properties`
is a JSON blob of booleans on the workspace/project/member row
(`workspace.py:44-58`, `project.py:52-60`) so *visibility* is data — but the
rendering is still a per-property switch in the web app, and the blob is
untyped, so a renamed property silently disables a column for every existing
user. Descriptors give the same configurability with a compiler.

The sibling Notion project's `src/lib/model/property-types.ts` is the same idea
applied to database properties; look there for the house style before inventing
one.

### 6.6 Route handlers stay thin

Every route handler is the same six steps, and it is worth making that literal:

```ts
export async function PATCH(req: Request, { params }: Ctx) {
  const { store, clock } = getContainer();
  const actor  = await requireActor(req);                     // 1. who
  const body   = await parseBody(req, updateProjectSchema);   // 2. validate input
  const facts  = await loadProjectFacts(store, actor, params.projectId); // 3. facts (I/O)
  assertCan('project.update', facts);                         // 4. authorize (pure)
  const result = await updateProject(store, clock, params.projectId, body); // 5. domain
  return jsonOk(toProjectDto(result));                        // 6. DTO out, never the entity
}
```

Step 6 matters: never return a domain entity straight to the client. A DTO
mapper is where you strip the fields a guest must not see, and it is the only
place that can enforce it consistently.

### 6.7 Free-tier constraints that shape the design

- **Serverless connection churn.** Every invocation is a new process. Use a
  pooled connection string (Neon/Supabase `-pooler`, or `?pgbouncer=true`) and
  `max: 1` on the client. Do not open a pool per request.
- **~10 s function budget on Hobby.** No long-running work. The rebalance in
  §5.5 fits; a workspace-wide reindex does not. Anything that might not fit must
  be chunked and resumable.
- **No cron, no queue, no in-process memory.** Cleanup (expired invites, stale
  rate-limit rows) runs opportunistically on writes, not on a schedule. Never
  cache in a module-level `Map` and assume it survives.
- **`server-only` on every module that touches secrets**, so an accidental
  client import is a build error rather than a leaked `SESSION_SECRET`.

---

## 7. Testing strategy

### 7.1 Which layer gets what

| Layer | Test kind | Coverage target | Notes |
|---|---|---|---|
| `src/domain/**` | Unit, no mocks, no async | ~100 % of branches | Pure functions. If a domain test needs a mock, the function is not pure — fix the function. |
| `src/domain/authz/**` | The exhaustive matrix test (§7.3) | every cell | The single highest-value test in the codebase |
| `src/ports/**` | none | — | Interfaces have no behaviour |
| `src/adapters/**` | Contract suite, run against **both** adapters | every port method | §6.3. Postgres run gated on `DATABASE_URL_TEST`, memory run always |
| `src/app/api/**` | Integration, memory adapter wired through the container | every route: one happy path + one denial | Fast (no DB), and it is where 403/404 mapping is verified |
| `src/components/**` | Unit on the *generic* components (`EntityTable`, `EntityBoard`, `EntityFilterBar`) and on descriptors | the generics thoroughly, per-entity screens barely | Testing the generic once beats testing forty screens |
| `e2e/` (Playwright) | Multi-user permission journeys only | ~8 specs | See §7.4 |

**The integration line** sits at the route handler. Above it (routes,
components) we test with the memory adapter and never touch Postgres; below it
(adapters) we test the adapter against real Postgres. Nothing mocks the
`DataStore` — the memory adapter *is* the test double, and it is the one that
the contract suite keeps honest. This avoids the usual failure where every test
mocks the repo and the mocks all agree with each other and none of them agree
with the database.

### 7.2 Note on the in-memory adapter

The `bet` port doc records a real caveat: *"a bare repo write racing an in-flight
`transact` can be lost."* The memory adapter cannot reproduce Postgres's locking,
so the concurrency tests for R4 (last owner) and §5.5 (rebalance) **must** run
against Postgres. Mark them, gate them on `DATABASE_URL_TEST`, and make CI set
it. A green suite that never ran them is the exact shape of a false negative.

### 7.3 Testing authorization exhaustively

```ts
// src/domain/authz/__tests__/matrix.test.ts
type Expectation = true | false | 'conditional';

/**
 * Hand-transcribed from research/05-oss-architecture.md §2.2.
 * DO NOT derive this from POLICY — deriving it makes the test a tautology
 * that passes for any policy, including an empty one.
 */
const EXPECTED = {
  'workspace.view': {
    'ws:OWNER': true, 'ws:ADMIN': true, 'ws:MEMBER': true, 'ws:GUEST': true,
    'team:ADMIN': false, 'team:MEMBER': false, 'proj:LEAD': false, 'proj:MEMBER': false,
  },
  'project.update': {
    'ws:OWNER': true, 'ws:ADMIN': true, 'ws:MEMBER': false, 'ws:GUEST': false,
    'team:ADMIN': true, 'team:MEMBER': false, 'proj:LEAD': true, 'proj:MEMBER': true,
  },
  // … all 48 rows …
} as const satisfies Record<Action, Record<RoleKey, Expectation>>;

describe.each(ACTIONS)('%s', (action) => {
  it.each(ROLE_KEYS)('holding only %s', (roleKey) => {
    const facts = factsHoldingOnly(roleKey);          // builder in test-support
    const expected = EXPECTED[action][roleKey];
    if (expected === 'conditional') {
      // a predicate cell: assert it can be both, so a broken predicate that
      // always returns false is caught
      expect(can(action, factsSatisfying(action, roleKey))).toBe(true);
      expect(can(action, factsViolating(action, roleKey))).toBe(false);
    } else {
      expect(can(action, facts)).toBe(expected);
    }
  });
});
```

`ACTIONS.length × ROLE_KEYS.length` = 48 × 8 = **384 individually named
assertions**, and adding either an action or a role fails to compile until
`EXPECTED` is updated — which forces the author back to the markdown matrix.

Note the warning in the comment. Deriving `EXPECTED` from `POLICY` would be a
signal shaped to the detector: it would pass against any table, including one
where every cell is `DENY`. The second transcription is the whole point.

Additional authorization tests, each catching a different real failure:

1. **Deny-by-default.** For every action, `can(action, factsWithNoMemberships)`
   is `false`. Catches a `row()` helper regression that flipped the base.
2. **Suspension beats everything.** For every action, an `OWNER` with
   `membershipStatus: 'SUSPENDED'` is denied.
3. **Union semantics.** A `ws:GUEST` who is also `team:MEMBER` gets exactly the
   `team:MEMBER` grants and nothing more. This is the guest requirement, tested
   directly.
4. **Transition rules.** A table-driven test over `checkWorkspaceRoleChange` with
   one case per rule R1–R7, asserting the `Denial.code`, not just falsiness.
5. **Last-owner concurrency.** Two parallel demotions against real Postgres;
   assert exactly one succeeds and `activeOwnerCount` ends at 1.
6. **Every route authorizes.** A meta-test that reads every file under
   `src/app/api/**/route.ts` and asserts each exported handler's source contains
   an `assertCan(` or is on an explicit `PUBLIC_ROUTES` allow-list. This is the
   one that catches the actual production failure mode — a new endpoint that
   nobody remembered to guard — and no amount of matrix coverage substitutes for
   it.
7. **DTO leakage.** For each DTO mapper, assert the guest projection omits the
   fields a guest must not see.

### 7.4 End-to-end

Playwright, and only for journeys that cross users or sessions, because those
are the ones unit tests structurally cannot cover:

1. Owner invites a member by link → member signs up through the link → lands in
   the right team.
2. Admin promotes member → member sees admin surfaces on next load.
3. Last owner attempts to demote self → blocked with the right message.
4. Guest is added to one team → cannot see the other team's issues, cannot reach
   them by direct URL (asserts **404**, not 403).
5. Member added to a project edits it and adds another member (the stated
   requirement, verified end to end).
6. Two browser contexts drag the same issue into the same gap → both land, order
   is stable on reload.
7. Removed member's session is rejected on next request.
8. Private team is invisible in search and in `@`-mention autocomplete to a
   non-member.

Heed the repo memory here: **web copy is e2e test data** — assertions on literal
sentences break when a designer edits a string. Prefer `data-testid` and role
queries over text matching for anything that is not itself the thing under test.

---

## 8. Anti-patterns to avoid

Each is something I read in the source, with the location.

**A1 — The role enum defined four times, in two languages.**
Plane: `ROLE_CHOICES = ((20, "Admin"), (15, "Member"), (5, "Guest"))` in
`apps/api/plane/db/models/workspace.py:19`; the same tuple **plus** a parallel
`class ROLE(Enum)` in `apps/api/plane/db/models/project.py:21-27`; a **third**
`class ROLE(Enum)` in `apps/api/plane/utils/permissions/base.py:13-17`; and a
fourth as `enum EUserPermissions { ADMIN = 20, MEMBER = 15, GUEST = 5 }` in
`packages/types/src/enums.ts:7-11`. Four copies of one fact. → Define roles once
in `src/domain/authz/roles.ts` and derive everything, including the DB check
constraint, from it.

**A2 — Permissions keyed on the HTTP method.**
Plane's DRF classes branch on `request.method in SAFE_METHODS` and
`request.method == "POST"` (`apps/api/plane/app/permissions/project.py:19,25,62,70`).
The policy is transport-shaped, so `POST /projects` and
`POST /projects/:id/members` — completely different authority — share a code
path and get the same answer. → Name domain actions, never verbs.

**A3 — Comments that contradict the code, in the security layer.**
In that same 146-line file: line 24 says *"Only workspace owners or admins can
create the projects"* above a filter of `role__in=[ADMIN, MEMBER]`; line 69
repeats the identical comment above the *member-add* endpoint; line 78 says
*"Only Project Admins can update project attributes"* above
`role__in=[ADMIN, MEMBER]`. Three contradictions in one file. When the policy is
prose next to a query, it drifts. A declarative table cannot drift from itself.

**A4 — A membership query per permission check, then again for the queryset.**
Each Plane permission class issues one or two `EXISTS` queries, and the viewset
then re-runs an equivalent filter to scope the results. Two hand-written
predicates that must agree, and N+1 queries per request. → Load facts once per
request, pass them to a pure `can()`, and pass a `ReadScope` to the query.

**A5 — Ownership modelled outside membership.**
`Workspace.owner` is a plain FK with `on_delete=models.CASCADE`
(`workspace.py:131-135`) while roles live on `WorkspaceMember`. So the owner may
have no membership row, the membership role enum has no `OWNER` value at all,
and deleting the owner's user row **deletes the workspace**. → `OWNER` is a
value of the membership role enum. There is no second place where ownership
lives.

**A6 — The default role is the wrong one.**
Plane: `role = PositiveSmallIntegerField(choices=ROLE_CHOICES, default=5)` on
both `WorkspaceMember` (`workspace.py:205`) and `ProjectMember`
(`project.py:219`) — a bare `create()` silently makes a read-only guest. Tegon
is worse in the opposite direction: `role Role @default(ADMIN)`
(`schema.prisma:783`) — a bare insert makes an **admin**. → No default on the
role column. Make the caller state it.

**A7 — An enum that mixes principal type with permission level.**
Tegon: `enum Role { ADMIN, USER, BOT, AGENT }` (`schema.prisma:886-891`). `BOT`
and `AGENT` answer "what kind of principal is this", `ADMIN`/`USER` answer "how
much authority does it have", and the column can only hold one. There is no way
to express an admin bot. → Two columns: `principal_type` and `role`.

**A8 — Foreign keys stored in arrays.**
Tegon: `UsersOnWorkspaces.teamIds String[]` (line 778), `Project.teams String[]`
(line 583), `Issue.labelIds/subscriberIds/attachments String[]`
(lines 342-349), `Invite.teamIds String[]` (line 304). No referential integrity
(a deleted team leaves dangling ids everywhere), no efficient reverse lookup
("who is in team X" is an array-containment scan), and — the decisive one — **no
room for edge metadata**: you cannot record a per-team role, a `joinedAt`, or an
`addedBy`, so adding team roles later is a data migration rather than a column.
→ Join tables, always, for anything a human is a member of.

**A9 — Ordering that cannot order.**
Tegon: `Issue.sortOrder Int?` (`schema.prisma:321`). Nullable, so rows with no
value have undefined position; integer, so there is no midpoint between adjacent
items and any drag rewrites a range. `Workflow.position Int` (line 818) has the
same problem for reordering states. → §5.

**A10 — One sort column doing two jobs.**
Plane computes a new `Issue.sort_order` as `max(sort_order) + 10000` filtered by
`(project, state)` (`apps/api/plane/db/models/issue.py:206-210`) but stores it in
a single global column. Group the board by anything other than state and the
manual order is meaningless. → Positions belong in their own table keyed by the
list they order (Vikunja's `task_positions`, §5.6).

**A11 — A role expressed as independent booleans.**
Focalboard: `BoardMember` carries `SchemeAdmin`, `SchemeEditor`,
`SchemeCommenter`, `SchemeViewer` as four separate bools
(`server/model/board.go:192-204`). Sixteen representable states, about five
legal, and no type prevents `SchemeAdmin && SchemeViewer` or all-false. → One
enum column. If you genuinely need capability composition, model capabilities
explicitly — but you do not.

**A12 — Fully data-driven RBAC.**
Huly stores permissions as documents: `Permission { txClass, objectClass,
forbid, scope, txMatch }`, `ClassPermission`, `AttributePermission`,
`ModulePermissionGroup { role, permissions, disabledPermissions }`
(`foundations/core/packages/core/src/classes.ts:568-600`), with rank in a
*separate* `roleOrder: Record<AccountRole, number>` map (line 618) that can
silently disagree with the enum. It is maximally flexible and it means you
cannot answer "what can a Guest do?" without booting the model, cannot type-check
a policy change, and cannot test the matrix exhaustively. OpenProject has the
same shape in SQL (`roles` + `role_permissions` rows, seeded by migration).
→ A declarative table **in code** is the sweet spot: as readable as data, as
checkable as types. Only move it to the database when a customer genuinely needs
custom roles, and then keep the built-in roles as code.

**A13 — Permission checks as methods on each entity.**
Vikunja puts `CanRead` / `CanWrite` / `CanUpdate` / `CanDelete` on every model
(`pkg/models/project_permissions.go`, `task_position.go:61-64`, …). Each is
sensible; collectively there is no file you can open to see the policy, and no
way to diff "what changed about who can do what" in a PR. → One `policy.ts`.

**A14 — Client and server implementing the policy twice.**
Plane maintains the server policy in Python and a parallel client policy in
`apps/web/core/store/user/base-permissions.store.ts` +
`packages/utils/src/permission/*`. They must be kept in sync by hand, and the
client one is what decides whether the button renders. We are a single
TypeScript codebase — import the *same* `can()` in the React component and in
the route handler. That is a real advantage of the stack and most clones throw
it away.

**A15 — Three deletion concepts at once.**
Plane has `is_active` on memberships, `deleted_at` soft delete, and hard delete,
and different code paths respect different combinations. → Pick two with clear
roles: `deleted_at` for "gone" and `status` for "temporarily revoked", and make
every query go through a repo method that applies both.

**A16 — Floats for manual order, discovered in production.**
Vikunja's float positions are backed by `MinPositionSpacing`, a full-view
recalculation, `FOR UPDATE` locking, duplicate detection, conflict resolution,
and two CLI repair commands (`pkg/cmd/repair_task_positions.go`,
`pkg/cmd/repair_orphan_positions.go`). Their engineering is *good* — that is the
point. All of it is the interest payment on choosing a float. → §5.2.

**A17 — Filtering visibility in application code instead of the query.** Not a
citation so much as the failure that A4 leads to: once `can()` is the only
authorization primitive, a list endpoint has no choice but to over-fetch and
filter in memory, which leaks through totals and pagination and does not scale.
→ Ship `readScopeFor()` at the same time as `can()`, not later.

---

## 9. Sources

**Source read directly (GitHub API, 2026-08-13)**

- Plane — [makeplane/plane](https://github.com/makeplane/plane) @ `preview`:
  `apps/api/plane/db/models/workspace.py`, `project.py`, `issue.py`, `state.py`,
  `label.py`; `apps/api/plane/app/permissions/project.py`;
  `apps/api/plane/utils/permissions/base.py`; `packages/types/src/enums.ts`
- Tegon — [tegonhq/tegon](https://github.com/tegonhq/tegon) @ `main`:
  `apps/server/prisma/schema.prisma`
- Huly — [hcengineering/platform](https://github.com/hcengineering/platform) @ `develop`:
  `foundations/core/packages/core/src/classes.ts`,
  `foundations/core/packages/rank/src/utils.ts`,
  `models/tracker/src/permissions.ts`, `plugins/tracker/src/index.ts`
- Vikunja — [go-vikunja/vikunja](https://github.com/go-vikunja/vikunja) @ `main`:
  `pkg/models/task_position.go`, `pkg/models/permissions.go`,
  `pkg/models/project_permissions.go`, `pkg/models/project_users.go`,
  `pkg/models/project_team.go`, `frontend/src/helpers/calculateItemPosition.ts`
- Focalboard — [mattermost/focalboard](https://github.com/mattermost/focalboard) @ `main`:
  `server/model/board.go`
- OpenProject — [opf/openproject](https://github.com/opf/openproject): `app/models/role.rb`

**Product documentation**

- [Linear — Members and roles](https://linear.app/docs/members-roles)
- [Linear — Private teams](https://linear.app/docs/private-teams)
- [Linear — Teams](https://linear.app/docs/teams)
- [GitLab — Roles and permissions](https://docs.gitlab.com/user/permissions/)
- [GitHub — Managing access to your projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/managing-access-to-your-projects)
- [Notion — Add members, admins, guests and groups](https://www.notion.com/help/add-members-admins-guests-and-groups)
- [Taiga — The permissions section](https://taiga.pm/the-permissions-section/)

**Ordering / ranking**

- [rocicorp/fractional-indexing](https://github.com/rocicorp/fractional-indexing) — the library to use
- [David Greenspan — Implementing Fractional Indexing](https://observablehq.com/@dgreensp/implementing-fractional-indexing) — the algorithm
- [Figma — Realtime editing of ordered sequences](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/) — arbitrary-precision strings over doubles; server-side collision resolution
- [Jira's ranking system explained (LexoRank)](https://tmcalm.nl/blog/lexorank-jira-ranking-system-explained/) and [Atlassian — Managing LexoRank](https://confluence.atlassian.com/adminjiraserver/managing-lexorank-938847803.html) — the bucket mechanism we deliberately skip
- [linear/linear#170 — "What's the correct way to change sortOrder?"](https://github.com/linear/linear/issues/170) — confirms Linear's `sortOrder` is a float

**In-repo conventions to stay consistent with**

- `Replicates/bet/src/domain/authz.ts` — pure `can()`, facts passed in by the route layer
- `Replicates/bet/src/ports/data-store.ts` — the repository-port contract
- `Replicates/bet/src/lib/container.ts` — the composition root
- `Replicates/bet/src/app/api/invites/route.ts` — the invite-token minting pattern
- `Replicates/Notion/src/config/app.config.ts` — the typed-config module shape
- `Replicates/Notion/src/lib/model/property-types.ts` — descriptor-driven fields
