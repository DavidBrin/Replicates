# 04 — Interaction Model: Keyboard, Command Palette, Optimistic UI

Research lane D. Target: enough precision to reimplement Linear's interaction model in a Next.js App Router clone.

---

## 0. How to read this document

**Confidence legend** — every shortcut row is tagged:

| Tag | Meaning |
|---|---|
| **C** | CONFIRMED — stated in Linear's own docs (`linear.app/docs/*`) or changelog, fetched during this research. |
| **R** | REPORTED — third-party cheat sheets only (KeyCombiner, ShortcutFoo, pie-menu, FastShortcuts, ShortcutRef). Treat as likely-true but unverified. |
| **D** | DISPUTED — sources disagree. A recommendation is given in §1.10. |

Linear has **no public keyboard-shortcut docs page**. `https://linear.app/docs/keyboard-shortcuts` returns 404, and there is no shortcuts entry in `linear.app/sitemap-docs.xml` (the full docs sitemap was enumerated). The authoritative list lives **only in the in-app searchable `?` modal**. Everything below is therefore assembled from (a) shortcuts mentioned in passing across ~20 individual Linear docs pages, (b) Linear changelog entries, (c) third-party cheat sheets. Where (a) and (c) conflict, **trust (a)** — several third-party sheets are stale (e.g. they still list `Cmd+D` for due date, which Linear's own docs now give as `Shift+D`).

**Prescriptive stance.** Sections marked "**→ Build this**" are instructions for the implementers, not description of Linear.

---

## 1. Shortcut map

### 1.1 The five design rules behind Linear's keymap

These matter more than any individual binding. Copy the rules, not just the table.

1. **Single letters are the fast path, and they are unmodified.** `C`, `S`, `A`, `P`, `L`, `X`, `F`, `I`, `R`, `E`, `V`, `T`, `U`, `H`. This is only possible because the app aggressively suppresses shortcuts while a text field has focus (§9.6). Linear's own framing: *"single-letter shortcuts for frequent actions, two-letter combos for navigation"* ([performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)).
2. **Two-key chords are prefixed by an intent verb.** `G` = *go to* (navigate the app), `O` = *open* (search-and-open a specific entity), `M` = *mark/relate* (issue relations). The prefix is pressed and released, then the second key. Not held.
3. **`Shift` + letter is the "sibling/less-common" variant of the letter.** `L` = add label / `Shift+L` = remove label. `E` = edit / `Shift+E` = estimate. `C` = create / `Shift+C` = add to cycle. `P` = priority / `Shift+P` = project. `D` unbound / `Shift+D` = due date. `S` = status / `Shift+S` = subscribe. `V` = new issue fullscreen / `Shift+V` = view display options. `F` = filter / `Shift+F` = clear last filter.
4. **`Cmd/Ctrl` + key is reserved for OS-conventional or destructive/system actions**: `Cmd+K` palette, `Cmd+Enter` submit, `Cmd+Z` undo, `Cmd+A` select all, `Cmd+Backspace` delete, `Cmd+.` / `Cmd+Shift+.` / `Cmd+Shift+,` copy family, `Cmd+B` layout toggle.
5. **Every shortcut has a mouse equivalent, and every menu shows its shortcut.** Linear's designer explicitly describes contextual menus as a *teaching surface*: they "display relevant keyboard shortcuts, helping users discover faster input methods" ([Invisible details](https://medium.com/linear-app/invisible-details-2ca718b41a44)). Since Jan 2026 Linear also **highlights whichever key is currently pressed** in those hints ([changelog 2026-01-22](https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile)).

---

### 1.2 Global (any view)

| Key(s) | Context | Action | Src |
|---|---|---|---|
| `Cmd/Ctrl + K` | Global | Open the command menu (palette). Context-scoped. | **C** |
| `/` | Global | Open global search (issues, projects, documents; title + description + comments). | **C** |
| `Cmd/Ctrl + F` | List / board / Inbox | "Find in view" — filter the *current* view's rows by title. | **C** |
| `?` | Global | Open the searchable keyboard-shortcuts help modal. | **C** |
| `Esc` | Global | Back / close / clear. See §1.11 for the full ladder. | **C** |
| `Cmd/Ctrl + Enter` | Any modal or editor | Save / submit. | **C** |
| `Cmd/Ctrl + Shift + Enter` | Create-issue modal | Save **and** open a new create form pre-filled with the same properties. (`Shift`-clicking the save button does the same.) | **C** |
| `Cmd/Ctrl + Z` | Global | Undo. Covers "almost every operation that changes issues, notifications, cycles or projects", **including batch operations over hundreds of issues**. | **C** |
| `Cmd/Ctrl + Shift + Z` | Global | Redo. | **C** |
| `[` | Global | Collapse / expand the sidebar. | **C** |
| `Cmd/Ctrl + B` | Issue views | Toggle **list ⇄ board** layout. *(Not sidebar — see §1.10.)* | **C** |
| `Shift + V` | Any view | Open Display options (grouping, ordering, visible properties). | **C** |
| `Cmd/Ctrl + I` | Issue detail | Toggle the right-hand details sidebar. | **R** |
| `Space` | List / board / palette | **Peek**: tap to toggle a preview overlay; *hold* for momentary preview. Shows description, assignee, status, priority, cycle, labels, estimate, dates. Keyboard-only — no hover trigger. Auto-previews as you move through command-menu results. | **C** |
| `Cmd/Ctrl + A` | List / board | Select all issues in the view. | **C** |
| `Cmd/Ctrl + Option/Alt + A` | Grouped list | Select all issues **in the focused group**. | **R** |
| `Alt/Option + Shift + Q` | Global | Log out. | **R** |
| `Cmd/Ctrl + Option/Alt + O` | Global | Open the link from the **last toast**. | **R** |

### 1.3 Navigation — the `G` chord (go to)

Press and release `G`, then the letter. Chord window is short (see §1.11).

| Key(s) | Action | Src |
|---|---|---|
| `G` `I` | Inbox | **C** |
| `G` `M` | My Issues | **C** |
| `G` `T` | Triage | **C** |
| `G` `X` | Archived issues (team archive) | **C** |
| `G` `A` | Active issues | **R** |
| `G` `B` | Backlog | **R** |
| `G` `E` | All issues | **R** |
| `G` `D` | Board | **R** |
| `G` `C` | Cycles | **R** |
| `G` `V` | Active cycle | **R** |
| `G` `W` | Upcoming cycle | **R** |
| `G` `P` | Projects | **R** |
| `G` `R` | Roadmap / last roadmap | **R** |
| `G` `S` | Settings | **R** |
| `G` `U` | Views — **opens a picker** to choose between workspace-level and team-specific views | **C** |
| `Cmd/Ctrl + Shift + 1…9` | Jump to team 1–9 | **R** |

### 1.4 Navigation — the `O` chord (open a specific thing)

`O` chords open a **searchable picker** for an entity type, then navigate to the chosen one. This is the "quick open" family and is distinct from `G`, which goes to a fixed view.

| Key(s) | Action | Src |
|---|---|---|
| `O` `I` | Open an issue — recent issues, searchable by issue ID or title | **C** |
| `O` `F` | Open a favorite | **C** |
| `O` `V` | Open a view | **C** |
| `O` `T` | Open a team | **C** (docs use it for "open another team's Triage") |
| `O` `P` | Open a project | **R** |
| `O` `C` | Open a cycle | **R** |
| `O` `U` | Open a user | **R** |
| `O` `M` | Open my profile | **R** |
| `O` `R` | Open a roadmap | **R** |

> Inside global search / quick-open, Linear supports **type prefixes**: `i ` issues, `p ` projects, `u ` users, `t ` teams, `l ` labels, `f ` favorites, `d ` documents. Also `lin123` matches `LIN-123` (case- and dash-insensitive shorthand). **C**

### 1.5 List & board — focus, selection, movement

| Key(s) | Context | Action | Src |
|---|---|---|---|
| `↑` `↓` / `K` `J` | List, board, Inbox | Move the **focus/highlight** cursor. | **C** |
| `←` `→` | Board | Move focus across columns (2-D arrow navigation). | **C** |
| `Home` / `End` | List | Jump to first / last. | **C** |
| `Enter` or `O` | Focused row | Open the issue. | **R** |
| `X` | Focused row | **Toggle selection** of the focused issue. Repeatable — move, press `X` again to add. | **C** |
| `Shift + X` | Focused row | Select multiple. | **C** |
| `Shift + Click` | Row | Select (and range-select from the anchor). | **C** |
| `Cmd/Ctrl + Click` | Row | Add/remove a single row to the selection (non-contiguous). | **R** |
| hold `Shift` then `↑`/`↓` | After first selection | **Extend the selected range** row by row. | **C** |
| `Cmd/Ctrl + A` | List / board | Select all. | **C** |
| `Esc` | List / board | Clear selection. | **C** |
| hover near left edge | Row | Reveals the row's **checkbox** (mouse affordance for `X`). | **C** |
| Right-click | Row or selection | Open the contextual menu for that issue *or the whole selection*. | **C** |
| `Option/Alt + ↑` / `↓` | Manual-ordered list or board | Move issue **one position** up/down. | **C** |
| `Option/Alt + Shift + ↑` / `↓` | Manual-ordered list or board | Move issue to **top / bottom** of its group or column. | **C** |
| `Option/Alt + ←` / `→` | Board | Move issue to the **previous / next column** (changes the grouped-by field). | **R** |
| `T` | Hovering a group header | Collapse / expand that group (list) or swimlane (board). | **C** |
| Drag | List / board | Reorder or re-group. Multi-selection drags as a unit on both lists and boards. | **C** |

### 1.6 Issue property actions (work on the focused issue **or** the whole selection)

This is the heart of the model: **the same key does the same thing whether one issue is focused in a list, many are selected, or you are inside issue detail.** Bulk is not a separate mode.

| Key(s) | Action | Src |
|---|---|---|
| `S` | Change **status** — opens the status picker | **C** |
| `A` | Change **assignee** — opens the assignee picker | **C** |
| `I` | **Assign to me** (no picker) | **C** |
| `P` | Change **priority** — opens the priority picker | **C** |
| `L` | Add / change **labels** — multi-select picker | **C** |
| `Shift + L` | Remove a label | **R** |
| `Shift + P` | Add to **project** | **R** |
| `Shift + C` | Add to **cycle** | **R** |
| `Cmd/Ctrl + Shift + C` | Add to **active cycle** (no picker) | **R** |
| `Shift + M` | Add to **project milestone** | **R** |
| `Shift + E` | Change **estimate** | **C** |
| `Shift + D` | Set **due date** | **C** |
| `Cmd/Ctrl + Shift + D` | Remove due date | **R** |
| `Cmd/Ctrl + Option/Alt + 1…9` | Set status by **position** in the team's workflow | **R** |
| `Shift + 1/2/3/4` | Priority: Urgent / High / Medium / Low (`Shift+0` = No priority) | **R, D** |
| `F` | Add a **filter** to the view | **C** |
| `Shift + F` | Clear the last filter | **R** |
| `Option/Alt + Shift + F` | Clear all filters | **R** |
| `Alt/Option + F` | Toggle **favorite** on the focused item | **C** |

Priority order, per Linear's docs, is **No priority, Low, Medium, High, Urgent** — and *no priority always sorts last* when a view is ordered by priority. **C**

### 1.7 Issue lifecycle, relations, copy

| Key(s) | Action | Src |
|---|---|---|
| `C` | New issue (modal) | **C** |
| `V` | New issue in **full-screen** view | **C** |
| `Option/Alt + C` | New issue **from a template** | **C** |
| `Cmd/Ctrl + Shift + O` | Create **sub-issue** (also: convert selected comment text, or a highlighted checklist, into sub-issues) | **C** |
| `Cmd/Ctrl + Shift + P` | Set **parent** issue | **C, D** *(collides with `Shift+P` = add to project; different modifier, but verify)* |
| `E` | Edit issue | **R, D** *(ShortcutFoo says `Option/Alt + E`)* |
| `R` | Rename (inline title edit) | **R** |
| `Cmd/Ctrl + Shift + M` | **Move to another team** | **C** |
| `#` | **Archive** issue — and **Restore** from the archive view | **C** (restore confirmed in docs; archive is **R**) |
| `Cmd/Ctrl + Backspace/Delete` | **Delete** issue (recoverable via `Cmd+Z`, then 14–30 days in "Recently deleted") | **C** |
| `D` or `Cmd/Ctrl + D` | Duplicate issue | **R, D** |
| `M` `B` | Mark as **blocked by** | **C** |
| `M` `X` | Mark as **blocking** | **C** |
| `M` `R` | Mark as **related to** | **C** |
| `M` `M` | Mark as **duplicate of** / merge into | **R** (Triage docs confirm `2` or `MM` for duplicate) |
| `Ctrl + L` | Link any URL to the issue | **R** |
| `Ctrl + Shift + L` | Toggle the links section | **R** |
| `Cmd/Ctrl + .` | Copy **issue ID** | **R** |
| `Cmd/Ctrl + Shift + .` | Copy **git branch name** | **R** |
| `Cmd/Ctrl + Shift + ,` | Copy **issue URL** | **R** |
| `Cmd/Ctrl + Shift + '` | Copy issue title | **R** |
| `Cmd/Ctrl + Shift + C` | Copy **current URL** (view-level) | **R, D** *(collides with editor inline-code)* |
| `Shift + S` | Subscribe / unsubscribe | **C** |
| `Cmd/Ctrl + Shift + S` | Manage subscribers | **C** |
| `Cmd/Ctrl + M` | Comment on issue (focus the composer) | **R** |
| `Shift + R` | Reply to comment | **R** |
| `Shift + X` | Open / close a comment thread | **R** |
| `Cmd + Option + M` / `Ctrl + Alt + M` | **Inline comment** on the selected part of the description | **C** |
| `Cmd/Ctrl + Shift + A` | Attach file to a comment | **C** |
| `Cmd/Ctrl + Shift + ↑` / `↓` | Open **parent** / **sub** issue | **R** |
| `Ctrl + Option/Alt + Shift + T` | Apply a template to the issue | **R** |
| `Option/Alt + V` | Save the current filtered list/board as a **custom view** | **C** |

### 1.8 Inbox & Triage

| Key(s) | Context | Action | Src |
|---|---|---|---|
| `J` `K` / `↑` `↓` | Inbox | Move through notifications | **C** |
| `U` | Inbox | Mark read / unread | **C** |
| `Option/Alt + U` | Inbox | Mark **all** as read | **C** |
| `Backspace` | Inbox | Delete the selected notification | **C** |
| `Shift + Backspace` | Inbox | Delete **all read** notifications | **C** |
| `H` | Inbox / issue | **Snooze** the notification, or set a reminder on an issue/document | **C** |
| `Cmd/Ctrl + F` | Inbox | Quick search bar; `Esc` clears it | **C** |
| `1` | Triage | **Accept** | **C** |
| `2` or `M` `M` | Triage | Mark as **duplicate** | **C** |
| `3` | Triage | **Decline** | **C** |
| `H` | Triage | **Snooze** | **C** |

> ⚠️ Note the collision: bare `1/2/3` are Triage actions. This is why priority is (reportedly) on `Shift+1..4` rather than bare digits. **Resolve this the same way in the clone.**

### 1.9 Editor shortcuts and markdown input rules

All **C** — from `linear.app/docs/editor`.

| Key(s) / Input rule | Action |
|---|---|
| `Cmd/Ctrl + B` / `**text**` | Bold |
| `Cmd/Ctrl + I` / `_text_` | Italic |
| `Cmd/Ctrl + U` | Underline |
| `Cmd/Ctrl + Shift + S` / `~~text~~` | Strikethrough *(third-party sheets say `Cmd+D` — **D**)* |
| `Cmd/Ctrl + E` | Inline code *(third-party sheets say `Cmd+Shift+C` — **D**)* |
| `` `code` `` | Inline code (input rule) |
| `Cmd/Ctrl + Shift + \` / `/code` / ` ``` ` | Code block |
| `Cmd/Ctrl + K` | Turn selection into a link |
| `#` `##` `###` `####` + Space | Heading 1–4 |
| `Cmd + Option + 0…4` (Win: `Ctrl + Alt + 0…4`) | Heading level / body text (standardised Mar 2026) |
| `Cmd/Ctrl + Shift + 8` / `*`,`-`,`+` + Space | Bulleted list |
| `Cmd/Ctrl + Shift + 9` / `1.` | Numbered list |
| `Cmd/Ctrl + Shift + 7` / `[]` | Checklist |
| `>` + Space | Blockquote |
| `>>>` + Space / `/collapsible section` | Collapsible section |
| `___` + Space | Horizontal divider |
| `\|--` / `/table` | Table |
| `/date`, `@Oct 1` | Insert date |
| `/diagram`, ` ```mermaid ` | Mermaid diagram |
| `/file`, `/insert`, `Cmd + Shift + U` | Attach / upload files |
| `@text` | Mention a user, issue, project, date or document |
| `@ENG-123` | Mention a specific issue |
| `:emoji_name:` | Emoji |
| `Shift + Enter` | Soft line break |
| `Enter` `Enter` | Exit code block / blockquote |
| `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` | Undo / redo (scoped to the editor) |
| `Cmd/Ctrl + Enter` | Submit (comment). Since Mar 2026 there is a **preference** to send with plain `Enter` instead. |

### 1.10 Where sources disagree

| Binding | Conflict | Verdict / recommendation |
|---|---|---|
| **Sidebar toggle** | Task brief guessed `Cmd+B`; Linear's changelog says `[`. `Cmd+B` is confirmed by *two* Linear docs pages as **list ⇄ board**. | Ship `[` for sidebar, `Cmd+B` for layout. Optionally also accept `Cmd+\`. |
| **Due date** | Linear docs: `Shift+D`. KeyCombiner & pie-menu: `Cmd+D`. | `Shift+D`. The `Cmd+D` sheets are stale (they also list `Cmd+D` for strikethrough). |
| **Priority digits** | ShortcutRef: bare `0-4`. FastShortcuts: `Shift+0..4`. | Use `Shift+1..4` globally (bare digits are taken by Triage), **and** bare `0-4` *inside* the priority picker once it's open. |
| **`E`** | KeyCombiner / pie-menu / FastShortcuts: "Edit issue". ShortcutFoo: `Option+E`. | Ambiguous and low-value. **Recommendation: don't ship a bare `E`.** Use `R` for inline rename and `Enter` to open. Reserve `E` for archive if you want a Gmail-ish muscle memory, and document it. |
| **Archive** | `#` is confirmed for *restore*; only third-party sources confirm `#` for *archive*. | Ship `#` as an archive/restore toggle, and always expose Archive in the palette + context menu. |
| **Duplicate** | `D` vs `Cmd+D`. | Palette-only in v1. `D` is too easy to hit by accident next to `S`/`A`. |
| **`Cmd+Shift+C`** | "Copy current URL" globally vs "inline code" in the editor. | Both can coexist — the editor scope wins when the editor has focus. This is exactly what the scope stack in §1.11 is for. |
| **`M`** | FastShortcuts lists bare `M` = "add to active cycle", but Linear docs confirm `M` is the **relations chord prefix** (`MB`/`MX`/`MR`). | `M` is a prefix. Never bind bare `M`. |

### 1.11 → Build this: the shortcut dispatcher

Do **not** reach for a hotkey library that only matches single combos. You need: chord sequences, a scope stack, selection-aware targets, and an input guard. It is ~200 lines.

**Architecture**

```
┌─ window keydown (capture: false, on document) ─┐
│  1. guard: is the event editable?              │
│  2. build a normalised key token               │
│  3. append to the chord buffer                 │
│  4. resolve against the active scope stack     │
│  5. execute → preventDefault                   │
└────────────────────────────────────────────────┘
```

**Scope stack.** A LIFO stack of scopes; the topmost *modal* scope blocks everything below it.

```
scopes = [
  { id: 'global',  modal: false },   // always at the bottom
  { id: 'list',    modal: false },   // mounted by the issue list
  { id: 'editor',  modal: true  },   // ProseMirror — swallows almost everything
  { id: 'palette', modal: true  },   // Cmd+K
  { id: 'dialog',  modal: true  },   // any focus-trapped modal
]
```

Resolution walks the stack top-down; on a `modal: true` scope it stops after that scope (plus a small allowlist: `Escape`, `Cmd+Enter`, `Cmd+K`, `Cmd+Z`).

**Input guard** — the single most important correctness detail:

```ts
function isTypingTarget(e: KeyboardEvent): boolean {
  if (e.isComposing || e.keyCode === 229) return true;        // IME composition — ALWAYS bail
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.closest('[data-no-shortcuts]')) return true;         // opt-out escape hatch
  return false;
}

// Policy: while typing, allow ONLY modifier-bearing and Escape bindings.
function allowedWhileTyping(binding: Binding): boolean {
  return binding.usesMeta || binding.usesCtrl || binding.key === 'Escape';
}
```

`e.isComposing` is non-negotiable: without it, Japanese/Chinese/Korean users typing an issue title will fire `S`, `A`, `P` mid-composition.

**Chord buffer**

```ts
const CHORD_PREFIXES = new Set(['g', 'o', 'm']);
const CHORD_TIMEOUT_MS = 1500;   // Linear feels ~1-2s; longer and users forget they armed it

let buffer: string[] = [];
let timer: number | undefined;

function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e)) { /* fall through to allowedWhileTyping filter */ }

  const token = normalise(e);                 // 'g' | 'shift+d' | 'mod+k' | 'Escape' ...
  const candidate = [...buffer, token].join(' ');

  const binding = resolve(candidate, scopeStack);
  if (binding) { clearBuffer(); e.preventDefault(); return binding.run(context()); }

  // no exact match — is it a live prefix?
  if (buffer.length === 0 && CHORD_PREFIXES.has(token) && !e.metaKey && !e.ctrlKey) {
    buffer = [token];
    showChordHint(token);                     // ← Linear shows a subtle "G …" affordance
    timer = window.setTimeout(clearBuffer, CHORD_TIMEOUT_MS);
    e.preventDefault();
    return;
  }

  clearBuffer();                              // any miss cancels the chord
}
```

**Target resolution** — one function, used by every property binding, so bulk edit is free:

```ts
function targets(): IssueId[] {
  if (selection.size > 0) return [...selection];   // multi-select wins
  if (focusedIssueId) return [focusedIssueId];     // list cursor
  if (route.issueId) return [route.issueId];       // issue detail page
  return [];
}
// binding: { keys: 's', scope: 'issue', run: () => openPicker('status', targets()) }
```

**Escape ladder** (`Esc` is overloaded; implement it as an ordered chain, first handler wins):

1. Cancel an armed chord buffer → 2. Close the topmost popover/picker → 3. Close the command palette → 4. Close peek → 5. Close a modal (offering *save as draft* for the create-issue modal, as Linear does) → 6. Clear the "find in view" query → 7. Clear the list selection → 8. Blur the focused input → 9. Navigate back / close issue detail.

**Registry shape.** Keep bindings declarative in one file so the `?` help modal and the command palette can both be *generated from it*. Linear's help modal is searchable; yours should be too, and it should never drift from reality:

```ts
type Binding = {
  id: 'issue.status';
  keys: 's' | ['s'];              // or a sequence: ['g','i']
  scope: 'global' | 'list' | 'issue' | 'editor' | 'palette';
  group: 'Issue';                 // for the ? modal AND the palette grouping
  label: 'Change status';
  when?: (ctx) => boolean;        // e.g. targets().length > 0
  run: (ctx) => void;
};
```

---

## 2. Command palette spec (`Cmd/Ctrl + K`)

### 2.1 What it is

The single most important interaction in the app. Linear's changelog describes it as covering *"hundreds of actions that range from modifying issue properties to switching between UI themes"* — i.e. **every action in the app is reachable here**, including navigation, settings and preferences. It is the discovery surface, the accessibility surface, and the power-user surface at once.

Critically: Linear's palette **searches the local in-memory object pool — no server queries, instant results** ([performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)). This is a hard requirement for the feel. If your palette does a network round trip per keystroke, you have not built a Linear palette.

### 2.2 Contextual scoping

Two Linear changelog entries state the rule verbatim:

- *"The new command menu groups its commands based on their functionality. Groups are then further subdivided based on the type of command, making it easier to skim over large sets."*
- *"Groups are then prioritized based on what you are focusing on or the view you're currently in… if you are looking at cycles, the command menu will first display commands that are related to cycles."*
- *"[The command menu shows] all actions applicable to your view or selection."*

**→ Build this** — palette ranking is `(groupPriority, matchScore, recency)`:

| Situation | Top group | Then |
|---|---|---|
| Issue(s) selected in a list | **Issue actions** (status, assignee, priority, labels, project, cycle, estimate, due date, copy, archive, delete) — labelled with the count, e.g. *"3 issues"* | View actions → Navigation → Settings |
| Issue detail page open | Issue actions for *this* issue | Sub-issue, relations → Navigation |
| Cycle view | Cycle actions | Issue actions → Navigation |
| Nothing focused, any view | View actions (filter, grouping, layout) | Navigation → Create → Settings |
| Project page | Project actions | … |

Also: **opening the palette dismisses peek** (Linear: "the peek feature automatically deactivates when the command menu opens").

### 2.3 Sub-menus / two-step commands

Picking "Change status" must not close the palette — it **pushes a page** onto the palette's internal stack and the input clears, placeholder becomes `Change status to…`, and the list becomes the team's workflow states.

```
stack = [
  { id: 'root',   query: '',      items: allCommands(ctx) },
  { id: 'status', query: 'in pr', items: statusesForTeam(team), onPick: apply },
]
```

- `Backspace` **on an empty input** pops the stack (the standard cmdk idiom).
- `Esc` pops one level; `Esc` at root closes.
- The breadcrumb/pill for the parent command renders inline to the left of the input.
- The pushed page reuses the **exact same component as the standalone picker** (§3). One combobox implementation, two entry points.

### 2.4 Positioning

Originally always screen-centre. Linear moved it so it appears *"closer to the UI element that it was invoked from… almost like a drop-down element but still retains its searchability and keyboard controllability."* Since Jan 2026, *"menus now open under their triggers by default."*

**→ Build this:** `Cmd+K` from a keyboard-only context → centred overlay near the top third (`top: 20vh`). Invoked from a property control (clicking the status chip) → anchored popover under that control. Same component, different positioner. Use Floating UI / Radix Popover with `flip` + `shift` + collision padding.

### 2.5 Visual structure

```
┌────────────────────────────────────────────────────────┐
│  ⌕  [Change status to…              ]     ← input      │  ~44px, no border, 15px text
├────────────────────────────────────────────────────────┤
│  ISSUE                                    ← group label│  11px, uppercase, muted, sticky
│  ◷  Change status…                             S       │  ← row: icon, label, right-aligned hint
│  ○  Assign to…                                 A       │
│  ⚑  Change priority…                           P       │
│  ⬡  Add label…                                 L       │
│  NAVIGATION                                            │
│  →  Go to My Issues                          G  M      │  ← chord hint = two separate keycaps
│  →  Go to Inbox                              G  I      │
│  SETTINGS                                              │
│  ☾  Toggle theme                                       │  ← no shortcut = no hint
└────────────────────────────────────────────────────────┘
```

Rules:
- **Fixed max height** (~440px) with internal scroll; the input never moves.
- **Group headers are sticky** while scrolling their section.
- **Shortcut hints are right-aligned keycaps**, one `<kbd>` per key, chords rendered as separate caps with a gap (`G` `M`, not `GM`).
- Icons on the left of every row — Linear: *"Icons further help find what you're looking for."*
- Exactly one row is "active" at a time, and it is highlighted, **not focused** (see §9.3).
- Empty state: "No results" plus a fallback action ("Create issue titled *<query>*").
- Selecting a row that isn't a sub-menu **executes and closes immediately**. No confirm step.

### 2.6 Fuzzy matching

**→ Build this.** Use a subsequence matcher with positional bonuses, not `String.includes`. Recommended: [`cmdk`](https://cmdk.paco.me/) (its default scorer is `command-score`, the Linear/Sublime-style algorithm) or roll it with `fzf`-style scoring.

Scoring that matches user expectation:

| Signal | Weight |
|---|---|
| Exact prefix of the label | highest |
| Word-boundary/initialism match (`cs` → **C**hange **s**tatus) | very high |
| Contiguous run of matched chars | high (bonus per extra contiguous char) |
| Match after a separator (space, `-`, `/`) | medium bonus |
| Camel-hump match | medium bonus |
| Gap penalty per skipped char | negative, decaying |
| Recency of last use of this command | tie-breaker, +small |
| Group priority (§2.2) | applied *before* score, as a sort key |

Also index **aliases and keywords** per command (`"Change status"` should match `state`, `workflow`, `todo`, `done`) and **the shortcut string itself** (typing `gi` should surface "Go to Inbox"). Debounce nothing — matching must be synchronous over a local array; sub-1000-item lists score in well under a frame.

### 2.7 Everything is reachable here

Enumerate at build time from the binding registry (§1.11) plus dynamic entities:

- **Actions** — every registered binding whose `when()` passes.
- **Navigation** — every sidebar destination, every team, every saved view, every favorite.
- **Entities** — issues (by ID and title), projects, users, labels, documents; with the `i `/`p `/`u `/`t `/`l `/`f `/`d ` prefixes.
- **Settings & preferences** — theme, layout defaults, notification settings; each as a directly-executable command, not just a link to a settings page.

---

## 3. Contextual property picker spec

This popover combobox is Linear's signature control. Status, assignee, priority, label, project, cycle, estimate, due date, milestone all use it. **Build it once.**

### 3.1 How it opens

| Trigger | Behaviour |
|---|---|
| Keyboard shortcut (`S`, `A`, `P`, `L`, …) with issues focused/selected | Opens **anchored to the corresponding property chip** if visible on screen; otherwise centred, palette-style. |
| Click on the property chip in a list row, board card, or issue detail sidebar | Opens anchored **under the trigger**. |
| Right-click → context menu → "Status" → submenu | Same component rendered as a submenu. |
| `Cmd+K` → "Change status…" | Same component rendered as a palette page (§2.3). |

Focus moves into the picker's text input on open. The trigger gets `aria-expanded="true"`.

### 3.2 Anatomy

```
┌─────────────────────────────┐
│ ⌕ [ back                  ] │  ← always-present filter input, autofocus
├─────────────────────────────┤
│ ○  Backlog                1 │  ← icon · label · right-aligned index/shortcut
│ ◔  Todo                   2 │
│ ◑  In Progress            3 │  ← active row (highlighted)
│ ⊘  Canceled               4 │
│ ●  Done                   5 │
└─────────────────────────────┘
```

- Width is fixed (~240–280px), height caps at ~320px with internal scroll.
- The **currently-applied** value shows a check on the right (or a filled state dot), and the picker **opens with the active row on the current value**, not on row 0.
- For pickers with a natural ordinal (status, priority) show `1..9` accelerators on the right; pressing the digit applies directly.

### 3.3 Search-as-you-type

- Filters on every keystroke, synchronously, over an in-memory list. Same fuzzy scorer as the palette (§2.6) for consistency.
- Matched characters are **bolded** in the row label.
- The active row resets to index 0 whenever the query changes and there is a result; if the query is cleared, snap back to the currently-applied value.
- For **labels** and **assignee**, the empty query should show *recents first* (recently used labels, recently assigned people), then alphabetical.
- **Create-on-the-fly**: the label picker's no-match state offers `Create label "<query>"`. Linear supports a group syntax here: typing `Type/Bug` or `Type:Bug` creates the label group `Type` and the label `Bug`. **C**

### 3.4 Keyboard navigation

| Key | Behaviour |
|---|---|
| `↑` `↓` | Move the active row. Wraps at the ends. |
| `Home` / `End` | First / last row. |
| `Enter` | Apply the active row. **Single-select pickers close.** Multi-select pickers stay open (see below). |
| `Tab` | Apply and close (treat like Enter, then move on). |
| `Esc` | Close **without** applying the pending highlight; already-applied changes stay applied. |
| `1`–`9` | Direct-apply by index where the picker exposes ordinals. |
| Printable chars | Always go to the filter input, never to type-ahead selection. |
| `Backspace` on empty input | In a palette sub-page: pop back. In a standalone popover: no-op. |
| `Cmd/Ctrl + Enter` | Apply and close, even in multi-select mode. |

### 3.5 Multi-select (labels — and the "modifier as accelerator" pattern)

Two distinct behaviours, both needed:

1. **Inherent multi-select (labels).** Rows are checkboxes. `Enter` or click **toggles** the label, applies it immediately, and **the menu stays open** so you can add several. Close with `Esc` or by clicking out. Filter text should clear after each toggle (so you can type the next label straight away) — or keep it, but pick one and be consistent.
   - Constraint from Linear's docs: **labels inside a label *group* are mutually exclusive** — "only one label from a given label group can be applied to an issue at a time". So toggling `Type/Bug` when `Type/Feature` is set *replaces* it. **C**
2. **Shift-as-accelerator on single-select pickers.** Holding `Shift` while clicking/Entering a row applies it **without closing the menu**. This is what lets you rip through a selection of issues, or through several statuses, without reopening. Linear generalised this in Jan 2026: *"Added support for selecting a range of options from a menu with multiselect via click while holding Shift."* **C**

**→ Build this:** one prop, `closeOnSelect: boolean`, derived as `!(multiple || event.shiftKey)`.

### 3.6 Immediate application — no save button

**There is no OK/Cancel/Save.** Selecting a value fires the mutation immediately and optimistically (§6). This is why:

- `Esc` must be safe: it closes the popover, it does **not** revert already-applied changes.
- There is no "dirty" state to manage, no confirmation dialog, no unsaved-changes warning.
- The chip in the underlying row updates **before** the popover finishes its close animation — the user sees the result behind the closing menu.

The one exception: the **create-issue** modal is a batch form — properties are staged locally and committed on `Cmd+Enter`. Closing it with `Esc` offers *save as draft*. **C**

### 3.7 Bulk semantics

When N issues are selected and a picker opens:

- Show the value that **all** selected issues share; if they differ, show an indeterminate/mixed state (dash on the checkbox, no check on any row).
- Applying sets the value on **all** N issues in a single logical operation, so a single `Cmd+Z` undoes the whole batch. Linear explicitly supports undoing "batch operations like modifying hundreds of issues". **C**
- The selection **survives** the operation — you can immediately press `A` and assign the same set.

### 3.8 Submenu safe-triangle (mouse polish)

When these pickers appear as *submenus* of a right-click context menu, implement the **safe triangle**: while the cursor is inside the triangle formed by (last cursor position, top-right corner of the submenu, bottom-right corner of the submenu), do not close the submenu or switch the hovered parent item. Linear implements this with `getBoundingClientRect()` + a mouse-tracking hook + a CSS `clip-path: polygon(...)` overlay, in ~40 lines. Without it, moving diagonally toward the submenu closes it and the menu feels broken. Radix UI's `DropdownMenu.Sub` already ships this behaviour — use it rather than rebuilding.

---

## 4. List interaction

### 4.1 Row anatomy & hover

```
[·] LIN-142  ◑  Fix the sync cursor drift        [Bug] [P1]   Aug 12   ◎
 ↑    ↑      ↑   ↑                                ↑            ↑       ↑
 checkbox    status  title (flex-1, truncate)  labels  priority date  assignee
 (hover)     icon
```

- **Rest state**: transparent background.
- **Hover**: subtle background tint (~4% overlay), plus **the checkbox fades in at the left edge** (Linear: "hover near the left edge of an issue to reveal its checkbox"). Hover styling must not shift layout — reserve the checkbox's width permanently and only change its opacity.
- **Focus (keyboard cursor)**: a distinct, stronger treatment than hover (Linear uses a background + a left accent). The focus cursor and the mouse hover are **independent** — moving the mouse must not move the keyboard cursor, and vice versa. This is the classic bug in clones.
- **Selected**: a clearly different, more saturated background + the checkbox rendered checked and always visible. Focused-and-selected is a fourth visual state.
- Rows are a **fixed height** (Linear ~40px comfortable / 32px compact). Fixed height is what makes virtualisation and `Alt+↑/↓` reordering cheap.

### 4.2 Click semantics

| Gesture | Result |
|---|---|
| Click on the row body | Open the issue (navigate to detail). Does **not** select. |
| Click on a property chip inside the row | Open that property's picker. **Must `stopPropagation`** so the row doesn't navigate. |
| Click the checkbox | Toggle selection; sets the range anchor. |
| `Cmd/Ctrl + Click` on the row | Toggle selection of that row (non-contiguous multi-select) — *not* navigate. |
| `Shift + Click` on the row | Select the contiguous range from the anchor to this row. |
| Middle-click / right-click → Open in new tab | Browser-native. Rows should be real `<a href>` so these work, and so link-copy works. |
| Right-click | Context menu for the row, or for the whole selection if the row is part of one. |
| Double-click on the title | Inline title edit. |

> Note the collision: Linear uses `Cmd+Click` for *selection*, which overrides the browser's open-in-new-tab. Keep parity with Linear (selection wins) and rely on middle-click / the context menu for new-tab. Document it — it surprises people.

### 4.3 Multi-select mechanics

State to keep: `Set<issueId> selected`, `issueId | null focused`, `issueId | null anchor`.

- `X` toggles `focused` in/out of `selected`, and sets `anchor = focused`.
- Holding `Shift` and pressing `↑`/`↓` **extends** from the anchor: move focus, then set the selection to the inclusive range `[anchor … focused]` in *visual* order (respecting the current grouping and sort, and skipping collapsed groups).
- `Cmd+A` selects everything currently rendered in the view (after filters). `Cmd+Alt+A` selects the focused group only.
- `Esc` clears.
- Selection is keyed by ID and must **survive** re-sorts and optimistic updates; if a mutation moves an issue to another group, keep it selected and let it animate to its new position.

### 4.4 Bulk action affordances

Two, and you want both:

1. **The command palette** — `Cmd+K` with a selection shows issue actions scoped to the selection, header reading e.g. *"3 issues"*.
2. **The context menu** — right-click anywhere on the selection.

Plus every property shortcut (`S`, `A`, `P`, `L`, …) applying to the whole selection with no extra ceremony.

Linear does **not** rely on a separate floating "bulk action bar"; the count is surfaced in the palette/menu header. **Recommendation:** ship a minimal fixed footer bar showing `N selected · Esc to clear` for discoverability, but make it purely informational plus an overflow `…` — do not make it the only way to bulk-edit.

### 4.5 Context menu contents (right-click on an issue / selection)

Ordered, with shortcut hints on the right and submenus (▸) for pickers:

```
Status                      ▸   S
Assignee                    ▸   A
Priority                    ▸   P
Labels                      ▸   L
Project                     ▸   ⇧P
Cycle                       ▸   ⇧C
Estimate                    ▸   ⇧E
Due date                    ▸   ⇧D
───────────────────────────────────
Add sub-issue                   ⌘⇧O
Set parent                  ▸   ⌘⇧P
Relations                   ▸       (blocked by / blocking / related / duplicate of)
───────────────────────────────────
Copy                        ▸       (issue ID ⌘. · issue URL ⌘⇧, · git branch name ⌘⇧. · title)
Move to team                ▸   ⌘⇧M
Subscribe                       ⇧S
Favorite                        ⌥F
Remind me                       H
───────────────────────────────────
Duplicate
Archive                         #
Delete                          ⌘⌫
```

### 4.6 Inline title editing

- Enter edit mode via `R` (rename) or double-click on the title text.
- Replace the title `<span>` with a borderless auto-growing `<textarea>` **at the same position, same font metrics, same line-height** so nothing moves. Measure and match — a 1px shift here is the most noticeable jank in the whole app.
- `Enter` commits, `Esc` cancels and restores, blur commits.
- While editing, the `editor` scope is pushed → all single-letter shortcuts are suppressed.
- Commit is optimistic; the row title updates instantly.

### 4.7 Drag & drop reordering

- Only available when the view's **ordering is Manual** (Linear gates it on this explicitly, in Display options). If the view is sorted by priority/date, disable dragging and show a tooltip explaining why — do not silently drop.
- Dragging **within** a group reorders. Dragging **across** a group boundary in a grouped list sets the grouped-by property *and* positions the issue.
- **Multi-drag is supported** — a selection drags as a unit ("drag and drop multiple issues on both board and list views"). **C**
- Manual order is a **workspace-wide property of the issue**, not a per-view preference: Linear states manual-order changes "apply workspace-wide". **C**
- Keyboard equivalents are mandatory (`Alt+↑/↓`, `Alt+Shift+↑/↓`) — see §9.
- **→ Build this:** store order as a **fractional index** (LexoRank / the `fractional-indexing` npm package), not an integer `position`. Inserting between two rows becomes a single-row write with no renumbering pass, which is what makes optimistic reorder trivial and conflict-tolerant. Use `@dnd-kit/core` + `@dnd-kit/sortable`; it is accessible (keyboard sensor + live-region announcements) out of the box, unlike react-beautiful-dnd which is unmaintained.

---

## 5. Board interaction

### 5.1 Layout

- Enter/leave with `Cmd/Ctrl + B`, via the Board icon near Display options, or via the command menu. A board can be set as a view's default. **C**
- Columns = the values of the **grouped-by** field. Default grouping is **Status**; Linear also supports grouping by **Project, Priority, Cycle, Label, Label group, and SLA status**. **C**
- Horizontally scrolling flex row of fixed-width columns (~300–360px), each with its own vertical scroll and a sticky header (`icon · name · count · [+]`).
- Columns can be **hidden**; hidden columns collapse to the end of the board, and **you can still drag into a hidden column without unhiding it**. **C**
- Swimlanes (a second grouping axis) collapse/expand with `T`. **C**

### 5.2 Card contents

Deliberately sparse. Linear: *"Descriptions are not shown on cards. If an issue has many properties, not all properties may have space to be displayed on the card."*

```
┌──────────────────────────────┐
│ LIN-142            ◎         │  id (muted, 11px) · assignee avatar (right)
│ Fix the sync cursor drift    │  title, up to 2–3 lines, then ellipsis
│ ◑  [Bug] [Auth]        ⚑ P1  │  status icon · labels · priority
└──────────────────────────────┘
```

Which properties render is driven by Display options; overflow is dropped rather than wrapped. Use `Space` (peek) to see the rest without opening.

### 5.3 Drag behaviour

| Gesture | Effect |
|---|---|
| Drag **between** columns | **Sets the grouped-by field** to the target column's value (status → sets status; assignee → reassigns; priority → repriorities; label → applies that label). This is the whole point: the board is a direct-manipulation editor for one field. |
| Drag **within** a column | Changes manual order only. |
| Drop position | *"Dragging issues between columns places them where the mouse positioned them."* Position is honoured, not forced to top. **C** |
| Column change via `S` / the command menu instead | *"When using keyboard shortcut `S` or the command menu, issues move to the top"* of the target column. **C** |
| Multi-select drag | The whole selection moves together. **C** |

### 5.4 On drop — the exact sequence

```
1. dragEnd fires with { issueId(s), fromColumn, toColumn, beforeId, afterId }
2. compute newRank = fractionalIndexBetween(rank(beforeId), rank(afterId))
3. OPTIMISTIC: patch the local store   → { statusId: toColumn, rank: newRank }
   (the card is already visually at the drop point; do NOT animate it back to origin first)
4. fire the mutation
5a. success → reconcile with the server row; no visual change if values match
5b. failure → revert the patch, animate the card back to its original slot,
              toast "Couldn't move LIN-142 · Retry"
```

Critical detail: the DnD library's own drop animation must be **cancelled/zeroed** because the store update has already placed the card where it belongs. If you let dnd-kit animate the card home *and then* re-render it in the new column, you get a visible double-move. Set `dropAnimation: null` and let the store be the truth.

### 5.5 Keyboard on the board

Everything the list has, plus:
- `←` `→` move focus across columns (2-D navigation). **C**
- `Alt + ←` / `→` **move the issue** to the previous/next column. **R**
- `Alt + ↑` / `↓` and `Alt + Shift + ↑` / `↓` move within the column. **C**
- `X`, `Shift+X`, `Shift+Click`, `Cmd+A` all select identically to lists — Linear explicitly standardised this: *"All select and navigation interactions & keyboard shortcuts are now the same between lists and boards."* **C**

**→ Build this:** implement list and board over the **same** `useIssueCursor` / `useIssueSelection` hooks, differing only in the "next in direction" function. Do not fork the logic.

---

## 6. Optimistic update strategy

### 6.1 What Linear actually does

Linear is not a web app that fetches data. It is a **replicated object database in the browser**, kept in sync by a **totally ordered stream of deltas keyed by a global monotonic integer**. The UI reads only from memory; the network is never on the interaction path.

**It is explicitly *not* a CRDT system.** The reverse-engineering write-up (endorsed by Linear's CTO) states this is closer to OT — it "requires a central server to arrange the order of transactions," enforcing a *total* order. CRDTs were rejected because they "introduce metadata overhead and become challenging to manage in scenarios involving partial syncing or permission controls." Conflict resolution is **last-writer-wins, decided by server ordering.**

**The object pool.** A flat `Map<uuid, ModelInstance>` (`modelLookup`) on the sync client. Exactly one `Issue` object per id in the process; every reference resolves through it, so every view of an issue updates together. MobX installs a getter/setter per property via `Object.defineProperty`; `observer` components re-render on property change. No reducers, no actions, no selector layer. ~80 model types.

**IndexedDB layout** — worth copying wholesale:

| Store | Contents |
|---|---|
| `linear_<hash>` / one table per model | server-confirmed rows |
| `_meta` | `lastSyncId`, `firstSyncId`, `subscribedSyncGroups`, `backendDatabaseVersion`, per-model `persisted` flag |
| `_transaction` | serialized, **not-yet-acknowledged** transactions — the offline queue |

**The invariant that makes rollback tractable:** *"client-side operations will never directly modify the tables in the local database… only alter in-memory models."* The durable cache is written **only** from server-confirmed deltas. Optimistic state lives in memory and in the `_transaction` queue — never in the durable cache. **Steal this rule verbatim.**

**`lastSyncId`** is a global monotonic integer, incremented by 1 on every successfully executed transaction, *across all workspaces*. It is the version number of the whole database. `subscribedSyncGroups` (your user id, your teams, your roles) determines which deltas you receive — that is how permissions and partial sync coexist with a single global counter.

**Delta packets** arrive over WebSocket as `{"cmd":"sync", SyncAction[], lastSyncId}`. Each `SyncAction` is `{ id, modelName, modelId, action, data }` where `action ∈ { I insert, U update, A archive, V unarchive, D delete, C covering, G/S sync-group }`. `data` carries the **full model state, not a patch**. Deltas go to *all* connected clients **including the originator** — and may differ from what the client sent, because the server performs side effects (history rows, etc.).

**The transaction machine** — the part most clones get wrong. Four queues:

```
createdTransactions          — a microtask flushes them and stamps a shared batchIndex
  → queuedTransactions       — serialized into the _transaction table (durable)
  → executingTransactions    — sent, not yet accepted/rejected
  → completedButUnsyncedTransactions
                             — server said OK and returned a lastSyncId; still waiting
                               for the matching delta packet to come back
```

Five behaviours to reproduce:

1. **Optimistic apply happens on property assignment, not on `save()`.** The setter intercepts, records `{ property, oldValue, newValue }` into a `modifiedProperties` map, and the in-memory model is *already* updated. `save()` only enqueues the transaction.
2. **Batching.** Transactions created in the same event-loop turn share a `batchIndex` and merge into one GraphQL mutation with aliased operations, each selecting `lastSyncId`.
3. **Two-phase acknowledgement. HTTP 200 is not completion.** The transaction records `syncIdNeededForCompletion` and moves to `completedButUnsyncedTransactions`. It only completes when the delta packet carrying that sync id arrives over the WebSocket. This is what guarantees memory and server converge before anything downstream runs.
4. **Rollback restores only the fields the transaction touched**, from `modifiedProperties` — not a whole-object snapshot (which would clobber a concurrent edit to a different field). A rejected transaction never touches IndexedDB.
5. **Rebase.** You set assignee = Bob; a colleague sets Alice and lands first. Your transaction is still unsynced. Alice's delta arrives → your transaction updates its *original* value to Alice → the in-memory model is re-set to Bob, because you wrote last. Your intent is preserved while the server's ordering is accepted.

**Undo is a transaction, not a snapshot.** Each type implements `undoTransaction`; undoing creates a *new* inverse transaction and enqueues it through the same pipe.

**Offline.** Queued transactions are serialized to `_transaction`. On restart they are deserialized and **replayed against in-memory models**, restoring the optimistic UI you had before the reload, then resent. Linear openly concedes a limitation here: **non-idempotent mutations risk duplication on replay** — you can do better than Linear, cheaply (see §6.4).

**Catch-up.** WebSocket handshake returns `{ lastSyncId, userSyncGroups, databaseVersion }`. If local `lastSyncId` is behind, the client requests `/sync/delta?lastSyncId=<local>&toSyncId=<server>`. Full bootstrap is triggered only by: no stores, no `lastSyncId`, or outdated models. ⚠️ **A retention-window "too far behind → full re-bootstrap" path is *not* documented in the public write-up.** It is the obviously-correct design and you should build it explicitly — just don't cite it as a Linear fact.

*(Sources: [wzhudev/reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine), [performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown), [marknotfound wire-protocol observations](https://marknotfound.com/posts/reverse-engineering-linears-sync-magic/), Tuomas Artman's "Scaling the Linear Sync Engine".)*

### 6.2 → Recommendation: do not build a sync engine. Build the transaction layer.

The sync engine is a multi-month project. **What makes the clone feel like Linear is that no interaction ever waits for the network** — and that is §6.1's *transaction machine*, not its IndexedDB replication. Build the transaction layer; skip the replication.

```
┌─────────────────────────────────────────────────────────────┐
│ CLIENT                                                      │
│                                                             │
│  Normalized object pool  Map<id, Entity>   ← single source  │
│         │                                     of UI truth   │
│         │ optimistic patch (synchronous, 0 ms)              │
│         ▼                                                   │
│   ┌──────────────────┐   POST /api/mutate                   │
│   │ per-entity FIFO  │   Idempotency-Key: <txnId>           │
│   │ transaction queue│ ─────────────────────────────────►   │
│   │  (+ retry)       │ ◄── { entity, seq }  authoritative   │
│   └──────────────────┘                                      │
│         │ reconcile (rebase pending) / rollback             │
│         ▼                                                   │
│   GET /api/sync?since=<cursor>       ← §7                   │
└─────────────────────────────────────────────────────────────┘
```

#### Why not React 19 `useOptimistic` as the spine

`useOptimistic` is good, and its exact semantics are worth knowing:

- The setter **must be called inside an Action** (`startTransition`, `<form action>`, or an Action prop). Outside one, React warns and the optimistic state renders only briefly.
- *"Optimistic state only renders while an Action is in progress, otherwise `value` is rendered."* And: *"There's no extra render to 'clear' the optimistic state. The optimistic and real state converge in the same render when the Transition completes."*
- **Rollback on failure is implicit** — if the Action throws, the transition ends and React renders whatever `value` currently is; since the parent normally only updates `value` on success, the UI shows the pre-mutation state. You get rollback by doing nothing.
- Prefer the **reducer form** — if the base value changes while the Action is pending, React re-runs the reducer against the new base. The bare-updater form does not.

But it disqualifies itself here:

- It is **component-local React state**. It does not survive unmount (a virtualised row scrolling away) or a route change.
- It is **scoped to one subtree**. Changing a status must also move the sidebar count, the group header count, the board column count, and the detail page. One optimistic layer can't span those without lifting into a store you'd have to build anyway.
- **Nothing is persisted**, there is no queue, no retry, no per-entity ordering, and no rollback hook you can observe (so a component that unmounted mid-flight can't raise a toast).

**Use it for leaf interactions only** — a like/react button, an inline rename inside a form, the comment composer.

#### Why not Server Actions as the mutation transport

Three facts from the current Next.js docs decide it:

1. **Server Actions dispatch sequentially, one at a time per client.** *"If a user triggers three actions in quick succession, the second waits for the first to finish, then the third waits for the second"* — and *"do not rely on `Promise.all` to parallelize Server Actions from the client."* In a Linear clone, `X`-selecting five issues and pressing `S` fires five mutations; the fifth would wait on four round trips. **This alone disqualifies them for the hot path.**
2. **Every mutation with a revalidation drags a full RSC re-render.** *"When a Server Action triggers an immediate revalidation, Next.js does the work inside one HTTP request: it runs the action, then re-renders the current route server-side."* Fine for a blog; for a keystroke-frequency UI it means re-running your data layer and paying server render + Flight parse on every property change.
3. **`revalidatePath` over-invalidates.** The docs admit it *"also causes all previously visited pages to refresh when navigated to again."*

There is also a real, filed, closed-as-not-planned flicker bug: `useOptimistic` reverts after the action resolves but *before* the revalidated RSC payload commits, flashing stale state ([vercel/next.js#49619](https://github.com/vercel/next.js/issues/49619)).

**Use Route Handlers for the hot path.** The Next docs themselves point you there, and Route Handlers are not subject to the single-flight dispatcher.

#### Which store

| Option | Verdict |
|---|---|
| **TanStack DB** (0.6+) | **Default recommendation.** It is the Linear model, unbundled: typed **collections** (normalized stores), incremental **live queries**, and transactional optimistic mutations with the same lifecycle — *"local changes are applied immediately as optimistic state, then persisted to your backend, and finally the optimistic state is replaced by the confirmed server state once it syncs back."* It also ships per-entity pacing (`usePacedMutations` with `queueStrategy` / `debounceStrategy`) and automatic mutation coalescing. Sits on TanStack Query, so adoption is incremental. |
| **Zustand / Valtio + hand-rolled queue** | Choose this if you want Linear's *transaction object* semantics — persisted queue, rebase, undo-as-inverse-transaction. ~400–700 lines. Worth it if undo/redo and offline replay are real product requirements. |
| **TanStack Query alone** | Fine and well-trodden, but you hand-build normalization and you will fight the invalidate-on-settle default (§6.5). |
| **TinyBase** | Good normalized reactive store with persisters; lighter than TanStack DB, less mutation machinery. |
| ~~**Replicache**~~ | **Archived June 2026** (repo read-only). Do not start here. Its successor is **Rocicorp Zero**, which syncs query results rather than tables and is genuinely the closest off-the-shelf thing to Linear — but it is a whole-backend commitment. |

### 6.3 → The optimistic mutation flow, concretely

```ts
// ── the object pool ──────────────────────────────────────────────
type Entity = { id: string; rev: number; [k: string]: unknown };

type Txn = {
  id: string;                    // client UUID — doubles as the Idempotency-Key
  entityId: string;
  patch: Partial<Entity>;
  original: Partial<Entity>;     // Linear's modifiedProperties: ONLY the touched fields
  state: 'queued' | 'executing' | 'completedUnsynced';
};

// ── mutate ───────────────────────────────────────────────────────
function mutate(entityIds: string[], patch: Partial<Entity>) {
  for (const entityId of entityIds) {
    const before = store.entities.get(entityId)!;
    const original = Object.fromEntries(
      Object.keys(patch).map(k => [k, before[k]])      // snapshot ONLY the touched fields
    );
    const txn: Txn = { id: crypto.randomUUID(), entityId, patch, original, state: 'queued' };

    applyToMemory(entityId, patch);   // 1. OPTIMISTIC — synchronous, in-memory ONLY
    persistQueue(txn);                // 2. durable queue (optional; never the entity cache)
    enqueue(entityId, txn);           // 3. per-entity FIFO
  }
  undoStack.push({ entityIds, patch, inverse: /* per-entity originals */ });
}

// ── the per-entity worker: serializes writes to the same row ─────
async function drain(entityId: string) {
  for (const txn of queueFor(entityId)) {
    txn.state = 'executing';
    try {
      const res = await fetch('/api/mutate', {
        method: 'POST',
        headers: { 'Idempotency-Key': txn.id },        // safe to retry after a timeout
        body: JSON.stringify({ entityId, patch: txn.patch }),
      });
      if (!res.ok) throw new HttpError(res);
      const { entity, seq } = await res.json();        // AUTHORITATIVE row + sequence
      reconcile(entity, seq);                          // 4. no refetch, no invalidate
      dropFromQueue(txn); unpersist(txn);
    } catch (e) {
      if (isRetryable(e)) { await backoff(); continue }  // network/5xx: KEEP the optimistic state
      rollback(txn);                                     // 4xx: undo the touched fields only
      dropFromQueue(txn); unpersist(txn);
      toast.error(`Couldn't update ${label(entityId)}`, {
        action: { label: 'Retry', onClick: () => mutate([entityId], txn.patch) },
      });
    }
  }
}

// ── reconcile: last-writer-wins, never regress, re-apply pending ──
function reconcile(server: Entity, seq: number) {
  const local = store.entities.get(server.id);
  if (local && server.rev < local.rev) return;         // stale response, drop it

  let next = server;
  for (const t of queueFor(server.id)) next = { ...next, ...t.patch };  // ← THE REBASE
  setEntity(next);
  store.cursor = Math.max(store.cursor, seq);
}
```

Two Linear behaviours are reproduced deliberately:

- **Rollback restores only the fields the transaction touched.** A whole-object snapshot would clobber a concurrent edit to a different field.
- **Reconcile re-applies still-pending local patches on top of server truth** — that is the rebase, and it is what stops your own later edit from being erased by an earlier server response.

**Undo is the same machinery.** Push `{ entityIds, inverse }` on success; `Cmd+Z` pops and calls `mutate` with the inverse. Because the batch was one logical mutation, you get "undo works across hundreds of issues" for free.

### 6.4 Failure classes, ordering, idempotency

**Treat the three failure classes differently — this is where clones feel fragile:**

| Failure | Action |
|---|---|
| Network / offline / 5xx | **Do not roll back.** Keep the optimistic state, keep the txn queued, retry with exponential backoff + jitter. This is what makes the app feel unbreakable on a flaky connection. |
| 4xx validation / permission | Roll back immediately, toast with a *reason*, no auto-retry. |
| 409 conflict / version mismatch | Take server truth, rebase pending patches on top. If the fields genuinely collide, surface it rather than silently LWW-ing. |

**Two writes to the same entity** — three designs, in order of preference:

1. **Per-entity serialized FIFO queue** (above). Ordering guaranteed, no version arithmetic, trivial merging. Build this. TanStack DB ships it as `usePacedMutations({ strategy: queueStrategy({ wait: 200 }) })`.
2. **Field-level patches + a server `rev`.** Send only changed fields; drop any response whose `rev` is lower than what you hold. Survives out-of-order responses without serializing.
3. **Coalescing.** Merge queued mutations for the same entity before sending. TanStack DB does this automatically: `insert+update → insert`, `insert+delete → removed`, `update+delete → delete`, `update+update → union`.

**Idempotency is not optional, and you can beat Linear here cheaply:** mint entity ids **client-side** (`crypto.randomUUID()`) and send the transaction id as an `Idempotency-Key`; the server upserts on it. Retry-after-timeout becomes safe, offline replay becomes safe, and — see §6.5 — the React key never changes, which removes a whole class of flicker.

**A poll response must never revert a pending optimistic value.** When applying a `/api/sync` delta, **skip fields that have a pending local mutation** for that entity. This single rule prevents most "my change flickered back" reports.

**Toasts must be driven off the queue, not off a component.** A row that unmounted mid-flight must still produce its error toast.

### 6.5 Avoiding flicker — the rules

1. **If the mutation response is authoritative, write it into the store and do not invalidate.** TanStack Query's canonical pattern ends with `invalidateQueries` in `onSettled`; for this app that is one round trip too many and a guaranteed flash. Return the full updated row from the route handler and write it, or use `invalidateQueries({ refetchType: 'none' })`. Reserve real invalidation for cross-entity effects you cannot compute locally.
2. **Client-generated ids.** Server-generated ids cause flicker because the React key changes when the temp id is swapped for the real one, remounting the row. Mint UUIDs on the client — *"No flicker — ID never changes."*
3. **Never key on array index, and never key on a value that changes on reconcile.** `key={`${statusId}-${id}`}` will unmount/remount the row on every status change and kill your animation.
4. **Reserve layout.** Optimistic values occupy the same box as confirmed ones. Signal pendingness with opacity or a tint, never by inserting a spinner or a different-height element.
5. **Reconcile by merging into the existing object**, preserving identity where values are unchanged, so `React.memo`'d rows don't re-render.
6. **Don't animate the thing you just moved.** On drop, zero the DnD library's drop animation (§5.4).
7. **Don't `router.refresh()` on mutation.** It re-renders the server tree — the coarsest possible reconcile.

If you *do* keep `useOptimistic` near a Server Action, expect the #49619 flash. Mitigate by returning the new data from the action and holding it in client state so `value` updates within the same transition, or by not calling `revalidatePath` for that mutation at all.

### 6.6 Where RSC and Server Actions still belong

Keep them — off the hot path.

| Use RSC / Server Actions for | Use client store + Route Handler for |
|---|---|
| Initial page render (first paint of a view, streamed) | Every property change |
| Auth, settings, workspace/team admin | Selection, ordering, drag-drop |
| Anything with a real form and a submit button, especially ending in `redirect()` | Comment posting, title edits |
| Heavy one-off reads (Insights, exports) | Anything triggered by a single keystroke |

The App Router page server-renders the first screen of issues and seeds a client provider; from then on the client store owns the view.

Cache-API notes for the parts you keep server-rendered (Next 16 surface):

| Function | Semantics |
|---|---|
| `updateTag(tag)` | Server Actions only. **Immediate** expiry; the next read waits for fresh data. Use when you need read-your-own-writes. |
| `revalidateTag(tag, 'max')` | Stale-while-revalidate. Does **not** include a re-render in the action response. |
| `revalidatePath(path, type?)` | Path/layout invalidation; triggers the in-response re-render. Over-invalidates. |
| `refresh()` / `router.refresh()` | Refetch the current route's RSC payload without invalidating cached data. |

Also worth knowing: Server Action ids rotate at most every 14 days, and a long-lived tab gets `Failed to find Server Action` — another reason not to put the hot path there. Action bodies cap at 1 MB.

### 6.7 If you later want offline reads

Mirror the normalized store into IndexedDB (**Dexie** + `useLiveQuery`, or TanStack DB 0.6's built-in persistence, which makes it close to a config change).

**Hold Linear's invariant:** persist only **server-confirmed** state to IndexedDB; persist optimistic state only as *queued transactions*. Writing optimistic values into the durable cache eventually ships a user a permanently-wrong local row.

Costs you inherit, honestly:
- **Schema migration**, forever. Linear solves it with a `__schemaHash` → bump `schemaVersion` → migrate on open. You need the same or you will ship a broken cache mid-session.
- **Bootstrap logic**: full vs local start, plus a "schema changed / cache too old / user changed → nuke and refetch" path.
- **Replay duplication**, unless you did the idempotency keys in §6.4.
- **Multi-tab**: IndexedDB is shared across tabs, your in-memory store is not. Elect a leader (Web Locks) or fan deltas over `BroadcastChannel` (you want the leader anyway — see §7.3).

**Ship without it.** §6.3–§6.5 deliver ~90% of the perceived speed for ~10% of the complexity.

---

## 7. Real-time options

> ⚠️ **Two widely-repeated "facts" about Vercel are now wrong.** Hobby functions no longer cap at 10s/60s — they run **300 seconds**, the same default *and* max as Pro (Fluid compute, default-on for projects created after 2025-04-23). And Vercel Functions **do** serve WebSockets natively (public beta since 2026-06-22). Vercel staff said the opposite as recently as Nov 2025, so anything written before ~July 2026 — including most blog posts and most model output — is stale. The recommendation below still avoids both, but for a completely different reason than the usual one.

### 7.1 What Linear does

WebSocket delta packets keyed by a monotonic sync id, fanned out via Redis, applied into each client's local object graph (§6.1). Plus real-time collaborative editing of descriptions and documents (ProseMirror + **Yjs**) with visible input cursors.

### 7.2 The actual constraint on Vercel Hobby: provisioned memory

| Hobby resource | Included |
|---|---|
| Function invocations | 1,000,000 / month |
| Edge requests | up to 1,000,000 / month |
| Active CPU | 4 CPU-hours |
| **Provisioned memory** | **360 GB-hrs** |
| Function memory | 2 GB / 1 vCPU (fixed, not configurable on Hobby) |
| Max function duration | 300 s (default *and* max) |
| Request/response body | 4.5 MB |
| Overage behaviour | **Hard stop.** No pay-as-you-go on Hobby, no Spend Management. *"You will have to wait until 30 days have passed before you can use the feature again."* |

Fluid pricing is asymmetric in exactly the way that matters: **Active CPU** *"pauses billing when your code is waiting for external services"*, but **provisioned memory** is *"billed for the entire instance lifetime… Memory is reserved for your function even when it's waiting for I/O."* So a held-open SSE or WebSocket connection is free on CPU and **fully billed on memory**.

```
360 GB-hrs ÷ 2 GB per instance = 180 instance-hours / month
```

**180 hours is your entire monthly budget for "a function instance being alive."** Fluid's in-function concurrency means all your users' connections can share one instance, so it's a shared pool — but that still works out to ~6 hours/day of "at least one user connected." A 9-to-5 team app (8h × 22 days = 176h) lands at **176 of 180**. You would be running at 98% of a hard cap whose failure mode is a 30-day outage you cannot pay your way out of.

**That is why persistent connections are the wrong choice here** — not because they don't work.

### 7.3 → Recommendation: cursor polling, built properly

**Ship polling. Design the client so a push transport drops in later without touching the store.**

Rationale: ~90–95% of the perceived speed in a Linear clone comes from optimistic local mutation (§6) — the user's *own* actions are already instant. Real-time only affects how fast you see *someone else's* change, and at 1–20 users a 15-second delay is invisible in an issue tracker. Polling costs one trivial invocation per user per interval, has zero third-party dependencies, works identically in local dev, and degrades by turning a knob rather than by rewriting.

**The swappable contract:**

```ts
type SyncTransport = { start(onDelta: (d: Delta) => void, getCursor: () => number): () => void };
// v1: pollingTransport()   v2: doorbellTransport(ably|pusher)   — the store never changes.
```

#### 7.3.1 The cursor: not a timestamp, and not a bare sequence either

**`updated_at` loses writes.** A row's timestamp is assigned when the statement *runs*; the row becomes visible when the transaction *commits*. T1 stamps 10:00:00 and commits at 10:00:03; a poll at 10:00:01 sees nothing, advances the cursor past 10:00:00, and **T1's row is never delivered.** Worse in Postgres specifically: `now()` / `CURRENT_TIMESTAMP` return *transaction start* time, so a long transaction stamps rows minutes in the past. (`clock_timestamp()` at least avoids that half.) Add clock skew from multiple writers and it's unusable.

**A naive `BIGSERIAL` has the identical bug.** `nextval()` is non-transactional — it allocates at statement time, outside the transaction, and never rolls back. Writer A takes seq 100, writer B takes 101, **B commits first**; a poll advances the cursor to 101; A commits and row 100 is now visible but below the cursor. **Lost.** Sequences also gap on rollback, so "wait for seq+1" doesn't rescue you.

**→ Build this (option A): serialize cursor assignment inside the write transaction.**

```sql
-- inside the same transaction as every mutation
UPDATE sync_state SET seq = seq + 1 WHERE workspace_id = $1 RETURNING seq;
```

The row lock forces writers to commit **in seq order** — writer B physically blocks until A commits, so out-of-order commits become impossible. One serialization point per workspace: free at 1–20 users, and it partitions cleanly when you grow.

**Belt and braces (option C): overlap the read.** Advance the cursor only to `max(seq) − margin`, or always re-read the last N values, and dedupe client-side by `(id, seq)`. Requires idempotent apply, which you want anyway. **Do A + C.**

*(For completeness, the provably-correct option B is the snapshot watermark: stamp rows with `pg_current_xact_id()` and read `WHERE txid > $cursor AND txid < pg_snapshot_xmin(pg_current_snapshot())`. Gap-free by construction, at the cost of a delay equal to your oldest open transaction. Overkill here.)*

#### 7.3.2 The endpoint contract

```
GET /api/sync?since=<cursor>&teamId=<id>
→ { changes: [...], cursor: <new>, hasMore: boolean, resync?: true }
```

- `SELECT … WHERE seq > $cursor ORDER BY seq LIMIT 200`. If `hasMore`, the client polls again **immediately** rather than waiting out the interval.
- **Tombstones for deletes.** Never hard-delete — you need `deleted_at` for archive/restore and `Cmd+Z` anyway. Set it and **bump the row's `seq`** so the delete ships as a change like any other. Otherwise clients hold deleted issues forever.
- **`min_retained_seq` + resync bailout.** Track how far back tombstones are retained; if an incoming `cursor < min_retained_seq`, respond `{ resync: true }` and have the client re-bootstrap. **Every incremental protocol needs this** — without it a laptop closed over a holiday silently diverges. (This is precisely the path Linear's public write-up doesn't document; build it explicitly.)
- Watch the **4.5 MB response cap** — a full resync must paginate.
- Keep the handler **lean and outside heavy framework middleware**. A 5 ms indexed query gives you ~2.9M polls against the 4 CPU-hour budget; a 15 ms handler lands at ~960k, i.e. the same order as the invocation cap.

#### 7.3.3 Interval and request budget

Every poll = 1 invocation + 1 edge request, both capped at 1,000,000/month (realistically ~700k after page loads and uncached assets).

| Interval | 10 users | 20 users |
|---|---|---|
| 5 s | 950k ❌ | 1.9M ❌ |
| 10 s | 475k ⚠️ | 950k ❌ |
| **15 s** | **317k ✅** | **634k ✅** |
| 30 s | 158k ✅ | 317k ✅ |

**Ship 15 s.** Three free multipliers on top:

1. **Page Visibility API.** `document.visibilityState === 'hidden'` → **stop polling entirely**; on `visibilitychange` back to visible, poll **once immediately**, then resume. Use `visibilitychange`, not `blur` — a tab on a second monitor is visible but unfocused, and users notice if it goes stale.
2. **One poller per browser, not per tab.** `BroadcastChannel` + leader election (or a `SharedWorker`); the leader polls and broadcasts results to followers. Three open tabs then cost one loop — a straight 3× saving against the binding cap.
3. **Idle backoff.** No input for 5 minutes → 60 s interval. Plus exponential backoff with jitter on errors.

`ETag: <cursor>` + `If-None-Match` → 304 saves bandwidth but still costs an invocation and an edge request, so it helps the resource that isn't binding. Do it anyway; don't count on it.

### 7.4 Fallback if 15 s genuinely isn't acceptable: **push a doorbell, pull the data**

**This is the single most important architectural point in this section.** Keep `/api/sync` exactly as-is as the source of truth. Add a free realtime channel and publish **one tiny message per mutation** — `{ workspace, cursor: 4711 }`, no payload. On receipt, the client calls the same `/api/sync` instead of waiting for the timer. Keep a slow 60 s timer as a self-healing backstop.

Why this and not a data channel: you never have to trust the pushed payload, **ordering doesn't matter**, dropped messages self-heal on the next poll, reconnect-after-offline is the same code path as cold start, and the transport becomes genuinely interchangeable. Ably, Pusher, Supabase Realtime, Vercel WebSockets and Durable Objects are all swappable behind a doorbell; none of them are swappable behind a data channel.

At 20 users and a few hundred mutations a day this is a few thousand messages a month — free forever at this scale.

### 7.5 Free-tier landscape (Aug 2026)

| Service | Free tier | What breaks first at 5–20 users |
|---|---|---|
| **Pusher Channels** (Sandbox) | 100 concurrent connections, 200k messages/day | Nothing. Comfortable. |
| **Ably** | 6M messages/month, 200 peak connections, **200 peak channels** | Peak *channels*, if you do channel-per-issue. Use channel-per-workspace. |
| **Supabase Realtime** | 200 peak connections, 2M messages/month; 100 msg/s, 100 channels/connection, 20 presence msg/s | **The 1-week inactivity project pause** — not any realtime number. Keep it warm with a cron or budget Pro. |
| **Liveblocks** | **10 simultaneous connections per room**, unlimited MAU, no credit card | **The 10-per-room cap sits inside your 1–20 target.** If "room" = workspace, you're hard-capped at 10 concurrent users. |
| **Cloudflare Durable Objects** (Workers Free) | 100k req/day, 13,000 GB-s/day, 5 GB storage; **WebSocket Hibernation** makes idle connections near-free | 100k requests/day. Most *capable* free option, but a second platform alongside Vercel. Best long-term answer. |
| **PartyKit** | Acquired by Cloudflare; price it as Durable Objects | — |
| **Upstash Redis** | 500k commands/month, REST `/subscribe` over SSE | Holding the SSE subscription still needs a Vercel function held open → you inherit the memory problem anyway. |
| **Upstash QStash** | 1,000 msg/day, server-to-server only | **No browser fan-out.** Not a realtime primitive here. |
| **Neon** | — | **No realtime primitive at all.** Logical replication needs a direct non-pooled persistent session, which a serverless function cannot hold; same for `LISTEN`/`NOTIFY`. On Neon, poll. |

Supabase Realtime's Postgres Changes does work on Free, but note it authorizes every event against every subscriber (throughput scales with *subscriber count*), is single-threaded to preserve ordering, doesn't apply RLS to DELETE, and Supabase itself recommends Broadcast past ~3,000 subscribers. None of that bites at 20 users.

⚠️ Unverified: Vercel's WebSockets docs carry a "Permissions Required" marker and **no Vercel document states which plans it's available on** — test a 10-line `ws` echo endpoint before designing around Hobby availability. Pusher/Ably credit-card requirements were not stated on their pricing pages. Liveblocks free-plan figures disagreed across sources; only the 10-per-room number was consistent.

Also: **Vercel Hobby is non-commercial use only.** If the clone ever earns money you're on Pro regardless of limits.

### 7.6 Presence

**Don't build it in v1.** It is the highest cost-to-value ratio feature here, and the most likely to blow a free tier: presence fan-out is **O(n²) in messages** — Ably's own docs work an example where ~200 clients joining and leaving produce ~80,400 messages.

When you do, **fold it into the poll you already make**:

- Client sends its current view with the sync request: `GET /api/sync?since=<cursor>&viewing=<issueId>`.
- Server upserts `(user_id, issue_id, last_seen_at)` — one row, or a Redis key with a 45 s TTL — and returns current viewers **in the same response**.
- Viewers = `last_seen_at > now() - 45s`.

Zero extra requests, zero new dependencies, ~15 s granularity. Good enough for "who's looking at this issue" avatars.

**Live cursors (Figma-style) are a different animal** — 20–60 messages/second *per user*. Do not attempt them on a polling architecture or on Hobby. **A Linear clone does not need them; Linear itself doesn't have them.** Collaborative *description* editing (Yjs + a persistent awareness channel) is likewise out of scope — make descriptions last-write-wins with a "someone else edited this" toast.

### 7.7 Migration path

1. **Now** — Hobby + cursor polling, 15 s visible / off when hidden, leader tab.
2. **Latency complaints** — add the Ably/Pusher doorbell. Still $0.
3. **Money changes hands** — Vercel Pro ($20/mo), required anyway by the non-commercial fair-use rule. Unlocks 800 s durations, Spend Management, and viable native WebSockets (provisioned memory becomes pay-as-you-go, ~$15/mo for a permanently warm instance).
4. **Real scale (100s–1000s concurrent)** — move fan-out to Cloudflare Durable Objects (one DO per workspace, WebSocket Hibernation) or Ably paid. **Postgres stays the source of truth and `/api/sync` stays the reconciliation path** — which is exactly why step 1 is worth doing carefully. The cursor endpoint you write today is the correctness backbone at every subsequent step.

---

## 8. Motion & feedback

### 8.1 Linear's actual timing values

Lifted from Linear's own CSS custom properties:

| Token | Value | Used for |
|---|---|---|
| `--speed-highlightFadeIn` | `0s` | Hover/selection highlights — **instant, no transition on the way in** |
| `--speed-quickTransition` | `0.1s` | Menus, popovers, small state changes |
| `--speed-regularTransition` | `0.25s` | Panels, larger layout changes |
| `--speed-slowTransition` | `0.35s` | The slowest thing in the app |

Two rules behind them:

- **Asymmetric timing: appear instantly, dismiss over ~150 ms.** Arrival is information the user asked for; departure is politeness. Never make the user wait for something to appear.
- **GPU-only properties.** Animate `transform` and `opacity`. **Never** `width`, `height`, `top`, `left`, `margin`, `padding`. Avoid paint-triggering properties where possible.

These durations sit *well below* the industry norm (Material's 200 ms standard) and below the ~100 ms cause-and-effect perception threshold. If your clone's menus fade in over 200 ms it will feel like a different, slower product no matter how correct everything else is.

**→ Build this** as design tokens and forbid ad-hoc durations in review:

```css
:root {
  --speed-instant:  0ms;
  --speed-quick:    100ms;
  --speed-regular:  250ms;
  --speed-slow:     350ms;
  --ease-out:       cubic-bezier(0.16, 1, 0.3, 1);   /* strong ease-out */
}
@media (prefers-reduced-motion: reduce) {
  :root { --speed-quick: 0ms; --speed-regular: 0ms; --speed-slow: 0ms; }
}
```

### 8.2 No spinners

The design consequence of §6: **there is no loading state for data you already have.** Linear has no "loading issues" spinner in the steady state because issues are already in memory.

The real thresholds ([NN/g, Response Time Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)): **0.1 s** = feels instantaneous, no feedback needed; **1 s** = flow of thought preserved — *"normally, no special feedback is necessary during delays of more than 0.1 but less than 1.0 second"*; **10 s** = limit of attention. The commonly-quoted "show a spinner after 300 ms" is a practitioner heuristic derived from these, not an NN/g number — but it is the right instinct, because a spinner that appears and vanishes in 200 ms is worse than no spinner at all.

| Duration | Treatment |
|---|---|
| < ~300 ms | **Nothing.** No spinner, no skeleton, no opacity change. |
| ~300 ms – 1 s | Delay the indicator 300–500 ms, and once shown keep it up for a 300 ms minimum so it can't strobe. A 2px indeterminate bar at the top of the content area, or a subtle pulse on the affected element only. |
| > 1 s, first load only | **Skeleton rows** matching the exact final geometry — same row height, same column positions — so nothing shifts when data arrives. Never a centred spinner. |
| Any mutation | Never block. The optimistic value is already on screen. |

Also copy Linear's **inlined app shell** trick: render the sidebar/header chrome from `localStorage` (theme, sidebar width) *before* the JS bundle parses, so the first paint is already correctly themed and laid out. That is what removes the white flash.

### 8.3 Toasts

Linear's toast: a small card, ~2 lines, an inline action, and a depleting progress bar. Notably there is a global shortcut to **open the link from the last toast** (`Cmd+Option+O`) — toasts are an interactive surface, not decoration.

**→ Build this:**

- Position bottom-left (Linear-like) or bottom-centre. Stack newest at the "open" end; max 3 visible, older ones collapse.
- Enter: `translateY(8px) → 0` + `opacity 0 → 1` over `--speed-quick`. Exit over ~150 ms.
- **Default duration 5–6 s**; pause the countdown on hover and while the tab is hidden.
- **Success toasts are usually wrong.** Do not toast "Status updated" — the user can see it. Toast only for: (a) errors, (b) destructive actions with undo, (c) actions whose result is *off-screen* ("Moved LIN-142 to Design", "Copied branch name").
- Every destructive toast carries **Undo** with the shortcut hint `⌘Z` rendered on it.
- Errors are sticky (no auto-dismiss) and carry **Retry** — driven from the mutation queue (§6.4), not from a component that may have unmounted.
- `role="status"` / `aria-live="polite"` for normal toasts, `role="alert"` / `assertive` for errors. Portal, with `aria-relevant="additions"`.
- Recommended library: **Sonner** — stacking, hover-pause, promise toasts, action buttons, unstyled enough to match.

### 8.4 Undo

Model undo as a first-class stack over the mutation layer (§6.3), not per-component state:

- `Cmd+Z` / `Cmd+Shift+Z` global, suppressed while a text editor has focus (the editor owns its own undo).
- **Batch operations are one undo entry**, because the batch was one logical mutation.
- After undo, **navigate back to where the action happened and re-select the affected issues** — Linear does exactly this, and it is what makes undo trustworthy rather than spooky.
- Keep the stack in memory only (~50 entries). Don't persist it.

### 8.5 Micro-details worth copying

- Sidebar notification badges **animate in together** rather than one-by-one, "reducing flickering" (Linear changelog, Jan 2026). Batch your enter animations.
- Shortcut hints in menus **highlight the key currently being held** — so holding `⌘` lights up the `⌘` cap in every visible hint. Cheap, and it teaches the keymap.
- Peek (`Space`) auto-previews as you arrow through **command-menu results**, not just list rows.

---

## 9. Accessibility

A keyboard-first app is not automatically an accessible app. These are the places where "keyboard-first" and "screen-reader-correct" pull in different directions, and how to resolve each.

### 9.1 The core tension

Linear-style lists have a **visual cursor that is not DOM focus** (you arrow through 200 rows; DOM focus stays on the container). If you instead move real DOM focus to each row, you get scroll-jank, `:focus-visible` fighting your styling, and screen readers announcing the whole row on every arrow press.

**→ Resolution:** use the **roving tabindex** pattern for list/board rows, and **`aria-activedescendant`** for comboboxes. Different tools for different jobs.

### 9.2 Lists & boards → roving tabindex

```html
<div role="grid" aria-label="Issues" aria-multiselectable="true">
  <div role="row" tabindex="0"  aria-selected="false" id="row-LIN-142"> … </div>  <!-- focused row -->
  <div role="row" tabindex="-1" aria-selected="true"  id="row-LIN-143"> … </div>
</div>
```

- Exactly **one** row has `tabindex="0"`; all others `-1`. On arrow, move the `0`, call `.focus()` on the new row, and `scrollIntoView({ block: 'nearest' })`.
- `Tab` from the list therefore leaves the list entirely — which is correct, and is what makes a 500-row list navigable.
- `aria-selected` mirrors your multi-select state; `aria-multiselectable` on the container.
- Announce bulk results via a live region: `"3 issues selected"`, `"Status changed to In Progress for 3 issues"`.
- **Virtualisation caveat:** if the focused row is unmounted by the virtualiser, focus lands on `<body>` and keyboard nav dies. Keep the focused row in an overscan window, or move `tabindex="0"` to the container and use `aria-activedescendant` instead when virtualised.

### 9.3 Command palette & pickers → `aria-activedescendant`

DOM focus **never leaves the text input** — that is what lets you keep typing while arrowing.

```html
<input type="text" role="combobox" aria-expanded="true" aria-haspopup="listbox"
       aria-autocomplete="list" aria-controls="cmdk-list"
       aria-activedescendant="cmdk-opt-3" autocomplete="off" />
<ul id="cmdk-list" role="listbox" aria-label="Commands">
  <li role="group" aria-labelledby="grp-issue">
    <span id="grp-issue" role="presentation">Issue</span>
    <li id="cmdk-opt-3" role="option" aria-selected="true">Change status…</li>
  </li>
</ul>
```

Per the ARIA APG combobox pattern: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant` pointing at the active option; popup as `role="listbox"` with `role="option"` children and `aria-selected="true"` on the active one. `↓` moves the active descendant; `Enter` accepts; `Esc` closes and returns focus to the trigger.

Multi-select label picker: `aria-multiselectable="true"` on the listbox, and each option's `aria-selected` reflects *applied*, not *highlighted*. Because "highlighted" and "selected" diverge in a multi-select combobox, also render a real checkbox visual so sighted users aren't confused either.

Announce the result count on a debounced (~250 ms) `aria-live="polite"` region: `"12 results"`. Do not announce on every keystroke.

**Use `cmdk`.** It implements this pattern correctly; hand-rolling the ARIA here is a reliable source of bugs.

### 9.4 Focus management

| Transition | Required behaviour |
|---|---|
| Open palette / picker / modal | Move focus to the input (or first focusable). Record the previously focused element. |
| Close any overlay | **Restore focus to exactly the element that opened it.** If that row was removed (archived), focus the next row in visual order. |
| Open issue detail from a list | Focus the detail container (`tabindex="-1"`), announce the title. On back, restore the list cursor to that issue and scroll it into view. |
| Delete/archive the focused row | Move the cursor to the next row *before* the row unmounts. |
| Route change | Move focus to the main heading (`tabindex="-1"` + `.focus()`) and announce the new view name in a live region — SPAs otherwise strand screen-reader users. |

### 9.5 Focus traps in modals

- Modals and the palette get `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
- Trap `Tab`/`Shift+Tab` within the dialog; `Esc` closes.
- Apply `inert` to the rest of the app while a modal is open — `aria-hidden` alone does not stop `Tab`; `inert` does both and is now broadly supported.
- **Popovers/pickers are NOT modals.** Dismissible on outside click and `Esc`, must not trap `Tab`, must not mark the app inert — otherwise the "hold `Shift` to keep the menu open and keep working" pattern breaks.
- Use **Radix UI** primitives (`Dialog`, `Popover`, `DropdownMenu`) rather than rolling your own — they handle the trap, the restore, the outside-click, the scroll-lock, and the submenu safe-triangle.

### 9.6 Keeping shortcuts from firing while typing

Covered mechanically in §1.11; the policy, restated as rules:

1. **Bail on `e.isComposing` (or `keyCode === 229`) unconditionally.** IME composition is the #1 cause of "the app randomly reassigned my issue while I typed".
2. **Ignore `INPUT`, `TEXTAREA`, `SELECT`, and any `isContentEditable` ancestor** for unmodified and `Shift`-only bindings.
3. **Allow through while typing**: `Escape`, `Cmd/Ctrl + Enter`, `Cmd/Ctrl + K`, `Cmd/Ctrl + Z`, and other `Cmd/Ctrl`-bearing bindings — but let the editor scope claim the ones it owns first (`Cmd+B`, `Cmd+I`, `Cmd+K`-as-link).
4. **Provide `data-no-shortcuts`** as an opt-out container attribute for third-party embeds.
5. **Never call `preventDefault()` unless a binding actually matched** — swallowing keys you don't handle breaks assistive tech, browser find, and the user's OS shortcuts.
6. **Respect `Tab`.** Never bind bare `Tab` globally.
7. **Every shortcut must have a non-keyboard equivalent.** Motor-impaired and screen-reader users navigate by the context menu and the palette. Drag-and-drop in particular **must** have the keyboard equivalents from §1.5 plus live-region announcements (`"Moved to position 3 of 12 in In Progress"`).

### 9.7 Other

- **`prefers-reduced-motion`** → zero all duration tokens (§8.1) and disable the drag "lift" transform. Disable the tweens, not the state changes.
- **Contrast**: the focus cursor and the selected state must be distinguishable **without relying on colour alone** at ~4% background deltas — add a left accent bar or a border, not just a tint.
- **Visible focus ring** on everything reachable by `Tab`. Use `:focus-visible` so mouse users don't see it, but never `outline: none` unconditionally.
- **Zoom/reflow**: rows must survive 200% zoom without horizontal page scroll (the board may scroll horizontally — that's a legitimate 2-D data surface).

---

## 10. Sources

### Linear official — docs (fetched Aug 2026)
- [select-issues](https://linear.app/docs/select-issues) — `X`, `Shift+↑/↓`, `Cmd+A`, `Esc`, `Alt(+Shift)+↑/↓`, right-click menu, bulk actions
- [board-layout](https://linear.app/docs/board-layout) — grouping options, drag placement, `Cmd+B`, `T`, hidden columns, `S`-moves-to-top
- [editing-issues](https://linear.app/docs/editing-issues) — `Cmd+Shift+M`, `Cmd+A`, `Cmd+Z`, inline editing
- [creating-issues](https://linear.app/docs/creating-issues) — `C`, `V`, `Alt+C`, `Esc` → save as draft
- [delete-archive-issues](https://linear.app/docs/delete-archive-issues) — `Cmd+Delete`, `#` restore, `G X`, undo
- [priority](https://linear.app/docs/priority) · [labels](https://linear.app/docs/labels) · [due-dates](https://linear.app/docs/due-dates) · [estimates](https://linear.app/docs/estimates) · [favorites](https://linear.app/docs/favorites)
- [peek](https://linear.app/docs/peek) — `Space` tap/hold, contents, palette integration
- [search](https://linear.app/docs/search) — `/`, `Cmd+F`, `O I`, type prefixes, `lin123` shorthand, matching behaviour
- [filters](https://linear.app/docs/filters) · [display-options](https://linear.app/docs/display-options) · [custom-views](https://linear.app/docs/custom-views)
- [editor](https://linear.app/docs/editor) — the full editor shortcut + markdown input-rule table
- [my-issues](https://linear.app/docs/my-issues) · [inbox](https://linear.app/docs/inbox) · [triage](https://linear.app/docs/triage)
- [assigning-issues](https://linear.app/docs/assigning-issues) · [issue-relations](https://linear.app/docs/issue-relations) · [parent-and-sub-issues](https://linear.app/docs/parent-and-sub-issues) · [comment-on-issues](https://linear.app/docs/comment-on-issues)

### Linear official — changelog & design writing
- [New command menu (2019-12-18)](https://linear.app/changelog/2019-12-18-new-command-menu) — grouping + context prioritisation
- [Contextual command menu (2019-10-07)](https://linear.app/changelog/2019-10-07-contextual-command-menu) — anchors near its trigger; peek deactivates
- [Better menus and view options (2020-08-26)](https://linear.app/changelog/2020-08-26-better-menus-and-view-options)
- [Issue selection](https://linear.app/changelog/issue-selection) — `Shift+Click`, 2-D board arrows, multi-drag, list/board parity
- [Undo actions](https://linear.app/changelog/undo-actions) — batch undo, returns you to the origin view and reselects
- [Keyboard shortcuts help (2021-03-25)](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help) — the searchable `?` modal
- [Collapsible sidebar](https://linear.app/changelog/unpublished-collapsible-sidebar) — `[`
- [2026-01-22](https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile) — menus open under triggers; `Shift+Click` range multiselect in menus; pressed-key highlighting; `G U`; batched sidebar animations
- [UI refresh (2026-03-12)](https://linear.app/changelog/2026-03-12-ui-refresh) — Enter-vs-`Cmd+Enter` comment preference; `Cmd+Opt+0–4` headings
- [Invisible details](https://linear.app/now/invisible-details) / [Medium version](https://medium.com/linear-app/invisible-details-2ca718b41a44) — submenu safe triangle; menus as a shortcut-teaching surface

### Architecture & performance
- [performance.dev — How is Linear so fast?](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) — IndexedDB + MobX object graph, granular observables, the `--speed-*` tokens, palette over the local object pool, service-worker precache
- [wzhudev/reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine) — endorsed by Linear's CTO; ModelRegistry, object pool, transaction queues, delta packets, rollback/rebase, undo, bootstrap, IndexedDB layout
- [marknotfound — Reverse engineering Linear's sync magic](https://marknotfound.com/posts/reverse-engineering-linears-sync-magic/) — observed `/sync/bootstrap`, `/sync/delta`, `{"cmd":"sync"}` frames
- [Scaling the Linear Sync Engine](https://linear.app/now/scaling-the-linear-sync-engine) · [talk video](https://www.youtube.com/watch?v=Wo2m3jaJixU) · [localfirst.fm #15 transcript](https://www.localfirst.fm/15/transcript) · [devtools.fm #61](https://www.devtools.fm/episode/61)

### Optimistic updates / React / Next.js
- [React — `useOptimistic`](https://react.dev/reference/react/useOptimistic) · [`useActionState`](https://react.dev/reference/react/useActionState)
- [Next.js — Server Actions and Mutations](https://nextjs.org/docs/app/guides/server-actions) (sequential dispatch; re-render on revalidate) · [`revalidatePath`](https://nextjs.org/docs/app/api-reference/functions/revalidatePath) · [`updateTag`](https://nextjs.org/docs/app/api-reference/functions/updateTag) · [`refresh`](https://nextjs.org/docs/app/api-reference/functions/refresh)
- [vercel/next.js#49619](https://github.com/vercel/next.js/issues/49619) — `useOptimistic` reverts before the revalidated render commits
- [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — cancel → snapshot → patch → rollback → settle
- [TanStack DB — Mutations](https://tanstack.com/db/latest/docs/guides/mutations) · [TanStack DB 0.6 (persistence, offline)](https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes)
- [rocicorp/replicache](https://github.com/rocicorp/replicache) — **archived 10 June 2026** · [Rocicorp / Zero](https://rocicorp.dev/blog/the-sync-001)
- [Dexie `liveQuery()`](https://dexie.org/docs/liveQuery())
- [NN/g — Response Time Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)

### Real-time / hosting limits
- Vercel: [Limits](https://vercel.com/docs/limits) (2026-08-03) · [Function limits](https://vercel.com/docs/functions/limitations) (2026-07-01) · [Hobby plan](https://vercel.com/docs/plans/hobby) · [Fluid compute](https://vercel.com/docs/fluid-compute) · [Fluid pricing](https://vercel.com/docs/functions/usage-and-pricing) · [Streaming](https://vercel.com/docs/functions/streaming-functions) · [WebSockets](https://vercel.com/docs/functions/websockets) + [public-beta changelog](https://vercel.com/changelog/websocket-support-is-now-in-public-beta) · [Queues](https://vercel.com/docs/queues) · [Fair use](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)
- [MDN — Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) · [MDN — Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- Postgres cursor correctness: [Sequences and messaging guarantees](https://event-driven.io/en/ordering_in_postgres_outbox/) · [pgpedia — `pg_current_snapshot()`](https://pgpedia.info/p/pg_current_snapshot.html) · [Snapshots and tuple visibility](https://jnidzwetzki.github.io/2024/04/03/postgres-and-snapshots.html) · [pgsql-general: modification time & transaction synchronisation](https://www.postgresql.org/message-id/4BCD3849.3020304%40postnewspapers.com.au)
- Free tiers: [Pusher](https://pusher.com/channels/pricing/) · [Ably](https://ably.com/pricing) + [presence](https://ably.com/docs/presence-occupancy/presence) · [Supabase](https://supabase.com/pricing) + [Realtime quotas](https://supabase.com/docs/guides/realtime/quotas) + [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [Liveblocks](https://liveblocks.io/pricing) · [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [Upstash Redis](https://upstash.com/pricing/redis) · [Neon logical replication](https://neon.com/docs/guides/logical-replication-neon)

### Standards & libraries
- [WAI-ARIA APG — Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- `cmdk` (palette) · Radix UI (Dialog/Popover/DropdownMenu + safe triangle) · `@dnd-kit` (accessible DnD) · `fractional-indexing` (LexoRank-style ordering) · Sonner (toasts)

### Third-party shortcut sheets (REPORTED tier, partly stale)
- [KeyCombiner](https://keycombiner.com/collections/linear/) — most complete; stale on due date
- [ShortcutFoo](https://www.shortcutfoo.com/app/dojos/linear-app-mac/cheatsheet) — most current-looking; has `Cmd+Opt+O` and `Cmd+Opt+A`
- [pie-menu](https://www.pie-menu.com/shortcuts/linear) · [FastShortcuts](https://fastshortcuts.com/shortcuts/linear/) · [ShortcutRef](https://shortcutref.com/en/linear/)
</content>
