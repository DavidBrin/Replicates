# Lane C — Data Model & API Reference

Authoritative entity/field reference for the Linear rebuild. Every fact is tagged:

- **[OBSERVED]** — read from the live Linear API against a real workspace (via the Linear MCP server, read-only). Company-specific content is redacted or paraphrased; only shapes are reported.
- **[DOCUMENTED]** — from Linear's published GraphQL schema (`@linear/sdk` `schema.graphql`) or `linear.app/docs`. Field descriptions are quoted verbatim from the schema's docstrings.
- **[PROPOSED]** — my design decision for the clone. Not a claim about Linear.
- **[VERIFIED]** — a claim about *my* proposed schema that I executed against a real Postgres 16 instance. The full DDL in §4 applies clean (30 tables, 0 errors) and every constraint below was exercised; see §4.2.

The single most valuable source is the SDK's checked-in SDL:
`https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql` (50,624 lines). It carries every type, every field, nullability, deprecations, and prose docstrings. Where this document quotes a description in "double quotes", it is verbatim from that file.

**Scalars used below:** `DateTime` = ISO-8601 UTC string. `TimelessDate` = calendar date with no time/zone (`"2026-08-25"`). `JSONObject` = arbitrary JSON. `ID`/`String` for ids = UUID v4.

---

## 1. Entity reference

### 1.1 Organization (Workspace)

`type Organization implements Node` — [DOCUMENTED]. Linear's Organization is the workspace. It has ~90 fields, the vast majority feature flags and integration settings. The structural ones:

| Field | Type | Null | Example (redacted) | Notes |
|---|---|---|---|---|
| `id` | `ID!` | no | `f62c01ed-…-81575615d7ff` | [OBSERVED] UUID v4 |
| `name` | `String!` | no | `"Acme"` | [OBSERVED] |
| `urlKey` | `String!` | no | `"acme"` | Workspace slug; appears in every URL (`linear.app/acme/…`) |
| `previousUrlKeys` | `[String!]!` | no | `["acme-old"]` | Old slugs kept so URLs keep resolving |
| `logoUrl` | `String` | yes | `https://…` | |
| `createdAt` / `updatedAt` | `DateTime!` | no | | |
| `archivedAt` | `DateTime` | yes | `null` | "Null if the entity has not been archived." |
| `deletionRequestedAt` | `DateTime` | yes | | Soft-delete request |
| `userCount` | `Int!` | no | `24` | Derived |
| `createdIssueCount` | `Int!` | no | `2751` | Derived — a monotonic all-time counter, not a live count |
| `projectStatuses` | `[ProjectStatus!]!` | no | | Project statuses are **workspace-level**, unlike issue workflow states |
| `fiscalYearStartMonth` | `Float!` | no | `1` | |
| `workingDays` | `[Float!]!` | no | `[1,2,3,4,5]` | |
| `projectUpdateRemindersDay` | `Day!` | no | `Friday` | |
| `projectUpdateRemindersHour` | `Float!` | no | `14` | |
| `securitySettings` / `authSettings` / `samlSettings` / `scimSettings` | `JSONObject` | mixed | | Linear buckets policy knobs into JSON blobs rather than columns |
| `samlEnabled` / `scimEnabled` | `Boolean!` | no | | |
| `releaseChannel` | `ReleaseChannel!` | no | | |
| `trialStartsAt` / `trialEndsAt` | `DateTime` | yes | | |
| `subscription` | `PaidSubscription` | yes | | |
| `allowedFileUploadContentTypes` | `[String!]` | yes | | |
| `gitBranchFormat` | `String` | yes | `"{username}/{identifier}-{title}"` | Drives `Issue.branchName` |

The MCP `get_workspace` returns only `{id, name, url}` — [OBSERVED] `{"id":"f62c01ed-…","name":"…","url":"https://linear.app/…"}`.

Deprecations worth noting, because they show where Linear *moved* config: `allowMembersToInvite` → `securitySettings.invitationsRole`; `restrictLabelManagementToAdmins` → `securitySettings.labelManagementRole`; `restrictTeamCreationToAdmins` → `securitySettings.teamCreationRole`.

### 1.2 Team

`type Team implements Node` — [DOCUMENTED]. ~100 fields. The load-bearing ones:

| Field | Type | Null | Example | Notes (docstrings verbatim) |
|---|---|---|---|---|
| `id` | `ID!` | no | `13cbf9fb-…` | [OBSERVED] |
| `key` | `String!` | no | `"ENG"` | "The team's unique key, used as a prefix in issue identifiers (e.g., 'ENG' in 'ENG-123') and in URLs." |
| `name` | `String!` | no | `"Development"` | [OBSERVED] |
| `displayName` | `String!` | no | `"Platform › Development"` | "The name of the team including its parent team name if it has one." |
| `description` | `String` | yes | `"Dev team"` | [OBSERVED] present on some teams, absent on others |
| `icon` | `String` | yes | `"CodeBlock"` | [OBSERVED] Named icon token, **not** a URL or emoji |
| `color` | `String` | yes | `"#26b5ce"` | |
| `visibility` | `TeamVisibility!` | no | `public` | "public for teams visible to all workspace members, private for teams visible only to members, and restricted for non-private teams inside a private-team boundary." |
| `private` | `Boolean!` | no | | **Deprecated** → use `visibility` |
| `parent` | `Team` | yes | `null` | Sub-teams. `ancestors: [Team!]!`, `children: [Team!]!` |
| `organization` | `Organization!` | no | | |
| `timezone` | `String!` | no | `"America/Los_Angeles"` | "Defaults to 'America/Los_Angeles'" |
| `issueEstimationType` | `String!` | no | `"fibonacci"` | "Must be one of `notUsed`, `exponential`, `fibonacci`, `linear`, `tShirt`." |
| `issueEstimationAllowZero` | `Boolean!` | no | `false` | "Whether to allow zeros in issues estimates." |
| `issueEstimationExtended` | `Boolean!` | no | `false` | "Whether to add additional points to the estimate scale." |
| `defaultIssueEstimate` | `Float!` | no | `1` | "What to use as a default estimate for unestimated issues." |
| `inheritIssueEstimation` | `Boolean!` | no | | Sub-team inherits parent's estimate config |
| `triageEnabled` | `Boolean!` | no | `false` | "When enabled, issues created by non-members or integrations are routed to a triage state for review before entering the normal workflow." |
| `triageIssueState` | `WorkflowState` | yes | | |
| `requirePriorityToLeaveTriage` | `Boolean!` | no | | |
| `cyclesEnabled` | `Boolean!` | no | | |
| `cycleDuration` / `cycleCooldownTime` / `cycleStartDay` | `Float!` | no | `2` / `0` / `1` | Weeks / weeks / day-of-week |
| `cycleLockToActive` | `Boolean!` | no | | |
| `cycleIssueAutoAssignStarted` / `…Completed` | `Boolean!` | no | | Auto-pull issues into the active cycle |
| `upcomingCycleCount` | `Float!` | no | | How many future cycles to pre-create |
| `autoArchivePeriod` | `Float!` | no | `3` | "Period after which automatically closed, completed, and duplicate issues are automatically archived in months." |
| `autoClosePeriod` | `Float` | yes | `6` | "Period after which issues are automatically closed in months. Null/undefined means disabled." |
| `autoCloseStateId` | `String` | yes | | "The canceled workflow state which auto closed issues will be set to. Defaults to the first canceled state." |
| `autoCloseParentIssues` / `autoCloseChildIssues` | `Boolean` | yes | | |
| `setIssueSortOrderOnStateChange` | `String!` | no | `"bottom"` | "Where to move issues when changing state." Replaces deprecated boolean `issueSortOrderDefaultToBottom` |
| `defaultIssueState` | `WorkflowState` | yes | | |
| `inheritWorkflowStatuses` | `Boolean!` | no | | "Only applies to sub-teams." |
| `groupIssueHistory` | `Boolean!` | no | | Collapses consecutive activity entries — see §5 |
| `scimManaged` / `scimGroupName` | `Boolean!` / `String` | no / yes | | "SCIM-managed teams have their membership controlled by the identity provider." |
| `joinByDefault` / `allMembersCanJoin` | `Boolean` | yes | | |
| `createdAt` / `updatedAt` / `archivedAt` | | | | |
| `retiredAt` | `DateTime` | yes | | Teams are retired, not deleted |

[OBSERVED] `list_teams` returns `{id, icon, name, description?, createdAt, updatedAt}` and paginates with an opaque `cursor` that is simply the last row's UUID (`hasNextPage: true, cursor: "413664c8-…"`) — i.e. **keyset pagination on the ordering column + id**, not offset.

Note `Team.key` is **not** in the required set of `TeamCreateInput`: "The key of the team. If not given, the key will be generated based on the name of the team." [DOCUMENTED]

### 1.3 User / Member

`type User implements Node` — [DOCUMENTED]. Linear has **one** User table; workspace membership is expressed by boolean flags on the user row rather than a join table, because a Linear User row is already scoped to one Organization (`user.organization: Organization!`).

| Field | Type | Null | Example (redacted) | Notes |
|---|---|---|---|---|
| `id` | `ID!` | no | `25412b66-…` | [OBSERVED] |
| `name` | `String!` | no | `"Ada L"` | [OBSERVED] Full name |
| `displayName` | `String!` | no | `"adal"` | [OBSERVED] Handle; unique-ified with a numeric suffix on collision (per SCIM docs) |
| `email` | `String!` | no | `"ada@acme.com"` | [OBSERVED] |
| `avatarUrl` | `String` | yes | `https://public.linear.app/<org>/<user>/<hash>` | [OBSERVED] Absent for some users; path is org-scoped, sometimes with a `256x256` size segment |
| `avatarBackgroundColor` | `String!` | no | `"#26b5ce"` | Fallback when no avatar |
| `initials` | `String!` | no | `"AL"` | Derived |
| `admin` | `Boolean!` | no | `false` | [OBSERVED] as `isAdmin` in the MCP projection |
| `owner` | `Boolean!` | no | | Enterprise-only role above admin |
| `guest` | `Boolean!` | no | `true` | [OBSERVED] as `isGuest`. Guests coexist with members in the same table |
| `app` | `Boolean!` | no | | True for OAuth-app actors. [OBSERVED] an app user's email is synthetic: `<uuid>@oauthapp.linear.app`, and Linear's own agent uses `linear-<orgid>@linear.linear.app` |
| `active` | `Boolean!` | no | `true` | [OBSERVED] as `isActive`. Suspension, not deletion |
| `disableReason` | `String` | yes | | |
| `lastSeen` | `DateTime` | yes | `2026-08-11T20:15:00.651Z` | [OBSERVED] MCP renders it as `"Offline (last seen …)"` |
| `statusEmoji` / `statusLabel` / `statusUntilAt` | `String` / `String` / `DateTime` | yes | | Slack-style personal status |
| `timezone` | `String` | yes | | |
| `title` | `String` | yes | | Job title |
| `description` | `String` | yes | | Bio |
| `url` | `String!` | no | | Profile URL |
| `isMe` | `Boolean!` | no | | Viewer-relative — computed per request |
| `isAssignable` / `isMentionable` | `Boolean!` | no | | Derived from active/guest/app |
| `canAccessAnyPublicTeam` | `Boolean!` | no | | Guests are false |
| `createdIssueCount` | `Int!` | no | | |
| `identityProvider` | `IdentityProvider` | yes | | SAML/SCIM linkage |
| `gitHubUserId` / `hasGitHubCodeAccess` | | | | |
| `createdAt` / `updatedAt` / `archivedAt` | | | | |

`TeamMembership` is a real join entity — [DOCUMENTED]:

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `ID!` | no | |
| `user` | `User!` | no | |
| `team` | `Team!` | no | |
| `owner` | `Boolean!` | no | The only team-level role bit on the membership row |
| `sortOrder` | `Float!` | no | Per-user ordering of teams in the sidebar |
| `createdAt` / `updatedAt` / `archivedAt` | | | |

There is also `enum TeamRoleType { member, owner }` [DOCUMENTED] — the modern spelling of the same idea.

`OrganizationInvite` — [DOCUMENTED]: `{id, email: String!, role: UserRoleType!, inviter: User!, invitee: User (null until accepted), external: Boolean!, acceptedAt, expiresAt, metadata: JSONObject, organization, createdAt, updatedAt, archivedAt}`. Note the invite carries the **role**, so role is decided at invite time.

### 1.4 Issue

`type Issue implements Node` — [DOCUMENTED]. The full field list, verbatim from the SDL (connection fields marked `→`):

**Identity & content**

| Field | Type | Null | Notes (verbatim docstrings) |
|---|---|---|---|
| `id` | `ID!` | no | UUID v4 |
| `identifier` | `String!` | no | "Issue's human readable identifier (e.g. ENG-123)." |
| `number` | `Float!` | no | "The issue's unique number, scoped to the issue's team. Together with the team key, this forms the issue's human-readable identifier (e.g., ENG-123)." Typed `Float` in GraphQL but integral in practice |
| `previousIdentifiers` | `[String!]!` | no | "Previous identifiers of the issue if it has been moved between teams." |
| `title` | `String!` | no | |
| `description` | `String` | yes | "The issue's description in markdown format." |
| `descriptionState` | `String` | yes | "[Internal] The issue's description content as YJS state." |
| `documentContent` | `DocumentContent` | yes | "[ALPHA] The document content representing this issue description." |
| `url` | `String!` | no | [OBSERVED] `https://linear.app/<org>/issue/ENG-123/<slugified-title>` |
| `branchName` | `String!` | no | "Suggested branch name for the issue." [OBSERVED] `david/dev-2731-decide-where-…` — `{username}/{identifier-lowercased}-{slug}`, truncated |

**Scheduling & sizing**

| Field | Type | Null | Notes |
|---|---|---|---|
| `priority` | `Float!` | no | "0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low." |
| `priorityLabel` | `String!` | no | Derived string. [OBSERVED] the MCP returns `{"value":2,"name":"High"}` and `{"value":0,"name":"No priority"}` |
| `estimate` | `Float` | yes | "The specific scale used depends on the team's estimation configuration (e.g., points, T-shirt sizes). Null if no estimate has been set." |
| `dueDate` | `TimelessDate` | yes | |
| `cycle` | `Cycle` | yes | |
| `project` | `Project` | yes | |
| `projectMilestone` | `ProjectMilestone` | yes | |
| `parent` | `Issue` | yes | Sub-issue parent |
| `state` | `WorkflowState!` | no | Required — an issue always has a status |
| `team` | `Team!` | no | Required — "Issues are always linked to a single team." [DOCUMENTED, linear.app/docs/creating-issues] |
| `assignee` / `creator` / `delegate` / `snoozedBy` | `User` | yes | `creator` is nullable (system/integration-created issues) |
| `botActor` | `ActorBot` | yes | |
| `externalUserCreator` / `asksExternalUserRequester` / `asksRequester` | | yes | Linear Asks / external requesters |

**Ordering**

| Field | Type | Null | Notes |
|---|---|---|---|
| `sortOrder` | `Float!` | no | "The order of the item in relation to other items in the organization. Used for manual sorting in list views." |
| `subIssueSortOrder` | `Float` | yes | "The order of the item in the sub-issue list. Only set if the issue has a parent." |
| `prioritySortOrder` | `Float!` | no | "The order of the item in relation to other items in the workspace, when ordered by priority." |
| `boardOrder` | `Float!` | no | **Deprecated**: "Will be removed in near future, please use `sortOrder` instead." Was "The order of the item in its column on the board." |

**Timestamps** — see §3.3 for what sets each.

`createdAt: DateTime!`, `updatedAt: DateTime!`, `archivedAt`, `startedAt`, `completedAt`, `canceledAt`, `triagedAt`, `startedTriageAt`, `autoArchivedAt`, `autoClosedAt`, `snoozedUntilAt`, `addedToCycleAt`, `addedToProjectAt`, `addedToTeamAt`, `suggestionsGeneratedAt` — all `DateTime` and nullable except `createdAt`/`updatedAt`.

**SLA**: `slaType: String` ("Calendar days or business days"), `slaStartedAt`, `slaMediumRiskAt`, `slaHighRiskAt`, `slaBreachesAt` — all `DateTime`.

**Flags & derived**: `trashed: Boolean` ("A flag that indicates whether the issue is in the trash bin."), `trusted: Boolean`, `inheritsSharedAccess: Boolean!`, `sharedAccess: IssueSharedAccess!`, `customerTicketCount: Int!`, `labelIds: [String!]!` (denormalized id array alongside the `labels` connection), `reactionData: JSONObject!` ("Emoji reaction summary for the issue, grouped by emoji type. Contains the count and reacting user information for each emoji."), `reactions: [Reaction!]!`, `activitySummary: JSONObject`, `integrationSourceType: IntegrationService`, `syncedWith: [ExternalEntityInfo!]`, `lastAppliedTemplate: Template`, `recurringIssueTemplate: Template`, `sourceComment: Comment`, `favorite: Favorite`, `summary: Summary`.

**Connections**: `→ children`, `→ comments` ("including inline comments on the issue's description"), `→ attachments`, `→ formerAttachments`, `→ documents`, `→ history`, `→ relations`, `→ inverseRelations`, `→ labels`, `→ subscribers`, `→ stateHistory: IssueStateSpanConnection!` ("The issue's workflow states over time"), `→ needs`/`→ formerNeeds` (customer needs), `→ releases`, `→ agentSessions`, `→ suggestions`/`→ incomingSuggestions`.

[OBSERVED] a live issue projection:

```jsonc
{
  "id": "DEV-2683",                       // MCP substitutes identifier for id
  "title": "…",
  "priority": {"value": 0, "name": "No priority"},
  "url": "https://linear.app/<org>/issue/DEV-2683/<slug>",
  "gitBranchName": "david/dev-2683-<slug>",
  "createdAt": "2026-08-09T18:55:00.074Z",
  "updatedAt": "2026-08-13T07:05:58.900Z",
  "archivedAt": null, "completedAt": null, "startedAt": null,
  "canceledAt": null, "dueDate": null,
  "slaStartedAt": null, "slaMediumRiskAt": null,
  "slaHighRiskAt": null, "slaBreachesAt": null,
  "status": "Backlog", "statusType": "backlog",
  "labels": [], "attachments": [], "documents": [],
  "stateHistory": [
    {"state": {"id": "2da94f45-…", "name": "Backlog", "type": "backlog"},
     "startedAt": "2026-08-09T18:55:00.074Z", "endedAt": null}
  ],
  "createdById": "46c68c19-…", "assigneeId": "46c68c19-…",
  "projectId": "3e2c13ab-…", "parentId": "DEV-2658",
  "teamId": "13cbf9fb-…"
}
```

`stateHistory` is worth calling out: Linear keeps an explicit **interval table** (`IssueStateSpan`: `{state, startedAt, endedAt}`) alongside the activity log. That is what powers cycle-time analytics without replaying history.

[OBSERVED] cross-checks on the timestamp semantics, from three issues in one team:
- status `Backlog` (type `backlog`) → `startedAt`, `completedAt`, `canceledAt` all `null`
- status `In Review` (type `started`) → `startedAt` set, `completedAt` null
- status `Done` (type `completed`) → both `startedAt` and `completedAt` set, `startedAt < completedAt`

**Writable inputs** — [DOCUMENTED] `IssueCreateInput` accepts `id` (client-supplied UUID: "If none is provided, the backend will generate one"), `createdAt` ("Must be a time in the past"), `title`, `description` (markdown), `descriptionData` (`JSON`, "[Internal] The issue description as a Prosemirror document"), `teamId!`, `stateId`, `assigneeId`, `priority`, `estimate: Int`, `dueDate`, `cycleId`, `projectId`, `projectMilestoneId`, `parentId` ("Can be a UUID or issue identifier"), `labelIds`, `sortOrder`, `subIssueSortOrder`, `preserveSortOrderOnCreate: Boolean`, `createAsUser` + `displayIconUrl` (app-actor impersonation). `IssueUpdateInput` adds `prioritySortOrder`, `snoozedUntilAt`, `snoozedById`, `trashed` ("Set to true to trash, or null to restore"), `teamId` (the move).

Notably **absent** from the write inputs: `number`, `identifier`, `startedAt`, `completedAt`, `canceledAt`, `triagedAt`. Those are server-derived.

### 1.5 WorkflowState (IssueStatus)

`type WorkflowState implements Node` — [DOCUMENTED], complete:

| Field | Type | Null | Notes (verbatim) |
|---|---|---|---|
| `id` | `ID!` | no | |
| `name` | `String!` | no | "The state's human-readable name" |
| `type` | `String!` | no | "One of `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`, `duplicate`." **A plain `String!`, not a GraphQL enum** |
| `color` | `String!` | no | "The state's UI color as a HEX string." |
| `position` | `Float!` | no | "The position of the state in the team's workflow. States are displayed in ascending order of position within their type group." |
| `description` | `String` | yes | |
| `team` | `Team!` | no | "Each team has its own set of workflow states." |
| `inheritedFrom` | `WorkflowState` | yes | "The parent team's workflow state that this state was inherited from." |
| `createdAt` / `updatedAt` / `archivedAt` | | | |
| `→ issues` | `IssueConnection!` | no | |

[OBSERVED] a real team's full status set — note `duplicate` is a real state type in use, and two distinct states share `type: "started"`:

```json
[{"id":"…","type":"canceled","name":"Canceled"},
 {"id":"…","type":"started","name":"In Review"},
 {"id":"…","type":"unstarted","name":"Todo"},
 {"id":"…","type":"duplicate","name":"Duplicate"},
 {"id":"…","type":"completed","name":"Done"},
 {"id":"…","type":"backlog","name":"Backlog"},
 {"id":"…","type":"started","name":"In Progress"}]
```

The `position`-within-`type`-group rule is the key detail: the UI sorts by (type group in fixed canonical order, then `position` ascending). `position` is **not** globally ordered across types.

### 1.6 IssueLabel

`type IssueLabel implements Node` — [DOCUMENTED]:

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `ID!` | no | |
| `name` | `String!` | no | [OBSERVED] `"Infra"`, `"UI/UX"` |
| `color` | `String!` | no | "The label's color as a HEX string." [OBSERVED] `"#26b5ce"`, `"#ee78ef"`, `"#95a2b3"`, `"#EB5CBB"` — mixed case, so treat as opaque text |
| `description` | `String` | yes | [OBSERVED] often `null`, sometimes a long paragraph |
| `team` | `Team` | yes | "If null, the label is a workspace-level label available to all teams in the workspace." **This nullability is the entire team-vs-workspace label distinction** |
| `parent` | `IssueLabel` | yes | Label groups |
| `isGroup` | `Boolean!` | no | "When true, this label acts as a container for child labels and cannot be directly applied to issues or projects." |
| `inheritedFrom` | `IssueLabel` | yes | |
| `creator` | `User` | yes | |
| `lastAppliedAt` | `DateTime` | yes | Used for "recently used" ordering and stale-label cleanup |
| `retiredAt` / `retiredBy` | `DateTime` / `User` | yes | Soft retirement |
| `organization` | `Organization!` | no | **Deprecated**: "Workspace labels are identified by their team being null." |
| `createdAt` / `updatedAt` / `archivedAt` | | | |

### 1.7 Project

`type Project implements Node` — [DOCUMENTED]:

| Field | Type | Null | Notes (verbatim) |
|---|---|---|---|
| `id` | `ID!` | no | |
| `name` | `String!` | no | |
| `description` | `String!` | no | "The short description of the project." Non-null (empty string when unset) |
| `content` | `String` | yes | "The project's content in markdown format." The long body |
| `contentState` | `String` | yes | "[Internal] The project's content as YJS state." |
| `slugId` | `String!` | no | "The project's unique URL slug." [OBSERVED] a 12-hex-char token, e.g. `ce65dca8e706`, appended to a slugified name in the URL |
| `identifier` | `String` | yes | "[Internal] … the workspace default `<prefix>-<number>`. Null for legacy projects that have not been backfilled." |
| `previousIdentifiers` | `[String!]!` | no | |
| `status` | `ProjectStatus!` | no | "Defines the project's position in its lifecycle." |
| `state` | `String!` | no | **Deprecated** → `status` |
| `health` | `ProjectUpdateHealthType` | yes | "derived from the most recent project update. Possible values are onTrack, atRisk, or offTrack. Null if no health has been reported." |
| `healthUpdatedAt` | `DateTime` | yes | |
| `priority` | `Int!` | no | Same 0–4 scale as issues |
| `priorityLabel` | `String!` | no | [OBSERVED] `{"value":4,"name":"Low"}` |
| `lead` | `User` | yes | "Null if no lead is assigned." |
| `leadTeam` | `Team` | yes | "[Internal]" |
| `→ members` | `UserConnection!` | no | [OBSERVED] a flat user list with no per-member role |
| `→ teams` | `TeamConnection!` | no | **Many-to-many** — a project spans teams |
| `startDate` | `TimelessDate` | yes | [OBSERVED] `"2026-08-11"` |
| `startDateResolution` | `DateResolutionType` | yes | "whether it refers to a specific month, quarter, half-year, or year." [OBSERVED] `null` when the date is an exact day |
| `targetDate` / `targetDateResolution` | same | yes | |
| `startedAt` / `completedAt` / `canceledAt` / `autoArchivedAt` | `DateTime` | yes | [OBSERVED] `startedAt` set on an `in progress` project, null on a `backlog` one |
| `progress` | `Float!` | no | "(completed estimate points + 0.25 * in progress estimate points) / total estimate points" |
| `scope` | `Float!` | no | "The overall scope (total estimate points) of the project." |
| `sortOrder` | `Float!` | no | "for manual ordering in list views" |
| `prioritySortOrder` | `Float!` | no | |
| `color` | `String!` | no | HEX |
| `icon` | `String` | yes | "Can be an emoji or a decorative icon type." |
| `labelIds` / `→ labels` | | | `ProjectLabel`, a separate taxonomy from `IssueLabel` |
| `trashed` | `Boolean` | yes | |
| `lastUpdate` | `ProjectUpdate` | yes | |
| `*History` fields | `[Float!]!` / `JSONObject!` | no | `completedIssueCountHistory`, `completedScopeHistory`, `inProgressScopeHistory`, `issueCountHistory`, `scopeHistory`, `progressHistory`, `currentProgress` — **pre-materialized burn-up series**, not computed per request |
| `updateReminderFrequencyInWeeks` / `updateRemindersDay` / `updateRemindersHour` / `frequencyResolution` | | | Status-update nagging |
| `createdAt` / `updatedAt` / `archivedAt` / `creator` | | | |

### 1.8 ProjectMilestone

`type ProjectMilestone implements Node` — [DOCUMENTED], complete:

`{id, name: String!, description: String, descriptionState: String, documentContent: DocumentContent, project: Project!, targetDate: TimelessDate, sortOrder: Float!, status: ProjectMilestoneStatus!, progress: Float! ("The progress % of the project milestone"), progressHistory: JSONObject!, currentProgress: JSONObject!, createdAt, updatedAt, archivedAt, → issues}`

[OBSERVED] milestones on a real project: `{id, name, description, targetDate: null, progress: "13%"}` — the MCP renders `progress` as a percent string; the underlying GraphQL field is a `Float!`. Milestones are ordered by `sortOrder` and commonly have a `null` targetDate.

### 1.9 ProjectStatus

`type ProjectStatus implements Node` — [DOCUMENTED], complete:

`{id, name: String!, color: String!, description: String, position: Float!, type: ProjectStatusType!, indefinite: Boolean!, team: Team (nullable — statuses can be workspace-level), inheritedFrom: ProjectStatus, createdAt, updatedAt, archivedAt}`

[OBSERVED] `{"id":"c1ed6954-…","name":"Backlog","type":"backlog"}`, `{"name":"In Progress","type":"started"}`, `{"name":"Planned","type":"planned"}`. Also `Organization.projectStatuses: [ProjectStatus!]!` — the default set lives on the workspace.

`indefinite` marks statuses (like Backlog / Paused) that don't imply a schedule.

### 1.10 Comment

`type Comment implements Node` — [DOCUMENTED]:

| Field | Type | Null | Notes (verbatim) |
|---|---|---|---|
| `id` | `ID!` | no | [OBSERVED] `c1b6e85b-…` — plain UUID |
| `body` | `String!` | no | "The comment content in markdown format. This is a **derived** representation of the canonical `bodyData` ProseMirror content." |
| `bodyData` | `String!` | no | "[Internal] … as a ProseMirror document. This is the **canonical** rich-text representation." |
| `user` | `User` | yes | Nullable — bot/external authors |
| `botActor` / `externalUser` / `onBehalfOf` | | yes | `onBehalfOf` = the human an agent acted for |
| `parent` / `parentId` | `Comment` / `String` | yes | "The ID of the parent comment under which the current comment is nested. Null for top-level comments." **One level of nesting — threads, not trees** |
| `→ children` | `CommentConnection!` | no | |
| `quotedText` | `String` | yes | "used for inline comments on documents or issue descriptions. Null for standard comments" |
| `resolvedAt` / `resolvingUser` / `resolvingComment` | | yes | Thread resolution |
| `editedAt` | `DateTime` | yes | "Null if the comment has not been edited since creation." |
| `reactionData` | `JSONObject!` | no | "grouped by emoji type. Each entry contains the emoji name, count, and the IDs of users who reacted." |
| `reactions` | `[Reaction!]!` | no | |
| `hideInLinear` | `Boolean!` | no | "[Internal] typically used for bot comments that provide redundant information" |
| `threadSummary` | `JSONObject` | yes | AI summary; "Null if … not a top-level comment" |
| `url` | `String!` | no | |
| **Polymorphic parent** | | | `issue`/`issueId`, `project`/`projectId`, `projectUpdate`/`projectUpdateId`, `initiative`/`initiativeId`, `initiativeUpdate`/`initiativeUpdateId`, `documentContent`/`documentContentId`, `post` — **all nullable; exactly one is set** |
| `createdAt` / `updatedAt` / `archivedAt` | | | |

[OBSERVED] a real comment projection: `{id, body (markdown with **bold**, bullet lists, and `[text](url)` links), createdAt, updatedAt, parentId: null, resolvedAt: null, quotedText: null, author: {id, name}, onBehalfOf: null}`. Confirms markdown round-trips out of the API, and that inline comments are distinguished purely by `quotedText != null`.

### 1.11 Reaction

`type Reaction implements Node` — [DOCUMENTED], complete:

`{id, emoji: String!, user: User (nullable), externalUser: ExternalUser, createdAt, updatedAt, archivedAt}` plus a polymorphic target — exactly one of `comment`, `issue`, `projectUpdate`, `initiativeUpdate`, `post`.

### 1.12 Attachment

`type Attachment implements Node` — [DOCUMENTED], complete:

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `ID!` | no | |
| `title` | `String!` | no | |
| `subtitle` | `String` | yes | |
| `url` | `String!` | no | The external link. Attachments are *links*, not uploaded blobs |
| `issue` | `Issue!` | no | **Non-null** — attachments belong to issues only |
| `originalIssue` | `Issue` | yes | Survives issue moves |
| `metadata` | `JSONObject!` | no | Integration-specific (PR state, Zendesk ticket, etc.) |
| `source` | `JSONObject` | yes | |
| `sourceType` | `String` | yes | e.g. `github`, `slack`, `zendesk` |
| `bodyData` | `String` | yes | |
| `groupBySource` | `Boolean!` | no | UI grouping |
| `creator` / `externalUserCreator` | | yes | |
| `createdAt` / `updatedAt` / `archivedAt` | | | |

[OBSERVED] `attachments: []` on a live issue — empty array, not null.

File uploads are a separate concern in Linear: `prepare_attachment_upload` / `create_attachment_from_upload` in the MCP surface, i.e. a pre-signed-URL flow, with the resulting blob then referenced as an Attachment URL or inline in markdown.

### 1.13 Document

`type Document implements Node` — [DOCUMENTED], complete:

`{id, title: String!, content: String (markdown), contentState: String (YJS), documentContentId: String, slugId: String!, icon: String, color: String, summary: String, sortOrder: Float! ("The sort order of the document in its parent entity's resources list. This order is shared with other resource types such as external links."), creator: User, owner: User, updatedBy: User, hiddenAt: DateTime, trashed: Boolean, url: String!, createdAt, updatedAt, archivedAt}`

Polymorphic attachment point — all nullable: `project`, `initiative`, `issue`, `team`, `cycle`, `release`.

`DocumentContent` is the shared rich-text row that Issue descriptions, Project content, Milestone descriptions, and Documents all point at: `{id, content: String (markdown), contentState: String (YJS), restoredAt, + one of document/issue/project/projectMilestone/initiative/pullRequest, createdAt, updatedAt}`. This is how Linear gets one editor implementation and one revision-history implementation across five entities.

### 1.14 Favorite

`type Favorite implements Node` — [DOCUMENTED]. The extreme case of Linear's polymorphism: **~25 nullable target columns**, one of which is set.

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `ID!` | no | |
| `owner` | `User!` | no | Favorites are per-user |
| `type` | `String!` | no | "The type of entity this favorite references, such as 'issue', 'project', 'cycle', 'customView', 'document', 'folder', etc. **Determines which associated entity field is populated.**" |
| `sortOrder` | `Float!` | no | "The position of this item in the user's favorites list. Lower values appear first." |
| `parent` / `→ children` | `Favorite` | yes | Favorites nest into folders |
| `folderName` | `String` | yes | "Only applies to favorites of type folder." |
| `title` | `String!` | no | Denormalized display title |
| `detail` | `String` | yes | "[Internal] Detail text" |
| `icon` / `color` / `url` | | yes | |
| `predefinedViewType` / `predefinedViewTeam` | `String` / `Team` | yes | "Only populated when the favorite type is 'predefinedView'." |
| `projectTab` / `initiativeTab` / `pipelineTab` | enums | yes | Favoriting a *tab* of an entity |
| `liveFolderDefinition` / `liveFolderPreset` | `JSONObject` / `String` | yes | Smart folders |
| Targets | | yes | `issue`, `project`, `cycle`, `customView`, `document`, `label`, `initiative`, `initiativeLabel`, `projectLabel`, `team`, `projectTeam`, `user`, `customer`, `dashboard`, `facet`, `release`, `releaseNote`, `releasePipeline`, `pullRequest`, `aiConversation` |
| `createdAt` / `updatedAt` / `archivedAt` | | | |

### 1.15 Notification

`interface Notification implements Entity & Node` — [DOCUMENTED]. Linear uses a **GraphQL interface with concrete per-target implementations** (`IssueNotification`, `ProjectNotification`, `DocumentNotification`, `OauthClientApprovalNotification`, …).

Shared interface fields:

| Field | Type | Null | Notes (verbatim) |
|---|---|---|---|
| `id` | `ID!` | no | |
| `user` | `User!` | no | The **recipient** |
| `actor` | `User` | yes | "The user that caused the notification. Null if … triggered by a non-user actor such as an integration, external user, or system event." |
| `botActor` / `externalUserActor` | | yes | |
| `type` | `String!` | no | "Determines the kind of event that triggered this notification and which associated entity fields will be populated." |
| `category` | `NotificationCategory!` | no | |
| `title` / `subtitle` | `String!` | no | "[Internal]" — **pre-rendered** copy, stored not computed |
| `readAt` | `DateTime` | yes | "Null if the notification is unread." |
| `snoozedUntilAt` / `unsnoozedAt` | `DateTime` | yes | "After this time, the notification reappears in the user's inbox." |
| `emailedAt` | `DateTime` | yes | Email-digest dedupe |
| `groupingKey` | `String!` | no | "[Internal] Notifications with the same grouping key will be grouped together in the UI." |
| `groupingPriority` | `Float!` | no | "Higher number means higher priority. If priority is the same, notifications should be sorted by `createdAt`." |
| `issueStatusType` | `String` | yes | "[Internal]" — denormalized so the inbox can filter without joining |
| `actorAvatarUrl` / `actorAvatarColor` / `actorInitials` / `isLinearActor` | | mixed | Denormalized actor presentation |
| `inboxUrl` / `url` | `String!` | no | |
| `createdAt` / `updatedAt` / `archivedAt` | | | |

`IssueNotification` adds: `issue: Issue!`, `issueId: String!`, `team: Team!`, `comment` / `commentId`, `parentComment` / `parentCommentId`, `reactionEmoji: String`, `subscriptions: [NotificationSubscription!]`.

The design lesson: Linear **denormalizes rendering into the notification row** (title, subtitle, actor avatar, issue status type). The inbox is a single-table scan.

### 1.16 CustomView & ViewPreferences

`type CustomView implements Node` — [DOCUMENTED]:

`{id, name: String!, description: String, icon: String, color: String, slugId: String!, modelName: String! (which entity the view lists), filterData: JSONObject! (the canonical filter AST), filters: JSONObject! (deprecated — "Will be replaced by filterData"), projectFilterData / initiativeFilterData / feedItemFilterData: JSONObject, shared: Boolean!, owner: User!, creator: User!, updatedBy: User, organization: Organization!, team: Team (nullable — team-scoped vs workspace-scoped), userViewPreferences: ViewPreferences, organizationViewPreferences: ViewPreferences, viewPreferencesValues: ViewPreferencesValues, createdAt, updatedAt, archivedAt, → issues, → projects, → initiatives, → updates}`

`type ViewPreferences implements Node` — `{id, type: String! ("organization" for workspace-wide defaults or "user" for personal overrides), viewType: String! ("board, cycle, project, customView, myIssues, etc."), preferences: ViewPreferencesValues!, createdAt, updatedAt, archivedAt}`.

`ViewPreferencesValues` is a **flat, very wide object of scalars** — several hundred fields following the naming convention `<viewType><Aspect>`: `columnOrderBoard: [String!]`, `columnOrderList: [String!]`, `closedIssuesOrderedByRecency: Boolean`, `customViewFieldDateCreated: Boolean`, `automationGrouping: String`, `customersViewOrdering: String`, and so on. It is the display state (grouping, ordering, which columns are visible, which columns are collapsed) for every view in the app.

Two-layer resolution: `organizationViewPreferences` provides workspace defaults, `userViewPreferences` overrides per user.

---

## 2. Enums (verbatim)

All from `schema.graphql` unless marked — [DOCUMENTED].

```graphql
enum IssueRelationType { blocks  duplicate  related  similar }

enum ProjectStatusType { backlog  canceled  completed  paused  planned  started }

enum ProjectMilestoneStatus { done  next  overdue  unstarted }

enum ProjectUpdateHealthType { atRisk  offTrack  onTrack }

enum DateResolutionType { halfYear  month  quarter  year }

enum UserRoleType { admin  app  guest  owner  user }

enum TeamRoleType { member  owner }

enum TeamVisibility { private  public  restricted }

enum OrganizationInviteStatus { accepted  expired  pending }

enum ViewPreferencesType { organization  user }

enum PaginationOrderBy { createdAt  updatedAt }

enum PaginationSortOrder { ascending  descending }   # (also: enum PaginationNulls)

enum FrequencyResolutionType { daily  weekly }

enum CyclePeriod { after  before  during }

enum Day { Monday Tuesday Wednesday Thursday Friday Saturday Sunday }

enum SlaStatus { Breached  Completed  Failed  HighRisk  LowRisk  MediumRisk }

enum IssueSharingPolicy { adminsOnly  allMembers  disabled }

enum ContextViewType { activeCycle  activeIssues  backlog  triage  upcomingCycle }

enum NotificationChannel { desktop  email  mobile  slack }

enum NotificationSubscriptionType {
  customView  customer  cycle  document  initiative  issue  label
  oauthClientApproval  project  pullRequest  team  user
}

enum NotificationCategory {
  appsAndIntegrations  assignments  billing  commentsAndReplies  customers
  documentChanges  feed  loops  mentions  postsAndUpdates  reactions
  reminders  reviews  statusChanges  subscriptions  system  triage
}

enum WebhookResourceType {
  AgentSessionEvent  AppUserNotification  Attachment  Comment  Customer
  CustomerNeed  Cycle  Document  Initiative  InitiativeUpdate  Issue
  IssueLabel  IssueSLA  OAuthAuthorization  PermissionChange  Project
  ProjectLabel  ProjectUpdate  Reaction  Release  ReleaseNote  User
}
```

### 2.1 The two pseudo-enums that are `String!`

These are the two that most matter for the clone, and **neither is a GraphQL enum** — both are `String!` with the legal values stated only in the docstring. Reproduce them as real Postgres enums.

**`WorkflowState.type`** — "One of `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`, `duplicate`."
[OBSERVED] all of `canceled`, `started`, `unstarted`, `duplicate`, `completed`, `backlog` in live use in a single team.

**`Team.issueEstimationType`** — "Must be one of `notUsed`, `exponential`, `fibonacci`, `linear`, `tShirt`."

Estimate scale values — [DOCUMENTED, linear.app/docs/estimates]:

| Scale | Base | Extended adds |
|---|---|---|
| `exponential` | 1 2 4 8 16 | 32 64 |
| `fibonacci` | 1 2 3 5 8 | 13 21 |
| `linear` | 1 2 3 4 5 | 6 7 |
| `tShirt` | XS S M L XL | XXL XXXL |

"When T-Shirt sizes require translation to numerical values (for display in graphs, for instance,) they follow the Fibonacci scale" — so `XS=1, S=2, M=3, L=5, XL=8, XXL=13, XXXL=21`. Cross-checked against the issue-creation URL parameters doc, which lists exactly those point values. `estimate` is therefore always stored as a **number**; the T-shirt scale is a display mapping only.

"Allow zero estimates to assign an explicit estimate of 0. This is different from leaving an issue unestimated. By default, unestimated issues count as 1 point" — i.e. `estimate NULL` ≠ `estimate 0`, and `NULL` is scored as `team.defaultIssueEstimate` in rollups.

### 2.2 Priority

[DOCUMENTED] `Issue.priority`: "0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low." Same scale on `Project.priority`.

[OBSERVED] `priorityLabel` values: `"No priority"`, `"Urgent"`, `"High"`, `"Medium"`, `"Low"`.

The trap: **the numeric order is not the display order.** Ascending `priority` gives Urgent → Low but puts "No priority" (0) *first*, whereas the UI shows it last. This is precisely why `prioritySortOrder` exists as a separate persisted float. In the clone, either persist an equivalent or sort with an explicit expression — `ORDER BY (CASE priority WHEN 0 THEN 5 ELSE priority END), sort_order`.

---

## 3. Mechanics

### 3.1 Identifiers

**Composition** — [DOCUMENTED]: `identifier = team.key || '-' || issue.number`. The `number` docstring: "The issue's unique number, **scoped to the issue's team**. Together with the team key, this forms the issue's human-readable identifier (e.g., ENG-123)." `Team.key`: "The team's unique key, used as a prefix in issue identifiers (e.g., 'ENG' in 'ENG-123') and in URLs."

**Allocation** — a **per-team monotonic counter**. Evidence: `number` is scoped to the team; `number` is not accepted in `IssueCreateInput` (server-assigned); and `Team.key` is unique within the workspace, so `(team.key, number)` is workspace-unique. [DOCUMENTED for the scoping and the server-assignment; the counter *implementation* is PROPOSED — see §4.]

Note that `Organization.createdIssueCount` is a *separate* workspace-wide monotonic counter, so team numbering is genuinely per-team, not a workspace sequence partitioned for display.

**`team.key` constraints** — [PROPOSED, inferred]. Linear's docs describe how to change the identifier ("Team settings > General > input new identifier") but publish no length or charset rule, and `TeamCreateInput.key` is only documented as "If not given, the key will be generated based on the name of the team." [OBSERVED] real keys are 3-uppercase-alphanumeric (`DEV`). Linear's own docs and URL examples use `ENG`, `LIN`, `MOB`, `FEA`, `EU` — 2 to 3 chars, uppercase. For the clone I propose: `^[A-Z0-9]{1,5}$`, unique per workspace, case-normalized on write. Do not claim this is Linear's rule.

**Team key change** — the identifier is derived, so changing `team.key` **re-labels every issue in the team at once**. This is the main argument for *not* storing `identifier` as the source of truth.

**Issue moved between teams** — fully specified [DOCUMENTED, linear.app/docs/editing-issues]:

> "When you move an issue to a new team, we generate a new issue ID and unique URL for the issue. Old URLs will still work and redirect to the new issue URL. Searching for old issue IDs will also bring up the current issue… Inline references to issues (like #ENG-123) will redirect when clicked, but won't update visually."

And the per-field effects, verbatim from the same page:

| Property | Effect on move |
|---|---|
| Cycle | "May be cleared… if there isn't a corresponding cycle in the destination team." |
| Team Labels | "Removed" |
| Projects | "Removed" (unless the destination team is already on the project) |
| Relations | "Remain" |
| Priority | "Remain" |
| Issue ID | "Changed. The issue receives a new identifier for the destination team. Previous identifiers remain searchable and continue to resolve to the issue." |
| Status | "Linear maps its status to the closest corresponding status in the destination team's workflow. If the destination team uses triage, open issues moved by someone outside that team will move to triage. Closed issues remain closed." |

So: a move burns a **new number from the destination team's counter**, pushes the old identifier onto `previousIdentifiers`, and the old number in the source team is **never reused**.

Consequence for the schema: `unique(team_id, number)` is correct, but the number must not be recycled, and lookup must consider `previous_identifiers`.

**Project identifiers** are the same idea one level up but newer: `Project.identifier` is "[Internal] … the workspace default `<prefix>-<number>`. Null for legacy projects that have not been backfilled." Projects also carry `slugId` — [OBSERVED] a 12-hex-character token appended to the slugified name (`…/project/singularity-mvp-planning-43620d505e2d`). The slug token is what makes the URL stable across renames.

### 3.2 Ordering

**What Linear does** — [DOCUMENTED]. Three persisted float columns on Issue:

- `sortOrder: Float!` — "The order of the item in relation to other items in the organization. Used for manual sorting in list views."
- `subIssueSortOrder: Float` — "Only set if the issue has a parent."
- `prioritySortOrder: Float!` — manual order within the priority-sorted view.
- `boardOrder: Float!` — **deprecated**, "please use `sortOrder` instead". Linear has collapsed list order and board order into one column. Do the same; don't build two.

All three are client-writable (`IssueUpdateInput.sortOrder` etc.), so **the client computes the new order value and sends it** — the server does not do "move to index 5" arithmetic. `IssueCreateInput.preserveSortOrderOnCreate: Boolean` exists to let a client pin the value it chose instead of letting the server slot the issue at top/bottom.

Team-level policy for automatic repositioning: `Team.setIssueSortOrderOnStateChange: String!` — "Where to move issues when changing state" (replaces the older boolean `issueSortOrderDefaultToBottom`). So dragging a card to another column also *rewrites* `sortOrder` per team policy.

Values observed in the wild for `sortOrder` are negative and large-magnitude (e.g. `-9014`, `-7930`) while `subIssueSortOrder` is positive fractional (e.g. `8064.65`, `7159.96`) — consistent with float midpointing plus a "new issues go to the top" convention that walks negative.

**The technique, generally.** Manual drag ordering has three viable persistences:

1. **Integer `position` with renumbering.** Simple, but every insert rewrites O(n) rows. Fails badly with concurrent editors and makes realtime sync noisy.
2. **Float midpoint** (what Linear does). `new = (prev + next) / 2`. O(1) writes. But IEEE-754 doubles have ~52 bits of mantissa: repeatedly inserting between the same pair exhausts precision in **~50 operations**, after which `(a+b)/2 == a` and ordering silently collapses. Requires a rebalance pass.
3. **Fractional indexing with variable-length strings** (Figma, Rocicorp/Replicache, tldraw). The key is a base-N string compared lexicographically; the midpoint is computed by string manipulation, so precision **never** runs out — the string just gets one character longer. [DOCUMENTED, figma.com/blog/realtime-editing-of-ordered-sequences]: Figma "assigns each object a real number index between 0 and 1"; "To insert between two objects, just set the index for the new object to the average index of the two objects on either side"; they use "arbitrary-precision fractions encoded as strings… base-95 encoding (the entire ASCII range rather than just digits 0–9) for compactness, omitting the leading '0.'" specifically because 64-bit doubles lose precision.

**Recommendation — [PROPOSED]: fractional indexing over base-62 strings, `TEXT` column, `COLLATE "C"`.**

Rationale: it is Linear's semantics (client computes an opaque order token, one row written per move) without Linear's precision cliff, and it costs one extra character of storage in exchange for deleting the rebalancing job from the critical path. The reference implementation is `rocicorp/fractional-indexing` (a port of Figma's scheme, MIT).

**Algorithm.**

```
DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"   // base 62, ASCII-ascending

generateKeyBetween(a, b) -> string        // a, b are existing keys or null
  precondition: a == null || b == null || a < b        (byte-wise compare)

  if a == null and b == null:  return "a0"             // first item in an empty list
  if a == null:                return keyBefore(b)     // prepend
  if b == null:                return keyAfter(a)      // append
  otherwise:                   return midpoint(a, b)
```

Keys are `<head><integer-part><fraction>`. The **head** is a single letter encoding the length and sign of the integer part (`a`..`z` = positive lengths 1..26, `Z`..`A` = negative lengths). This is the one trick that makes plain lexicographic comparison agree with numeric order across magnitudes — `"a0" < "a1" < … < "az" < "b00"`, and `"Zy" < "Zz" < "a0"`.

- **Append** (`b == null`): increment the integer part in base-62. `"a0" → "a1"`, `"az" → "b00"` (integer overflow bumps the head).
- **Prepend** (`a == null`): decrement. `"a0" → "Zz"`, `"Z0" → "Yzz"`.
- **Midpoint** (both present): walk the two strings; while the digits agree, copy them. At the first differing position, if there is a free digit strictly between them, emit it and stop. If not (they are adjacent digits, e.g. `4` and `5`), copy `a`'s digit and recurse into the next position with `b` treated as exhausted — appending a digit near the middle of the alphabet. Result: `midpoint("a0","a1") = "a0V"`, `midpoint("a0","a0V") = "a0G"`. **Key length grows by at most one character per insertion into the same gap.**

`generateNKeysBetween(a, b, n)` exists and must be used for bulk operations (paste, import, "move 20 selected issues"): it distributes n keys evenly in one pass, producing much shorter keys than n sequential `generateKeyBetween` calls, which would produce a degenerate right-leaning chain.

**Edge cases and how to handle them — [PROPOSED]:**

| Case | Handling |
|---|---|
| **Concurrent identical inserts.** Two clients drag different issues into the same gap and both compute the same key. | Do **not** add a unique constraint on the order key. Make the sort deterministic instead: `ORDER BY sort_order, id`. Ties then resolve identically on every client and every replica. Optionally add ±1 random low digit ("jitter") client-side to make collisions rare, but never rely on it for correctness. |
| **Unbounded key growth.** A list repeatedly reordered by dragging into the same position grows keys ~1 char per move. | Monitor `max(length(sort_order))` per scope. Above a threshold (say 40 chars), run an offline rebalance for that scope only: `generateNKeysBetween(null, null, count)` and rewrite. This is a maintenance nicety, not a correctness requirement — unlike floats, nothing breaks if you never run it. |
| **Rebalancing races a live drag.** | Rebalance inside a single transaction per scope, and version the scope (`teams.order_epoch`); clients that computed a key against a stale epoch retry. |
| **Collation.** Postgres' default locale collation does **not** order base-62 keys correctly — it is not merely a case-sensitivity nuance, it inverts the key space. | Declare the column `TEXT COLLATE "C"` and index it that way. **This is the single most likely bug in this whole design**, and it fails silently. [VERIFIED] on Postgres 16 — the same nine keys under the two collations:<br>`C`: `AZ < Az < Zz < a0 < a0G < a0V < a1 < az < b00` ✅<br>`und-x-icu`: `a0 < a0G < a0V < a1 < az < Az < AZ < b00 < Zz` ❌<br>Under ICU the *prepend* key `Zz` — the key produced by dragging an item to the **top** of the list — sorts **last**. The item lands at the bottom. |
| **Scope of the key.** Linear's `sortOrder` is documented as workspace-wide ("in relation to other items in the organization"). | Keep it workspace-wide too. A per-view key would need one row per (issue, view). Grouping (by status, assignee, project) then just partitions the same global order, which is what Linear's board does. |
| **Empty list / first insert.** | `generateKeyBetween(null, null) = "a0"`. |
| **Deleting the neighbours you interpolated against.** | No effect — keys are absolute, not relative. This is the main advantage over linked-list ordering. |

**Where order keys are needed** (mirroring Linear): `issues.sort_order`, `issues.sub_issue_sort_order` (nullable — only when parented), `projects.sort_order`, `project_milestones.sort_order`, `workflow_states.position`, `project_statuses.position`, `labels` (no order in Linear — alphabetical), `favorites.sort_order`, `team_members.sort_order`, `documents.sort_order`.

For `workflow_states.position` I keep a `DOUBLE PRECISION` rather than a string, because the set is small (5–10 rows per team), edited rarely, and always by an admin in a settings screen where an O(n) renumber is free. Matching Linear's `Float!` here costs nothing.

### 3.3 Timestamps — what sets each

All [DOCUMENTED] from the schema docstrings; the state-derived ones cross-checked [OBSERVED] against three live issues (see §1.4).

| Column | Set by |
|---|---|
| `createdAt` | Insert. Client may supply it on import — "Must be a time in the past." |
| `updatedAt` | "The last time at which the entity was **meaningfully** updated. This is the same as the creation time if the entity hasn't been updated after creation." Not every write bumps it. |
| `startedAt` | Transition into a state whose `type = 'started'`. |
| `completedAt` | Transition into `type = 'completed'`. |
| `canceledAt` | "The time at which the issue was moved into canceled state" — `type = 'canceled'`. |
| `startedTriageAt` | "The time at which the issue entered triage." |
| `triagedAt` | "The time at which the issue **left** triage." ← the name is misleading; read it as "triage completed at". |
| `archivedAt` | Explicit archive. Present on essentially every entity. |
| `autoArchivedAt` | "automatically archived by the auto pruning process" — driven by `team.autoArchivePeriod` (months), applied to closed/completed/duplicate issues. |
| `autoClosedAt` | "automatically closed by the auto pruning process" — driven by `team.autoClosePeriod`; the issue is moved to `team.autoCloseStateId` (a canceled-type state). |
| `snoozedUntilAt` | "The time until an issue will be snoozed in **Triage view**." Paired with `snoozedBy: User`. Writable via `IssueUpdateInput.snoozedUntilAt` + `snoozedById`. |
| `addedToCycleAt` / `addedToProjectAt` / `addedToTeamAt` | First association with that cycle / project / team. |
| `dueDate` | User-set `TimelessDate`. |
| `slaStartedAt` / `slaMediumRiskAt` / `slaHighRiskAt` / `slaBreachesAt` | Computed when an SLA policy attaches; `slaType` says calendar vs business days. |
| `trashed` | Boolean, not a timestamp, in Linear. "Set to true to trash, or null to restore." |

**Re-open semantics** — [PROPOSED]. Linear does not document whether moving a Done issue back to Todo clears `completedAt`, and I could not establish it read-only without mutating a production workspace. The right model for the clone, and the one that makes these columns self-consistent, is:

- On entering a `started`/`completed`/`canceled` state, set the corresponding column **only if currently null** for `startedAt` (first-start wins, so cycle-time is measured from first pickup), and **always** for `completedAt`/`canceledAt`.
- On leaving a `completed` state, clear `completedAt`. On leaving `canceled`, clear `canceledAt`. Otherwise a re-opened issue reports as completed in every rollup.
- Never clear `startedAt`.

Either way, the authoritative record is `issue_state_spans` (§4), which Linear also keeps (`Issue.stateHistory: IssueStateSpanConnection!`, [OBSERVED] returning `{state: {id, name, type}, startedAt, endedAt}` with `endedAt: null` for the current span). Derive analytics from spans; treat the denormalized timestamps as a cache for cheap filtering.

### 3.4 Relations

[DOCUMENTED] `enum IssueRelationType { blocks  duplicate  related  similar }`.

`type IssueRelation` is minimal and **stores one row per relationship, in one direction**:

```graphql
type IssueRelation implements Node {
  id: ID!
  issue: Issue!          # "The source issue whose relationship is being described.
                         #  This is the issue from which the relation originates."
  relatedIssue: Issue!   # "The target issue… The relation type describes how the
                         #  source issue relates to this issue."
  type: String!          # "Possible values include blocks, duplicate, and related."
  createdAt / updatedAt / archivedAt
}
```

The inverse is **not stored**. It is exposed as a separate connection on Issue: `relations` (rows where this issue is `issue`) and `inverseRelations` (rows where this issue is `relatedIssue`). The client then names the inverse:

| Stored row | Reads on `issue` as | Reads on `relatedIssue` as |
|---|---|---|
| `blocks` | **blocks** | **blocked by** |
| `duplicate` | **duplicate of** | **has duplicate** |
| `related` | related to | related to (symmetric) |
| `similar` | similar to | similar to (symmetric) |

[OBSERVED] confirms exactly this projection — `get_issue(includeRelations: true)` returns four *derived* buckets from two stored directions:

```json
"relations": {
  "blocks":      [{"id":"DEV-2688", "title":"…"}],
  "blockedBy":   [],
  "relatedTo":   [ … 9 issues … ],
  "duplicateOf": null
}
```

Note `duplicateOf` is a **scalar** (`null` here), not an array — an issue is a duplicate of at most one other. Also note `similar` never appears in the UI projection; it is an ML-suggestion type, surfaced through `Issue.suggestions` / `incomingSuggestions`, not the user-facing relations list.

Relations survive an issue's move between teams [DOCUMENTED: "Relations — Remain"].

### 3.5 Permissions & membership

**Workspace level** — [DOCUMENTED] `enum UserRoleType { admin, app, guest, owner, user }`, carried on `OrganizationInvite.role` and mirrored on the User row as booleans `admin`, `owner`, `guest`, `app`, plus `active`.

- `owner` — Enterprise-only tier above admin.
- `admin` — workspace settings, billing, member management.
- `user` — normal member; sees all public teams (`canAccessAnyPublicTeam: true`).
- `guest` — [DOCUMENTED, linear.app/docs/scim] guests are invited into **specific teams only** and cannot browse the workspace. [OBSERVED] a guest is an ordinary row in the same user list with `isGuest: true, isAdmin: false, isActive: true` — no separate table.
- `app` — OAuth application actor. [OBSERVED] synthetic email `<uuid>@oauthapp.linear.app`; Linear's own agent uses `linear-<orgId>@linear.linear.app`. These appear as project members and comment authors, so they must be first-class users, not a side table.

SCIM group push maps IdP groups 1:1 onto teams, with reserved groups `linear-owners`, `linear-admins`, `linear-guests` assigning workspace roles — evidence that role is a single enum per (user, workspace), not a set.

**Team level** — `TeamMembership { user, team, owner: Boolean!, sortOrder }`, i.e. a two-value role (`enum TeamRoleType { member, owner }`). `Team.visibility` (`public` / `private` / `restricted`) gates who may see or join; `Team.joinByDefault` / `allMembersCanJoin` control self-service joining.

**Project level** — `Project.members: UserConnection!` with **no role on the membership**, plus a distinguished `Project.lead: User` and `Project.leadTeam: Team`. [OBSERVED] a live project's members list is a flat array of `{id, name, email}` and includes an app user. `Project.teams` is many-to-many with Team.

**Issue level** — `Issue.sharedAccess: IssueSharedAccess { isShared, sharedWithUsers, sharedWithCount, disallowedIssueFields, viewerHasOnlySharedAccess }` and `Issue.inheritsSharedAccess: Boolean!`, gated workspace-wide by `enum IssueSharingPolicy { adminsOnly, allMembers, disabled }`.

---

## 4. Proposed schema

[PROPOSED] throughout. Postgres 15+. Conventions:

- `uuid` primary keys, `gen_random_uuid()` (pgcrypto / built-in in PG13+). Client-supplied ids are accepted on insert, matching Linear's `IssueCreateInput.id`, because offline-first clients need to name a row before the server sees it.
- `timestamptz` everywhere; `date` for `TimelessDate`.
- Soft-delete via `archived_at timestamptz` (Linear's convention) rather than row deletion; `trashed_at` separately for the user-visible trash bin.
- `ON DELETE` behaviour is chosen for the *hard* deletes that do happen (workspace deletion, user hard-delete under GDPR). Everyday deletion is soft.
- Order keys are `text COLLATE "C"` — see §3.2.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive email / url_key
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- title search
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ─────────────────────────────────────────────────────────────
-- Enums.  Linear ships several of these as bare String!; we make
-- them real types so bad values cannot be written (see §2.1).
-- ─────────────────────────────────────────────────────────────
CREATE TYPE workflow_state_type AS ENUM
  ('triage','backlog','unstarted','started','completed','canceled','duplicate');
CREATE TYPE project_status_type AS ENUM
  ('backlog','planned','started','paused','completed','canceled');
CREATE TYPE project_milestone_status AS ENUM ('unstarted','next','overdue','done');
CREATE TYPE project_health AS ENUM ('onTrack','atRisk','offTrack');
CREATE TYPE date_resolution AS ENUM ('month','quarter','halfYear','year');
CREATE TYPE workspace_role AS ENUM ('owner','admin','user','guest','app');
CREATE TYPE team_role AS ENUM ('owner','member');
CREATE TYPE team_visibility AS ENUM ('public','private','restricted');
CREATE TYPE issue_relation_type AS ENUM ('blocks','duplicate','related','similar');
CREATE TYPE estimation_type AS ENUM
  ('notUsed','exponential','fibonacci','linear','tShirt');
CREATE TYPE reactable_type AS ENUM ('issue','comment','project_update','document');
CREATE TYPE favorite_target AS ENUM
  ('issue','project','cycle','document','label','team','user','saved_view','folder');

-- ─────────────────────────────────────────────────────────────
-- Identity
-- ─────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext      NOT NULL,
  email_verified_at  timestamptz,
  password_hash      text,                       -- null for OAuth-only / app users
  name               text        NOT NULL,
  display_name       text        NOT NULL,
  avatar_url         text,
  avatar_color       text        NOT NULL DEFAULT '#5E6AD2',
  timezone           text,
  title              text,
  description        text,
  status_emoji       text,
  status_label       text,
  status_until_at    timestamptz,
  is_app             boolean     NOT NULL DEFAULT false,
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,                  -- store a hash, never the token
  user_agent     text,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash)
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id)
  WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Workspace
-- ─────────────────────────────────────────────────────────────
CREATE TABLE workspaces (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  url_key               citext      NOT NULL,
  previous_url_keys     text[]      NOT NULL DEFAULT '{}',
  logo_url              text,
  git_branch_format     text NOT NULL DEFAULT '{username}/{identifier}-{title}',
  fiscal_year_start_month smallint  NOT NULL DEFAULT 1,
  working_days          smallint[]  NOT NULL DEFAULT '{1,2,3,4,5}',
  -- one counter for project identifiers, mirroring Organization.createdIssueCount
  project_counter       integer     NOT NULL DEFAULT 0,
  settings              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,
  CONSTRAINT workspaces_url_key_key UNIQUE (url_key)
);

CREATE TABLE workspace_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  role          workspace_role NOT NULL DEFAULT 'user',
  is_active     boolean NOT NULL DEFAULT true,
  disable_reason text,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT workspace_members_uniq UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);
-- one owner minimum is enforced in the app; a partial unique index would
-- forbid co-owners, which Linear allows.

CREATE TABLE workspace_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  role          workspace_role NOT NULL DEFAULT 'user',
  inviter_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  invitee_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  token_hash    text NOT NULL,
  accepted_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_invites_uniq UNIQUE (workspace_id, email)
);

-- ─────────────────────────────────────────────────────────────
-- Teams
-- ─────────────────────────────────────────────────────────────
CREATE TABLE teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES teams(id) ON DELETE SET NULL,
  key           text NOT NULL,
  name          text NOT NULL,
  description   text,
  icon          text,
  color         text,
  visibility    team_visibility NOT NULL DEFAULT 'public',
  timezone      text NOT NULL DEFAULT 'America/Los_Angeles',

  -- THE per-team issue number counter.  See §3.1 / the note below.
  issue_counter integer NOT NULL DEFAULT 0,

  default_state_id      uuid,        -- FK added after workflow_states exists
  triage_enabled        boolean NOT NULL DEFAULT false,
  triage_state_id       uuid,
  require_priority_to_leave_triage boolean NOT NULL DEFAULT false,

  estimation_type       estimation_type NOT NULL DEFAULT 'notUsed',
  estimation_allow_zero boolean NOT NULL DEFAULT false,
  estimation_extended   boolean NOT NULL DEFAULT false,
  default_issue_estimate numeric(6,2) NOT NULL DEFAULT 1,

  cycles_enabled        boolean NOT NULL DEFAULT false,
  cycle_duration_weeks  smallint NOT NULL DEFAULT 2,
  cycle_cooldown_weeks  smallint NOT NULL DEFAULT 0,
  cycle_start_day       smallint NOT NULL DEFAULT 1,

  auto_archive_months   smallint NOT NULL DEFAULT 3,
  auto_close_months     smallint,                       -- null = disabled
  auto_close_state_id   uuid,
  sort_order_on_state_change text NOT NULL DEFAULT 'bottom',  -- 'top'|'bottom'|'noChange'

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT teams_key_uniq  UNIQUE (workspace_id, key),
  CONSTRAINT teams_name_uniq UNIQUE (workspace_id, name),
  CONSTRAINT teams_key_format CHECK (key ~ '^[A-Z0-9]{1,5}$'),
  CONSTRAINT teams_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX teams_workspace_idx ON teams (workspace_id) WHERE archived_at IS NULL;

CREATE TABLE team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        team_role NOT NULL DEFAULT 'member',
  sort_order  text COLLATE "C" NOT NULL,     -- per-user sidebar order of teams
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT team_members_uniq UNIQUE (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id, sort_order);

-- ─────────────────────────────────────────────────────────────
-- Workflow states
-- ─────────────────────────────────────────────────────────────
CREATE TABLE workflow_states (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name         text NOT NULL,
  type         workflow_state_type NOT NULL,
  color        text NOT NULL,
  description  text,
  position     double precision NOT NULL,
  inherited_from_id uuid REFERENCES workflow_states(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT workflow_states_name_uniq UNIQUE (team_id, name),
  CONSTRAINT workflow_states_color_hex CHECK (color ~* '^#[0-9a-f]{6}$')
);
CREATE INDEX workflow_states_team_idx ON workflow_states (team_id, type, position);

ALTER TABLE teams
  ADD CONSTRAINT teams_default_state_fk
    FOREIGN KEY (default_state_id)    REFERENCES workflow_states(id) ON DELETE SET NULL,
  ADD CONSTRAINT teams_triage_state_fk
    FOREIGN KEY (triage_state_id)     REFERENCES workflow_states(id) ON DELETE SET NULL,
  ADD CONSTRAINT teams_auto_close_state_fk
    FOREIGN KEY (auto_close_state_id) REFERENCES workflow_states(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- Labels.  team_id NULL  ⇒  workspace-level label (Linear's rule).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE labels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id      uuid REFERENCES teams(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES labels(id) ON DELETE SET NULL,
  name         text NOT NULL,
  color        text NOT NULL,
  description  text,
  is_group     boolean NOT NULL DEFAULT false,
  creator_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  last_applied_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT labels_group_has_no_parent CHECK (NOT (is_group AND parent_id IS NOT NULL))
);
-- Two partial uniques, because UNIQUE(team_id, name) does not constrain NULL team_id.
CREATE UNIQUE INDEX labels_team_name_uniq ON labels (team_id, lower(name))
  WHERE team_id IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX labels_workspace_name_uniq ON labels (workspace_id, lower(name))
  WHERE team_id IS NULL AND archived_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Projects
-- ─────────────────────────────────────────────────────────────
CREATE TABLE project_statuses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id      uuid REFERENCES teams(id) ON DELETE CASCADE,   -- null = workspace-wide
  name         text NOT NULL,
  type         project_status_type NOT NULL,
  color        text NOT NULL,
  description  text,
  position     double precision NOT NULL,
  indefinite   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);
CREATE UNIQUE INDEX project_statuses_ws_name_uniq
  ON project_statuses (workspace_id, lower(name)) WHERE team_id IS NULL;

CREATE TABLE projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number        integer NOT NULL,                    -- from workspaces.project_counter
  slug_id       text NOT NULL,                       -- 12 hex chars, URL-stable
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',            -- short blurb
  content       text,                                -- long markdown body
  icon          text,
  color         text NOT NULL DEFAULT '#5E6AD2',
  status_id     uuid NOT NULL REFERENCES project_statuses(id) ON DELETE RESTRICT,
  health        project_health,
  health_updated_at timestamptz,
  priority      smallint NOT NULL DEFAULT 0,
  lead_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  creator_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  start_date            date,
  start_date_resolution date_resolution,
  target_date           date,
  target_date_resolution date_resolution,
  sort_order    text COLLATE "C" NOT NULL,
  started_at    timestamptz,
  completed_at  timestamptz,
  canceled_at   timestamptz,
  trashed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT projects_number_uniq  UNIQUE (workspace_id, number),
  CONSTRAINT projects_slug_uniq    UNIQUE (workspace_id, slug_id),
  CONSTRAINT projects_priority_rng CHECK (priority BETWEEN 0 AND 4),
  -- resolution is only meaningful when the date is set
  CONSTRAINT projects_start_res_needs_date
    CHECK (start_date_resolution IS NULL OR start_date IS NOT NULL),
  CONSTRAINT projects_target_res_needs_date
    CHECK (target_date_resolution IS NULL OR target_date IS NOT NULL)
);
CREATE INDEX projects_ws_sort_idx ON projects (workspace_id, sort_order)
  WHERE archived_at IS NULL AND trashed_at IS NULL;
CREATE INDEX projects_lead_idx    ON projects (lead_id)   WHERE archived_at IS NULL;
CREATE INDEX projects_status_idx  ON projects (status_id) WHERE archived_at IS NULL;

-- Project ↔ Team is many-to-many (a project spans teams).
CREATE TABLE project_teams (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id)
);
CREATE INDEX project_teams_team_idx ON project_teams (team_id);

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

CREATE TABLE project_milestones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  target_date date,
  status      project_milestone_status NOT NULL DEFAULT 'unstarted',
  sort_order  text COLLATE "C" NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT project_milestones_name_uniq UNIQUE (project_id, name)
);
CREATE INDEX project_milestones_project_idx
  ON project_milestones (project_id, sort_order);

CREATE TABLE project_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL,
  health      project_health NOT NULL,
  slug_id     text NOT NULL,
  edited_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX project_updates_project_idx
  ON project_updates (project_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- Cycles
-- ─────────────────────────────────────────────────────────────
CREATE TABLE cycles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  number      integer NOT NULL,
  name        text,
  description text,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  completed_at timestamptz,
  auto_archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT cycles_number_uniq UNIQUE (team_id, number),
  CONSTRAINT cycles_range CHECK (ends_at > starts_at)
);
CREATE INDEX cycles_team_window_idx ON cycles (team_id, starts_at, ends_at);

-- ─────────────────────────────────────────────────────────────
-- Issues
-- ─────────────────────────────────────────────────────────────
CREATE TABLE issues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES teams(id)      ON DELETE CASCADE,
  number        integer NOT NULL,
  -- Denormalized "ENG-123", maintained by trigger from teams.key + number.
  -- Source of truth remains (team_id, number); see Deviations.
  identifier    text NOT NULL,
  previous_identifiers text[] NOT NULL DEFAULT '{}',

  title         text NOT NULL,
  description   text,                          -- markdown, canonical

  state_id      uuid NOT NULL REFERENCES workflow_states(id) ON DELETE RESTRICT,
  priority      smallint NOT NULL DEFAULT 0,
  estimate      numeric(6,2),                  -- NULL ≠ 0 (see §2.1)

  assignee_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  creator_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  snoozed_by_id uuid REFERENCES users(id) ON DELETE SET NULL,

  parent_id     uuid REFERENCES issues(id)   ON DELETE SET NULL,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  project_milestone_id uuid REFERENCES project_milestones(id) ON DELETE SET NULL,
  cycle_id      uuid REFERENCES cycles(id)   ON DELETE SET NULL,

  sort_order           text COLLATE "C" NOT NULL,
  sub_issue_sort_order text COLLATE "C",       -- NULL iff parent_id IS NULL

  due_date        date,
  started_at      timestamptz,
  completed_at    timestamptz,
  canceled_at     timestamptz,
  started_triage_at timestamptz,
  triaged_at      timestamptz,                 -- "left triage" — see §3.3
  snoozed_until_at timestamptz,
  auto_closed_at  timestamptz,
  auto_archived_at timestamptz,
  added_to_cycle_at   timestamptz,
  added_to_project_at timestamptz,
  added_to_team_at    timestamptz,
  trashed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')),       'A') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'B')
  ) STORED,

  CONSTRAINT issues_number_uniq     UNIQUE (team_id, number),
  CONSTRAINT issues_identifier_uniq UNIQUE (workspace_id, identifier),
  CONSTRAINT issues_priority_rng    CHECK (priority BETWEEN 0 AND 4),
  CONSTRAINT issues_no_self_parent  CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT issues_sub_order_iff_parent CHECK (
    (parent_id IS NULL AND sub_issue_sort_order IS NULL) OR
    (parent_id IS NOT NULL AND sub_issue_sort_order IS NOT NULL)),
  CONSTRAINT issues_milestone_needs_project CHECK (
    project_milestone_id IS NULL OR project_id IS NOT NULL)
);

-- Main list query: team board/list grouped by status, manual order.
CREATE INDEX issues_team_state_order_idx
  ON issues (team_id, state_id, sort_order)
  WHERE archived_at IS NULL AND trashed_at IS NULL;

-- "My issues" and assignee grouping.
CREATE INDEX issues_assignee_idx
  ON issues (assignee_id, sort_order)
  WHERE archived_at IS NULL AND trashed_at IS NULL;

-- Project and cycle views.
CREATE INDEX issues_project_idx ON issues (project_id, sort_order)
  WHERE archived_at IS NULL AND trashed_at IS NULL;
CREATE INDEX issues_milestone_idx ON issues (project_milestone_id, sort_order)
  WHERE project_milestone_id IS NOT NULL;
CREATE INDEX issues_cycle_idx   ON issues (cycle_id, sort_order)
  WHERE cycle_id IS NOT NULL AND archived_at IS NULL;

-- Sub-issue list.
CREATE INDEX issues_parent_idx ON issues (parent_id, sub_issue_sort_order)
  WHERE parent_id IS NOT NULL;

-- Priority-ordered views: 0 ("No priority") must sort LAST — see §2.2.
CREATE INDEX issues_team_priority_idx
  ON issues (team_id, (CASE priority WHEN 0 THEN 5 ELSE priority END), sort_order)
  WHERE archived_at IS NULL AND trashed_at IS NULL;

-- Recency feeds and delta sync.
CREATE INDEX issues_ws_updated_idx ON issues (workspace_id, updated_at DESC);

-- Search: full-text, plus trigram for the identifier/title quick-open palette.
CREATE INDEX issues_search_idx     ON issues USING gin (search_tsv);
CREATE INDEX issues_title_trgm_idx ON issues USING gin (title gin_trgm_ops);
-- Old identifiers must still resolve after a team move (§3.1).
CREATE INDEX issues_prev_ident_idx ON issues USING gin (previous_identifiers);

CREATE TABLE issue_labels (
  issue_id   uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id   uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, label_id)
);
-- Needed for "all issues with label X" without scanning the issue table.
CREATE INDEX issue_labels_label_idx ON issue_labels (label_id, issue_id);

CREATE TABLE issue_subscribers (
  issue_id   uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX issue_subscribers_user_idx ON issue_subscribers (user_id);

-- One row per relationship, one direction only — Linear's model (§3.4).
CREATE TABLE issue_relations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id         uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  related_issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  type             issue_relation_type NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  CONSTRAINT issue_relations_not_self CHECK (issue_id <> related_issue_id),
  -- For symmetric types the app must write the pair with issue_id < related_issue_id
  -- (canonical direction) so this unique index also prevents the mirrored duplicate.
  CONSTRAINT issue_relations_symmetric_canonical CHECK (
    type NOT IN ('related','similar') OR issue_id < related_issue_id)
);
CREATE UNIQUE INDEX issue_relations_uniq
  ON issue_relations (issue_id, related_issue_id, type);
CREATE INDEX issue_relations_inverse_idx ON issue_relations (related_issue_id, type);
-- An issue is a duplicate of at most one other.
CREATE UNIQUE INDEX issue_relations_one_duplicate_of
  ON issue_relations (issue_id) WHERE type = 'duplicate';

-- Interval table behind cycle-time analytics (Linear's IssueStateSpan).
CREATE TABLE issue_state_spans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id   uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  state_id   uuid NOT NULL REFERENCES workflow_states(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz,
  CONSTRAINT issue_state_spans_range CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX issue_state_spans_issue_idx ON issue_state_spans (issue_id, started_at);
-- At most one open span per issue.
CREATE UNIQUE INDEX issue_state_spans_open_uniq
  ON issue_state_spans (issue_id) WHERE ended_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Comments, reactions, attachments, documents
-- ─────────────────────────────────────────────────────────────
CREATE TABLE comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id          uuid REFERENCES issues(id)          ON DELETE CASCADE,
  project_id        uuid REFERENCES projects(id)        ON DELETE CASCADE,
  project_update_id uuid REFERENCES project_updates(id) ON DELETE CASCADE,
  document_id       uuid,   -- FK added after documents
  parent_id   uuid REFERENCES comments(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL,                 -- markdown, canonical
  quoted_text text,                          -- non-null ⇒ inline/anchored comment
  edited_at   timestamptz,
  resolved_at timestamptz,
  resolved_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  -- exactly one parent entity
  CONSTRAINT comments_one_parent CHECK (
    (issue_id IS NOT NULL)::int + (project_id IS NOT NULL)::int +
    (project_update_id IS NOT NULL)::int + (document_id IS NOT NULL)::int = 1),
  -- threads are one level deep, like Linear: a reply cannot have replies.
  -- enforced by trigger (a CHECK cannot query another row).
  CONSTRAINT comments_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX comments_issue_idx  ON comments (issue_id, created_at)
  WHERE issue_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX comments_thread_idx ON comments (parent_id, created_at)
  WHERE parent_id IS NOT NULL;
CREATE INDEX comments_project_idx ON comments (project_id, created_at)
  WHERE project_id IS NOT NULL;

CREATE TABLE reactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type   reactable_type NOT NULL,
  target_id     uuid NOT NULL,
  emoji         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reactions_uniq UNIQUE (user_id, target_type, target_id, emoji)
);
CREATE INDEX reactions_target_idx ON reactions (target_type, target_id);

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  creator_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  subtitle    text,
  url         text NOT NULL,
  source_type text,                            -- 'github' | 'slack' | 'upload' | …
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  -- Linear dedupes integration links by (issue, url).
  CONSTRAINT attachments_url_uniq UNIQUE (issue_id, url)
);
CREATE INDEX attachments_issue_idx ON attachments (issue_id, created_at);

CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  team_id      uuid REFERENCES teams(id)    ON DELETE CASCADE,
  issue_id     uuid REFERENCES issues(id)   ON DELETE CASCADE,
  title        text NOT NULL,
  content      text,
  icon         text,
  color        text,
  slug_id      text NOT NULL,
  sort_order   text COLLATE "C" NOT NULL,
  creator_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  owner_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  trashed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT documents_slug_uniq UNIQUE (workspace_id, slug_id)
);
CREATE INDEX documents_project_idx ON documents (project_id, sort_order)
  WHERE project_id IS NOT NULL;

ALTER TABLE comments
  ADD CONSTRAINT comments_document_fk
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Notifications, favorites, saved views
-- ─────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- recipient
  actor_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  type          text NOT NULL,        -- see §5 event list
  category      text NOT NULL,
  issue_id      uuid REFERENCES issues(id)    ON DELETE CASCADE,
  project_id    uuid REFERENCES projects(id)  ON DELETE CASCADE,
  comment_id    uuid REFERENCES comments(id)  ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  reaction_emoji text,
  -- Pre-rendered, as Linear does: the inbox is a single-table scan.
  title         text NOT NULL,
  subtitle      text NOT NULL,
  grouping_key  text NOT NULL,
  grouping_priority real NOT NULL DEFAULT 0,
  issue_status_type workflow_state_type,       -- denormalized for inbox filters
  read_at       timestamptz,
  snoozed_until_at timestamptz,
  emailed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);
-- THE inbox query.
CREATE INDEX notifications_inbox_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX notifications_user_all_idx  ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_grouping_idx  ON notifications (user_id, grouping_key);
CREATE INDEX notifications_snoozed_idx   ON notifications (snoozed_until_at)
  WHERE snoozed_until_at IS NOT NULL;

CREATE TABLE favorites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES favorites(id) ON DELETE CASCADE,   -- folders
  target_type  favorite_target NOT NULL,
  target_id    uuid,                          -- null only for type 'folder'
  folder_name  text,
  sort_order   text COLLATE "C" NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorites_folder_shape CHECK (
    (target_type = 'folder' AND target_id IS NULL AND folder_name IS NOT NULL) OR
    (target_type <> 'folder' AND target_id IS NOT NULL)),
  CONSTRAINT favorites_uniq UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX favorites_user_idx ON favorites (user_id, sort_order);

CREATE TABLE saved_views (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id      uuid REFERENCES teams(id) ON DELETE CASCADE,  -- null = workspace view
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  name         text NOT NULL,
  description  text,
  icon         text,
  color        text,
  slug_id      text NOT NULL,
  model_name   text NOT NULL DEFAULT 'Issue',   -- Issue | Project | Initiative
  filter_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  shared       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT saved_views_slug_uniq UNIQUE (workspace_id, slug_id)
);
CREATE INDEX saved_views_ws_idx ON saved_views (workspace_id) WHERE shared;
CREATE INDEX saved_views_owner_idx ON saved_views (owner_id);

-- Two-layer display prefs, matching ViewPreferences {type: organization|user}.
CREATE TABLE view_preferences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        text NOT NULL CHECK (scope IN ('organization','user')),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  saved_view_id uuid REFERENCES saved_views(id) ON DELETE CASCADE,
  view_type    text NOT NULL,                  -- 'board' | 'myIssues' | 'cycle' | …
  view_key     text,                           -- team id / project id for built-ins
  preferences  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT view_prefs_user_iff_user_scope CHECK (
    (scope = 'user' AND user_id IS NOT NULL) OR
    (scope = 'organization' AND user_id IS NULL))
);
CREATE UNIQUE INDEX view_prefs_uniq
  ON view_preferences (workspace_id, scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       view_type, coalesce(view_key,''), coalesce(saved_view_id,'00000000-0000-0000-0000-000000000000'::uuid));
```

### 4.1 The issue-number counter

The one piece of concurrency-critical logic in the whole schema.

```sql
-- Inside the same transaction as the INSERT:
WITH bumped AS (
  UPDATE teams
     SET issue_counter = issue_counter + 1
   WHERE id = $team_id
  RETURNING issue_counter, key
)
INSERT INTO issues (id, workspace_id, team_id, number, identifier, title,
                    state_id, sort_order, creator_id)
SELECT $id, $workspace_id, $team_id, b.issue_counter,
       b.key || '-' || b.issue_counter, $title, $state_id, $sort_order, $creator_id
  FROM bumped b
RETURNING id, identifier;
```

Why this and not the alternatives:

- **A Postgres `SEQUENCE` per team** is non-blocking but **gap-prone** — a rolled-back insert burns a number. Linear's identifiers are dense in practice, and users notice gaps. It also means DDL on every team creation, and thousands of sequence objects.
- **`SELECT max(number)+1`** is a lost-update race. Under `READ COMMITTED` two concurrent creates both read the same max and one insert fails the unique constraint. Retrying works but turns a hot team into a livelock under load.
- **The `UPDATE … RETURNING` above** takes a row lock on the team for the remainder of the transaction, so concurrent creates in the *same team* serialize (correct and gapless), while creates in *different teams* proceed in parallel. Since the transaction is a single insert, the lock is held for microseconds. `unique(team_id, number)` remains as the backstop.

**Never reuse a number.** On a team move (§3.1), take a fresh number from the destination team, push the old identifier onto `previous_identifiers`, and leave the source team's counter untouched:

```sql
UPDATE issues
   SET previous_identifiers = previous_identifiers || identifier,
       team_id = $dest_team, number = $new_number, identifier = $new_identifier,
       cycle_id = NULL,                 -- "May be cleared"
       project_id = CASE WHEN EXISTS (SELECT 1 FROM project_teams
                                       WHERE project_id = issues.project_id
                                         AND team_id = $dest_team)
                         THEN project_id ELSE NULL END,   -- "Removed"
       state_id = $mapped_state
 WHERE id = $issue_id;
DELETE FROM issue_labels il USING labels l
 WHERE il.label_id = l.id AND il.issue_id = $issue_id AND l.team_id IS NOT NULL;
-- workspace labels (l.team_id IS NULL) survive; relations and priority untouched
```

### 4.2 Verification

[VERIFIED] The DDL in §4 was extracted from this document and executed against `postgres:16-alpine`. It applies clean — **30 tables, 0 errors**. Each of the following was then exercised with a seeded workspace/team/state and behaved as specified:

| Check | Result |
|---|---|
| Counter allocates gapless per team, identifier composed correctly | `ENG-1`, `ENG-2`, `ENG-3` ✅ |
| `teams_key_format` rejects lowercase (`eng2`) and >5 chars (`TOOLONG`) | both rejected ✅ |
| `issues_number_uniq` rejects a reused `(team_id, number)` | rejected ✅ |
| `issues_sub_order_iff_parent` rejects a sub-order with no parent | rejected ✅ |
| `issue_relations_symmetric_canonical` rejects the mirrored `related` row | rejected ✅ |
| `issue_state_spans_open_uniq` rejects a second open span | rejected ✅ |
| `comments_one_parent` rejects zero parents; accepts exactly one | both correct ✅ |
| Priority display order puts `0` last | `1,2,3,4,0` ✅ |
| `COLLATE "C"` orders fractional-index keys correctly | ✅ (and ICU does not — see §3.2) |

The one bug this caught: the DDL originally used the `citext` type without `CREATE EXTENSION citext`, which cascades into every downstream table failing. Fixed.

---

## 5. Activity feed design

### 5.1 Linear's approach, and why not to copy it

[DOCUMENTED] `type IssueHistory` has **~70 fields**, almost all nullable, in matched `from*`/`to*` pairs: `fromAssignee`/`toAssignee`, `fromState`/`toState`, `fromPriority`/`toPriority`, `fromEstimate`/`toEstimate`, `fromCycle`/`toCycle`, `fromProject`/`toProject`, `fromProjectMilestone`/`toProjectMilestone`, `fromParent`/`toParent`, `fromTeam`/`toTeam`, `fromTitle`/`toTitle`, `fromDueDate`/`toDueDate`, `fromDelegate`/`toDelegate`, `fromSlaBreachesAt`/`toSlaBreachesAt`, `fromSlaStartedAt`/`toSlaStartedAt`, `fromSlaType`/`toSlaType`, `fromSlaBreached`/`toSlaBreached`, plus set-valued `addedLabelIds`/`removedLabelIds`, `addedToReleaseIds`/`removedFromReleaseIds`, plus booleans `archived`, `autoArchived`, `autoClosed`, `trashed`, `updatedDescription`, plus `actor`/`botActor`/`descriptionUpdatedBy`, `attachment`, `relationChanges: [IssueRelationHistoryPayload!]`, `toConvertedProject`, `triageResponsibility*`, `workflowMetadata`, `issueImport` — **and a `changes: JSONObject` escape hatch alongside all of it**.

That shape is a per-field-column design that has already lost: the `changes` JSON blob exists precisely because new tracked fields kept arriving and adding two nullable columns each time stopped scaling. Note also that Linear's own `ProjectHistory` — the newer sibling — is `{id, project, entries: JSONObject!, createdAt}`, i.e. they went **fully generic** the second time.

One more behaviour to reproduce, [DOCUMENTED, linear.app/docs/creating-issues]:

> "Changes made to an issue's properties in the first 3 minutes are considered part of the issue creation process, and won't be added to the activity log as changes to the issue."

And `Team.groupIssueHistory: Boolean!` collapses consecutive entries by the same actor in the UI.

### 5.2 Recommendation — [PROPOSED]

**A single generic event table with a discriminated JSONB payload, plus four promoted columns for indexing.** Not per-field columns.

```sql
CREATE TYPE activity_entity AS ENUM ('issue','project','comment','document','milestone');

CREATE TABLE activity_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type  activity_entity NOT NULL,
  entity_id    uuid NOT NULL,
  -- Promoted so the common feeds are index-only; issue_id is redundant with
  -- entity_id for issue events but lets comment/attachment events join the
  -- issue's timeline without a second table.
  issue_id     uuid REFERENCES issues(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES users(id)  ON DELETE SET NULL,
  type         text NOT NULL,                     -- see the list below
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Grouping: consecutive same-actor edits within a short window share a key,
  -- so the UI can collapse them (Team.groupIssueHistory).
  group_key    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_issue_idx  ON activity_events (issue_id, created_at DESC)
  WHERE issue_id IS NOT NULL;
CREATE INDEX activity_entity_idx ON activity_events (entity_type, entity_id, created_at DESC);
CREATE INDEX activity_actor_idx  ON activity_events (actor_id, created_at DESC);
CREATE INDEX activity_ws_idx     ON activity_events (workspace_id, created_at DESC);
CREATE INDEX activity_payload_idx ON activity_events USING gin (payload jsonb_path_ops);
```

Why generic wins here:

1. **The schema stops changing.** Every new tracked field is a new `type` value, not a migration adding two nullable columns to a table that is already the widest in the database.
2. **The read pattern is "give me everything on this issue, newest first."** It is never "find all issues whose priority changed from 2 to 1" — that query does not exist in the product. Per-field columns buy indexability nobody uses.
3. **Sparsity.** With ~70 columns and one or two set per row, a per-column table is mostly NULL bitmap. JSONB stores only what is present.
4. **It is where Linear ended up anyway** (`changes: JSONObject`, `ProjectHistory.entries: JSONObject!`).

The cost — you cannot `FOREIGN KEY` into a JSONB payload, so a referenced user/label/state id can dangle after a hard delete. That is the correct trade for an append-only audit log: **an activity entry should still read correctly after the thing it references is gone**, which is exactly why `actor_id` is `ON DELETE SET NULL` while the payload keeps a denormalized name snapshot.

**Payload convention.** Every state-change payload carries `{"from": …, "to": …}`; set changes carry `{"added": [...], "removed": [...]}`; each referenced entity is stored as `{"id": uuid, "name": "…"}` so the feed renders without joins and survives deletion.

```jsonc
// issue.state_changed
{"from": {"id":"…","name":"Todo","type":"unstarted"},
 "to":   {"id":"…","name":"In Progress","type":"started"}}

// issue.labels_changed
{"added":   [{"id":"…","name":"Infra","color":"#ee78ef"}],
 "removed": [{"id":"…","name":"UX","color":"#26b5ce"}]}

// issue.moved_to_team
{"from": {"id":"…","key":"ENG"}, "to": {"id":"…","key":"OPS"},
 "previousIdentifier": "ENG-123", "newIdentifier": "OPS-45"}
```

### 5.3 Event type list

```
# lifecycle
issue.created                    issue.archived              issue.unarchived
issue.deleted                    issue.trashed               issue.restored
issue.auto_closed                issue.auto_archived

# core fields
issue.title_changed              issue.description_updated
issue.state_changed              issue.priority_changed
issue.estimate_changed           issue.due_date_changed

# people
issue.assigned                   issue.unassigned
issue.delegate_changed
issue.subscriber_added           issue.subscriber_removed

# taxonomy & grouping
issue.labels_changed
issue.project_changed            issue.milestone_changed
issue.cycle_changed              issue.moved_to_team
issue.parent_changed             issue.sub_issue_added        issue.sub_issue_removed

# triage
issue.entered_triage             issue.left_triage
issue.snoozed                    issue.unsnoozed

# relations
issue.relation_added             issue.relation_removed
issue.marked_duplicate           issue.duplicate_unmarked

# discussion & files
comment.created                  comment.edited               comment.deleted
comment.resolved                 comment.unresolved
reaction.added                   reaction.removed
attachment.added                 attachment.removed

# project-level (entity_type = 'project')
project.created                  project.status_changed       project.health_changed
project.lead_changed             project.member_added         project.member_removed
project.dates_changed            project.team_added           project.team_removed
project.update_posted            project.archived
milestone.created                milestone.updated            milestone.deleted
```

**Suppression rules to implement** — [PROPOSED, mirroring documented Linear behaviour]:

1. **Creation grace window.** Suppress every `issue.*_changed` whose `created_at < issue.created_at + interval '3 minutes'` and whose actor is the creator. Do it at write time (don't record), so the log stays small.
2. **Grouping.** Assign `group_key = actor_id || ':' || entity_id || ':' || floor(epoch/300)` so consecutive edits by one person within five minutes collapse into one feed row when `teams.group_issue_history` is on.
3. **No-op suppression.** Never record an event where `from` equals `to`.
4. **Description edits.** Record `issue.description_updated` as a marker only, with no `from`/`to` body in the payload. Full-text revisions belong in a separate `document_revisions` table, not the activity log — Linear does the same, exposing description history as its own feature ("Issue description history"). Putting document bodies in the activity feed makes the table grow without bound.

---

## 6. Deviations & rationale

| # | Linear | This schema | Why |
|---|---|---|---|
| 1 | `sortOrder: Float!` (IEEE-754 double) | `sort_order text COLLATE "C"` (base-62 fractional index) | Doubles exhaust mantissa precision after ~50 inserts into the same gap and then silently stop ordering. Strings never do. Same O(1) write, same client-computes-the-key protocol. Cost: a few bytes and a mandatory `COLLATE "C"`. See §3.2. |
| 2 | Separate `sortOrder` **and** `boardOrder` | One `sort_order` | Linear itself deprecated `boardOrder`: "please use `sortOrder` instead". Don't build the thing they're deleting. |
| 3 | `prioritySortOrder` persisted | Not persisted; an expression index instead | A third order column is a third thing to keep consistent. `(CASE priority WHEN 0 THEN 5 ELSE priority END, sort_order)` reproduces the display order deterministically without a writable column. Revisit only if users need manual reordering *within* the priority view. |
| 4 | `WorkflowState.type`, `Team.issueEstimationType`, `Favorite.type`, `ViewPreferences.type` are `String!` with legal values only in a docstring | Real Postgres `ENUM` types | These are closed sets. A typo'd `"cancelled"` (two Ls) would silently create an issue state that no query matches. GraphQL leaves them as strings for API-evolution reasons that don't apply to our own database. |
| 5 | User row carries `admin`/`owner`/`guest`/`app` booleans; membership is implicit in `user.organization` | Separate `workspace_members` join with a `role` enum | Linear's User is already org-scoped (one row per user per workspace). Our `users` table is global identity, so membership *must* be a join. A single `role` enum also makes four mutually-exclusive booleans un-representable-wrong. |
| 6 | `TeamMembership.owner: Boolean!` | `team_members.role team_role` | Same information, extensible, and matches Linear's own newer `enum TeamRoleType { member, owner }`. |
| 7 | `IssueHistory` with ~70 `from*`/`to*` columns | One `activity_events` table with JSONB payload | See §5.1. Linear's newer `ProjectHistory` is already `entries: JSONObject!`. |
| 8 | `Favorite` with ~25 nullable target FK columns | `(target_type enum, target_id uuid)` polymorphic pair | 25 nullable FKs is unmaintainable. We lose referential integrity on favorites; the mitigation is a nightly sweep plus tolerating a dangling favorite (worst case: a sidebar entry 404s). Acceptable for a per-user bookmark; **not** acceptable for issues, which keep real FKs. |
| 9 | `Comment` with 7 nullable parent FKs | Kept as nullable FKs + a `CHECK` that exactly one is set | Opposite call to #8, deliberately. Comments are load-bearing and few in kind; real FKs give real cascades. The `CHECK ((a IS NOT NULL)::int + … = 1)` gives the discriminated-union guarantee without losing integrity. |
| 10 | `identifier` derived on read | `identifier` denormalized + trigger, with `(team_id, number)` still the source of truth | The quick-open palette and every `#ENG-123` link resolve by identifier; joining `teams` on every lookup to rebuild the string is wasteful, and `UNIQUE(workspace_id, identifier)` is a genuinely useful constraint. Renaming a team key rewrites the column for that team — a rare, bounded, backgroundable operation. |
| 11 | Relations exposed as `relations` + `inverseRelations`, with a `similar` type | One row per relation, canonical direction enforced for symmetric types; `similar` retained in the enum but unused by the UI | The `CHECK (type NOT IN ('related','similar') OR issue_id < related_issue_id)` plus the unique index makes the mirrored duplicate un-insertable, which Linear's schema does not prevent. `similar` is an ML-suggestion type; keep the enum value, don't build UI for it. |
| 12 | `trashed: Boolean` | `trashed_at timestamptz` | Same predicate (`trashed_at IS NOT NULL`), plus you learn *when*, which the trash-bin auto-purge needs anyway. Consistent with `archived_at`. |
| 13 | `descriptionState` (YJS) is the collaborative state; `Comment.bodyData` (ProseMirror) is canonical with `body` markdown derived | **Markdown is canonical**, single `text` column, no CRDT state | Linear needs YJS/ProseMirror for real-time multi-cursor editing. That is a separate, large subsystem. Storing markdown as the source of truth keeps the schema honest for a clone, keeps search working on the same column, and leaves a clean upgrade path: add a `content_state bytea` column later and flip which one is canonical. Note the inconsistency this avoids — Linear's Issue uses YJS while Comment uses ProseMirror, i.e. even they have two rich-text representations. |
| 14 | Milestone/project `progress`, `scope`, and `*History` arrays persisted on the row | Computed on read | Linear pre-materializes burn-up series because their sync engine ships whole models to clients. We can `SUM(estimate)` over an indexed `project_id`. Add a materialized view only when a project exceeds a few thousand issues. |
| 15 | Numbers via an unspecified mechanism | `UPDATE teams SET issue_counter = issue_counter + 1 RETURNING` in-transaction | Gapless and race-free; per-team row lock held for microseconds. Sequences would be gap-prone and require per-team DDL. See §4.1. |
| 16 | Cursor pagination on `(orderBy, id)` | Same | [OBSERVED] Linear's cursor is the last row's UUID with `orderBy: createdAt|updatedAt`. Keyset, not offset. Reproduce it — offset pagination breaks under concurrent inserts, which a realtime issue tracker has constantly. |
| 17 | Initiatives, Cycles-as-first-class, Customers/Needs, Releases, Triage rules, Agent sessions, SLAs, Templates, Integrations | Cycles included; the rest omitted | Scope. The tables above are the spine; each omitted subsystem attaches cleanly (`initiatives` + `initiative_projects`, `customers` + `customer_needs`, etc.) without reshaping anything here. |

---

## 7. Sources

**Live API (OBSERVED)** — Linear MCP server, read-only, against a real production workspace. Tools used: `get_workspace`, `list_teams`, `get_team`, `list_users`, `list_issue_statuses`, `list_issues`, `get_issue(includeRelations: true)`, `list_comments`, `list_issue_labels`, `list_projects(includeMilestones, includeMembers)`, `search_documentation`. No mutating call was made. All company-specific content is redacted or paraphrased.

**Linear GraphQL schema (DOCUMENTED)** — the authoritative field list, nullability, deprecations and docstrings:
- https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql (50,624 lines; downloaded and grepped directly)
- https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql
- https://linear.app/developers/graphql — endpoint `https://api.linear.app/graphql`, auth (`Authorization: Bearer <token>` for OAuth, bare `Authorization: <key>` for personal API keys), `includeArchived: true` to include archived rows, partial success with HTTP 200
- https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects — public schema explorer

**Linear product docs (DOCUMENTED)**
- https://linear.app/docs/creating-issues — "Issues are always linked to a single team. They have an issue ID (team's issue identifier and unique number)"; the 3-minute activity-log grace window; issue-creation URL params including the T-shirt→point mapping
- https://linear.app/docs/editing-issues — the complete move-between-teams field-effect table, and old-identifier redirect behaviour
- https://linear.app/docs/estimates — the four estimate scales, extended scales, and zero-vs-unestimated semantics
- https://linear.app/docs/teams — team settings surface
- https://linear.app/docs/custom-views — view scoping, sharing, ownership
- https://linear.app/docs/scim — role provisioning (`linear-owners`/`linear-admins`/`linear-guests`), guest handling, team↔group mapping
- https://linear.app/docs/conceptual-model — entity overview

**Ordering technique (DOCUMENTED)**
- https://www.figma.com/blog/realtime-editing-of-ordered-sequences/ — Evan Wallace on fractional indexing: index in (0,1), midpoint insert, arbitrary-precision base-95 strings instead of doubles, concurrent-insert and interleaving caveats
- https://github.com/rocicorp/fractional-indexing — reference implementation: `generateKeyBetween(a, b, digits?, intDigits?)`, `generateNKeysBetween(a, b, n)`, BASE_62_DIGITS, the integer-head magnitude prefix, jitter for concurrent generation
- https://www.steveruiz.me/posts/reordering-fractional-indices — practical walkthrough incl. rebalancing
- https://gist.github.com/Venryx/8e1c26cce0959f201b2d2080587c112b — survey of fractional-indexing schemes and ports
- https://medium.com/whisperarts/lexorank-what-are-they-and-how-to-use-them-for-efficient-list-sorting-a48fc4e7849f — LexoRank (Atlassian's variant) for comparison

**Schema verification (VERIFIED)** — the §4 DDL was executed against `postgres:16-alpine` in Docker, and the constraint/ordering behaviour in §4.2 was exercised with seeded rows. Nothing in §4 is untested prose.

**Linear architecture (background)**
- https://marknotfound.com/posts/reverse-engineering-linears-sync-magic/ — the sync engine: full/partial bootstrap into IndexedDB, `lastSyncId` staleness detection, `/sync/delta` returning `SyncAction {id, modelName, modelId, action: "I"|"U"|"D"|"A", data}`, Postgres backing store, ~40 model types. Relevant to Lane C only as confirmation that the server ships whole models keyed by `(modelName, modelId)` — which is why so many Linear fields are pre-materialized.
