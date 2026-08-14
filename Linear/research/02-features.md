# Linear — Product Features & UX Semantics (Research Lane B)

Research target: rebuild Linear (linear.app) as a Next.js web app. This document describes **how the product behaves**, at the level of detail needed to reimplement it without ever having used the app.

**Method**: read from Linear's own documentation (`linear.app/docs/...`), retrieved 2026-08-13 via their public docs and their MCP documentation-search endpoint (which returns full page text). Every claim is tagged:

- **[C]** = CONFIRMED — stated in Linear's own docs. URL given in the Sources section and usually inline.
- **[C-API]** = CONFIRMED from Linear's public GraphQL schema / API-facing references rather than the end-user docs.
- **[I]** = INFERRED — a reasonable reconstruction from screenshots, adjacent docs, or the shape of the product. Treat as a design decision you are free to change.

> **Terminology note.** Linear's docs renamed "workflow states" to **issue statuses** in the UI, but the API still calls them `WorkflowState` and the type field is still `state`. This document uses **status** for the user-facing name and **state type** for the five/six categories.

---

## 0. Conceptual model (read this first)

**[C]** ([conceptual-model](https://linear.app/docs/conceptual-model), [teams](https://linear.app/docs/teams))

```
Workspace  (one company; unique URL; one billing plan; one member list)
 ├── Members (users, with a workspace-level role)
 ├── Labels (workspace-level)
 ├── Project statuses (workspace-level, custom)
 ├── Teams  (1..n)
 │    ├── key/identifier  (e.g. ENG)  → drives issue IDs
 │    ├── Issue statuses  (per-team ordered set)
 │    ├── Labels          (team-level)
 │    ├── Estimate config (per-team)
 │    ├── Triage on/off   (per-team)
 │    └── Issues (each issue belongs to EXACTLY ONE team)
 ├── Projects (belong to 1..n teams; contain issues from those teams)
 │    └── Milestones (belong to exactly one project)
 └── Initiatives (group projects; out of scope for this rebuild)
```

Load-bearing invariants:

1. **[C]** "Issues are always linked to a single team." An issue can never belong to two teams. Moving an issue between teams is allowed but reassigns it wholesale.
2. **[C]** "Issues can only be associated with one project at a time." The documented workaround for cross-project work is sub-issues in different projects.
3. **[C]** A project may be shared across multiple teams; its issues each still belong to one team. When a project spans >1 team the project page grows per-team tabs.
4. **[C]** Sub-issues may be assigned to **any** team or member in the workspace — not just the parent's team.
5. **[C]** A milestone belongs to a project; issues attach to at most one milestone, and only a milestone of the project they're already in.

---

## 1. ISSUES

### 1.1 Identifier

**[C]** ([creating-issues](https://linear.app/docs/creating-issues)) — "Issues are always linked to a single team. They have an issue ID (team's issue identifier and unique number) and are required to have a title and a status — all other properties and relations are optional."

| Aspect | Behavior | Confidence |
|---|---|---|
| Format | `<TEAM_KEY>-<number>`, e.g. `ENG-123`, `LIN-42` | **[C]** |
| Team key | Set at team creation, editable later in *Team settings → General → team identifier*. Linear's own examples use 2–4 uppercase chars (`LIN`, `ENG`, `MOB`, `DES`, `FEA`, `EU`). No documented hard length limit. | **[C]** for editability; **[I]** for the 2–4 char convention |
| Number allocation | Monotonically increasing **per team**, starting at 1 | **[I]** — docs say "unique number" scoped to the team but never state the algorithm |
| Reuse after delete | Not documented. Deleted issues sit in *Recently deleted* for 30 days and can be restored with their original ID, which only works if the number is **not** reused. | **[I]** — implement as *never reused*: keep a per-team counter that only increments |
| Team key change | Docs allow renaming the identifier. Existing issue IDs re-render under the new key. | **[I]** — the number is the stored value; the key is joined at render time |
| Search by ID | `/` search matches `LIN-123` exactly and also shorthand `lin123` (case-insensitive, separator optional) | **[C]** ([search](https://linear.app/docs/search)) |
| ID in URL | `linear.app/{workspace}/issue/ENG-123/{slugified-title}`; a comma-separated list `…/issues/ENG-123,ENG-456` opens an ad-hoc view of just those issues | **[C]** for the comma list; **[I]** for the single-issue URL shape |

**Implementation note [I]:** allocate the number inside the same transaction that inserts the issue, using `SELECT ... FOR UPDATE` on a per-team counter row (or a Postgres sequence per team). A naive `MAX(number)+1` races.

### 1.2 Full field list

Two fields are **required**: `title` and `status`. Plus the implicit `team`. Everything else is optional. **[C]**

| Field | Type | Notes | Confidence |
|---|---|---|---|
| `identifier` | derived string | `TEAM_KEY-number` | **[C]** |
| `title` | string, required | Pre-fills from highlighted text if you press `C` with a selection | **[C]** |
| `description` | rich text / markdown | Autosaves as you type (unlike comments, which need an explicit submit). Full markdown support — see §17 Editor. | **[C]** ([comment-on-issues](https://linear.app/docs/comment-on-issues), [editor](https://linear.app/docs/editor)) |
| `status` | FK → WorkflowState, required | See §2 | **[C]** |
| `assignee` | FK → User, nullable | **Exactly one** person. "Issues in Linear are assigned to a single person at a time." `No assignee` clears it. | **[C]** ([assigning-issues](https://linear.app/docs/assigning-issues)) |
| `delegate` / agent | FK → app-user, nullable | Agents are delegated *in addition to* the human assignee. **Out of scope** for the rebuild. | **[C]** |
| `priority` | enum 0–4, default 0 | See §3 | **[C]** / **[C-API]** |
| `labels` | many-to-many | Multiple labels; at most one per label group | **[C]** |
| `estimate` | number or null | Scale is per-team; see §5 | **[C]** |
| `dueDate` | date, nullable | Mutually exclusive with SLA (SLA out of scope) | **[C]** ([due-dates](https://linear.app/docs/due-dates)) |
| `parent` | FK → Issue, nullable | See §1.4 | **[C]** |
| `children` | reverse of `parent` | | **[C]** |
| `project` | FK → Project, nullable | At most one | **[C]** |
| `projectMilestone` | FK → Milestone, nullable | Only settable when `project` is set | **[C]** |
| `cycle` | FK → Cycle, nullable | **Out of scope** | **[C]** |
| `subscribers` | many-to-many Users | Auto-added on create / assign / @mention; manual `Shift+S` | **[C]** ([notifications](https://linear.app/docs/notifications), [inbox](https://linear.app/docs/inbox)) |
| `attachments` / links | list | URL attachments (`Ctrl+L` to add a link), uploaded files (25 MB via email intake), integration linkbacks | **[C]** |
| `relations` | list | blocks / blocked by / related / duplicate — see §1.5 | **[C]** ([issue-relations](https://linear.app/docs/issue-relations)) |
| `creator` | FK → User, immutable | Present in CSV export as "Creator" | **[C]** ([exporting-data](https://linear.app/docs/exporting-data)) |
| `customerRequests` | list | **Out of scope** | **[C]** |
| `slaStatus` | enum | **Out of scope** | **[C]** |

**Timestamps** — Linear's own CSV/Sheets export enumerates them exactly **[C]** ([exporting-data](https://linear.app/docs/exporting-data), [google-sheets](https://linear.app/docs/google-sheets)):

`Created`, `Updated`, `Started`, `Triaged`, `Completed`, `Canceled`, `Archived`

Critical behavioral rule **[C]** (from the Google Sheets timestamp FAQ, and the single most important thing to get right):

> "Multiple issue statuses can exist in a single category (e.g. In Progress and In Review fall under Started). The timestamp exported reflects the latest timestamp at which an issue was moved to that status **category** from another category — not between statuses of the same category. Null fields on timestamps mean the issue was never in that status, **or the timestamp was cleared** (an issue moving from Backlog → Done → In Progress will clear the completed timestamp)."

So: `startedAt` / `completedAt` / `canceledAt` are **category-transition stamps**, they do **not** re-stamp on within-category moves, and they are **cleared** when the issue leaves that category. Store them explicitly; do not derive them from the activity log.

### 1.3 Creating an issue

**[C]** ([creating-issues](https://linear.app/docs/creating-issues))

| Entry point | Detail |
|---|---|
| `C` | Opens the issue creation **modal** |
| `V` | Creates in **full-screen** mode |
| `Option/Alt + C` | Opens the template picker |
| `+` icon | Upper-left of the app chrome |
| `https://linear.new` | Redirects to the new-issue page when logged in |
| Highlighted text + `C` | Pre-fills the title with the selection |
| `Cmd/Ctrl + Shift + Enter` on save | Saves and immediately opens a new composer with the **same properties** ("Create more") |

**URL prefill grammar [C]** — `https://linear.new?<param>=<value>&…`. Supported params: `title`, `description` (markdown, URL-encoded, `+` for space), `status` (UUID or name), `team` (UUID or key), `priority` (`Urgent|High|Medium|Low`), `assignee` (UUID, display name, or literal `me`), `estimate` (point number), `cycle`, `label` (comma-separated), `project`, `milestone` (requires `project`), `links` (comma-delimited `url|title`), `template`.

> **Doc bug worth noting**: the creating-issues page lists t-shirt point values as "No priority (0), XS (1), S(2), M (3), L (5), XL (8), XXL (13), XXXL (21)". "No priority" there is a typo for "No estimate", and the numbers are the Fibonacci mapping (§5). The estimates page is authoritative.

**Drafts [C]** — two kinds:
- *Temporary*: navigating away hides the composer and keeps content locally; it reopens next time. Client-local only; cleared by logout/reset.
- *Saved*: pressing `Esc` / close offers "save as draft". Persists across clients, appears in a **Drafts** page in the sidebar, auto-deleted after **6 months**.

**Activity-log grace period [C]** — "Changes made to an issue's properties in the **first 3 minutes** are considered part of the issue creation process, and won't be added to the activity log as changes to the issue." Implement this: suppress activity entries when `now - issue.createdAt < 3 min`.

### 1.4 Parent & sub-issues

**[C]** ([parent-and-sub-issues](https://linear.app/docs/parent-and-sub-issues))

Creation:
- `+ Add sub-issues` button below the parent's description opens the sub-issue editor
- `Cmd/Ctrl + Shift + O` opens the sub-issue editor; also converts a **text selection** (bulleted / numbered / checklist) into sub-issues, and converts a **comment** into a sub-issue
- Paste a list of titles → creates one sub-issue per line
- Saving a sub-issue immediately reopens the editor for the next one; `Cmd/Ctrl + Shift + Enter` (or shift-click Save) carries the previous values over; `Esc` exits

**Property inheritance on creation [C]** — exact rules:

| Property | Inherited? |
|---|---|
| team | **yes** |
| priority | **yes** |
| project | **yes** |
| cycle | yes, *only when created in an active status* |
| assignee | yes **iff** you are the parent's assignee, **or** all existing sub-issues already share the parent's assignee |
| labels | **no** |

**Status automation [C]** — two independent team-level toggles (*Settings → Team → Workflow*), both off by default:
- **Parent auto-close**: when *all* sub-issues are done, the parent is marked done automatically.
- **Sub-issue auto-close**: when the parent is marked done, all remaining sub-issues are marked done.

Status changes triggered by git integrations also respect these. **There is no automatic parent status change other than these two opt-in toggles** — the parent does not follow sub-issue progress by default.

**Progress rollup [C/I]** — Linear does *not* document a percent-complete badge on a parent issue in the issue list; it documents progress rollup for **projects** and **milestones** ("Progress starts counting the moment an issue moves to a *started* status, and increases further once it's completed"). **[I]** A parent issue shows a `n/m` sub-issue completion counter next to the sub-issue section; treat a richer rollup as optional.

Conversions **[C]**:
- Issue → sub-issue: select issue(s), *Set parent* via `Cmd+Shift+P` or command menu
- Sub-issue → issue: `Cmd/Ctrl+K` → **Remove parent**
- Parent → project: `…` menu → **Convert to project**. The original issue and its sub-issues are added to the new project as *standalone* issues; **all sub-issue relationships are removed**; the original issue is renamed to indicate the conversion.
- Duplicate parent with children: `…` → **Duplicate** → toggle **Include sub-issues**

Display **[C]**:
- Display Options has a **Sub-issues** toggle (show all sub-issues, or only parents + standalone issues)
- Filters offer: *only top-level issues*, *issues with sub-issues*, *only sub-issues*
- Under a parent, `…` → **Always hide completed sub-issues** (per-user)
- Under a parent, `…` → **Order by** — per-user, not global

Nesting depth is **not documented** for issues. **[I]** Allow arbitrary depth but guard against cycles (a parent chain must be acyclic).

### 1.5 Relations

**[C]** ([issue-relations](https://linear.app/docs/issue-relations))

| Relation | Inverse | Notes |
|---|---|---|
| Related | Related (symmetric) | General association |
| Blocks | Blocked by | Directed dependency |
| Duplicate of | Duplicate | Directed; **only one direction is user-settable** — you mark *the issue you're on* as a duplicate of another |

Behavioral rules:
- Multiple relations of each type are allowed on one issue.
- Marking as duplicate moves the current issue into the reserved **Duplicate** status (see §2.3) and shows a **banner** plus a link to the canonical issue in the issue view.
- **"Once the blocking issue has been resolved, the relationship moves under Related."** i.e. a blocks/blocked-by pair auto-demotes to *related* when the blocker completes — implement this as a display rule, not a data mutation, or you lose the history.
- The sidebar renders relations with colored flags: **orange** flag under *Blocked by*, **red** flag under *Blocks*.
- Removing: hover the relation and click the `×`, or use the command menu.
- **Auto-linking**: referencing an issue in a description or comment (`@ENG-123`, or pasting an issue ID/URL) **automatically adds it as a *related* issue**. **[C]** ([editor](https://linear.app/docs/editor))

Shortcuts **[C]**: `M` then `R` = create related; `M` then `B` = mark blocked; `M` then `X` = mark blocking; `M` `M` = mark duplicate.

### 1.6 Issue detail layout

**[C]** for the components, **[I]** for the exact geometry. Assembled from [assigning-issues](https://linear.app/docs/assigning-issues) ("the assignee field in the properties sidebar"), [comment-on-issues](https://linear.app/docs/comment-on-issues), [parent-and-sub-issues](https://linear.app/docs/parent-and-sub-issues), [issue-relations](https://linear.app/docs/issue-relations), and the changelog on collapsed issue history.

```
┌ breadcrumb: Team ▸ ENG-123 ────────────── [subscribe] [⋯] [Cmd/Ctrl+I sidebar] ┐
│                                                        │                        │
│  MAIN PANE                                             │  PROPERTIES SIDEBAR    │
│  ─────────                                             │  ──────────────────    │
│  # Title (inline editable, h1)                         │  Status      ▸ Todo    │
│                                                        │  Priority    ▸ High    │
│  Description (markdown editor, autosaves)              │  Assignee    ▸ @david  │
│                                                        │  Labels      ▸ bug ×   │
│  ── + Add sub-issues ────────────────────              │  Project     ▸ …       │
│  ▸ ENG-124  Sub-issue title       ▸ In Progress        │  Milestone   ▸ …       │
│  ▸ ENG-125  Sub-issue title       ▸ Todo               │  Estimate    ▸ 3       │
│                                                        │  Due date    ▸ …       │
│  ── Links / attachments ─────────────────              │  Parent      ▸ ENG-100 │
│                                                        │  ─────────────────     │
│  ── Activity feed (chronological) ───────              │  Relations             │
│  ● David created the issue · 3d                        │   ⚑ Blocked by ENG-99  │
│  ● David changed status Todo → In Progress · 2d        │   ⚑ Blocks     ENG-140 │
│  ▸ [comment thread]                                    │   ↔ Related    ENG-88  │
│  ● 4 older events (collapsed)                          │  ─────────────────     │
│  ▸ [comment thread]                                    │  Subscribers  ●●●  +   │
│                                                        │                        │
│  ┌ Leave a comment… ──────────────── [Comment] ┐       │                        │
└────────────────────────────────────────────────────────┴────────────────────────┘
```

Notes:
- **[C]** The sidebar is toggled with `Cmd/Ctrl + I` (documented for the project details sidebar; the issue sidebar behaves the same).
- **[C]** Relations live in the right-hand sidebar, grouped by type with flag icons.
- **[C]** Sub-issues appear **below the description**, above the activity feed.
- **[C]** The comment composer sits at the bottom with placeholder text "Leave a comment…"; unsent comment text is visible on the issue *and* appears in the sidebar **Drafts**.
- **[C]** Activity: "similar consecutive events are grouped and older activity is collapsed between comment threads."
- **[C]** Printing an issue (`Cmd/Ctrl+P`) switches every activity timestamp from relative ("3d") to absolute — so both renderings must exist.
- **[C]** Property changes can be made from the sidebar, from the command menu, from the row/card in a list or board, or via a single-key shortcut while the issue is focused.

### 1.7 Delete & archive

**[C]** ([delete-archive-issues](https://linear.app/docs/delete-archive-issues))

- **Delete**: `Cmd/Ctrl + Delete`, contextual menu, or `Cmd/Ctrl+K → Delete issue`. Undo with `Cmd/Ctrl+Z` immediately; afterwards restore from *Team archives → Recently deleted issues* with `#`. Held **30 days**, then permanently gone.
- **Archive** is **automatic only** — there is deliberately **no manual archive action**. Archived issues remain searchable and restorable (`#`).
- **Auto-close** (team setting): closes issues untouched for a configured period → sets one of the closed statuses, writes a history item to the activity feed, notifies subscribers. Re-open by changing status. Suppressed while the issue is in an active cycle or unfinished project, has a future due date, an active SLA, or sub-issues not eligible to close.
- **Auto-archive** (team setting): closed issues are archived after they've been completed/canceled/auto-closed **and inactive** for the full period. The issue's creator is **notified** on archive. Runs roughly every 24h. Blocked when: the parent isn't closed, sub-issues aren't all closed, sub-issues in another project aren't closed, or the issue's project isn't yet archivable.

---

## 2. WORKFLOW STATES (issue statuses)

**[C]** ([configuring-workflows](https://linear.app/docs/configuring-workflows))

### 2.1 State types

**Statuses are per-team.** Each status has a **name**, **color**, **description**, **position within its category**, and a **type (category)**. Teams can add unlimited statuses per category and reorder **within** a category; **the categories themselves are in a fixed order and cannot be reordered.** At least one status must exist in each category.

| Type (API value **[C-API]**) | UI category name **[C]** | Meaning | Counts as… |
|---|---|---|---|
| `triage` | Triage | "an additional status category that acts as an Inbox for your team" — only present when Triage is enabled | excluded from all views by default |
| `backlog` | Backlog | acknowledged, not planned | not active |
| `unstarted` | Unstarted | planned / ready, not begun | **active** |
| `started` | Started | in progress | **active**; stamps `startedAt` |
| `completed` | Completed | done | closed; stamps `completedAt` |
| `canceled` | Canceled | won't do | closed; stamps `canceledAt` |

The five non-triage categories are the ones the docs call out explicitly. `triage` is a sixth, feature-gated one. **[C]** for the six names; **[C-API]** for the lowercase API spellings.

### 2.2 Default status set Linear ships

**[C]** — "These workflows are team-specific and come with a default set and order: **Backlog > Todo > In Progress > Done > Canceled**."

| Position | Name | Type | Color **[I]** |
|---|---|---|---|
| 1 | Backlog | `backlog` | grey `#bec2c8` |
| 2 | Todo | `unstarted` | grey/blue `#e2e2e2` |
| 3 | In Progress | `started` | yellow `#f2c94c` |
| 4 | Done | `completed` | purple/indigo `#5e6ad2` |
| 5 | Canceled | `canceled` | grey `#95a2b3` |
| — | Duplicate | reserved, system | grey |

Linear's own product team's real workflow, quoted verbatim as a worked example **[C]**:

```
Backlog:    Icebox, Backlog
Unstarted:  Todo
Started:    In Progress, In Review, Ready to Merge
Completed:  Done
Canceled:   Canceled, Could not reproduce, Won't Fix
Duplicate:  Duplicate  (applied automatically when an issue is marked as a duplicate)
```

### 2.3 The Duplicate status

**[C]** — "When you mark an issue as a duplicate of another, its status is automatically changed to **Duplicate** — this is a system-managed status that **cannot be renamed or customized**."

⚠️ **Documentation conflict** worth resolving in your implementation: the Triage page says marking as duplicate "updates the new issue to a **Canceled status type**", while the workflow page presents *Duplicate* as its own reserved category. **[I] Recommended implementation**: a single system-owned status named `Duplicate`, `type = canceled`, `isSystem = true`, one per team, not editable and not deletable. That satisfies both statements — it's its own status, it behaves as canceled for analytics/archiving.

### 2.4 Default status for new issues

**[C]** — "The default status defines the workflow status that will be applied to newly created issues in your team… **By default, your first Backlog status will be the default status.** To change that, hover over a different status in the Backlog or Todo categories and then select **Make default**." Only `backlog` and `unstarted` statuses are eligible to be the default.

### 2.5 What "started" / "completed" drive

**[C]**

- **Active views**: the team's *Active* view = statuses whose type is `unstarted` **or** `started`. Excludes backlog, completed, canceled.
- **Timestamps**: entering the category stamps `startedAt`/`completedAt`/`canceledAt`; leaving the category clears the stamp (§1.2).
- **Progress**: project & milestone progress "starts counting the moment an issue moves to a **started** status, and increases further once it's **completed**." So a started issue contributes partial credit.
- **Auto-archive**: only `completed` / `canceled` / auto-closed issues are eligible.
- **Cycle interaction [C]**: adding a backlog issue to a cycle auto-moves it to the active (`unstarted`) default; there's an opt-in reverse automation. (Cycles are out of scope but the *pattern* — a status auto-transition on a container change — is worth knowing.)

### 2.6 Auto-close / auto-archive settings

Both configured in **Team settings → Issue statuses & automations**. The auto-archive period also governs when **projects and cycles** archive. **[C]**

---

## 3. PRIORITY

**[C]** ([priority](https://linear.app/docs/priority)) — "Issues can be set to **No priority, Low, Medium, High, or Urgent**." There are deliberately **no custom priorities**: "Adding too many options makes it harder to set priority and leads to diminishing returns. If more granularity is needed, the best workaround is to create additional workflow statuses or use labels."

### 3.1 The enum

| Value **[C-API]** | Name **[C]** | Icon **[I]** |
|---|---|---|
| `0` | No priority | three flat grey dashes / "…" glyph |
| `1` | Urgent | orange/red filled square with `!` |
| `2` | High | three bars, all filled |
| `3` | Medium | three bars, two filled |
| `4` | Low | three bars, one filled |

Note the ordering trap: the numeric order is **not** the semantic order. `1` is the most urgent, `0` means *unset*. A naive `ORDER BY priority ASC` puts "No priority" first, which is wrong.

### 3.2 Sorting

**[C]** — "By default, items **without an assigned priority level are now always sorted last**."

**[I]** Implement as: `ORDER BY (priority = 0) ASC, priority ASC` — i.e. bucket `0` to the end, then 1 → 4 ascending. Same rule applies to project priority.

### 3.3 Manual reorder inside a priority group

**[C]** — "On any view ordered by priority, simply drag & drop an issue or project above other ones to indicate it is more important. **The exact position will be saved globally across your workspace**, so that anyone else looking at a view ordered by priority will see these issues or projects in the same relative positions."

So a priority-ordered view is `(priority bucket, manual sort key within bucket)`. The manual sort key is global, not per-user. See §7.3.

### 3.4 Setting

**[C]** — Select one or more issues, press `P`, choose. Pressing `P` again changes or removes it. Works in bulk.

### 3.5 Urgent side-effects

**[C]** — "When an issue is marked as **Urgent**, Linear notifies the assignee and, if email notifications are enabled, also sends an urgent email notification."

---

## 4. LABELS

**[C]** ([labels](https://linear.app/docs/labels))

### 4.1 Scope

Two scopes, one flat table:
- **Workspace labels** — available to every team. Recommended for cross-cutting categories like "Bug".
- **Team labels** — available only in that team.

**[C]** Sub-teams inherit their parent team's labels; to change an inherited label you edit it in the parent.

**[C]** Cross-team filtering behavior worth reimplementing carefully: *"Team-specific labels 'act' like workspace labels when filtering all teams or multi-team views. As long as labels in different teams share the same name, filtered results will show all issues across all teams that match the label."* i.e. **filter by label name, not label id**, in multi-team views. This holds in custom views, My Issues, project all-team views and global search — but **not** in the API, where you must use each team's label UUID.

**[C]** Creating a workspace label whose name collides with existing team labels offers to **convert** those team labels to workspace scope.

### 4.2 Label groups

**[C]**
- A label group creates exactly **one** level of nesting. No deeper.
- Max **250 labels per group**.
- **You apply a label from the group, never the group itself.**
- **Mutually exclusive**: "Only one label from a given label group can be applied to an issue at a time." Applying a second label from the same group replaces the first.
- Create a group + label in one step from the Add-label flow using `Group/Label` or `Group:Label` syntax — e.g. typing `Type/Bug` creates the group "Type" and the label "Bug".
- **[C]** Project labels behave identically and are also mutually exclusive within a group ([project-labels](https://linear.app/docs/project-labels)).

### 4.3 Fields & management

| Field | Notes |
|---|---|
| name | **[C]** Reserved names, rejected because they'd collide with real properties: `assignee`, `cycle`, `effort`, `estimate`, `hours`, `priority`, `project`, `state`, `status` |
| color | **[C]** Editable inline by clicking the color swatch in the label row |
| description | **[C]** Short text; shown on **hover over an applied label anywhere in Linear** |
| group | **[C]** nullable FK to a label group |
| scope | **[C]** workspace or team |
| archived | **[C]** Archiving keeps the label on issues where it's applied but blocks future application. Views, filters, groups and insights all respect archived labels. |

**[C]** Management (Settings → Workspace → Labels, or Team settings → Labels):
- Edit name/color inline; right-click a row for *convert to group*, *move to workspace*, *change team*, *delete*
- Multi-select rows with `x` or Shift+click → right-click for bulk actions
- **Merge** multiple labels into one
- **Delete** is irreversible and removes the label from every issue

**[C]** Apply with `L`, or click the Labels field in the right sidebar. Multiple labels per issue are the norm.

---

## 5. ESTIMATES

**[C]** ([estimates](https://linear.app/docs/estimates))

Enabled **per team** at *Team Settings → General → Estimates*. "Teams can use different estimate scales and configurations, even if they're working together on the same project." Sub-teams may inherit the parent's estimate settings.

### 5.1 The four scales — exact values

| Scale | Base values | Extended (+2 values) |
|---|---|---|
| **Exponential** | 1, 2, 4, 8, 16 | 32, 64 |
| **Fibonacci** | 1, 2, 3, 5, 8 | 13, 21 |
| **Linear** | 1, 2, 3, 4, 5 | 6, 7 |
| **T-Shirt** | XS, S, M, L, XL | XXL, XXXL |

**[C]** "When T-Shirt sizes require translation to numerical values (for display in graphs, for instance) they follow the **Fibonacci** scale." → XS=1, S=2, M=3, L=5, XL=8, XXL=13, XXXL=21.

The "extended scale" is a **boolean toggle** that appends the two extra values to whichever scale is selected.

### 5.2 Zero & unestimated

**[C]**
- **Allow zero estimates** is a separate toggle. An explicit `0` is **distinct from** unestimated (null).
- **Default**: unestimated issues count as **1 point** in all rollups. This is configurable and can be disabled.
- When estimates are not enabled at all, statistics use "a default value of **1 estimate point per issue**."

### 5.3 Display

**[C]**
- `Shift + E` adds / edits / removes an estimate.
- `F` → filter by estimate value.
- The top bar of most views shows either total **issue count** or total **estimate value** next to the view name; **hover to see both**, and **click the number beside a group header to toggle** between count and estimate sum.
- Estimate is one of the toggleable **display properties** on list rows and board cards.

---

## 6. VIEWS, FILTERS, GROUPING, SORTING, DISPLAY OPTIONS

### 6.1 Display options popover

**[C]** ([display-options](https://linear.app/docs/display-options))

Opened with **`Shift + V`**, or the *Display options* button at the top right of a view. `Cmd/Ctrl + B` toggles list ⇄ board directly.

Two save modes, and this distinction matters:
- **Personal**: just customize; the change persists for *you* on that view even after navigating away.
- **Set as default**: writes the configuration as the workspace-wide default for that page. Everyone sees it when they first open the view, and can still layer personal preferences on top.
- **Reset to default** reverts personal tweaks.

#### Layout
**[C]** List ⇄ Board on issue views. Project & initiative views: List ⇄ Timeline, and projects also support Board.

#### Grouping (issue views)
**[C]** Verbatim list: **status, assignee, project, priority, cycle, label, parent issue, team, customer, release, SLA status**, plus **No grouping**, plus **Focus** (My Issues only).

For the rebuild, the in-scope set is: **No grouping, Status, Assignee, Priority, Project, Label, Team, Parent issue**.

**[C]** "No grouping removes all categorization and is especially useful when applying ordering and filters. **Grouping settings will affect whether you can order issues manually.**" (Manual reordering across the whole list requires *No grouping* — see §7.3.)

**[C]** Beside each group header, a number shows either total issue count or total estimate for that group; **click it to toggle**.

#### Grouping (project / initiative views)
**[C]** lead, member, status, health, start date, target date — and for projects, also initiative and label group.

#### Sub-grouping (swimlanes)
**[C]** Available in lists and in boards (as rows). "In board view having rows helps for a swim-lane style structure." The grouping header is **sticky** on scroll. **Dragging an issue between groupings automatically applies that grouping's property to the issue** — this is true for sub-groups as well as columns.

#### Ordering
**[C]** Verbatim list: **Status, Manual, Priority, Last created, Last updated, Due date, Link count.**

- Sort direction is reversible **except** for Manual.
- **Status ordering has two different behaviors depending on layout** — this is subtle and worth reproducing:
  - **List views**: ordered "from **closest to done → farthest from done**, followed by completed and canceled issues. This helps to surface active work without scrolling through the backlog."
  - **Board views**: "always ordered with statuses from **first to last**" (i.e. the team's configured workflow order, Backlog → … → Canceled).
- **[C]** Due-date ordering: "Issues with a due date will show up at the top of each group."
- **[C]** Board and list **cannot be ordered independently** — "If a List view is ordered by priority for example, Board view will be ordered the same way."

#### Sub-issues toggle
**[C]** On = show sub-issues inline in the list. Off = only parent issues and issues without sub-issues.

#### Show empty groups
**[C]** On = render groups/columns containing zero issues.

#### Display properties
**[C]** The full toggle list, verbatim: **ID, status, assignee, priority, SLA, project, due date, milestone, cycle, release, estimate, labels, links, customers, customer revenue, time in status, created date, updated date, pull requests and commits, Sentry issues.** Some only appear when the relevant feature is on.

**[C]** Crucial distinction the docs spell out: "**This is different from filters**; filters will refine the list to only issues with certain properties while display options show all issues in the list but hide or show data on the issue item or board card."

For the rebuild the in-scope display properties are: **ID, status, assignee, priority, project, due date, milestone, estimate, labels, links, created date, updated date**.

### 6.2 Filters

**[C]** ([filters](https://linear.app/docs/filters))

Opened with **`F`**. A view can hold multiple filters simultaneously.

#### Filterable fields (Linear's own quick-filter table, verbatim)

| Property type | Quick-filter shortcut (type the value directly) |
|---|---|
| Team | Team name |
| Status | Status name |
| Assignee | Username |
| Created by | Username |
| Priority | "High", "Low", etc. |
| Labels | Label or label group name |
| Content | *(no quick filters)* |
| Cycle | Active, Upcoming |
| Project | Project name |
| Subscriber | Username |
| Relations | *(top-level filters)* |
| Date filters | "N days", Month, Quarter, Half-year, Year |
| Links | Front, Zendesk, Intercom, custom link source |
| Milestone | Milestone name |
| Added to cycle | *(see below)* |

Plus, documented elsewhere: **estimate** ([estimates](https://linear.app/docs/estimates)), **due date** ([due-dates](https://linear.app/docs/due-dates)), **sub-issue filters** (top-level only / has sub-issues / only sub-issues) ([parent-and-sub-issues](https://linear.app/docs/parent-and-sub-issues)), **SLA status**, **recurring issues**, **project label** ([project-labels](https://linear.app/docs/project-labels)).

#### Operators

**[C]** verbatim:

| Operator | When it appears |
|---|---|
| `is` / `is not` | one option selected |
| `is either of` / `is not` | multiple options selected |
| `includes any` / `includes all` / `includes neither` / `includes either` / `includes none` | labels and links |
| `before` / `after` | date filters |

**[C]** The interaction model, exactly: "for a filter that says *Assignee is Andreas*, clicking on **Assignee** does nothing, clicking on **is** gives you the option to change the operator to *is not*, and clicking on **Andreas** shows a selectable list to modify the assignee. If you add another assignee, Adrien, then you'll see the `is` operator change to `is either of` / `is not`." **The filter's field cannot be changed once added** — only the operator and the values.

#### AND / OR semantics

**[C]** — top-level filters are implicitly **AND**-ed. For anything richer, the filter menu has an **Advanced filter** entry: "Advanced filters let you build more precise views by **grouping conditions and combining them with AND/OR logic (including nested filter groups)**. From the filter menu, choose *Advanced filter* to open the builder, add conditions, and adjust the logic between them."

**[I]** Data shape for a saved filter:
```
FilterNode = { op: "and" | "or", children: FilterNode[] }
           | { field, operator, values[] }
```

#### Documented gotchas **[C]**
- To filter for *no labels*, you must select **all** labels and then flip the operator to *does not include*. (There is no explicit "is empty".)
- To filter by **milestone you must filter by project first**.
- You **cannot filter for suspended users**; go to their profile page instead.
- **Date filters** offer relative and absolute forms: *Overdue, 1 day from now, 1 week from now, 3 months from now, Custom date or timeframe, No due date* (from the due-dates page).
- **Added to cycle** is distinct from **Cycle** — it answers *when* an issue was added relative to the cycle's start (`Planned` = before start or within 24h of it; `After cycle` = >24h after start). Cycles are out of scope, but the pattern (a derived temporal filter) is instructive.

#### Filters in the URL
**[C]** "The applied filters are also reflected in the browser URL. You can copy the browser address to share the filtered view; opening the link applies the same filters. **Only the main filters are included in the URL. View options, quick filters, and Insights filters aren't included.**"

**[I]** Implement as a compact serialized query param, e.g. `?filter=<base64 json>`, and **do not** serialize display options.

### 6.3 Search-within-view

**[C]** `Cmd/Ctrl + F` opens a quick-search bar next to Display Options. It behaves as a **temporary filter** — matching issues stay, others vanish as you type. It matches **exact issue ID or words in the title only** (not description, not comments). `Esc` clears.

### 6.4 Saved / custom views

**[C]** ([custom-views](https://linear.app/docs/custom-views))

Creation:
- Sidebar → **Views** → pick type (**Issue / Project / Initiative**) → **New view**
- Or, from any filtered list/board, **`Option/Alt + V`** or the **Save view** icon (which only appears once at least one filter is applied)

What is saved **[C]**: **filters + grouping + ordering + display options**. All of it persists when the view is reopened.

Visibility scoping **[C]**:
| Scope chosen at creation | Where it appears | Who sees it |
|---|---|---|
| Workspace | *Workspace views* on the Views page | all full members (not guests) |
| A specific team | *Team views* | members of that team |
| A specific project / initiative | scoped to it | anyone with access |
| "All teams" + filters | Workspace views | full members; filters restrict the content |

**[C]** "Sharing a link does not automatically give anyone access to a view, it must be shared first."

Other view mechanics **[C]**:
- **Owner**: every view has an owner, defaulting to the creator, reassignable. Shown in the view's sidebar and the Views page.
- **Edit / Duplicate**: click the view name inside the view → *Edit view…* / *Duplicate view…*
- **Favorite**: star it → it appears in the sidebar; favorited views can be set as your default landing page in *Settings → Account → Preferences*.
- **Contextual views**: from a team's Issues/Projects section, or from inside a project, you can create views that appear as **tabs alongside** the defaults, drag-reorderable.
- **View sidebars**: the right-hand sidebar on a view offers quick filtering — issue views show assignees, labels, projects; project views show leads, teams, initiatives, health.
- **View subscriptions**: subscribe to be notified when an issue is *added to the view* and/or when one is *completed/canceled*. You are never notified for your own actions.
- `t` while hovering a group header collapses/expands it (list view).
- `O` then `V` opens the view switcher.

### 6.5 Default pages every team has

**[C]** ([default-team-pages](https://linear.app/docs/default-team-pages), [teams](https://linear.app/docs/teams))

| Page | Contents | Shortcut |
|---|---|---|
| **Team home / Overview** | Landing page: pinned resources, team members, shortcuts to settings/triage/issues/projects/views. Tabs: Overview, Documents, Members. | click team name; `O` then `T` |
| **Issues → All issues** | "all issues across the selected team that are **not archived or deleted**" — **includes completed and canceled** | — |
| **Issues → Active** | statuses of type `unstarted` **or** `started` (default set: Todo + In Progress). Excludes Backlog, Completed, Canceled. | `G` then `A` |
| **Issues → Backlog** | statuses of type `backlog` | `G` then `B` |
| **Triage** *(opt-in)* | see §8 | `G` then `T` |
| **Cycles** *(opt-in)* | out of scope | — |
| **Projects** | all projects assigned to the team | — |
| **Views** | custom views for team + workspace | `O` then `V` |
| **Archive** | archived issues/cycles/projects + recently-deleted (30 d) | `G` then `X` |

Workspace-level, above the teams in the sidebar **[C]**: **Inbox** (`G` then `I`), **My Issues** (`G` then `M`), **Drafts**, **Views**, **Projects**, **Initiatives**, **Favorites**, and (feature-gated) Pulse / Reviews / Customers.

---

## 7. LIST vs BOARD

**[C]** ([board-layout](https://linear.app/docs/board-layout), [display-options](https://linear.app/docs/display-options))

### 7.1 Board mechanics

- Toggle with **`Cmd/Ctrl + B`**, or the board/list icons next to Display options.
- **Boards default to grouping by Status.** Grouping can be changed to **Project, Priority, Cycle, Label, Label group, SLA status**, and more — the same grouping list as lists.
- **One column per group value.** Column order when grouped by status = the team's configured workflow order, first to last.
- **`+` at the top of a column** creates an issue directly in that column (pre-set to that group's value).
- **Hide a column**: column `…` menu → *Hide*. Hidden columns collect at the far right of the board. **You can still drag issues into a hidden column without unhiding it.**
- **Show empty groups** off ⇒ empty columns disappear.
- Horizontal scroll: `Shift` + vertical scroll, trackpad horizontal scroll, or click-and-drag on empty board space.
- **Swimlanes**: sub-grouping renders as rows. `T` collapses/expands a swimlane.
- **`Space` while hovering a card** peeks at more detail.
- **Descriptions are never shown on cards.** If an issue has many properties, not all fit on a card.
- Board layout is not available in **Triage** or **Inbox**.
- There is **no workspace-wide "board by default"** setting; the closest thing is *Set as default* on one specific view.

### 7.2 What dragging does

**[C]** — "You can drag and drop issues between each grouping and **it will automatically adopt the properties of that grouping**."

So the drop target's group value is written to the underlying field:

| Grouped by | Dropping into a column sets… |
|---|---|
| Status | `issue.statusId` |
| Assignee | `issue.assigneeId` |
| Priority | `issue.priority` (**[C]** for projects: "Dragging a project into a priority group will apply that same priority") |
| Project | `issue.projectId` |
| Label | adds that label (**[I]** — and presumably removes the previous label from the same group) |
| Team | `issue.teamId` |
| Cycle | `issue.cycleId` |

Plus the drop **position** writes the manual sort key (§7.3).

### 7.3 Manual ordering & how it persists

**[C]** — This is the single most important behavioral detail in the whole feature and it is not what most clones do:

> "Manual ordering is default for board views and can be selected in most list views. To move issues around, select them with your mouse and drag them to a new position. **Manual ordering is unique in that it will update the manual order for everyone in the workspace.**"

And for priority ordering: "The exact position will be saved **globally across your workspace**, so that anyone else looking at a view ordered by priority will see these issues or projects in the same relative positions."

So: **the manual sort key is a global property of the issue, not a per-user or per-view preference.**

**[I] Implementation**: store a single `sortOrder` (fractional index / LexoRank string) on the issue. On drop, compute a key strictly between the neighbours. Linear's own API exposes a `sortOrder` float on issues, which corroborates the single-global-key model. Do **not** store an ordered array per view.

**[C]** Keyboard reordering, which requires a specific configuration:
- In Display Options set **Grouping: No grouping** and **Ordering: Manual**
- `Option/Alt + Shift + ↑ / ↓` → move selected issue(s) to the **top / bottom**
- `Option/Alt + ↑ / ↓` → move in single increments
- In board view, `Option/Alt + Shift + ↑ / ↓` moves to top/bottom of the **column**

**[C]** Placement rule when changing column by keyboard vs mouse: "when you move issues to a new column on a board, it will go to **the top** if you make the change with the keyboard shortcut `S` or the command menu, and to **wherever you placed it** if you used the mouse."

### 7.4 Selection model (shared by list and board)

**[C]** ([select-issues](https://linear.app/docs/select-issues))

- **Highlight** ≠ **select**. Hovering or `↑/↓`/`J/K` *highlights*; single-key shortcuts act on the highlighted issue.
- **Select**: `X` on a highlighted issue, `Shift`+click, or click the checkbox that appears near the left edge on hover.
- **Multi-select**: `X` on each; or hold `Shift` and use `↑/↓` to extend a contiguous range; or `Cmd/Ctrl + A` to select all in the current (filtered) list or board.
- **Deselect all**: `Esc`.
- **Act**: `Cmd/Ctrl + K` for the command bar, or right-click for the contextual menu. A **bulk-action toolbar appears at the bottom** with common actions.
- All property shortcuts work in bulk — e.g. `Cmd/Ctrl+A` then `P` sets priority on everything selected.

---

## 8. TRIAGE

**[C]** ([triage](https://linear.app/docs/triage))

### 8.1 What it is

"Triage is a **special inbox for your team**. When an issue is created by integration or by a workspace member not belonging to your specific Linear team, it will appear here. Triage offers an opportunity to review, update, and prioritize issues before they are added to your team's workflow."

Enable per team: **Team Settings → Triage**, toggle on. Triage then appears under the team name in the sidebar.

### 8.2 How issues enter Triage

**[C]** An issue defaults to **Triage** status when:
1. It is created through an **integration** (Slack, Sentry, email intake, Asks, …)
2. It is created while the user is **inside the Triage view**
3. It is created by a workspace member who is **not a member of that team**

A **default template** configured in *Team Settings → Templates* can override the triage status.

### 8.3 Actions

**[C]**

| Action | Shortcut | Effect |
|---|---|---|
| **Accept** | `1` | Offers to leave a comment, then moves the issue to the **team's default status** |
| **Mark as duplicate** | `2` or `M` `M` | Choose the canonical issue. **Moves the new issue's attachments and customer requests to the canonical issue**, then sets the new issue to a **Canceled** status type |
| **Decline** | `3` | Sets the issue to a **Canceled** status type; offers an optional explanation comment |
| **Snooze** | `H` | Hides it from the triage queue until a chosen time **or until there is new activity on the issue — whichever comes first**. Snoozing hides it from *other* users too by default. Toggle *Show snoozed* in View Options to see them. |

Navigation: `G` then `T` = this team's triage; `O` then `T` = pick another team's triage.

### 8.4 Important visibility rule

**[C]** FAQ, verbatim: *"By default, **we exclude triage issues from all views** since triage is considered to be outside the normal workflow. To include them in a custom view, you need to explicitly include them by adding a status filter where 'Triage' is included."*

This is a global query predicate: every issue list must implicitly exclude `state.type = 'triage'` unless the filter names it.

### 8.5 Other

**[C]**
- **Require priority before leaving triage** is a configurable team setting.
- **Triage responsibility**: designate members to be notified of / auto-assigned incoming issues, optionally rotated from PagerDuty / OpsGenie / Rootly / Incident.io. Members see who's currently on triage duty when creating issues.
- **Triage rules** (Business/Enterprise): condition → action automation that can set team, status, assignee, label, project, priority. Rules run top-down; moving to another team's triage re-applies **that** team's rules.
- **Triage Intelligence** (LLM suggestions) — out of scope.

---

## 9. PROJECTS

**[C]** ([projects](https://linear.app/docs/projects), [project-status](https://linear.app/docs/project-status), [project-milestones](https://linear.app/docs/project-milestones), [initiative-and-project-updates](https://linear.app/docs/initiative-and-project-updates), [project-priority](https://linear.app/docs/project-priority))

"Projects are units of work that have a clear outcome or planned completion date, such as a new feature's launch, and are comprised of issues and optional documents."

### 9.1 Fields

Only **name** is required. Linear recommends also setting a **lead** and an **icon**.

| Field | Type | Notes |
|---|---|---|
| name | string, required | |
| icon | emoji/glyph + color | **[C]** recommended at creation |
| description / summary | rich text | CSV export distinguishes **Summary** (short) from **Description** (long body on the overview page) **[C]** |
| status | FK → ProjectStatus | see §9.3 — **manual only** |
| health | enum | see §9.4 — set via project **updates** |
| priority | enum 0–4 | same enum as issues; `P` then `P` sets it **[C]** |
| lead | FK → User, nullable | **exactly one**. "We have a single lead field to keep ownership of the project clear." |
| members | many-to-many Users | "If more people are involved with the project, consider adding them as members, however **members have to opt-in to receive notifications**." |
| teams | many-to-many Teams, ≥1 | multi-team projects grow per-team tabs |
| initiatives | many-to-many | out of scope |
| labels | many-to-many | project labels, grouped, mutually exclusive within a group |
| startDate | **timeframe** | see §9.2 |
| targetDate | **timeframe** | see §9.2 |
| milestones | 1..n | see §9.5 |
| documents | 1..n | project-scoped docs |
| resources / links | list | external files & links |
| creator, createdAt, startedAt, updatedAt, completedAt, canceledAt, archivedAt | timestamps | from the CSV export field list **[C]** |

### 9.2 Timeframes (start / target date)

**[C]** — "Rarely will a project's precise end date be known in its early stages. Select start and target dates that match your level of certainty. Options are available to choose a **year, half-year, quarter, month or precise day**."

**[I] Data shape**: store `(date, granularity)` where granularity ∈ `{day, month, quarter, half, year}` — or, as Linear's own CSV export implies with columns `Start Date (Start)` / `Start Date (End)`, store the **resolved range** `[start, end]` plus the granularity label. The export having both a start *and* an end column for a single date field is strong evidence for the range model.

### 9.3 Project status (lifecycle)

**[C]** — Project statuses are **fully custom**, like issue statuses, and organized into **five fixed categories**:

| Category |
|---|
| Backlog |
| Planned |
| In Progress |
| Completed |
| Canceled |

"Project statuses can have customized **name, description, and color**, which is configured in **Settings → Projects → Statuses**. You can have **multiple statuses within** the available project status categories."

Note the scope difference from issue statuses: project statuses are **workspace-level** (Settings → Projects), whereas issue statuses are **per-team**.

**[C]** Critical: "**Project statuses are updated manually — we do not do this automatically, even if all issues are completed.**"

**[C]** The status appears next to the project name in initiative/timeline pages and as an icon on the project bar.

### 9.4 Project health (≠ status)

**[C]** — Health is a **separate axis** from status, and it is set **as part of writing a project update**, not as a standalone field edit.

| Health value | Color |
|---|---|
| **On track** | green |
| **At risk** | yellow |
| **Off track** | red |
| *(no current update)* | grey |

**[C]** Additional derived health states, from the staleness rules:
- **Update Missing** — shown when (a) the last update said *On Track* **and** (b) an update is *one reminder cycle + 3 days* overdue. A **dashed outline** on the health icon marks "slightly overdue" before it goes grey.
- **No Update expected** — when the project is completed, or its update schedule is set to *Never*.

### 9.5 Project updates

**[C]**
- Written from the Project (or Initiative) **Overview** page via the **pencil icon** on the latest update.
- **The lead posts the first update; after that any workspace member can write one.**
- An update = **health indicator + rich-text body** (formatting, file uploads).
- The **most recent update** shows on the Overview; the full history is on an **Updates tab**, chronological, alongside property changes (target date, members, milestones).
- **Emoji reactions** on updates. **Comments** on updates, with their own notification thread (author + participants get Inbox notifications).
- **Edit**: only the update's creator sees the pencil. **Delete**: `…` beside the update.
- **Auto-generated progress digest** is appended to a project update: delays, target-date changes, new leads, milestone progress, overall progress — **only if overall progress changed by more than 2%** since the last update. The author can **Hide details** to exclude it.
- **Reminders**: workspace-level cadence (daily / weekly / biweekly, with day + time), overridable per project to *follow workspace default* / *custom schedule* / *never*. Reminders only fire for projects whose status category is **In Progress** and that have a lead, and only if the lead hasn't posted in the last 24h. Follow-up nudges at **+1 working day** and **+2 working days**.

### 9.6 Project overview page & tabs

**[C]**
- **Tabs**: `Overview`, `Issues`, plus any **custom issue views attached to the project** (created with the "new view" icon next to Issues; drag to reorder; right-click for copy link / favorite / edit / delete), plus **per-team tabs** when the project spans multiple teams, plus a **Customer requests** tab once the first request is added (out of scope).
- **Overview content**: summary, properties, associated documents and links, full description, project milestones, progress graph.
- **Project details sidebar**: `Cmd/Ctrl + I` toggles it. Edit any property from here, add external files, create project documents, view the progress graph.
- **Delete**: `…` next to the project name → Delete (or right-click the project in a list). Lands in the team archive's *Recently deleted projects* for **30 days**.
- **Archive**: automatic. A project archives once it is in a completed/canceled status, has **no unarchived issues remaining**, and has been inactive for the auto-archive period. Its issues archive **at the same time as the project**, even if they closed much earlier — "in order to not affect project statistics." Consequence: **closed issues in an open project never archive.**

### 9.7 Attaching issues

**[C]**
- `Shift + P` on selected issue(s) — adds to a project or moves between projects
- `C` while inside a project view — creates an issue already in that project
- Or set the Project property on the issue directly
- **One project per issue.**
- **[C]** Project picker ordering (the default list you see when adding a project to an issue): *projects you lead → projects you're a member of → recently created by you → projects with overlapping teams → active → recently created → cancelled and completed.*

### 9.8 Milestones

**[C]** ([project-milestones](https://linear.app/docs/project-milestones))

| Field | Notes |
|---|---|
| name | required |
| description | optional |
| targetDate | optional, set at creation or later |
| position | manual order within the project |
| progress % | **computed**, not stored |

- **Attach an issue**: `Shift + M`, command menu "Add to milestone", **drag-and-drop onto the milestone in the project details pane**, or accept the auto-suggestion when creating an issue inside a project that has milestones.
- **Reorder**: hover, drag the `⋮⋮` handle, in the project overview or details pane.
- **Convert a milestone into its own project** via the overflow menu.
- **Progress**: "starts counting the moment an issue moves to a *started* status, and increases further once it's completed."
- **Icon**: a **diamond** whose fill changes with completion; **yellow** marks the current focus milestone.
- Issue lists can **filter and group by milestone** — but you must filter by project first.

### 9.9 Project views

**[C]** Team-level Projects page and workspace-level Projects page; both support **list, board, timeline**. Timeline supports zoom (week / month / quarter / year) and two-finger horizontal scroll. Display options include a **Completed projects** control on the Active tab: show projects completed in the last week / month / year, or all, or none.

---

## 10. TEAMS

**[C]** ([teams](https://linear.app/docs/teams), [private-teams](https://linear.app/docs/private-teams), [sub-teams](https://linear.app/docs/sub-teams))

### 10.1 Fields

| Field | Notes |
|---|---|
| name | **[C]** editable in *Team settings → General* |
| identifier / key | **[C]** editable in *Team settings → General*; drives issue IDs |
| icon + color | **[I]** — the docs reference team icons in the sidebar but never document the picker |
| timezone | **[C]** *Team settings → General* |
| private | **[C]** boolean; Business/Enterprise only |
| parentTeam | **[C]** sub-teams; Business/Enterprise; up to 5 levels on Enterprise |
| estimates enabled + scale + extended + allowZero + unestimatedCountsAsOne | **[C]** |
| triage enabled | **[C]** |
| autoClose period, autoArchive period | **[C]** |
| default status | **[C]** |
| issue-creation-by-email toggle + address | **[C]** |
| detailed issue history toggle | **[C]** — *Team settings → General* has a "toggle detailed issue history" switch |
| cycles enabled + schedule | **[C]** — out of scope |
| SCIM group mapping | **[C]** — out of scope |

### 10.2 Team settings pages

**[C]** verbatim list:

| Page | Configures |
|---|---|
| **General** | name, identifier, timezone, estimates, issue creation by email, detailed issue history |
| **Members** | team membership; promote to team owner |
| **Issue labels** | team-level labels and label groups |
| **Templates** | team-level issue / project / document templates |
| **Recurring issues** | out of scope |
| **Slack notifications** | out of scope |
| **Issue statuses & automations** | workflow statuses, git automations, branch naming, auto-close, auto-archive |
| **Triage** | enable Triage, triage responsibility |
| **Cycles** | out of scope |
| **Access and permissions** | team visibility, join restrictions, per-capability owner-only toggles, issue sharing |
| **Danger zone** | make private, retire team, delete team |

### 10.3 Public vs private

**[C]**

| | Public team | Private team |
|---|---|---|
| Discoverable | Yes, by all workspace members | No — invisible to non-members |
| Joinable | Any member can self-join (unless the team owner has restricted joining) | Invite from a team owner only |
| Issues visible | To everyone | Only to team members |
| @mention | Anyone | **"You cannot @mention a member in an issue in the private team if they are not already a member of the private team."** |
| Plan | All | Business & Enterprise |

**[C]** Additional private-team rules:
- Anyone in the workspace can *create* a new private team; only workspace owners/admins/team owners can *change the visibility* of an existing team.
- **On converting a team to private: "non-members will be removed from active issue assignments, and non-member subscribers will be unsubscribed from issues in that team."** This is a real data migration, not just an ACL flip.
- The person who creates/converts a private team becomes its default **owner**.
- Members of a private team can leave on their own but **cannot re-join without an explicit invite**.
- Admins can see all private teams in *Settings → Administration → Teams* and can join by adding themselves (with a confirmation warning). On Enterprise only *owners* can do this.
- Projects: a project under a public team can also be shared with a private team — only private-team members see that association. If **all** public teams are removed from a project, the project becomes private.
- Sub-teams under a private parent are either **Restricted** (default — parent-team members can see and join) or **Private** (only explicitly added people). A private parent can only have private sub-teams.

### 10.4 Membership

**[C]**
- A user may belong to **many teams**.
- Self-join / self-leave: hover the team name in the sidebar → `···` → *Join team* / *Leave team…*
- Admins add users in *Settings → Administration → Members*.
- **You do not have to join a team to work with it**: "Anyone in the workspace can create issues for other teams or be assigned issues in other teams." Navigating to a team you're not in puts it in a temporary **"Exploring"** section of your sidebar.
- Team owners can restrict joining to invite-only even for non-private teams.

### 10.5 Team limits & lifecycle

**[C]**

| Plan | Team limit |
|---|---|
| Free | 2 |
| Basic | 5 |
| Business | Unlimited |
| Enterprise | Unlimited |

- Admins can restrict team creation to admins only (*Settings → Administration → Security*).
- **Copy team settings…** at creation clones another team's configuration.
- **Retire a team** (soft): the team becomes **read-only** — settings locked, issues viewable but not editable, removed from sidebars. Projects associated *only* with retired teams also become read-only. Restorable any time.
- **Delete a team**: permanently deletes its issues. **30-day** grace period in *Settings → Teams → Recently deleted*.

---

## 11. MEMBERS, ROLES & PERMISSIONS ★ (critical for the rebuild)

**[C]** ([members-roles](https://linear.app/docs/members-roles), [invite-members](https://linear.app/docs/invite-members), [workspaces](https://linear.app/docs/workspaces), [private-teams](https://linear.app/docs/private-teams))

### 11.1 The role model — two axes

Linear has **two orthogonal role axes**. Getting this wrong is the single biggest structural risk in a clone.

```
WORKSPACE ROLE  (one per user per workspace)
  Owner  >  Admin  >  Member  >  Guest

TEAM ROLE       (per user per team)
  Team owner  >  Team member
```

Workspace admins and owners are **automatically team owners of every team they can access**. Guests can **never** be team owners.

### 11.2 Workspace roles — capability matrix

Compiled from the members-roles page. Cells marked **[I]** are inferred from the text ("cannot access workspace-level administration pages") rather than an explicit table.

| Capability | Owner | Admin | Member | Guest |
|---|:--:|:--:|:--:|:--:|
| **Plan availability** | Enterprise only | all plans | all | Business/Enterprise |
| Billing & plan changes | ✅ | ✅ *(configurable)* | ❌ | ❌ |
| Security settings (SAML/SCIM, invite links, approved domains, workspace restrictions) | ✅ | ⚠️ configurable | ❌ | ❌ |
| Audit logs | ✅ | ❌ **[C]** | ❌ | ❌ |
| Workspace export (CSV) | ✅ | ✅ *(Owner-only on Enterprise)* | ❌ | ❌ |
| OAuth app approvals | ✅ | ❌ | ❌ | ❌ |
| Team access management (see/join all private teams) | ✅ | ✅ *(non-Enterprise)* | ❌ | ❌ |
| Rename workspace / change URL | ✅ | ✅ | ❌ | ❌ |
| Delete workspace | ✅ | ⚠️ configurable | ❌ | ❌ |
| Invite members | ✅ | ✅ (default) | ⚠️ only if *Allow users to send invites* is on | ❌ |
| Change a member's role | ✅ | ✅ | ❌ | ❌ |
| Suspend a member | ✅ | ✅ | ❌ | ❌ |
| Add / remove team members | ✅ | ✅ | ⚠️ per-team setting | ❌ |
| Add **guest** users to a team | ✅ | ✅ | ❌ — **"Only team owners can add guest users, regardless of this setting."** | ❌ |
| Create teams | ✅ | ✅ | ⚠️ unless restricted to admins | ❌ |
| Manage workspace labels | ✅ | ✅ | ❌ **[I]** | ❌ |
| Create custom **project statuses** | ✅ | ✅ | ❌ **[I]** | ❌ |
| Manage workspace templates | ✅ | ✅ | ❌ **[I]** | ❌ |
| Configure integrations | ✅ | ✅ | ❌ | ❌ |
| **Create / edit / delete issues** in accessible teams | ✅ | ✅ | ✅ | ✅ (their teams only) |
| **Comment** | ✅ | ✅ | ✅ | ✅ |
| Create / view **projects** | ✅ | ✅ | ✅ | ✅ (their teams only) |
| **Workspace views** | ✅ | ✅ | ✅ | ❌ |
| **Initiatives** | ✅ | ✅ | ✅ | ❌ |
| **Customer requests** | ✅ | ✅ | ✅ | ❌ |
| **Pulse** | ✅ | ✅ | ✅ | ❌ |
| Settings pages beyond own Account tab | ✅ | ✅ | limited | ❌ |
| Export issues from a view | up to 2,000 | up to 2,000 | up to 250 | ❌ **"Guest users cannot export issues"** |
| Export projects/initiatives | 200 | 200 | 200 | ❌ |

**[C]** Plan-dependent defaults:
- **Free plan: every user is an Admin.**
- Basic / Business: the user who upgraded the workspace becomes the Admin.
- Enterprise: Owner exists; Admins have reduced permissions; Owners can reconfigure which roles may perform which workspace-level actions under *Settings → Administration → Security → Workspace restrictions*.

**[C]** No "delete issue" permission is documented as role-gated. **[I]** Any member with access to an issue can delete it, and the 30-day *Recently deleted* window is the safety net rather than a permission check. Reimplement it this way.

### 11.3 Team owners (Business/Enterprise)

**[C]**

Who is a team owner automatically:
- every workspace admin / owner, for every team they can access
- the **creator** of a newly created team
- anyone promoted by an existing team owner or a workspace admin/owner

No limit on how many; a team is not required to have one. **Guests cannot be team owners.** Team owners of a parent team are team owners of its sub-teams.

**Team-owner-only operations (hard-coded, not configurable) [C]:**
1. Deleting a team
2. Making a team private
3. Changing a team's parent

**Configurable per-team capability gates** (*Team settings → Access and permissions*), each toggled between *all members* and *team owners only* **[C]**:
- **Issue Label Management** — who can create/edit team issue labels
- **Template Management** — who can create/edit team templates
- **Team Settings Management** — who can manage workflow statuses, cycles, triage rules, agent guidance, other team settings
- **Member Management** — who can add users to the team *(guests always team-owner-only)*

**[C]** "Permission settings are **not inherited** from parent team to sub-team."

**[C]** **Team access**: by default any workspace member can join a non-private team; team owners can restrict joining to invite/add only.

### 11.4 Guests in detail

**[C]**

**Can:**
- access issues, projects and documents for the teams they're **explicitly added to**
- take the same actions as Members **within those teams** — create, edit, comment, create projects

**Cannot:**
- see or discover any other team, or its issues
- use workspace-wide features: workspace views, customer requests, initiatives, Pulse
- access any settings beyond their own **Account** tab
- export issues
- be a team owner

**[C]** Multi-team projects and guests: "Guests will only see issues belonging to the teams they're part of. They will still see the **project shell**, but only with their allowed team's issues visible." So the project entity is visible; its issue list is filtered.

**[C]** Guests are **billed as regular members** — the role is about scope, not cost.

### 11.5 Invites

**[C]** ([invite-members](https://linear.app/docs/invite-members))

Flow:
1. *Settings → Administration → Members* → **Invite**
2. Enter one or more email addresses, comma-separated
3. Under **"Invite as…"** pick the role (paid plans only — on Free everyone is an Admin)
4. Optionally pick **team(s)** the invitee auto-joins
5. **Send invites** → each invitee receives an **invite link by email**

Who may invite **[C]**:
- Free: anyone (all are admins)
- Paid: Admins only by default. Admins can flip **"Allow users to send invites"** in *Settings → Administration → Security*.

Two additional join paths **[C]**:
- **Approved email domains** — *Settings → Administration → Security*. Anyone with a matching email domain can join **without an invitation or approval**. The docs explicitly warn to review this list and remove domains you no longer control.
- **Invite links** — a single reusable, persistent URL generated in Security settings; **"Reset invite link"** rotates it. Unavailable in SAML/SCIM workspaces.

**Invite & Assign [C]** — a genuinely distinctive behavior: *"Invited users can be assigned issues or marked as project leads **before they accept their invitation**. On any issue or project, open the assignee selection menu and choose **'Invite and assign…'**."* So a pending-invite user must be a first-class assignable entity in your data model.

**[C]** The *Members* settings page lists all active and suspended members and filters by **role** or **status** — *Pending invites*, *Suspended*, *left the workspace*.

### 11.6 Changing roles, suspending, leaving

**[C]**
- **Change role**: Members page → hover row → `⋯` → **Change role…**
- **Suspend**: Members page → hover row → `⋯` → **Suspend user…**. "Suspended users lose all access **immediately** and are removed from your next billing cycle. **They remain visible in the members list for historical purposes** — for example, when viewing issues they created or were assigned to." API tokens are revoked. Their issue activity stays visible at `linear.app/<workspace>/profiles/<username>`.
- **You cannot filter views by suspended users** — you have to go to their profile page.
- Any member can find the admins: `Cmd/Ctrl+K` → **View workspace admins**, or `linear.app/settings/view-admins`.
- A user can **leave** a workspace without deleting their account; deleting the account is separate.
- **Delete workspace**: owner (or admin, if permitted) starts it; a confirmation code is emailed; the workspace is scheduled for deletion in **48 hours** and all admins are emailed; any admin can cancel in that window.

### 11.7 Project membership

**[C]**

| Role on a project | How set | What it means |
|---|---|---|
| **Lead** | single user field | Owns the project; "in charge of writing the spec and general execution"; posts the first project update; receives update reminders. Only **one** — deliberately. |
| **Member** | multi-user field | Collaborator. **"Members have to opt-in to receive notifications."** Auto-added to the project's Slack channel if that automation is on. |

**[C]** Editing rights are **not** derived from project membership. Project visibility and editability come from **team** membership: anyone who can see the project's team(s) can see and edit the project. Project lead/member are ownership and notification signals, not an ACL. (The only ACL-like effect is guests seeing a filtered issue list on a multi-team project.)

**[I]** Implement `ProjectMember` as a pure join table with no permission bits; enforce authorization at the team level.

---

## 12. COMMENTS & ACTIVITY

### 12.1 Comments

**[C]** ([comment-on-issues](https://linear.app/docs/comment-on-issues))

- **Who**: "All users with access to an issue can post comments and threaded replies."
- **Composer**: the "Leave a comment…" box at the bottom of the issue. Unlike the description (which autosaves), **a comment requires an explicit submit** — the **Comment** button or `Cmd/Ctrl + Enter`. *(Preference: whether `Enter` or `Cmd/Ctrl+Enter` submits is user-configurable in Preferences.)* **[C]**
- **Unsent comments are visible on the issue and appear in the sidebar Drafts.** **[C]**
- **Attachments**: paperclip icon, `Cmd/Ctrl + Shift + A`, or drag-and-drop. **[C]**

**Threads [C]**:
- Hover a top-level comment → click the **Reply to comment** arrow icon (top right of the comment) → a thread opens beneath it
- If a thread already exists, type into the box at the bottom of that thread
- **Two levels only**: root comment → replies. No reply-to-a-reply nesting is documented.
- **Resolve a thread** from the overflow menu on the **root message**. You may also resolve *from a specific reply*, which surfaces that reply as the resolution.

**Edit / delete [C]** — `…` at the **top right of the comment**:
- **Edit** (own comments only) → **Save**
- **Delete**
- Manage subscription to that thread
- **Copy URL to the comment** (comments are individually addressable)
- **Create a new issue from the comment**
- **Create a sub-issue from the comment**

**Reactions [C]** — emoji reactions on: the **issue description itself**, **individual comments**, **threads**, **project updates**, and **initiative updates**. "All official Unicode emojis are available by default. Custom emojis can be uploaded individually (JPG, GIF, and PNG formats are supported)."

**Inline comments on descriptions [C]** — highlight text in a description → comment icon in the formatting toolbar, or `Cmd ⌥ M` (Mac) / `Ctrl Alt M` (Win). The comment is anchored to that exact span. Also works in documents and project overviews. Images can be commented on too.

**@mentions [C]** ([editor](https://linear.app/docs/editor)) — `@` mentions a **user, issue, project, date, or document**. Mentioning a **user** sends an Inbox notification **and subscribes them to the issue**. Mentioning an **issue** (`@ENG-123`, or pasting the ID/URL) **automatically adds it as a *related* issue**.

### 12.2 Activity feed

**[C]** — every issue has an **Activity feed** interleaved with comment threads.

Recorded events (assembled from across the docs; the precise wording is **[I]** but the event set is **[C]**):

| Event | Reads roughly as |
|---|---|
| creation | "David created the issue" |
| status change | "David changed status from **Todo** to **In Progress**" |
| assignee change | "David assigned **Sarah**" / "David unassigned" / "David assigned to themselves" |
| delegation to agent | "David delegated to **Agent**" |
| priority change | "David set priority to **Urgent**" |
| label add/remove | "David added label **bug**" |
| estimate change | "David set estimate to **3**" |
| due date set/changed/cleared | |
| project / milestone / cycle change | |
| parent set / removed | |
| relation added / removed | "David marked this as blocked by **ENG-99**" |
| title / description edit | |
| team moved | |
| subscribe / unsubscribe | *(with an unsubscribe control in the feed)* |
| attachment / link added | |
| auto-close | "a history item is published to its Activity feed" **[C, verbatim]** |
| archive | |
| PR/branch linked *(out of scope)* | |

Display rules **[C]**:
- "To reduce clutter and keep the issue activity feed focused, **similar consecutive events are grouped** and **older activity is collapsed between comment threads**."
- Timestamps render **relative** ("3d") normally, and switch to **absolute** when the issue is printed to PDF.
- **Property changes within the first 3 minutes of creation are not logged.**
- *Team settings → General* has a **"toggle detailed issue history"** switch controlling verbosity.
- You can **unsubscribe from the Activity feed** directly (documented as one of the three unsubscribe entry points).

**[C]** The workspace-level counterpart is **My Issues → Activity**, "a historical list of issues where you've added a comment, reacted to a comment, changed its status, linked a pull request, or created, updated, or deleted the issue."

---

## 13. NOTIFICATIONS & INBOX

**[C]** ([inbox](https://linear.app/docs/inbox), [notifications](https://linear.app/docs/notifications))

### 13.1 Subscription — the source of every notification

You are **automatically subscribed** to an issue when you **[C]**:
1. **create** it
2. are **assigned** to it
3. are **@mentioned** in its description or a comment

Plus: @mentioning you in a **comment thread** auto-subscribes you to **that thread specifically**, not the whole issue. **[C]**

Manual **[C]**: `Shift + S` toggles subscribe; `Cmd/Ctrl + Shift + S` manages the subscriber list. Unsubscribe from three places: `Shift+S`, the button in the top menu bar, or the unsubscribe option in the **Activity feed**. From the Inbox list you must **click into** the notification first.

View everything you follow at **My Issues → Subscribed**. **[C]**

### 13.2 What generates a notification

**[C]** — Notification types are **grouped categories**, and "grouped categories cannot be partially selected":

- new **comment** / reply on a subscribed issue
- **@mention** (issue description, comment, document)
- **assignment** to you
- **status changes** category — bundles: issue **completions**, **cancelations**, **urgent-priority changes**, and **changes to blocking relationships**
- **due date** near / past due (opt-in)
- **auto-close** / auto-archive events (notifies subscribers / creator)
- **SLA** breach warnings *(out of scope)*
- **project & initiative update** posted, and comments on updates
- **custom view subscriptions** — issue added to a view, or completed/canceled in it (never for your own actions)
- **reminders** you set on an issue/document/project/initiative
- **[C]** Urgent priority: the assignee is notified, plus an urgent email if email notifications are on

### 13.3 Delivery channels

**[C]** Inbox (always on, cannot be opted out of), Desktop app push, Mobile push, Slack DM, Email (digest or immediate). *Settings → Account → Notifications*; a **green dot** means the channel is enabled, **grey** means disabled.

**[C]** "You **cannot choose which notifications go to your Inbox**. All notifications will arrive there, and any additional notification subscriptions you enable under Account > Notifications will link back to the Inbox notification." The Inbox is the canonical store; other channels are mirrors.

### 13.4 Inbox UI

**[C]**

| Element | Behavior |
|---|---|
| Open | `G` then `I` from anywhere |
| Navigate | `J` / `K` or `↑` / `↓` |
| Open one | click → a **special Inbox view** of the issue where you can take both inbox actions and issue edits |
| Mark read/unread | `U` |
| Mark **all** read | `Option/Alt + U` |
| Delete notification | `Backspace` |
| Delete all **read** notifications | `Shift + Backspace` |
| Snooze | `H` |
| Contextual menu | right-click a row |
| Quick search | `Cmd/Ctrl + F` — narrows by issue title, issue ID, **notification type**, assignee, team, project, priority. `Esc` clears. |
| Display options | toggle **Show snoozed** and **Show read issues**. Ordering only — **no grouping** in Inbox. |

**[C]** **Snooze** hides a notification until the chosen time, then it reappears.
**[C]** **Reminders** are a separate concept: set on an issue/document/project/initiative with `H` (or `…` → *Remind Me*), shown as a banner at the top of the issue, reschedulable/cancelable. Reminders do **not** hide anything, so there's no display toggle for them.
**[C]** Custom date entry accepts typed values: `Jan 3 10am`, `next quarter`, `til <month/date>`, `for X months/weeks/days` — **the option must be typed in full** ("next quarter", not "next quar").
**[C]** **There is no archive for notifications.**
**[C]** **Cap: 2,000 open notifications.** Beyond that, older ones are automatically archived/dropped.

---

## 14. SEARCH & COMMAND PALETTE

### 14.1 Search

**[C]** ([search](https://linear.app/docs/search))

| Property | Behavior |
|---|---|
| Open | **`/`** |
| Scope | **issues, projects, and documents**, across the whole workspace |
| Issue match fields | **issue ID, title, description, comments** |
| ID matching | exact `LIN-123` **and** shorthand `lin123` |
| Highlighting | the term is highlighted when it appears in the title |
| Exact phrase | wrap in `"quotes"` — "Without quotes, searches may also include results for similar terms" |
| Stop words | articles/prepositions/conjunctions (`a`, `the`, `and`, `or`) are excluded **unless quoted** |
| Refine | `@`-mention teams, users, statuses and properties inside the query — this **auto-creates and applies a filter**; more via the Filter menu |
| Default result order | relevance: **unstarted and in-progress first, then backlog, completed, canceled, archived** |
| Re-sort | relevance / last updated / last created |
| Max results | **500** |
| Recents | opening search shows recent searches and recent issues |

**[C]** `O` then `I` = **quick issue search**: recent issues + search by **ID or title only** (supports partial words; does *not* search description or comments). This is a different, lighter index than `/`.

**[C]** `Cmd/Ctrl + F` = search within the current view (a temporary filter; exact ID or words in the title).

### 14.2 Command palette (`Cmd/Ctrl + K`)

**[C]** The command menu is the universal action surface. It is **context-sensitive**: it acts on whatever issue(s) are currently highlighted or selected, or on the current page.

Documented command-menu capabilities (a representative, not exhaustive, list) **[C]**:

*Navigation*: open user / project / team / view / customer; `my issues`; **View workspace admins**.

*Issue actions*: Create sub-issue; Create new sub-issue from template; Set parent; **Remove parent**; Assign to…; Change status; Change priority; Add label; Add to milestone; Add to project; Set SLA; Remind me about this issue; Snooze this notification; Cancel reminder; Delete issue; Convert into recurring issue; **Share issue**; Copy git branch name; Copy issue in markdown; Copy pre-filled create issue URL to clipboard; Export issues as CSV…; Export customer requests as CSV…

*View actions*: Show display options; `board` → show in board view; Copy view URL; Configure custom view Slack notifications.

**[C]** Scoped-search prefixes inside the command menu: `i` + space (issues), `p` (projects), `u` (users), `t` (team), `l` (labels), `f` (favorites), `d` (documents).

**[C]** `?` anywhere opens the full keyboard-shortcut reference.

---

## 15. MY ISSUES

**[C]** ([my-issues](https://linear.app/docs/my-issues))

Open with **`G` then `M`**, or from the sidebar just under Inbox.

| Tab | Contents |
|---|---|
| **Assigned** | Issues assigned to you across the whole workspace — **including those delegated to an agent**, since you remain the assignee. Grouped by **Focus order** by default. |
| **Created** | Every issue you authored in the workspace, chronological. Includes issues created on your behalf through integrations (Slack, Front, Intercom, Zendesk, Sentry). |
| **Subscribed** | Issues you follow. "You're automatically subscribed to issues assigned to you, in which you've been @mentioned, and created by you." |
| **Activity** | A historical list of issues you touched — comment added, comment reacted to, status changed, PR linked, issue created/updated/deleted. Filterable by action type. |
| **Shared** | *(Enterprise)* issues shared with you from private teams you don't belong to |

### Focus grouping

**[C]** — "Focus is a unique grouping that attempts to organize issues assigned to you **in order of what you'd want to work on first**." The documented order, verbatim:

> **urgent work → SLA-bound work → blockers → cycle work → other active work → triage → backlog → completed work**

Focus is only available in My Issues. Everything else (grouping, ordering, display properties) works as in any other view via the top-right Display options.

---

## 16. ANYTHING ELSE CENTRAL TO DAILY USE

### 16.1 Editor (markdown)

**[C]** ([editor](https://linear.app/docs/editor)) — descriptions, comments and documents share one editor. Markdown is typed or pasted and converted to rich text live. A **formatting toolbar** appears on text selection; **`/` opens slash commands**.

| Element | Markdown / shortcut |
|---|---|
| Bold | `**text**` / `Cmd+B` |
| Italic | `_text_` / `Cmd+I` |
| Strikethrough | `~~text~~` / `Cmd+Shift+S` |
| Underline | `Cmd+U` |
| Inline code | `Cmd+E` |
| H1–H4 | `#`…`####` + space |
| Bulleted list | `*`, `-`, `+` + space, or `Cmd+Shift+8` |
| Numbered list | `1.` or `Cmd+Shift+9` |
| Checklist | `[]` or `Cmd+Shift+7` |
| Link | `Cmd+K`, or paste a URL over a selection |
| Blockquote | `>` + space |
| Collapsible section | `>>>` + space, or `/collapsible section` |
| Code block | `/code` or ``Cmd+Shift+\`` |
| Mermaid diagram | `/diagram`, or paste a ` ```mermaid ` block |
| Divider | `___` + space |
| Table | `\|--` or `/table` |
| Date chip | `/date` or `@Oct 1` |
| File attach | `/file`, `/insert`, `Cmd+Shift+U`, drag-drop |
| Emoji | native picker or `:name:` (`:100:`, `:+1:`) |
| Line break | `Shift+Enter` |
| Escape a code block | `Enter` `Enter` |
| Select all issue content | `Cmd+A` |
| Copy description as markdown | `Cmd+K` → *copy issue in markdown* |

**Embeds [C]**: YouTube, Descript, Loom and Figma auto-embed on paste. **Esc** or "Keep as link" right after pasting keeps the plain URL.

### 16.2 Templates

**[C]** Issue, project and document templates, at **workspace** or **team** level. A team can have a **default template** that applies to new issues (and can override the triage default status). Applying a template pre-fills properties **including sub-issues**. `Option/Alt + C` opens the template picker at issue creation. Templates can be given their own **email address** so mail sent there creates an issue with the template's properties (subject → title, body → description).

### 16.3 Documents

**[C]** Documents exist at **team**, **project**, and **initiative** level. Team docs are for "shared context that doesn't make sense to tie to a particular project" — runbooks, design links, meeting notes. Documents support inline comments and are searchable via `/`.

### 16.4 Favorites & sidebar

**[C]** Star anything (view, project, customer page, document) to pin it into the sidebar. `O` then `F` opens favorites. Favorited views can be set as your **default landing page** (*Settings → Account → Preferences → Default home view*).

### 16.5 Preferences worth cloning

**[C]** ([account-preferences](https://linear.app/docs/account-preferences))

- **Default home view** — which page opens on login
- **Display full names** vs usernames
- **First day of the week**
- **Convert text emoticons into emojis**
- **Submit comment on `Enter` vs `Cmd/Ctrl+Enter`**
- **Interface**: font size, pointer cursor on interactive elements, underlined links
- **Theme**: multiple light and dark presets, "system", plus fully **custom themes** (there's a community site, linear.style, with 70+)
- **Auto-assign to self** on issue creation *(off by default)*
- **On move to started status, assign to yourself** *(off by default)*

**[C]** Linear explicitly does **not** support a default assignee for new issues — templates, triage responsibility, or triage rules are the documented workarounds.

### 16.6 Real-time sync & offline

**[C]** ([get-the-app](https://linear.app/docs/get-the-app)) — "Linear automatically syncs all changes in realtime as they happen." Offline changes queue locally and retry on reconnect, surfacing a **"Syncing"** label with a pending-change count next to the workspace name in the sidebar. Important caveat, stated plainly: *"We do not check the creation date of each change before updating data. This means that if you make a lot of edits while in offline mode, you could overwrite changes from someone on your team."* — i.e. **last-write-wins, not CRDT/OT**, at the field level. That is a very reasonable bar for a clone.

### 16.7 Peek

**[C]** `Space` while hovering an issue in a list or board opens a **peek preview** without navigating.

### 16.8 Keyboard shortcut reference

Consolidated from every page read. `?` opens the in-app list. **[C]** unless marked.

**Navigation (`G` then …)**
| Keys | Goes to |
|---|---|
| `G` `I` | Inbox |
| `G` `M` | My Issues |
| `G` `A` | Team → Active issues |
| `G` `B` | Team → Backlog |
| `G` `T` | Team → Triage |
| `G` `X` | Team → Archive |
| `G` `V` | Current cycle *(out of scope)* |
| `G` `Q` | Customers *(out of scope)* |
| `G` `R` | Reviews *(out of scope)* |

**Open pickers (`O` then …)**
| Keys | Opens |
|---|---|
| `O` `I` | Issue quick-search / recent issues |
| `O` `P` | Projects |
| `O` `U` | User profiles |
| `O` `T` | Teams |
| `O` `V` | Views |
| `O` `F` | Favorites |
| `O` `W` | Switch workspace |
| `O` `C` | Cycles *(out of scope)* |

**Global**
| Keys | Action |
|---|---|
| `Cmd/Ctrl + K` | Command menu |
| `/` | Workspace search |
| `?` | Shortcut reference |
| `C` | Create issue (modal) |
| `V` | Create issue (full screen) |
| `Option/Alt + C` | Create from template |
| `Esc` | Close / clear selection |

**On an issue (highlighted or open)**
| Keys | Action |
|---|---|
| `S` | Change status |
| `A` | Change assignee |
| `I` | Assign to me |
| `P` | Set priority |
| `L` | Add label |
| `Shift + E` | Set estimate |
| `Shift + D` | Set due date |
| `Shift + P` | Add to project |
| `Shift + M` | Add to milestone |
| `Cmd/Ctrl + Shift + P` | Set parent |
| `Cmd/Ctrl + Shift + O` | Create sub-issue / convert selection |
| `Shift + S` | Subscribe / unsubscribe |
| `Cmd/Ctrl + Shift + S` | Manage subscribers |
| `M` `R` / `M` `B` / `M` `X` / `M` `M` | Related / Blocked by / Blocks / Duplicate |
| `Ctrl + L` | Add a link attachment |
| `Cmd/Ctrl + Shift + A` | Attach a file to a comment |
| `H` | Set reminder / snooze |
| `Cmd/Ctrl + Delete` | Delete issue |
| `Cmd/Ctrl + I` | Toggle details sidebar |
| `Space` (hover) | Peek |
| `#` (in archive) | Restore |

**Lists & boards**
| Keys | Action |
|---|---|
| `J` / `K` or `↑` / `↓` | Move highlight |
| `X` | Select |
| `Shift + X` / `Shift`+click | Select multiple |
| `Cmd/Ctrl + A` | Select all |
| `F` | Filters |
| `Shift + V` | Display options |
| `Cmd/Ctrl + B` | List ⇄ Board |
| `Cmd/Ctrl + F` | Search within view |
| `Option/Alt + V` | Save as custom view |
| `T` | Collapse/expand group or swimlane |
| `Option/Alt + Shift + ↑/↓` | Move to top / bottom |
| `Option/Alt + ↑/↓` | Move up / down one |

**Triage**
`1` accept · `2` duplicate · `3` decline · `H` snooze · `M` `M` duplicate

**Inbox**
`U` read/unread · `Option/Alt + U` all read · `Backspace` delete · `Shift + Backspace` delete all read · `H` snooze

---

## 17. EXPLICITLY OUT OF SCOPE

The following are real Linear features that this rebuild should **omit**. They are mentioned here only so implementers recognize and skip them when they surface in the docs or in screenshots: **cycles/sprints** (repeating per-team planning periods, cycle graphs, "Added to cycle" filters, cycle auto-move automations); **initiatives and roadmaps** beyond the bare notion that projects can be grouped (sub-initiatives, initiative updates, initiative labels/priority/owner/lead-team, timeline zoom); **SLAs** (rules, statuses, breach notifications, the fire icon); **Linear Asks** (Slack and email request intake, form templates, synced requester threads); **customer requests and customer pages** (customers, tiers, revenue, "mark as important"); **all integrations and plugins** (GitHub/GitLab PR automation, Slack, Figma, Sentry, Intercom, Zendesk, Front, Zapier, Airbyte, Google Sheets, PagerDuty, MCP); **native AI agents** (agent delegation, Triage Intelligence, AI filtering, resolved-thread summaries, Linear Agent, Guides, Pulse audio); **Insights / analytics dashboards** (measures, dimensions, charts); and the surrounding enterprise machinery (**SAML/SCIM, audit logs, Diffs/code review, releases, recurring issues, Pulse, mobile & desktop apps, import/export**). Where one of these leaves a *hook* in an in-scope feature — e.g. the `cycle` and `slaStatus` fields appear in the grouping and display-property lists, and Triage rules can set properties — simply omit that option from the menu rather than stubbing it.

---

## 18. Sources

Every URL below was read for this document.

**Linear documentation (`linear.app/docs/…`)**
- https://linear.app/docs — docs index
- https://linear.app/docs/conceptual-model — Concepts
- https://linear.app/docs/workspaces — Workspaces
- https://linear.app/docs/teams — Teams
- https://linear.app/docs/sub-teams — Sub-teams
- https://linear.app/docs/private-teams — Private teams
- https://linear.app/docs/default-team-pages — Team pages
- https://linear.app/docs/members-roles — Members and roles
- https://linear.app/docs/invite-members — Invite members
- https://linear.app/docs/creating-issues — Create issues
- https://linear.app/docs/configuring-workflows — Issue status
- https://linear.app/docs/parent-and-sub-issues — Parent and sub-issues
- https://linear.app/docs/issue-relations — Issue relations
- https://linear.app/docs/priority — Priority
- https://linear.app/docs/project-priority — Project priority
- https://linear.app/docs/labels — Issue labels
- https://linear.app/docs/project-labels — Project labels
- https://linear.app/docs/estimates — Estimates
- https://linear.app/docs/due-dates — Due dates
- https://linear.app/docs/assigning-issues — Assign and delegate issues
- https://linear.app/docs/select-issues — Select issues
- https://linear.app/docs/delete-archive-issues — Delete and archive issues
- https://linear.app/docs/display-options — Display options
- https://linear.app/docs/board-layout — Board layout
- https://linear.app/docs/filters — Filters
- https://linear.app/docs/custom-views — Custom Views
- https://linear.app/docs/user-views — User views
- https://linear.app/docs/search — Search
- https://linear.app/docs/my-issues — My issues
- https://linear.app/docs/triage — Triage
- https://linear.app/docs/projects — Projects
- https://linear.app/docs/project-status — Project status
- https://linear.app/docs/project-milestones — Project milestones
- https://linear.app/docs/initiative-and-project-updates — Initiative and Project updates
- https://linear.app/docs/initiatives — Initiatives
- https://linear.app/docs/sub-initiatives — Sub-initiatives
- https://linear.app/docs/comment-on-issues — Comments and reactions
- https://linear.app/docs/editor — Editor
- https://linear.app/docs/notifications — Notifications
- https://linear.app/docs/inbox — Inbox
- https://linear.app/docs/pulse — Pulse
- https://linear.app/docs/account-preferences — Preferences
- https://linear.app/docs/exporting-data — Exporting Data
- https://linear.app/docs/google-sheets — Google Sheets *(used for the authoritative field & timestamp lists)*
- https://linear.app/docs/get-the-app — Download Linear *(sync/offline model)*
- https://linear.app/docs/sla — SLAs *(read to scope out)*
- https://linear.app/docs/customer-requests — Customer Requests *(read to scope out)*
- https://linear.app/docs/agents-in-linear — AI Agents *(read to scope out)*
- https://linear.app/docs/diffs — Reviews *(read to scope out)*
- https://linear.app/docs/slack — Slack *(read to scope out)*
- https://linear.app/docs/linear-asks-slack — Asks with Slack *(read to scope out)*
- https://linear.app/docs/linear-asks-email — Asks with Email *(read to scope out)*
- https://linear.app/docs/scim — SCIM *(read to scope out)*
- https://linear.app/docs/gitlab — GitLab *(read to scope out)*
- https://linear.app/docs/mcp — MCP server *(the retrieval mechanism used)*

**Linear developer / API**
- https://linear.app/developers/graphql — Getting started
- https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects — public schema reference *(source of the numeric priority enum and the lowercase `WorkflowState.type` values)*

**Linear changelog**
- https://linear.app/changelog/2022-11-10-label-groups — Label Groups
- https://linear.app/changelog/2024-03-19-custom-statuses-for-projects — Custom statuses for projects
- https://linear.app/changelog/2025-04-03-collapsed-issue-history — Collapsed issue history
- https://linear.app/changelog/2025-06-12-project-labels — Project labels
- https://linear.app/changelog/2025-12-17-team-owners — Team owners
- https://linear.app/changelog/2022-07-14-guest-accounts — Guest accounts

**Third-party corroboration (used only where Linear's own docs are silent)**
- https://bugwarrior.readthedocs.io/en/latest/services/linear.html — state type names
- https://help.reclaim.ai/en/articles/6333573-how-workflow-states-in-linear-affects-reclaim — state type semantics
- https://pkg.go.dev/github.com/guillermo/linear/linear-api — generated API bindings

---

## 19. Priority for rebuild

Ranked for a **1:1 clone of the central experience**. MUST = the app is not Linear without it. SHOULD = the app feels wrong without it but ships. COULD = polish.

### MUST — the core loop

| # | Feature | Section | Why |
|---|---|---|---|
| 1 | Workspace → Teams → Issues hierarchy; issue belongs to exactly one team | §0, §10 | Every other rule depends on it |
| 2 | Issue identifier `TEAM-123`, per-team monotonic counter, never reused | §1.1 | The single most recognizable thing about Linear |
| 3 | Issue CRUD with title + description (markdown) + status | §1.2, §16.1 | |
| 4 | Workflow statuses: 5 types, per-team custom set, name/color/position, default status | §2 | The type system drives views, timestamps, progress, archiving |
| 5 | Category-transition timestamps (`startedAt`/`completedAt`/`canceledAt`), cleared on leaving the category | §1.2 | Getting this wrong silently corrupts every rollup |
| 6 | Priority enum 0–4 with "No priority sorts last" | §3 | |
| 7 | Assignee (exactly one), creator, subscribers | §1.2, §13.1 | |
| 8 | Labels: workspace + team scope, groups with mutual exclusivity, colors, multi-apply | §4 | |
| 9 | List view: grouping (status/assignee/priority/project/label/none), ordering, display properties | §6.1 | |
| 10 | Board view: columns from the grouping, drag-and-drop **writes the grouped field** | §7.1, §7.2 | |
| 11 | Global manual `sortOrder` (fractional index), shared across all users | §7.3 | Almost every clone gets this wrong |
| 12 | Filters: field + operator + values, implicit AND, `is` / `is not` / `is either of` / `includes any…none` / `before` / `after` | §6.2 | |
| 13 | Default team views: All issues, Active, Backlog + workspace My Issues | §6.5, §15 | |
| 14 | Keyboard-first interaction: `C`, `S`, `A`, `P`, `L`, `I`, `X`, `J/K`, `Esc`, `Cmd+K` | §16.8 | Linear *is* its keyboard model |
| 15 | Command palette `Cmd+K`, context-sensitive on selection | §14.2 | |
| 16 | Comments with threaded replies + emoji reactions + @mentions | §12.1 | |
| 17 | Activity feed with human-readable change events; 3-minute creation grace window | §12.2 | |
| 18 | Roles: Admin / Member / Guest at workspace level, membership at team level; guests scoped to their teams | §11 | Explicitly called out as critical |
| 19 | Email invite flow with role + team preselection, and pending-invite users being assignable | §11.5 | |
| 20 | Projects: name, icon, lead, members, teams, description, status, start/target dates, issue list | §9 | |
| 21 | Sub-issues: creation, property inheritance rules, the two opt-in auto-close toggles | §1.4 | |
| 22 | Relations: blocks / blocked by / related / duplicate, with the duplicate → Duplicate-status behavior | §1.5, §2.3 | |
| 23 | Delete → 30-day *Recently deleted* → restore | §1.7 | |
| 24 | Real-time sync between open clients (last-write-wins is fine) | §16.6 | |

### SHOULD — recognizably Linear

| # | Feature | Section |
|---|---|---|
| 25 | Saved / custom views with scope (workspace / team), owner, favorite-to-sidebar | §6.4 |
| 26 | Display options popover with **Set as default** vs personal preference | §6.1 |
| 27 | Inbox: notification list, read/unread, snooze, `G I`, delete, 2,000 cap | §13 |
| 28 | Subscription rules (create / assign / @mention auto-subscribe) | §13.1 |
| 29 | My Issues tabs: Assigned / Created / Subscribed / Activity | §15 |
| 30 | Workspace search `/` across issues + projects, ID and shorthand matching, relevance ordering | §14.1 |
| 31 | Triage: enable per team, entry rules, accept / decline / duplicate / snooze, **excluded from all views by default** | §8 |
| 32 | Estimates: 4 scales + extended, zero vs unestimated, count/estimate toggle in group headers | §5 |
| 33 | Due dates with the red/orange/grey icon rules and the date filter set | §1.2, §6.2 |
| 34 | Project milestones with drag-attach and started/completed progress weighting | §9.8 |
| 35 | Project status (5 categories, custom, **manual only**) vs project **health** (on track / at risk / off track) | §9.3, §9.4 |
| 36 | Project updates with health + body + reactions + comments; Updates tab | §9.5 |
| 37 | Private teams, including the on-conversion unassign/unsubscribe migration | §10.3 |
| 38 | Bulk selection + bulk action toolbar | §7.4 |
| 39 | Sub-issue display/filter controls (show sub-issues, top-level only, hide completed) | §1.4 |
| 40 | Auto-archive of closed issues; team Archive page with restore | §1.7 |
| 41 | Peek on `Space` | §16.7 |
| 42 | Issue templates with a team default | §16.2 |
| 43 | Dark/light theme + user preferences (default home view, full names, comment submit key) | §16.5 |
| 44 | Team owners with the four configurable capability gates | §11.3 |
| 45 | Filter and view state serialized into the URL (main filters only) | §6.2 |

### COULD — polish, safe to defer

| # | Feature | Section |
|---|---|---|
| 46 | Advanced filters: nested AND/OR groups | §6.2 |
| 47 | Sub-grouping / swimlanes in list and board | §6.1, §7.1 |
| 48 | Board column hiding, with drop-into-hidden-column still working | §7.1 |
| 49 | Inline comments anchored to a description span | §12.1 |
| 50 | Comment thread resolution (and resolve-from-a-specific-reply) | §12.1 |
| 51 | Issue drafts (temporary + saved, 6-month expiry, Drafts page) | §1.3 |
| 52 | `linear.new` prefill URL grammar | §1.3 |
| 53 | Convert: comment → issue, selection → sub-issues, parent → project | §1.4, §12.1 |
| 54 | Label archiving, merging, converting team ↔ workspace | §4.3 |
| 55 | Label descriptions on hover | §4.3 |
| 56 | Team retirement (read-only) as distinct from deletion | §10.5 |
| 57 | Project views attached as tabs; per-team tabs on multi-team projects | §9.6 |
| 58 | Project timeframes with year/half/quarter/month/day granularity | §9.2 |
| 59 | Custom view subscriptions (notify on added / completed) | §6.4 |
| 60 | Reminders on issues (`H`), with typed natural-language dates | §13.4 |
| 61 | CSV export of a view | §16 |
| 62 | Copy issue as markdown | §16 |
| 63 | Approved email domains / reusable invite link | §11.5 |
| 64 | Sub-teams | §10 |
| 65 | Custom emoji upload | §12.1 |
| 66 | Offline queueing with a "Syncing (n)" indicator | §16.6 |
| 67 | Print-to-PDF with absolute timestamps | §1.6 |
